/**
 * 아주 작은 ZIP 쓰기·읽기 (D-86 사진 백업) — 사진(JPEG·PNG)은 이미 압축돼 있어 ‘저장(store)’ 방식으로 묶는다.
 * 만든 파일은 윈도우 탐색기·맥에서 그대로 열린다(파일 이름 UTF-8). 읽기는 store와 deflate(다시 압축한 파일)를 받는다.
 * ZIP64는 쓰지 않는다 — 한 파일 4GB·6만5천 장 미만 (월별 사진 백업은 수백 MB 이하).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** 파일 시각 (없으면 지금) */
  date?: Date;
}

function dosTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** 여러 파일을 ZIP 한 덩어리로 (Blob으로 감싸 내려받기). 데이터는 복사하지 않고 조각 목록으로 돌려준다 */
export function zipStore(entries: ZipEntry[]): Uint8Array[] {
  if (entries.length >= 0xffff) throw new Error("ZIP 파일 수가 너무 많습니다.");
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const { time, date } = dosTime(e.date ?? new Date());
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // 풀 때 필요한 버전
    lv.setUint16(6, 0x0800, true); // 이름 UTF-8
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(local, e.data);
    central.push(cd);
    offset += local.length + e.data.length;
    if (offset > 0xffffffff) throw new Error("ZIP 파일이 너무 큽니다.");
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return [...parts, ...central, end];
}

export interface ZipFile {
  name: string;
  /** 0 = store, 8 = deflate */
  method: number;
  /** 압축된(또는 그대로) 데이터 */
  raw: Uint8Array;
  size: number;
  crc: number;
}

/** ZIP 목록 읽기 — 파일 내용은 raw 그대로(deflate면 unzipEntry로 푼다) */
export function readZip(buf: Uint8Array): ZipFile[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP 파일이 아닙니다.");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: ZipFile[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || v.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP 목록이 손상되었습니다.");
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const off = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (off + 30 > buf.length || v.getUint32(off, true) !== 0x04034b50) throw new Error("ZIP 파일이 손상되었습니다.");
    const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    if (start + csize > buf.length) throw new Error("ZIP 파일이 잘렸습니다.");
    if (name.endsWith("/")) continue;
    out.push({ name, method, raw: buf.subarray(start, start + csize), size, crc });
  }
  return out;
}

/** 파일 하나 꺼내기 — deflate는 브라우저·Node의 DecompressionStream으로 풀고, CRC로 손상 여부를 확인한다 */
export async function unzipEntry(f: ZipFile): Promise<Uint8Array> {
  let data: Uint8Array;
  if (f.method === 0) data = f.raw;
  else if (f.method === 8) {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([f.raw as BlobPart]).stream().pipeThrough(ds);
    data = new Uint8Array(await new Response(stream).arrayBuffer());
  } else throw new Error("이 ZIP 압축 방식은 읽을 수 없습니다.");
  if (data.length !== f.size || crc32(data) !== f.crc) throw new Error(`손상된 파일: ${f.name}`);
  return data;
}
