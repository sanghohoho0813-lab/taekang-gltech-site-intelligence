/**
 * DEMO 화면 시험 공통 — 브라우저 시계를 평일 낮(한국 2026-11-04 수 12:00)에서 시작한다.
 * 가상 데이터는 ‘지금’을 기준으로 오늘 기록(07:55 출근·오늘 보고 등)을 만들기 때문에,
 * 실제 시각이 한국 새벽이면 그 기록이 아직 없어 시험이 시각에 따라 달라졌다. 시계는 시작점만 정하고 그대로 흐른다.
 */
import { test as base, expect } from "@playwright/test";

export const DEMO_NOW = new Date("2026-11-04T03:00:00Z");

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.install({ time: DEMO_NOW });
    await use(page);
  },
});
export { expect };
export type { Page } from "@playwright/test";
