/**
 * 사진 데이터가 정말 그 형식인지 앞 바이트로 확인한다 (JPEG·PNG·WEBP) — 사진이라 적고 다른 파일을 올려 두지 못하게.
 */
export function photoLooksReal(dataUrl: string): boolean {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]{4,16})/.exec(dataUrl);
  if (!m) return false;
  const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const chars = m[2].slice(0, m[2].length - (m[2].length % 4));
  const b: number[] = [];
  for (let i = 0; i < chars.length; i += 4) {
    const n = (B.indexOf(chars[i]) << 18) | (B.indexOf(chars[i + 1]) << 12) | (B.indexOf(chars[i + 2]) << 6) | B.indexOf(chars[i + 3]);
    b.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  if (m[1] === "jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (m[1] === "png") return b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x);
  // RIFF????WEBP
  return b.length >= 12 && [0x52, 0x49, 0x46, 0x46].every((x, i) => b[i] === x) && [0x57, 0x45, 0x42, 0x50].every((x, i) => b[i + 8] === x);
}
