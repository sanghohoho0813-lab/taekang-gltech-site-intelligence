/**
 * AX 상세설계서 (D-59) — 8개 장, 권한표·데이터 표가 시스템 정의만큼 나오고, 금액 없음, 인쇄 12장 이내, 현장 직원 차단
 */
import { test, expect, type Page } from "./demoTest";

const PREFS = "tk-site-intel:prefs:v1";
async function start(page: Page, role: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/dashboard");
  await page.evaluate(
    ([pk, r]) => {
      localStorage.clear();
      localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: r, deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 }));
    },
    [PREFS, role] as const,
  );
}

test("상세설계서: 8개 장 · 권한표·데이터 표 · 금액 없음 · 인쇄 12장 이내", async ({ page }) => {
  await start(page, "manager", 1280);
  await page.goto("/design");
  const doc = page.getByTestId("design-doc");
  for (const id of ["design-overview", "design-flows", "design-screens", "design-permissions", "design-data", "design-modules", "design-security", "design-infra", "design-sign"]) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId("design-client")).toContainText("태강지엘텍");
  await expect(page.getByTestId("design-role")).toHaveCount(4);
  await expect(page.getByTestId("design-flow")).toHaveCount(4);
  await expect(page.getByTestId("design-perm")).toHaveCount(54); // 명령 50 + 계정·백업 4
  await expect(page.getByTestId("design-collection")).toHaveCount(24);
  await expect(page.getByTestId("design-module")).toHaveCount(7);
  // 현장 직원은 기성 청구 불가, 출근은 본인만
  const billing = page.getByTestId("design-perm").filter({ hasText: "기성 청구 등록" });
  await expect(billing.locator('[data-role="field"]')).toHaveAttribute("data-allow", "no");
  await expect(page.getByTestId("design-perm").filter({ hasText: /^출근/ }).locator('[data-role="field"]')).toHaveAttribute("data-allow", "own");
  await expect(page.getByTestId("design-foot")).toContainText("DEMO");
  const text = (await doc.innerText()).replace(/\s+/g, " ");
  expect(text).not.toMatch(/\d[\d,]*\s*(만\s*)?원(?![가-힣])|\d\s*억/);
  const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBeLessThanOrEqual(12);
});

test("상세설계서: 휴대폰 폭 넘침 없음 · 현장 직원은 못 봄", async ({ page }) => {
  await start(page, "ceo", 390);
  await page.goto("/design");
  await expect(page.getByTestId("design-perm").first()).toBeAttached();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "field" })), [PREFS] as const);
  await page.goto("/design");
  await expect(page.getByTestId("access-denied")).toBeVisible();
});
