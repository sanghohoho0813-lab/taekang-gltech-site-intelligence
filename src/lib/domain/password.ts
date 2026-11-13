/**
 * 읽기 쉬운 임시 비밀번호 — 소문자 5자 + 숫자 5자 (예: kpqmt48273). 헷갈리는 글자 l·o·0·1 제외.
 * 대문자를 섞으면 60~70대가 휴대폰에서 Shift·한/영을 오가다 틀리고 잠긴다 (D-77 리허설). 소문자 다음 숫자라 자판을 한 번만 바꾼다.
 * 서버 규칙(8자 이상·영문·숫자)을 항상 만족. 사용자 추가·비밀번호 초기화·로그인 쪽지에서 함께 쓴다. 저장하지 않는다(서버에는 해시만).
 */
const LOWER = "abcdefghjkmnpqrstuvwxyz";
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
  const letters = Array.from({ length: 5 }, () => LOWER[rand(LOWER.length)]);
  const digits = Array.from({ length: 5 }, () => DIGITS[rand(DIGITS.length)]);
  return [...letters, ...digits].join("");
}
