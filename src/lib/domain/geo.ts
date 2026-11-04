/** 위치 계산 — 현장 반경 안/밖 판정 (서버·화면 공용, 같은 결과) */
import type { GeoStamp, GeoStatus, Site } from "./types";

export interface GeoSample {
  lat: number;
  lng: number;
  /** 휴대폰이 알려준 오차 반경 (m) */
  accuracy: number;
}

/** 오차가 이보다 크면 '정확도 낮음'으로 본다 (건물 안·고층에서 흔함) */
export const WEAK_ACCURACY_M = 150;
export const DEFAULT_RADIUS_M = 300;

/** 두 지점 사이 거리 (m, 하버사인) */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function validSample(s: unknown): s is GeoSample {
  if (!s || typeof s !== "object") return false;
  const x = s as Record<string, unknown>;
  return typeof x.lat === "number" && typeof x.lng === "number" && typeof x.accuracy === "number" && Math.abs(x.lat) <= 90 && Math.abs(x.lng) <= 180 && x.accuracy >= 0 && x.accuracy < 100_000;
}

/**
 * 현장 안/밖 판정
 * - 거리 ≤ 반경 이고 오차가 크지 않으면 inside
 * - 오차를 빼도 반경보다 멀면 outside
 * - 그 사이(오차가 커서 확신 못 함)면 weak
 */
export function judgeGeo(site: Pick<Site, "geo"> | undefined, sample: GeoSample | null | undefined, reason?: GeoStamp["reason"]): GeoStamp {
  if (!sample) return { status: "none", reason: reason ?? "unavailable" };
  const base = { lat: round6(sample.lat), lng: round6(sample.lng), accuracyM: Math.round(sample.accuracy) };
  if (!site?.geo) return { ...base, status: "nosite" };
  const d = Math.round(distanceM(site.geo, sample));
  let status: GeoStatus;
  if (d <= site.geo.radiusM && sample.accuracy <= WEAK_ACCURACY_M) status = "inside";
  else if (d - Math.min(sample.accuracy, 1_000) > site.geo.radiusM) status = "outside";
  else status = "weak";
  return { ...base, distanceM: d, status };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export const GEO_LABEL: Record<GeoStatus, string> = {
  inside: "현장 안",
  outside: "현장 밖",
  weak: "위치 불확실",
  none: "위치 없음",
  nosite: "현장 위치 미등록",
};

/** "현장 안 · 45m" / "현장 밖 · 1.2km" */
/** 위치 판정 문구. withDistance = false 이면 거리를 빼고 (활동 기록처럼 오래 남는 곳에 쓰는 문구 — 거리도 위치 정보다 · D-43) */
export function geoText(g: GeoStamp | undefined, withDistance = true): string {
  if (!g) return "위치 기록 없음";
  const dist = !withDistance || g.distanceM === undefined ? "" : ` · ${g.distanceM >= 1000 ? `${(g.distanceM / 1000).toFixed(1)}km` : `${g.distanceM}m`}`;
  const why = g.status === "none" ? (g.reason === "denied" ? " (위치 권한 거부)" : g.reason === "skipped" ? " (위치 없이 진행)" : " (위치를 못 잡음)") : g.status === "weak" && withDistance && g.accuracyM !== undefined ? ` (오차 ${g.accuracyM}m)` : "";
  return `${GEO_LABEL[g.status]}${dist}${why}`;
}

/** 지도에서 확인 (키 없이 여는 카카오맵 링크) */
export function mapLink(lat: number, lng: number, label = "위치"): string {
  return `https://map.kakao.com/link/map/${encodeURIComponent(label)},${lat},${lng}`;
}
