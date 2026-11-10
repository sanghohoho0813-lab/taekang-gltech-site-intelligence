import type { NextConfig } from "next";

const PROD = process.env.NODE_ENV === "production";

/**
 * 보안 헤더 (운영 배포 준비 · D-33)
 * - CSP: 외부 스크립트·스타일·글꼴·이미지·연결을 모두 막는다 (이 앱은 외부 자원을 쓰지 않음).
 *   Next가 페이지마다 넣는 인라인 스크립트(화면 데이터)와 테마 부트 스크립트 때문에 script-src에 'unsafe-inline'을 둔다.
 *   개발 서버는 eval을 쓰므로 운영 빌드에서만 적용한다.
 * - frame-ancestors / frame-src 'self': 같은 주소 안에서만 휴대폰 미리보기(iframe)를 허용
 * - Permissions-Policy: 위치·카메라는 이 사이트만, 마이크·결제 등은 끔
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // DEMO·LIVE 빌드를 나란히 둘 수 있게 (예: NEXT_DIST_DIR=.next-live)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // LIVE 모드 서버 DB 드라이버는 번들하지 않고 node_modules에서 그대로 불러온다 (PGlite WASM 포함)
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: PROD ? CSP : "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), interest-cohort=()" },
          // HTTPS로 접속한 뒤에만 브라우저가 적용한다 (로컬 http에서는 무시됨)
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // 회사 내부 업무 시스템 — 검색엔진에 노출하지 않는다
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // 보고서 링크(D-73): 주소에 비밀값이 들어 있으므로 다른 사이트로 주소가 넘어가지 않게, 브라우저·중간 서버가 저장하지 않게
        source: "/s/:token",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      {
        // 보고서 링크의 문서·사진 응답도 같은 머리말 (위의 전체 규칙이 경로별 응답 머리말을 덮어쓰므로 여기서 다시 정한다 · 점검 9차)
        source: "/api/share/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      {
        // 알림 서비스워커는 바뀌면 바로 새로 받게 (D-37)
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, max-age=0" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
