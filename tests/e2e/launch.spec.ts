/**
 * 시범 운영 준비 (D-53)·로그인 쪽지 (D-54) — 시연 데이터로 점검표, 고치는 곳 연결, 쪽지 미리보기·쪽지만 인쇄, 현장 직원 차단
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

test("시범 운영 준비: 시작 전 고칠 것 → 고치는 곳 · 직원별 남은 것 · 로그인 쪽지만 A4 한 장으로 인쇄", async ({ page }) => {
  await start(page, "manager", 1280);
  await page.goto("/launch");
  const sum = page.getByTestId("launch-summary");
  await expect(sum).toHaveAttribute("data-ok", "0");
  await expect(page.getByTestId("launch-blockers")).toContainText("본사 전화번호");
  await expect(page.getByTestId("launch-warnings")).toContainText("위치정보 보관 기간");
  await expect(page.getByTestId("launch-people-ready")).toContainText("0 / 2명");
  const company = page.getByTestId("launch-company");
  await expect(company.locator('[data-key="phone"]')).toHaveAttribute("data-status", "missing");
  await expect(company.locator('[data-key="phone"]')).toContainText("운영 모드: 운영 관리 → 운영 설정");
  await expect(page.getByTestId("launch-site")).toHaveCount(3);
  const choi = page.locator('[data-testid="launch-person"][data-user="u-field"]');
  await expect(choi).toHaveAttribute("data-ready", "0");
  await expect(choi.getByTestId("launch-todo")).toContainText("내 휴대폰 점검");

  // 쪽지: 고르기 전에는 못 누름 → 모두 고르기 → 2장
  await expect(page.getByTestId("launch-slips")).toBeDisabled();
  await page.getByTestId("launch-pick-all").check();
  await page.getByTestId("launch-slips").click();
  const dlg = page.getByTestId("slip-dialog");
  await expect(dlg.getByTestId("slip-card")).toHaveCount(2);
  await expect(dlg.getByTestId("slip-card").first()).toContainText("최성민");
  await expect(dlg.getByTestId("slip-card").first()).toContainText("담당 A현장, B현장");
  await expect(dlg.getByTestId("slip-password")).toHaveCount(0); // 시연: 비밀번호 칸은 빈칸
  await expect(dlg.getByTestId("slip-qr").first()).toHaveAttribute("data-text", /\/login$/);

  // 인쇄: 쪽지만 (다른 화면·대화상자 숨김), A4 한 장
  await page.evaluate(() => document.documentElement.classList.add("print-slips"));
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".slip-print-root [data-testid='slip-card']")).toHaveCount(2);
  await expect(page.locator(".slip-print-root [data-testid='slip-card']").first()).toBeVisible();
  await expect(page.locator("#main")).toBeHidden();
  const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" } });
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => document.documentElement.classList.remove("print-slips"));
  await dlg.getByRole("button", { name: "닫기" }).first().click();
  await expect(page.locator(".slip-print-root")).toHaveCount(0); // 닫으면 쪽지(비밀번호)도 화면에서 지운다

  // 고치는 곳: 시연의 개인위치정보는 설정 화면
  await company.locator('[data-key="privacy"]').getByTestId("launch-fix").click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("시범 운영 준비: 휴대폰 폭 넘침 없음 · 현장 직원은 못 봄", async ({ page }) => {
  await start(page, "ceo", 390);
  await page.goto("/launch");
  await expect(page.getByTestId("launch-person")).toHaveCount(2);
  await page.getByTestId("launch-pick-all").check();
  await page.getByTestId("launch-slips").click();
  await expect(page.getByTestId("slip-dialog").getByTestId("slip-card")).toHaveCount(2);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  await page.getByTestId("slip-dialog").getByRole("button", { name: "닫기" }).first().click();
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "field" })), [PREFS] as const);
  await page.goto("/launch");
  await expect(page.getByTestId("access-denied")).toBeVisible();
});
