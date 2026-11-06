/**
 * 로그인 뒤 돌아갈 주소 — 같은 사이트 안의 경로만 허용 (외부 주소로 보내는 공격 방지).
 * ‘/\evil.com’처럼 브라우저가 ‘//evil.com’으로 읽는 주소, 제어 문자, 다른 출처로 풀리는 주소는 모두 거부 (D-65 점검 반영)
 */
export function safeNext(v: string | null, origin = "https://app.invalid"): string | null {
  if (!v || !v.startsWith("/") || v.startsWith("//") || /[\\\u0000-\u001f]/.test(v)) return null;
  try {
    const u = new URL(v, origin);
    if (u.origin !== origin) return null;
    const path = `${u.pathname}${u.search}${u.hash}`;
    return path.startsWith("/login") ? null : path;
  } catch {
    return null;
  }
}
