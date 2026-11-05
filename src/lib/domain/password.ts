/**
 * 읽기 쉬운 임시 비밀번호 (영문+숫자 10자, 헷갈리는 글자 l·I·O·0·1 제외) — 서버 규칙(8자 이상·영문·숫자)을 항상 만족.
 * 사용자 추가·비밀번호 초기화·로그인 쪽지에서 함께 쓴다. 저장하지 않는다(서버에는 해시만).
 */
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";

function rand(n: number): number {
  // 나머지 편향 없이 0..n-1
  const lim = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < lim) return buf[0] % n;
  }
}

export function tempPassword(): string {
  const all = LOWER + UPPER + DIGITS;
  const chars = [LOWER[rand(LOWER.length)], DIGITS[rand(DIGITS.length)], ...Array.from({ length: 8 }, () => all[rand(all.length)])];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
