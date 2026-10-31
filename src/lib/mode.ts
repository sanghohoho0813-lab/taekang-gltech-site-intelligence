/**
 * 저장소 모드 — 빌드 시 고정 (NEXT_PUBLIC_DATA_MODE).
 * demo: 브라우저 로컬 가상 데이터 (영업 시연용, 기본값)
 * live: 서버 DB + 로그인 + 서버 권한 검사 (실제 운영)
 */
export const DATA_MODE: "demo" | "live" = process.env.NEXT_PUBLIC_DATA_MODE === "live" ? "live" : "demo";
export const IS_LIVE = DATA_MODE === "live";
