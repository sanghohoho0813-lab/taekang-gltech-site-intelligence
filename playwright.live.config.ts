import { defineConfig } from "@playwright/test";

/**
 * LIVE 모드 E2E — 빈 PGlite DB로 서버를 새로 띄워 실제 운영 시작 흐름과 보안 경계를 검증한다.
 * 먼저 `npm run build:live` 필요. 실행: `npm run e2e:live`
 */
const PORT = Number(process.env.E2E_LIVE_PORT ?? 3300);
const DB_DIR = ".data/e2e-live";

export default defineConfig({
  testDir: "tests/e2e-live",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `rm -rf ${DB_DIR} && NEXT_PUBLIC_DATA_MODE=live NEXT_DIST_DIR=.next-live DATABASE_URL=pglite:./${DB_DIR} npx next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
