/**
 * 백업 파일 다루기 (브라우저 · D-86)
 * - 전체 자료 백업(.json.gz) 미리 보기·압축 → 빈 시스템 복원 요청
 * - 사진 백업: 달마다 사진을 한 장씩 받아 ZIP으로 묶기 / ZIP에서 꺼내 원본이 없는 사진에 올리기
 */
import type { DemoDB } from "@/lib/domain/types";
import { PHOTO_BACKUP_FORMAT, photoFileName, photoMonth, type PhotoManifest } from "@/lib/domain/photoBackup";
import { readZip, unzipEntry, zipStore, type ZipEntry } from "@/lib/domain/zip";
import { todayIso } from "@/lib/domain/format";

/** 서버 요청 한도(4.5MB) 안 — base64로 늘어나는 것(×4/3)까지 생각한 압축 파일 크기 */
export const MAX_RESTORE_GZ = 3_200_000;

const isGzip = (b: Uint8Array) => b[0] === 0x1f && b[1] === 0x8b;

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(t);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface BackupPeek {
  companyName: string;
  exportedAt: string | null;
  ceoEmails: string[];
  members: number;
  rows: number;
}

/** 고른 파일이 백업인지, 어느 회사·언제 백업인지 미리 본다 (서버에 보내기 전) */
export async function peekBackup(file: File): Promise<{ peek: BackupPeek; payload: string }> {
  const raw = new Uint8Array(await file.arrayBuffer());
  let text: string;
  if (isGzip(raw)) {
    if (typeof DecompressionStream === "undefined") throw new Error("이 브라우저는 압축 파일을 열 수 없습니다. 크롬·엣지 최신 버전에서 해 주세요.");
    text = new TextDecoder().decode(await pipe(raw, new DecompressionStream("gzip")));
  } else text = new TextDecoder().decode(raw);
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new Error("백업 파일이 아닙니다. ‘전체 자료 백업’에서 내려받은 파일(taekang_backup_….json.gz)을 골라 주세요.");
  }
  if (j.format !== "taekang-site-intelligence-backup") throw new Error("태강 현장관리 백업 파일이 아닙니다.");
  if (!Array.isArray(j.members)) throw new Error("시연(DEMO) 화면에서 내려받은 가상 자료는 복원할 수 없습니다. 운영 화면의 ‘전체 자료 백업’ 파일을 골라 주세요.");
  const data = (j.data ?? {}) as Record<string, unknown>;
  const members = j.members as { email?: string; role?: string; active?: boolean }[];
  // 사용자 목록(users)은 자료 건수에 넣지 않는다 — 복원 결과의 ‘자료 N건’과 같은 숫자가 나오게
  const rows = Object.entries(data).reduce<number>((a, [k, v]) => a + (k !== "users" && Array.isArray(v) ? v.length : 0), 0);
  // 서버로는 압축본을 보낸다 (원문 1년치 약 15MB → 0.4MB)
  let gz: Uint8Array = raw;
  if (!isGzip(raw)) {
    if (typeof CompressionStream === "undefined") {
      if (raw.length > MAX_RESTORE_GZ) throw new Error("이 브라우저에서는 큰 백업 파일을 보낼 수 없습니다. 크롬·엣지 최신 버전에서 해 주세요.");
    } else gz = await pipe(raw, new CompressionStream("gzip"));
  }
  if (gz.length > MAX_RESTORE_GZ) throw new Error("백업 파일이 너무 커서 화면으로 복원할 수 없습니다. 개발 담당에게 DB 복원을 요청하세요.");
  return {
    peek: {
      companyName: String((data.company as { name?: string } | undefined)?.name ?? ""),
      exportedAt: typeof j.exportedAt === "string" ? j.exportedAt : null,
      ceoEmails: members.filter((m) => m.role === "ceo" && m.active !== false && typeof m.email === "string").map((m) => m.email as string),
      members: members.length,
      rows,
    },
    payload: toBase64(gz),
  };
}

// ───────────── 사진 백업 ─────────────

export interface PhotoZipResult {
  parts: Uint8Array[];
  saved: number;
  /** 원본이 없어 빠진 사진 (복원 뒤 아직 안 올린 것) */
  missing: number;
  failed: number;
}

/** 한 달 사진을 ZIP으로 — 사진마다 기존 주소(/api/photos/…)로 받는다(권한 확인 그대로). 4장씩 동시에 */
export async function buildPhotoZip(db: DemoDB, month: string, onProgress: (done: number, total: number) => void): Promise<PhotoZipResult> {
  const list = db.photos.filter((p) => photoMonth(p.createdAt) === month).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const siteName = new Map(db.sites.map((s) => [s.id, s.shortName || s.name]));
  const got: (ZipEntry & { meta: PhotoManifest["photos"][number] })[] = [];
  let missing = 0;
  let failed = 0;
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const p = list[next++];
      try {
        const r = await fetch(`/api/photos/${encodeURIComponent(p.id)}`, { credentials: "same-origin", cache: "no-store" });
        const mime = (r.headers.get("content-type") ?? "").split(";")[0];
        if (r.ok && mime === "image/svg+xml") missing += 1;
        else if (!r.ok || !/^image\/(jpeg|png|webp)$/.test(mime)) failed += 1;
        else {
          const site = siteName.get(p.siteId) ?? "현장";
          const name = photoFileName(p, site, mime);
          got.push({ name, data: new Uint8Array(await r.arrayBuffer()), date: new Date(p.createdAt), meta: { file: name, id: p.id, siteId: p.siteId, site, date: todayIso(new Date(p.createdAt)), caption: p.caption ?? "", mime } });
        }
      } catch {
        failed += 1;
      }
      onProgress(++done, list.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  got.sort((a, b) => a.name.localeCompare(b.name));
  const manifest: PhotoManifest = { format: PHOTO_BACKUP_FORMAT, version: 1, month, exportedAt: new Date().toISOString(), photos: got.map((g) => g.meta) };
  const entries: ZipEntry[] = [{ name: "photos.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 1)) }, ...got.map(({ name, data, date }) => ({ name, data, date }))];
  return { parts: zipStore(entries), saved: got.length, missing, failed };
}

export interface PhotoRestoreResult {
  saved: number;
  existed: number;
  unknown: number;
  invalid: number;
  failed: number;
}

/** 사진 백업 ZIP에서 꺼내 올린다 — 원본이 없는 사진만 서버가 채운다. 한 번에 40장·3MB 이하로 나눠 보낸다 */
export async function uploadPhotoZip(file: File, onProgress: (done: number, total: number) => void): Promise<PhotoRestoreResult> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let files;
  try {
    files = readZip(buf);
  } catch {
    throw new Error("ZIP 파일이 아닙니다. ‘사진 백업’에서 내려받은 파일(taekang_photos_….zip)을 골라 주세요.");
  }
  const mf = files.find((f) => f.name === "photos.json" || f.name.endsWith("/photos.json"));
  if (!mf) throw new Error("사진 백업 파일이 아닙니다(목록 photos.json이 없음).");
  let manifest: PhotoManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(await unzipEntry(mf)));
  } catch {
    throw new Error("사진 백업의 목록을 읽을 수 없습니다.");
  }
  if (manifest.format !== PHOTO_BACKUP_FORMAT || !Array.isArray(manifest.photos)) throw new Error("사진 백업 파일이 아닙니다.");
  const prefix = mf.name.slice(0, mf.name.length - "photos.json".length);
  const byName = new Map(files.map((f) => [f.name, f]));
  const out: PhotoRestoreResult = { saved: 0, existed: 0, unknown: 0, invalid: 0, failed: 0 };
  let batch: { id: string; mime: string; data: string }[] = [];
  let size = 0;
  let done = 0;
  const total = manifest.photos.length;
  const send = async () => {
    if (!batch.length) return;
    const n = batch.length;
    const r = await fetch("/api/backup/photos", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ photos: batch }) }).catch(() => null);
    const j = r?.ok ? ((await r.json().catch(() => null)) as Omit<PhotoRestoreResult, "failed"> | null) : null;
    if (j) {
      out.saved += j.saved;
      out.existed += j.existed;
      out.unknown += j.unknown;
      out.invalid += j.invalid;
    } else out.failed += n;
    batch = [];
    size = 0;
    done += n;
    onProgress(done, total);
  };
  for (const item of manifest.photos) {
    const f = byName.get(prefix + item.file) ?? byName.get(item.file);
    if (!f) {
      out.failed += 1;
      onProgress(++done, total);
      continue;
    }
    let data: string;
    try {
      data = toBase64(await unzipEntry(f));
    } catch {
      out.invalid += 1;
      onProgress(++done, total);
      continue;
    }
    if (size + data.length > 3_000_000 || batch.length >= 40) await send();
    batch.push({ id: item.id, mime: item.mime, data });
    size += data.length;
  }
  await send();
  return out;
}
