/** D-72: 아침 알림 미리보기·켜고 끄기 · 준공 보고서(발주처 제출용) — 준공 전 ‘중간 정리’ → 준공일 넣으면 ‘준공 보고서’ · 본사만 */
import { test, expect, type Page } from "./demoTest";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";

async function freshStart(page: Page, role = "ceo") {
  await page.goto("/dashboard");
  await page.evaluate(
    ([pk, dk, r]) => {
      localStorage.removeItem(dk);
      sessionStorage.clear();
      localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: r, deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 }));
    },
    [PREFS, DB, role] as const,
  );
}
const asRole = (page: Page, role: string) => page.evaluate(([pk, r]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: r })), [PREFS, role] as const);
const kstDaysAgo = (n: number) => new Date(Date.now() + 9 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);

test("아침 알림: 설정에서 오늘 보낼 내용 미리보기(본사·현장) · 끄고 켜기", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await page.goto("/settings");
  const card = page.getByTestId("brief-card");
  await expect(card).toHaveAttribute("data-on", "1");
  await expect(card.getByTestId("brief-status")).toContainText("시연판은 실제로 보내지 않습니다");
  await expect(card.getByTestId("brief-preview-hq")).toContainText("오늘 아침");
  // 휴대폰에 보일 문구 그대로
  await expect(card.getByTestId("brief-push-hq")).toContainText("오늘 아침");
  await expect(card.getByTestId("brief-preview-hq")).not.toContainText(/\d\s*원|억/);
  await card.getByTestId("brief-toggle").click();
  await expect(card).toHaveAttribute("data-on", "0");
  await expect(card.getByTestId("brief-status")).toContainText("꺼져 있습니다");
  await card.getByTestId("brief-toggle").click();
  await expect(card).toHaveAttribute("data-on", "1");
});

test("준공 보고서: 준공 전 ‘공사 진행 정리’ → 준공일만 넣고 공정 미완료면 ‘공사 정리 보고서’ · 인쇄 · 금액 없음 · 현장 직원은 못 봄", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await page.goto("/sites/site-a?tab=requests");
  await page.getByTestId("completion-card").getByTestId("completion-open").click();
  await expect(page).toHaveURL(/\/sites\/site-a\/completion/);
  const body = page.getByTestId("completion-body");
  await expect(body).toContainText("공사 진행 정리 (준공 전)");
  await expect(page.getByTestId("completion-not-done")).toBeVisible();
  await expect(page.getByTestId("completion-stage")).toHaveCount(5);
  await expect(page.getByTestId("completion-month").first()).toBeVisible();
  const text = (await body.innerText()).replace(/\s+/g, " ");
  expect(text).not.toMatch(/\d[\d,]*\s*(만\s*)?원(?![가-힣])|\d\s*억/);
  // 준공일 넣기 (착공 뒤, 5개월 전)
  await page.goto("/sites/site-a?tab=requests");
  await page.getByTestId("warranty-edit").click();
  await page.getByTestId("warranty-completed").fill(kstDaysAgo(150));
  await page.getByTestId("warranty-save").click();
  await expect(page.getByTestId("completion-open")).toContainText("준공 보고서");
  await page.getByTestId("completion-open").click();
  // 준공일은 넣었지만 공정률이 100%가 아니면 ‘준공 보고서’가 아니라 ‘공사 정리 보고서’ + 화면 안내 (인쇄에는 안 나옴)
  await expect(page.getByTestId("completion-title")).toHaveText("공사 정리 보고서");
  await expect(page.getByTestId("completion-unfinished")).toBeVisible();
  await expect(page.getByTestId("completion-not-done")).toHaveCount(0);
  await expect(page.getByTestId("completion-sign")).toContainText("담당");
  await expect(page.getByTestId("completion-overview")).toContainText("계약서 기준");
  const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBeLessThanOrEqual(5);
  // 휴대폰 폭 넘침 없음
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(body).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  // 현장 직원은 못 봄
  await asRole(page, "field");
  await page.goto("/sites/site-a/completion");
  await expect(page.getByText("본사만 볼 수 있습니다")).toBeVisible();
  await expect(page.getByTestId("completion-body")).toHaveCount(0);
});
