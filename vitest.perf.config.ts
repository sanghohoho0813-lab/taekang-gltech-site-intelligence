import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** 성능 측정 전용 (npm run perf) — 기본 테스트(npm test)에는 포함하지 않는다 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/perf/**/*.perf.test.ts"], environment: "node", testTimeout: 300_000, hookTimeout: 300_000 },
});
