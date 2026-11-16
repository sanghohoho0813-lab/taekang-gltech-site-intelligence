/** D-84: 변경공사 청구·회수 — 설계변경 추가 원가 → 변경공사 만들기 → 발주처 청구(다음 확인할 날) → 확인 기록 → 요청과 다른 금액 승인은 사유 → 회수율 · 위험 신호 풀림 */
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

test("변경공사 청구·회수: 청구 안 한 추가 원가 → 만들기 → 발주처 청구·다음 확인 → 기록 → 일부 승인 사유 → 회수율", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  // 현장 보고로 설계변경 추가 원가 4,000만 (자재 3,000만 + 노무 1,000만)
  await page.goto("/sites/site-a");
  await page.getByTestId("open-report-sheet-pc").click();
  const sheet = page.getByTestId("report-sheet");
  await sheet.getByTestId("fill-demo").click();
  await sheet.getByTestId("submit-report").click();
  await expect(sheet.getByTestId("report-impact")).toBeVisible();
  await sheet.getByRole("button", { name: "닫기" }).first().click();

  await page.goto("/finance#co-board");
  const board = page.getByTestId("co-board");
  await expect(board.getByTestId("co-sum-unclaimed")).toContainText("4,000만");
  const extras = board.getByTestId("co-unclaimed").getByTestId("co-extra");
  await expect(extras).toHaveCount(2);
  await extras.nth(0).locator("input[type=checkbox]").check();
  await extras.nth(1).locator("input[type=checkbox]").check();
  await board.getByTestId("co-make").click();
  const cm = page.getByTestId("co-create-modal");
  await expect(cm.getByTestId("co-amount")).toHaveValue("40,000,000");
  await cm.getByTestId("co-title").fill("3층 남측 유리 사양 상향");
  await cm.getByTestId("co-amount").fill("46000000");
  await cm.getByTestId("co-create-confirm").click();
  await expect(page.getByTestId("co-create-modal")).toHaveCount(0);
  await expect(board.getByTestId("co-sum-unclaimed")).toContainText("없음");

  const row = board.getByTestId("co-open").getByTestId("change-order").filter({ hasText: "3층 남측 유리 사양 상향" });
  await expect(row).toHaveAttribute("data-status", "review");
  await expect(row).toContainText("근거 추가 원가 4,000만");
  // 발주처 청구 — 다음 확인할 날 기본 14일 뒤
  await row.getByTestId("co-submit").click();
  const sm = page.getByTestId("co-status-modal");
  await sm.getByTestId("co-status-note").fill("견적서·사진 메일 발송");
  await sm.getByTestId("co-confirm").click();
  await expect(page.getByTestId("co-status-modal")).toHaveCount(0);
  await expect(row).toHaveAttribute("data-status", "submitted");
  await expect(row.getByTestId("co-follow")).toContainText("다음 확인");
  // 확인 기록
  await row.getByTestId("co-log").click();
  const lm = page.getByTestId("co-log-modal");
  await lm.getByTestId("co-log-note").fill("원청 공무 통화 — 다음 주 검토 회의");
  await lm.getByTestId("co-log-confirm").click();
  await expect(page.getByTestId("co-log-modal")).toHaveCount(0);
  await expect(row).toContainText("원청 공무 통화");
  await row.getByTestId("co-log-toggle").click();
  await expect(row.getByTestId("co-log-list").locator("li")).toHaveCount(3);
  // 요청과 다른 금액 승인 — 사유 없으면 막힘
  await row.getByTestId("co-approve").click();
  const am = page.getByTestId("co-status-modal");
  await am.getByTestId("co-amt").fill("44000000");
  await am.getByTestId("co-confirm").click();
  await expect(am).toContainText("사유");
  await am.getByTestId("co-status-note").fill("원청 단가 협의로 감액");
  await am.getByTestId("co-confirm").click();
  await expect(page.getByTestId("co-status-modal")).toHaveCount(0);
  const done = board.getByTestId("co-decided").getByTestId("change-order").filter({ hasText: "3층 남측 유리 사양 상향" });
  await expect(done).toHaveAttribute("data-status", "approved");
  await expect(done.getByTestId("co-decision-note")).toContainText("원청 단가 협의로 감액");
  await expect(done).toContainText("회수 110%");
  await expect(board.getByTestId("co-sum-recovery")).toContainText("110%");
  // 위험 신호 ‘설계변경 추가원가 — 변경공사 미등록’이 풀림
  await page.goto("/insights");
  await expect(page.getByTestId("signal-board")).toBeVisible();
  await expect(page.getByTestId("signal-board").locator('[data-rule="UNBILLED_CHANGE"]')).toHaveCount(0);
});

test("변경공사: 반려는 사유 필수 → 다시 청구(근거 원가 그대로) · 휴대폰에서 가로로 넘치지 않음", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page);
  await page.goto("/finance#co-board");
  const board = page.getByTestId("co-board");
  const row = board.getByTestId("co-open").getByTestId("change-order").first();
  await expect(row).toBeVisible();
  const title = (await row.locator("b").first().innerText()).trim();
  await row.getByTestId("co-reject").click();
  const rm = page.getByTestId("co-status-modal");
  await rm.getByTestId("co-confirm").click();
  await expect(rm).toContainText("반려 사유");
  await rm.getByTestId("co-status-note").fill("원청 — 설계 범위 안이라 불인정");
  await rm.getByTestId("co-confirm").click();
  await expect(page.getByTestId("co-status-modal")).toHaveCount(0);
  const rejected = board.getByTestId("co-decided").getByTestId("change-order").filter({ hasText: title }).first();
  await expect(rejected).toHaveAttribute("data-status", "rejected");
  await rejected.getByTestId("co-reclaim").click();
  const cm = page.getByTestId("co-create-modal");
  await cm.getByTestId("co-title").fill("아트리움 유리 사양 변경 (도면 근거 보강)");
  await cm.getByTestId("co-create-confirm").click();
  await expect(page.getByTestId("co-create-modal")).toHaveCount(0);
  await expect(board.getByTestId("co-open").getByTestId("change-order").filter({ hasText: "도면 근거 보강" })).toContainText("다시 청구");
  await expect(rejected).toContainText("다시 청구함");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
