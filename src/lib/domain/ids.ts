/** 보안 컨텍스트가 아닌 환경(LAN IP http 접속 등)에서도 동작하는 ID 생성기 */
export function uid(prefix: string): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") {
    try {
      return `${prefix}_${c.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    } catch {
      // 비보안 컨텍스트 — 아래 대체 경로 사용
    }
  }
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}
