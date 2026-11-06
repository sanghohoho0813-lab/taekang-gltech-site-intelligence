/** D-67: 발주처 포털 맨 위 메뉴 · 공정 사진 공개 · 휴대폰 뒤로 = 이전 단계 · 인터넷 끊김 표시 */
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

test("왼쪽 메뉴 맨 위는 ‘고객 화면 › 발주처 포털’, 그 아래 대시보드", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await page.goto("/dashboard");
  const links = page.getByTestId("sidebar").locator('a[data-testid^="nav-"]');
  await expect(links.nth(0)).toHaveAttribute("data-testid", "nav-partner");
  await expect(links.nth(1)).toHaveAttribute("data-testid", "nav-dashboard");
  await expect(page.getByTestId("sidebar")).toContainText("고객 화면");
});

test("사진대장에서 ‘발주처 공개’한 사진만 발주처 포털 ‘공정 사진’에 보이고, 끄면 사라진다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await page.goto("/photos");
  await page.getByTestId("ledger-sample").click();
  await expect(page.getByTestId("ledger-share")).toHaveCount(6);
  await page.getByTestId("ledger-share").nth(4).click();
  await expect(page.getByTestId("ledger-share").nth(4)).toHaveText(/공개 중/);
  await page.getByTestId("ledger-share").nth(5).click();
  await expect(page.getByTestId("ledger-shared-count")).toContainText("발주처 공개 2장");
  // 발주처 역할 — 공개한 2장만, 공개 설명(공종)과 함께
  await page.evaluate((pk) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "partner" })), PREFS);
  await page.goto("/partner");
  await expect(page.getByTestId("partner-photo")).toHaveCount(2);
  await page.getByTestId("partner-photo").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("partner-feed")).toBeVisible();
  // 본사가 끄면 사라진다
  await page.evaluate((pk) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "ceo" })), PREFS);
  await page.goto("/photos");
  await page.getByTestId("ledger-share").nth(4).click();
  await expect(page.getByTestId("ledger-shared-count")).toContainText("발주처 공개 1장");
});

test("현장 보고 중 휴대폰 ‘뒤로’를 누르면 보고가 닫히지 않고 이전 단계로", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page, { role: "field" });
  await page.goto("/field");
  await page.goto("/field/report");
  await page.getByTestId("easy-site-site-a").click();
  const wiz = page.getByTestId("easy-report");
  await expect(wiz).toHaveAttribute("data-step", "work");
  await page.getByTestId("work-chip").first().click();
  await page.getByTestId("easy-next").click();
  await expect(wiz).toHaveAttribute("data-step", "progress");
  // 입력 단계에서는 하단 메뉴를 숨긴다
  await expect(page.getByTestId("bottom-nav")).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(/\/field\/report/);
  await expect(wiz).toHaveAttribute("data-step", "work");
  await page.goBack();
  await expect(wiz).toHaveAttribute("data-step", "site");
  // 화면 안 ‘이전’과 섞어 써도 맞게 — 앞으로 두 단계 가서 ‘이전’ 한 번, ‘뒤로’ 한 번
  await page.getByTestId("easy-site-site-a").click();
  await page.getByTestId("easy-next").click();
  await expect(wiz).toHaveAttribute("data-step", "progress");
  await page.getByTestId("easy-back").click();
  await expect(wiz).toHaveAttribute("data-step", "work");
  await page.goBack();
  await expect(wiz).toHaveAttribute("data-step", "site");
  await expect(page).toHaveURL(/\/field\/report/);
});

test("인터넷이 끊기면 화면 맨 위에 알린다", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page, { role: "field" });
  await page.goto("/field");
  await expect(page.getByTestId("offline-banner")).toHaveCount(0);
  await context.setOffline(true);
  await expect(page.getByTestId("offline-banner")).toContainText("인터넷이 끊겼어요");
  await context.setOffline(false);
  await expect(page.getByTestId("offline-banner")).toHaveCount(0);
});
