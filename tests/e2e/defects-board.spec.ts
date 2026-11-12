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
  // 이 화면에서 바로 작업지시를 보낸다 (D-75)
  await expect(row.getByTestId("defect-order")).toHaveText("작업지시 보내기");
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

test("두 현장 담당: 확인 화면에서 오늘 출근한 현장으로 옮기면 현장마다 다른 작업·진행률은 비우고 다시 고르게 한다 (적은 글은 유지)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page, { role: "field" });
  await page.goto("/field");
  await expect(page.getByTestId("bottom-nav")).toBeVisible();
  await page.evaluate((dk) => {
    const db = JSON.parse(localStorage.getItem(dk)!);
    const t = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    db.attendance = [...(db.attendance ?? []), { id: "att-e2e-b2", siteId: "site-b", userId: "u-field", workDate: t, inAt: new Date().toISOString(), inGeo: { status: "inside", lat: 37.5, lng: 127, accuracyM: 10, distanceM: 20 }, inDevice: "dev-e2e" }];
    localStorage.setItem(dk, JSON.stringify(db));
  }, DB);
  await page.goto("/field/report");
  await page.getByTestId("fill-demo").click();
  await expect(page.getByTestId("confirm-other-site")).toContainText("B현장");
  // A현장 공정 이름 작업 하나 고르고 확인 화면으로
  await page.getByRole("button", { name: "오늘 한 작업 고치기" }).click();
  await page.getByTestId("work-chip").first().click();
  await page.getByTestId("easy-next").click();
  await expect(page.getByTestId("confirm-move-site")).toBeVisible();
  await page.getByTestId("confirm-move-site").click();
  // 작업 단계로 돌아와 안내 · A현장 작업은 빠지고 · 적은 글은 그대로
  await expect(page.getByTestId("moved-site-note")).toContainText("B현장으로 옮겼어요");
  await expect(page.getByTestId("work-chip-orphan")).toHaveCount(0);
  await expect(page.getByTestId("work-chip").and(page.locator('[aria-pressed="true"]'))).toHaveCount(0);
  expect((await page.locator("#easy-work-text").inputValue()).length).toBeGreaterThan(5);
});
