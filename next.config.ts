import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // DEMO·LIVE 빌드를 나란히 둘 수 있게 (예: NEXT_DIST_DIR=.next-live)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // LIVE 모드 서버 DB 드라이버는 번들하지 않고 node_modules에서 그대로 불러온다 (PGlite WASM 포함)
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // 같은 Origin에서만 Mobile Frame(iframe)으로 자기 자신을 렌더링할 수 있게 한다 (v4.1 Device View).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
