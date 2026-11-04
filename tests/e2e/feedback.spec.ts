/**
 * 앱 의견 (D-47) — 현장: 누르기만으로 보내기 → 본사 처리 대기·오류·의견 → 보류(이유 필수)·반영 → 현장 ‘내 정보’에 결과·답변, CSV
 */
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";
async function start(page: Page, role: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/dashboard");
  await page.evaluate(
    ([pk, dk, r]) => {
      localStorage.clear();
      localStorage.removeItem(dk);
      localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: r, deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 }));
    },
    [PREFS, DB, role] as const,
  );
}
const asRole = (page: Page, role: string) => page.evaluate(([pk, r]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: r })), [PREFS, role] as const);

test("앱 의견: 현장 보내기 → 본사 보류(이유)·반영 → 현장에 결과·답변 → CSV", async ({ page }) => {
  await start(page, "field", 390);
  await page.goto("/my");
  const box = page.getByTestId("my-feedback");
  await expect(box.getByTestId("fb-mine-item")).toHaveCount(1); // 가상 의견 1건 (확인 전)
  await page.getByTestId("fb-cat-small_text").click();
  await page.getByTestId("fb-text").fill("보고 확인 화면 글씨가 작아요");
  await page.getByTestId("fb-send").click();
  await expect(page.getByTestId("fb-msg")).toContainText("보냈어요");
  await expect(box.getByTestId("fb-mine-item")).toHaveCount(2);

  // 본사: 처리 대기 → 오류·의견
  await asRole(page, "manager");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("pending-feedback")).toContainText("2");
  await page.getByTestId("pending-feedback").click();
  await expect(page).toHaveURL(/\/quality$/);
  await expect(page.getByTestId("quality-open")).toContainText("2건");
  await expect(page.getByTestId("quality-errors")).toContainText("실제 운영에서 자동 기록");
  const mine = page.locator('[data-testid="quality-fb"]').filter({ hasText: "보고 확인 화면 글씨가 작아요" });
  // 보류는 이유가 있어야
  await mine.getByTestId("fb-status-hold").click();
  await mine.getByTestId("fb-save").click();
  await expect(mine).toContainText("보류할 때는 이유를 적어 주세요");
  await mine.getByTestId("fb-reply").fill("다음 고도화 때 확인 화면 글씨를 키웁니다");
  await mine.getByTestId("fb-save").click();
  await expect(page.locator('[data-testid="quality-fb"]').filter({ hasText: "보고 확인 화면" })).toHaveAttribute("data-status", "hold");
  const loc = page.locator('[data-testid="quality-fb"][data-id="fb-seed-2"]');
  await loc.getByTestId("fb-status-done").click();
  await loc.getByTestId("fb-reply").fill("지하 구간은 현장 QR 출근을 쓰세요");
  await loc.getByTestId("fb-save").click();
  await expect(loc).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("quality-open")).toContainText("0건");
  const dl = page.waitForEvent("download");
  await page.getByTestId("quality-csv").click();
  const csv = readFileSync((await (await dl).path())!, "utf8");
  expect(csv).toContain("반영함");
  expect(csv).toContain("지하 구간은 현장 QR 출근을 쓰세요");
  expect(csv).toContain("보류");

  // 현장: 결과와 답변
  await asRole(page, "field");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my");
  const done = page.locator('[data-testid="fb-mine-item"][data-status="done"]');
  await expect(done).toContainText("반영함");
  await expect(done).toContainText("본사: 지하 구간은 현장 QR 출근을 쓰세요");
  await expect(page.locator('[data-testid="fb-mine-item"][data-status="hold"]')).toContainText("다음 고도화 때");
});
