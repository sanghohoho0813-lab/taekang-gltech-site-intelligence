/**
 * 사진 백업 (D-86) 공통 — 서버(현황·올리기)와 브라우저(ZIP 만들기·풀기)가 같은 규칙을 쓴다.
 * ZIP 안: photos.json(목록) + 달/날짜_현장_설명_번호.jpg. 윈도우 탐색기에서 사진을 그대로 볼 수 있다.
 * 변경공사 증빙 파일(사진·PDF · D-88)도 같은 ZIP에 ‘변경공사증빙_…’ 이름으로 들어간다.
 */
import { todayIso } from "./format";

export const PHOTO_BACKUP_FORMAT = "taekang-site-intelligence-photos";

/** 사진이 올라온 달 — 한국 날짜 기준 */
export const photoMonth = (createdAt: string) => {
  const t = Date.parse(createdAt);
  // 날짜가 깨진 기록 하나 때문에 사진 백업 카드 전체가 오류로 사라지지 않게 (점검 반영)
  return Number.isFinite(t) ? todayIso(new Date(t)).slice(0, 7) : NO_MONTH;
};
export const NO_MONTH = "0000-00";

export interface PhotoManifestItem {
  file: string;
  id: string;
  siteId: string;
  site: string;
  date: string;
  caption: string;
  mime: string;
}

export interface PhotoManifest {
  format: typeof PHOTO_BACKUP_FORMAT;
  version: 1;
  month: string;
  exportedAt: string;
  photos: PhotoManifestItem[];
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** 파일 이름에 못 쓰는 글자를 빼고 짧게 */
export function safeName(s: string, max = 30): string {
  return (
    s
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max)
      .trim() || "사진"
  );
}

export function photoFileName(p: { id: string; createdAt: string; caption: string }, site: string, mime: string): string {
  const t = Date.parse(p.createdAt);
  const date = Number.isFinite(t) ? todayIso(new Date(t)) : "0000-00-00";
  return `${date.slice(0, 7)}/${date}_${safeName(site, 16)}_${safeName(p.caption || "사진", 24)}_${safeName(p.id, 40)}.${EXT[mime] ?? "jpg"}`;
}

/** ZIP 안 파일 이름 끝의 ‘_사진번호.확장자’ — 다시 묶으면서 한글 이름이 깨져도(윈도우 CP949·맥 NFD) 사진 번호로 찾는다 */
export function photoIdSuffix(id: string, mime: string): string {
  return `_${safeName(id, 40)}.${EXT[mime] ?? "jpg"}`;
}
