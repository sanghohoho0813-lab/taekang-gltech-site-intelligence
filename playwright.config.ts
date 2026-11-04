import { defineConfig } from "@playwright/test";

// 브라우저가 한글 파일 이름을 그대로 쓰도록 (이 컨테이너는 언어 설정이 비어 있어 내려받은 파일 이름이 "download"가 됨 — 실제 PC는 UTF-8)
process.env.LANG ||= "C.UTF-8";
process.env.LC_ALL ||= "C.UTF-8";

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
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
    command: `npx next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/dashboard`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
