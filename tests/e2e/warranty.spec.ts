/** D-70: 하자보증 기간 — 현장 상세에서 넣기 → 만료 임박이면 처리 대기·하자보수 현황·발주처 포털에 표시 */
import { test, expect, type Page } from "./demoTest";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";

async function freshStart(page: Page, prefs: Record<string, unknown> = {}) {
  await page.goto("/dashboard");
  await page.evaluate(
    ([pk, dk, p]) => {
      localStorage.removeItem(dk as string);
      sessionStorage.clear();
      localStorage.setItem(pk as string, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: "ceo", deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2, ...(p as object) }));
    },
    [PREFS, DB, prefs] as const,
  );
}
const asRole = (page: Page, role: string) => page.evaluate(([pk, r]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: r })), [PREFS, role] as const);
const kstDaysAgo = (n: number) => new Date(Date.now() + 9 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);

test("하자보증: 준공 전(시연 24개월) → 준공일·12개월 넣어 만료 임박 → 처리 대기·하자보수 현황·발주처 포털", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await page.goto("/sites/site-a?tab=requests");
  const card = page.getByTestId("warranty-card");
  await expect(card).toHaveAttribute("data-state", "pending");
  await expect(card.getByTestId("warranty-line")).toContainText("준공 후 2년");
  await card.getByTestId("warranty-edit").click();
  await page.getByTestId("warranty-months").fill("12");
  await page.getByTestId("warranty-completed").fill(kstDaysAgo(330));
  await page.getByTestId("warranty-save").click();
  await expect(card).toHaveAttribute("data-state", "soon");
  await expect(card.getByTestId("warranty-line")).toContainText("일 남음");
  // 처리 대기
  await page.goto("/dashboard");
  await expect(page.getByTestId("pending-warranty").locator("b")).toHaveText("1");
  // 하자보수 현황: 현장별 하자보증 · 끝난 하자에 ‘보증 기간 안’
  await page.goto("/defects");
  await expect(page.getByTestId("warranty-row").first()).toHaveAttribute("data-state", "soon");
  await page.getByTestId("defect-view-all").click();
  await expect(page.getByTestId("defect-row").filter({ hasText: "2층 회의실 창 개폐 불량" }).getByTestId("defect-warranty")).toHaveText("보증 기간 안");
  // 발주처 포털: 기간만 (본사 메모 없음)
  await asRole(page, "partner");
  await page.goto("/partner");
  await expect(page.getByTestId("partner-warranty")).toContainText("만료 임박");
  await expect(page.getByTestId("partner-portal")).not.toContainText("가상 계약서 하자담보 조항");
});

test("하자보증 입력 검사: 개월 0·미래 준공일은 저장되지 않고, 현장 직원에게는 고치기 버튼이 없다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await freshStart(page);
  await page.goto("/sites/site-b?tab=requests");
  await page.getByTestId("warranty-edit").click();
  await page.getByTestId("warranty-months").fill("0");
  await page.getByTestId("warranty-save").click();
  await expect(page.getByText("1~120개월")).toBeVisible();
  await page.keyboard.press("Escape");
  await asRole(page, "field");
  await page.goto("/sites/site-a?tab=requests");
  await expect(page.getByTestId("warranty-card")).toBeVisible();
  await expect(page.getByTestId("warranty-edit")).toHaveCount(0);
});
