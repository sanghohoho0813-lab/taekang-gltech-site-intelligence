/** D-71: 지난 공정 진행 이력 엑셀 가져오기 → 현장 공정 변화 기록 → 가져오기 취소 (현장 ‘준공’ ↔ 하자보증 준공일은 운영판 전용 화면이라 LIVE E2E에서) */
import { test, expect, type Page } from "./demoTest";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";

async function freshStart(page: Page) {
  await page.goto("/dashboard");
  await page.evaluate(
    ([pk, dk]) => {
      localStorage.removeItem(dk);
      sessionStorage.clear();
      localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: "ceo", deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 }));
    },
    [PREFS, DB] as const,
  );
}
const kstDaysAgo = (n: number) => new Date(Date.now() + 9 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);

test("공정 진행 이력: 붙여넣기 → 미리보기(앞 기록 → 값) → 넣기 → 현장 ‘공정’ 탭 공정 변화 기록 → 가져오기 취소", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await page.goto("/data");
  await page.getByTestId("import-kind-progress").click();
  await expect(page.getByTestId("import-card")).toContainText("지금 공정률은 바꾸지 않습니다");
  // C현장(착공 120일 전) 철골 하부구조 지금 90% — 그보다 높은 값은 오류
  await page.getByTestId("import-text").fill(`현장,날짜,공정 단계,진행률,메모\nC현장,${kstDaysAgo(40)},철골 하부구조,95,`);
  await expect(page.getByTestId("import-errors")).toContainText("지금 철골 하부구조(90%)보다 높습니다");
  await expect(page.getByTestId("import-apply")).toHaveCount(0);
  const rows = [`C현장,${kstDaysAgo(100)},철골 하부구조,30,1단 설치`, `C현장,${kstDaysAgo(70)},철골 하부구조,60%,`, `C현장,${kstDaysAgo(40)},철골 하부구조,85,`, `C현장,${kstDaysAgo(40)},전체,30,`];
  await page.getByTestId("import-text").fill(["현장,날짜,공정 단계,진행률,메모", ...rows].join("\n"));
  await expect(page.getByTestId("import-summary")).toContainText("C현장 — 3개 날짜 · 단계 2개");
  await expect(page.getByTestId("import-progress-rows")).toContainText("철골 하부구조 0% → 30%");
  await expect(page.getByTestId("import-progress-rows")).toContainText("철골 하부구조 60% → 85%");
  await page.getByTestId("import-apply").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  // 한 현장만 넣었으면 그 현장의 공정 탭으로
  await page.getByTestId("import-done").getByRole("link").click();
  await expect(page).toHaveURL(/\/sites\/site-c\?tab=progress/);
  const days = page.getByTestId("progress-history-day");
  await expect(days).toHaveCount(3);
  await expect(days.first()).toHaveAttribute("data-imported", "1");
  await expect(days.first()).toContainText("지난 기록");
  await expect(days.first()).toContainText("전체 공정률 0% → 30%");
  // 지금 공정률은 그대로 (C현장 35%)
  await expect(page.locator("main")).toContainText("공정률 35%");
  // 같은 파일 다시 → 모두 이미 있음
  await page.goto("/data");
  await page.getByTestId("import-kind-progress").click();
  await page.getByTestId("import-text").fill(["현장,날짜,공정 단계,진행률,메모", ...rows].join("\n"));
  await expect(page.getByTestId("import-dups")).toContainText("그날 기록이 이미 있음");
  // 취소
  const batch = page.locator('[data-testid="import-batch"][data-kind="progress"]').first();
  await batch.getByTestId("import-undo").click();
  await batch.getByTestId("import-undo-confirm").click();
  await expect(batch).toHaveAttribute("data-undone", "1");
  await page.goto("/sites/site-c?tab=progress");
  await expect(page.getByTestId("progress-history")).toContainText("아직 공정 변화 기록이 없습니다");
});
