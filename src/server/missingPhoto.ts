/**
 * 사진 원본이 없을 때 보여 주는 그림 (D-86) — 백업 파일로 복원한 뒤 ‘사진 백업’을 아직 올리지 않은 사진.
 * 깨진 그림 대신 이유를 보여 준다. 원본이 올라오면 같은 주소에서 진짜 사진이 나온다(ETag가 달라 브라우저가 다시 받음).
 */
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#eef0f3"/><g fill="none" stroke="#9aa3ae" stroke-width="14" stroke-linejoin="round"><rect x="300" y="190" width="200" height="150" rx="18"/><circle cx="400" cy="265" r="40"/></g><text x="400" y="410" text-anchor="middle" font-family="system-ui,-apple-system,'Malgun Gothic',sans-serif" font-size="40" font-weight="700" fill="#4b5563">사진 원본 없음</text><text x="400" y="462" text-anchor="middle" font-family="system-ui,-apple-system,'Malgun Gothic',sans-serif" font-size="26" fill="#6b7280">백업으로 옮긴 자료 — 사진 백업을 올리면 보입니다</text></svg>`;

const BYTES = new TextEncoder().encode(SVG);

export const MISSING_PHOTO = { mime: "image/svg+xml", data: BYTES, missing: true as const };

/** 자리 표시 그림 응답 — 진짜 사진과 ETag를 다르게(원본이 올라오면 바로 바뀌게) */
export function missingPhotoResponse(id: string, headers: Record<string, string> = {}): Response {
  return new Response(Buffer.from(BYTES), {
    headers: {
      ...headers,
      "Content-Type": "image/svg+xml",
      "Cache-Control": "private, no-cache",
      ETag: `"${id}-missing"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
