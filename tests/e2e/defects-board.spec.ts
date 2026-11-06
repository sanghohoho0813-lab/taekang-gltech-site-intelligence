/** D-69: 본사 하자보수 현황 · 관리대장 · 처리 대기 연결 · 시연 데이터의 지난 기록 */
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

test("하자보수 현황: 시연 데이터의 끝난 하자 1건 → 새 요청은 ‘본사 할 일’과 처리 대기에 → 관리대장에 번호·보수 완료일", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await page.goto("/defects");
  await expect(page.getByTestId("defect-kpi-open")).toContainText("0건");
  await page.getByTestId("defect-view-all").click();
  const done = page.getByTestId("defect-row").filter({ hasText: "2층 회의실 창 개폐 불량" });
  await expect(done).toHaveAttribute("data-next", "closed");
  await expect(done.getByTestId("defect-days")).toContainText("보수까지");
  // 발주처가 새 하자보수를 보낸다
  await asRole(page, "partner");
  await page.goto("/partner#request");
  await page.getByTestId("p-type").selectOption("defect");
  await page.locator("#p-title").fill("1층 로비 자동문 옆 유리 금감");
  await page.getByTestId("p-location").fill("1층 로비 동측");
  await page.locator("#p-desc").fill("유리 모서리에 금이 갔습니다.");
  await page.getByTestId("partner-submit").click();
  await expect(page.getByTestId("partner-sent")).toBeVisible();
  // 본사: 현황·처리 대기
  await asRole(page, "ceo");
  await page.goto("/defects");
  await expect(page.getByTestId("defect-kpi-todo")).toContainText("1건");
  const row = page.getByTestId("defect-row").filter({ hasText: "1층 로비 자동문 옆 유리 금감" });
  await expect(row).toHaveAttribute("data-next", "assign");
  await expect(row.getByTestId("defect-open")).toHaveText("작업지시·회신");
  await page.goto("/dashboard");
  await expect(page.getByTestId("pending-defect").locator("b")).toHaveText("1");
  // 관리대장: A현장 · 오래된 것부터
  await page.goto("/defects");
  await page.getByTestId("defect-view-ledger").click();
  const led = page.getByTestId("defect-ledger");
  await expect(led).toContainText("하자보수 관리대장");
  await expect(led.getByTestId("defect-ledger-row").first()).toContainText("2층 회의실 창 개폐 불량");
  await expect(led.getByTestId("defect-ledger-row").first()).toContainText("접수 후");
  await expect(led.getByTestId("defect-ledger-row")).toHaveCount(2);
  expect((await led.innerText()).replace(/\s+/g, " ")).not.toMatch(/\d+(\.\d+)?억|\d[\d,]*만 원|이익|원가/);
});

test("시연 데이터: 월간 보고서에 지난 공정 변화가 들어 있고, 하자보수 현황은 현장 직원이 볼 수 없다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await freshStart(page, { role: "partner" });
  await page.goto("/partner/report");
  // 이번 달이든 지난달이든 둘 중 하나에는 시연용 공정 변화가 있다
  const changed = async () => page.getByTestId("report-stage-row").filter({ hasText: "%p" }).count();
  let n = await changed();
  if (!n) {
    await page.getByTestId("report-month-1").click();
    await expect(page).toHaveURL(/month=/);
    n = await changed();
  }
  expect(n).toBeGreaterThan(0);
  await asRole(page, "field");
  await page.goto("/defects");
  await expect(page.getByTestId("access-denied")).toBeVisible();
});
