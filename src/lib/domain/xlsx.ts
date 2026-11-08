/**
 * 엑셀(.xlsx) 읽기·쓰기 — 외부 라이브러리 없이 (D-45)
 *
 * 읽기: xlsx는 XML 파일 묶음(zip)이다. 필요한 부분(통합 문서·시트·공유 문자열·서식)만 풀어 값으로 바꾼다.
 * - 압축 풀기는 브라우저·Node 내장 DecompressionStream("deflate-raw")
 * - 날짜: 엑셀은 날짜를 숫자(일련번호)로 저장하고 셀 서식으로 날짜임을 표시 → 서식을 보고 YYYY-MM-DD로 바꾼다
 * - 수식: 엑셀이 마지막으로 계산해 저장한 값을 쓴다 (계산하지 않음)
 * - 크기 제한: 파일 5MB, 풀었을 때 40MB(압축 폭탄 방지), 시트 5,000행·60열
 * - 예전 형식(.xls)·암호 걸린 파일은 읽지 않고 안내한다
 * 쓰기: 양식 파일(입력 시트 + 작성 안내 시트). 압축하지 않은(store) zip으로 만든다.
 *
 * 화면·서버 어디서나 쓰는 순수 함수 (DOM 없음).
 */

export class XlsxError extends Error {}

export const MAX_XLSX_BYTES = 5_000_000;
const MAX_UNZIPPED = 40_000_000;
const MAX_ROWS = 5_000;
const MAX_COLS = 60;

export interface XlsxSheet {
  name: string;
  hidden: boolean;
  /** rows[i] = 엑셀 (i+1)행. 빈 행은 [] */
  rows: string[][];
}

// ───────────────────────── zip ─────────────────────────

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  size: number;
  localOffset: number;
}

function zipEntries(b: Uint8Array): Map<string, ZipEntry> {
  // 끝에서부터 ‘중앙 디렉터리 끝’ 표시(PK\x05\x06)를 찾는다 (주석은 최대 65,535바이트)
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65_535); i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("엑셀 파일이 아니거나 손상된 파일입니다.");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  if (p === 0xffffffff || count === 0xffff) throw new XlsxError("파일이 너무 큽니다. 나눠서 올려주세요.");
  const out = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new XlsxError("엑셀 파일이 손상되었습니다.");
    const flags = u16(b, p + 8);
    if (flags & 1) throw new XlsxError("암호가 걸린 파일은 열 수 없습니다. 엑셀에서 암호를 풀고 다시 저장해 주세요.");
    const nameLen = u16(b, p + 28);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { name, method: u16(b, p + 10), compSize: u32(b, p + 20), size: u32(b, p + 24), localOffset: u32(b, p + 42) });
    p += 46 + nameLen + u16(b, p + 30) + u16(b, p + 32);
  }
  return out;
}

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new XlsxError("이 브라우저는 엑셀 파일을 읽을 수 없습니다. 크롬·엣지 최신 버전을 쓰거나 CSV로 저장해 올려주세요.");
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  void writer.write(data as unknown as BufferSource).catch(() => {});
  void writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new XlsxError("파일 내용이 너무 큽니다. 나눠서 올려주세요.");
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof XlsxError) throw e;
    throw new XlsxError("엑셀 파일이 손상되었습니다 (압축을 풀 수 없음).");
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

class Unzipper {
  private used = 0;
  constructor(
    private readonly b: Uint8Array,
    private readonly entries: Map<string, ZipEntry>,
  ) {}
  has(name: string) {
    return this.entries.has(name);
  }
  async text(name: string): Promise<string | null> {
    const e = this.entries.get(name);
    if (!e) return null;
    const left = MAX_UNZIPPED - this.used;
    if (e.size > left) throw new XlsxError("파일 내용이 너무 큽니다. 나눠서 올려주세요.");
    const lo = e.localOffset;
    if (lo + 30 > this.b.length || u32(this.b, lo) !== 0x04034b50) throw new XlsxError("엑셀 파일이 손상되었습니다.");
    const start = lo + 30 + u16(this.b, lo + 26) + u16(this.b, lo + 28);
    const raw = this.b.subarray(start, start + e.compSize);
    let data: Uint8Array;
    if (e.method === 0) data = raw;
    else if (e.method === 8) data = await inflateRaw(raw, left);
    else throw new XlsxError("지원하지 않는 압축 방식입니다. 엑셀에서 다시 저장해 주세요.");
    this.used += data.length;
    return new TextDecoder().decode(data);
  }
}

// ───────────────────────── XML (필요한 부분만) ─────────────────────────

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] !== "#") return ENT[e];
    const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = decodeXml(m[2] ?? m[3] ?? "");
  return out;
}
/** <si>·<is> 안의 글자: 서식 조각(<r><t>)을 이어 붙이고, 일본어 읽기(<rPh>)는 뺀다 */
function richText(inner: string): string {
  const s = inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of s.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += decodeXml(m[1] ?? "");
  return out;
}

// ───────────────────────── 날짜 ─────────────────────────

/** 엑셀 기본 날짜·시간 서식 번호 (한국어 등 동아시아 서식 27~36, 50~58 포함) */
const BUILTIN_DATE = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 36, 50, 51, 52, 53, 54, 57, 58]);
const BUILTIN_TIME = new Set([18, 19, 20, 21, 32, 33, 34, 35, 45, 46, 47, 55, 56]);
/** 칸 서식 종류 — 날짜·시간, 또는 백분율(엑셀 100% = 값 1 · D-71) */
type CellKind = "date" | "time" | "datetime" | "pct" | null;
const builtinKind = (id: number): CellKind => (id === 22 ? "datetime" : BUILTIN_TIME.has(id) ? "time" : BUILTIN_DATE.has(id) ? "date" : id === 9 || id === 10 ? "pct" : null);

/** 서식 문자열이 백분율인가 (따옴표 안 글자·\% 는 빼고 % 가 남는지) — 날짜가 아닐 때만 */
export function cellKind(code: string): CellKind {
  const d = dateKind(code);
  if (d) return d;
  return /%/.test(code.replace(/"[^"]*"/g, "").replace(/\\./g, "").split(";")[0]) ? "pct" : null;
}

/** 서식 문자열이 날짜/시간인가: 따옴표 글자·\x·[색상/지역] 을 빼고 y·d·m·h·s 가 남는지 */
export function dateKind(code: string): "date" | "time" | "datetime" | null {
  const c = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(?!h|m|s)[^\]]*\]/gi, "")
    .split(";")[0]
    .toLowerCase();
  if (/general|^@$/.test(c)) return null;
  const hasDate = /[yd]/.test(c) || (/m/.test(c) && !/[hs]/.test(c));
  const hasTime = /[hs]/.test(c);
  if (hasDate && hasTime) return "datetime";
  if (hasDate) return "date";
  if (hasTime) return "time";
  return null;
}

/** 엑셀 날짜 일련번호 → YYYY-MM-DD (date1904: 맥 예전 형식) */
export function serialToDate(serial: number, kind: "date" | "time" | "datetime" = "date", date1904 = false): string {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = base + Math.round(serial * 86_400_000);
  const iso = new Date(ms).toISOString();
  if (kind === "time") return iso.slice(11, 16);
  if (kind === "datetime" && Math.round((serial % 1) * 1440) !== 0) return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  return iso.slice(0, 10);
}

function numText(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (Number.isInteger(n)) return Math.abs(n) < 1e21 ? n.toFixed(0) : String(n);
  return String(parseFloat(n.toPrecision(15)));
}

/** 열 글자 → 0부터 (A=0, Z=25, AA=26) */
export function colIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref.toUpperCase());
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ───────────────────────── 읽기 ─────────────────────────

/** 파일 앞부분으로 종류 확인: xlsx(zip) / 예전 엑셀·암호 파일(OLE) / 그 밖 */
export function sniffSpreadsheet(b: Uint8Array): "xlsx" | "legacy" | "other" {
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "xlsx";
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "legacy";
  return "other";
}

export async function readXlsx(input: ArrayBuffer | Uint8Array): Promise<XlsxSheet[]> {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length > MAX_XLSX_BYTES) throw new XlsxError("파일이 너무 큽니다 (5MB 이하). 나눠서 올려주세요.");
  const kind = sniffSpreadsheet(b);
  if (kind === "legacy") throw new XlsxError("예전 엑셀 형식(.xls)이거나 암호가 걸린 파일입니다. 엑셀에서 암호를 풀고 ‘다른 이름으로 저장 → Excel 통합 문서(.xlsx)’로 저장해 주세요.");
  if (kind !== "xlsx") throw new XlsxError("엑셀(.xlsx) 파일이 아닙니다.");
  const zip = new Unzipper(b, zipEntries(b));
  const wb = await zip.text("xl/workbook.xml");
  if (!wb) throw new XlsxError("엑셀 통합 문서가 아닙니다 (워드·파워포인트 파일일 수 있음).");
  const date1904 = /<workbookPr\b[^>]*\bdate1904\s*=\s*"(1|true)"/i.test(wb);

  // 시트 → 파일 경로
  const rels = new Map<string, string>();
  for (const m of ((await zip.text("xl/_rels/workbook.xml.rels")) ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.Id && a.Target) rels.set(a.Id, resolvePath("xl/", a.Target));
  }

  // 공유 문자열
  const shared: string[] = [];
  const sst = await zip.text("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) shared.push(richText(m[1] ?? ""));

  // 셀 서식 → 날짜 종류
  const xfDate: CellKind[] = [];
  const styles = await zip.text("xl/styles.xml");
  if (styles) {
    const fmts = new Map<number, string>();
    for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
      const a = attrs(m[0]);
      fmts.set(Number(a.numFmtId), a.formatCode ?? "");
    }
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
    for (const m of xfs.matchAll(/<xf\b[^>]*?\/?>/g)) {
      const id = Number(attrs(m[0]).numFmtId ?? 0);
      const code = fmts.get(id);
      xfDate.push(code !== undefined ? cellKind(code) : builtinKind(id));
    }
  }

  const sheets: XlsxSheet[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const rid = a["r:id"] ?? Object.entries(a).find(([k]) => k.endsWith(":id"))?.[1];
    const path = rid ? rels.get(rid) : undefined;
    if (!path || !zip.has(path)) continue;
    const xml = (await zip.text(path)) ?? "";
    sheets.push({ name: a.name ?? `시트${sheets.length + 1}`, hidden: a.state === "hidden" || a.state === "veryHidden", rows: sheetRows(xml, shared, xfDate, date1904) });
  }
  if (!sheets.length) throw new XlsxError("읽을 수 있는 시트가 없습니다.");
  return sheets;
}

function resolvePath(baseDir: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : baseDir + target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}

function sheetRows(xml: string, shared: string[], xfDate: CellKind[], date1904: boolean): string[][] {
  const data = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] ?? "";
  const rows: string[][] = [];
  let nextRow = 1;
  for (const rm of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = attrs(rm[1]);
    const r = ra.r ? Number(ra.r) : nextRow;
    nextRow = r + 1;
    if (!Number.isInteger(r) || r < 1) continue;
    // 테두리·서식만 있는 빈 행(양식을 아래까지 꾸민 경우)은 건너뛴다 — 값이 있는 행만 제한에 센다 (리뷰 반영 D-49)
    if (r > MAX_ROWS) {
      if (/<v\b[^>]*>[^<]|<t\b[^>]*>[^<]/.test(rm[2] ?? "")) throw new XlsxError(`시트가 너무 깁니다 (${MAX_ROWS.toLocaleString()}행 이하). 나눠서 올려주세요.`);
      continue;
    }
    const cells: string[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attrs(cm[1]);
      const col = ca.r ? colIndex(ca.r) : nextCol;
      nextCol = col + 1;
      if (col < 0 || col >= MAX_COLS) continue;
      const inner = cm[2] ?? "";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const t = ca.t ?? "n";
      let text = "";
      if (t === "s") text = v !== undefined ? (shared[Number(v)] ?? "") : "";
      else if (t === "inlineStr") text = richText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      else if (t === "str") text = v !== undefined ? decodeXml(v) : "";
      else if (t === "b") text = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      else if (t === "e") text = v !== undefined ? decodeXml(v) : "";
      else if (t === "d") text = v !== undefined ? decodeXml(v).slice(0, 10) : "";
      else if (v !== undefined && v !== "") {
        const kind = xfDate[Number(ca.s ?? 0)] ?? null;
        const n = Number(v);
        // 백분율 서식 칸은 화면에 보이는 대로 ‘100%’ (값 1을 1로 읽어 100%가 1%가 되던 문제 · D-71 점검 반영)
        if (!kind || !Number.isFinite(n)) text = numText(v);
        else text = kind === "pct" ? `${numText(String(n * 100))}%` : serialToDate(n, kind, date1904);
      }
      while (cells.length < col) cells.push("");
      cells[col] = text;
    }
    while (rows.length < r - 1) rows.push([]);
    rows[r - 1] = cells;
  }
  // 끝의 빈 칸·빈 행 정리
  for (const row of rows) while (row.length && row[row.length - 1].trim() === "") row.pop();
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

/** 표 → CSV 글자 (행 번호 유지: 빈 행도 한 줄로 남긴다) */
export function rowsToCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
}

// ───────────────────────── 쓰기 (양식) ─────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // 고정 시각 (2026-01-01 00:00) — 같은 내용이면 같은 파일
  const time = 0;
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 이름
    lv.setUint16(8, 0, true); // 압축 안 함
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
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
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(local, f.data);
    central.push(cd);
    offset += local.length + f.data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const toSerial = (iso: string) => (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;

export interface SheetSpec {
  name: string;
  rows: string[][];
  /** 열 너비 (글자 수) */
  widths?: number[];
  /** 첫 줄을 굵게·고정 */
  header?: boolean;
  /** 셀 내용에 맞춰 줄바꿈 */
  wrap?: boolean;
  /** 날짜·숫자처럼 보이는 값을 엑셀 날짜·숫자 칸으로 (기본 켬) */
  typed?: boolean;
}

/** 서식 번호: 0 기본, 1 머리글(굵게·배경), 2 날짜(yyyy-mm-dd), 3 숫자(#,##0), 4 줄바꿈 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function sheetXml(s: SheetSpec): string {
  const typed = s.typed !== false;
  const cols = s.widths?.length ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const pane = s.header ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>` : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const rows = s.rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          const ref = `${colName(ci)}${ri + 1}`;
          if (v === "") return "";
          const head = s.header && ri === 0;
          if (!head && typed && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(toSerial(v))) return `<c r="${ref}" s="2"><v>${toSerial(v)}</v></c>`;
          if (!head && typed && /^-?\d{1,15}$/.test(v)) return `<c r="${ref}" s="${Math.abs(Number(v)) >= 1000 ? 3 : 0}"><v>${Number(v)}</v></c>`;
          const st = head ? 1 : s.wrap ? 4 : 0;
          return `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${pane}<sheetFormatPr defaultRowHeight="16.5"/>${cols}<sheetData>${rows}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

/** 엑셀 파일(.xlsx) 만들기 */
export function writeXlsx(sheets: SheetSpec[]): Uint8Array {
  const enc = new TextEncoder();
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets
    .map((s, i) => `<sheet name="${esc(s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("")}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(ct) },
    { name: "_rels/.rels", data: enc.encode(rootRels) },
    { name: "xl/workbook.xml", data: enc.encode(wb) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(wbRels) },
    { name: "xl/styles.xml", data: enc.encode(STYLES) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s)) })),
  ]);
}
