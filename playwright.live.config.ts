import { defineConfig } from "@playwright/test";

// 브라우저가 한글 파일 이름을 그대로 쓰도록 (이 컨테이너는 언어 설정이 비어 있어 내려받은 파일 이름이 "download"가 됨 — 실제 PC는 UTF-8)
process.env.LANG ||= "C.UTF-8";
process.env.LC_ALL ||= "C.UTF-8";
import webpush from "web-push";
import { randomBytes } from "node:crypto";

// 휴대폰 알림 시험용 키 — 실행할 때마다 새로 만든다 (저장소에 키를 두지 않음)
const VAPID = webpush.generateVAPIDKeys();
// 매일 점검 예약 작업 비밀값 — 실행마다 새로 (테스트 작업자 프로세스도 같은 값을 쓰도록 환경변수로 · D-71)
process.env.E2E_CRON_SECRET ||= randomBytes(24).toString("hex");

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
    // E2E_DATABASE_URL=postgres://… (빈 DB)이면 실제 Postgres로, 없으면 내장 PGlite로
    command: `${process.env.E2E_DATABASE_URL ? "true" : `rm -rf ${DB_DIR}`} && NEXT_PUBLIC_DATA_MODE=live NEXT_DIST_DIR=.next-live DATABASE_URL=${process.env.E2E_DATABASE_URL ?? `pglite:./${DB_DIR}`} VAPID_PUBLIC_KEY=${VAPID.publicKey} VAPID_PRIVATE_KEY=${VAPID.privateKey} VAPID_SUBJECT=mailto:qa@taekang.test CRON_SECRET=${process.env.E2E_CRON_SECRET} STATE_CACHE_FREEZE=1 npx next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
