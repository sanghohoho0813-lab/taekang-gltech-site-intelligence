import { test, expect, type Page } from "./demoTest";

/**
 * D-92 진행 현황 보고서(11/18) 대조 — 코드는 있었지만 자동 시험이 없던 주장 확인
 * ① 현장 직원이 금액을 1만 배로 잘못 넣으면 다시 묻는다(1억 넘으면 넣을 수 없고 원 단위 고치기 제안, 1천만 원 넘으면 ‘맞나요?’)
 * ② 본사가 고친 금액이 현장 직원 화면에 ‘본사가 고쳐 반영했어요: 처음 → 지금’으로 보인다
 * ③ 출퇴근 시각을 고칠 때 근무가 14시간을 넘으면 한 번 더 확인해야 저장된다 (아직 오지 않은 시각으로는 못 고침)
 * ④ 본사가 고친 출퇴근이 현장 직원 첫 화면 안내 → ‘내 정보’에 고치기 전·후와 이유로 보인다
 */
const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";
const A = { latitude: 37.2638, longitude: 127.0289 }; // 가상 A현장 중심에서 약 35m

async function asField(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await page.evaluate(
    ([pk, dk]) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.removeItem(dk);
      localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: "field", deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 }));
    },
    [PREFS, DB] as const,
  );
}

async function switchRole(page: Page, role: "field" | "manager") {
  await page.evaluate(([pk, r]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: r })), [PREFS, role] as const);
  if (role === "manager") await page.setViewportSize({ width: 1440, height: 900 });
  else await page.setViewportSize({ width: 390, height: 844 });
}

test("보고서 ①② 금액 1만 배 입력 다시 묻기 → 본사가 고친 금액이 현장 직원에게 ‘처음 → 지금’으로 보임", async ({ page }) => {
  await asField(page);
  await page.goto("/field");
  await page.getByTestId("easy-go-report").click();
  await page.getByTestId("easy-site-site-a").click();
  await page.getByTestId("work-chip").first().click();
  await page.getByTestId("easy-next").click();
  await page.getByTestId("progress-same").click();
  await page.getByTestId("easy-next").click();
  await page.getByTestId("issue-no").click();
  await page.getByTestId("cost-yes").click();
  await page.getByTestId("cost-cat-material").click();
  // 원 단위로 350만 원을 넣은 실수(3500000 → 350억): 1억을 넘으면 넣을 수 없고, 원 단위 고치기를 제안
  await page.getByTestId("cost-amount").fill("3500000");
  await expect(page.getByTestId("cost-big-ask")).toContainText("1억 원까지");
  await expect(page.getByTestId("cost-big-ok")).toHaveCount(0);
  await expect(page.getByTestId("easy-next")).toBeDisabled();
  await page.getByTestId("cost-big-fix").click();
  await expect(page.getByTestId("cost-amount")).toHaveValue("350");
  await expect(page.getByTestId("cost-big-ask")).toHaveCount(0);
  // 1천만 원이 넘으면 ‘맞나요?’ — 확인해야 다음으로
  await page.getByTestId("cost-amount").fill("1500");
  await expect(page.getByTestId("cost-big-ask")).toContainText("맞나요?");
  await expect(page.getByTestId("easy-next")).toBeDisabled();
  await page.getByTestId("cost-big-ok").click();
  await expect(page.getByTestId("cost-big-ask")).toHaveCount(0);
  await page.getByTestId("easy-next").click();
  await page.getByTestId("impact-unknown").click();
  await page.getByTestId("reason-rework").click();
  await expect(page.getByTestId("easy-confirm")).toContainText("1,500만 원");
  await page.getByTestId("submit-report").click();
  await expect(page.getByTestId("report-done")).toContainText("1,500만 원");

  // 본사: 현장 상세 원가에서 금액을 고친다
  await switchRole(page, "manager");
  await page.goto("/sites/site-a?tab=cost");
  const row = page.getByTestId("cost-entry").filter({ hasText: "1,500만" }).first();
  await row.getByRole("button", { name: "원가 수정" }).click();
  await page.locator("#e-amt").fill("12000000");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByTestId("cost-entry").filter({ hasText: "1,200만" }).first()).toBeVisible();

  // 현장 직원: 내가 보낸 보고에 ‘본사가 고쳐 반영했어요: 1,500만 원 → 1,200만 원’
  await switchRole(page, "field");
  await page.goto("/my");
  const adj = page.getByTestId("entry-adjusted").first();
  await expect(adj).toContainText("본사가 고쳐 반영했어요");
  await expect(adj).toContainText(/1,500만 원\s*→\s*1,200만 원/);
});

test("보고서 ③④ 출퇴근 고치기: 14시간 넘으면 한 번 더 확인해야 저장 → 현장 직원 첫 화면 안내 → ‘내 정보’에 고치기 전·후와 이유", async ({ page }) => {
  await asField(page);
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ ...A, accuracy: 15 });
  await page.goto("/field");
  await page.getByTestId("att-in").click();
  await page.getByTestId("att-consent-yes").click();
  await expect(page.getByTestId("att-result")).toContainText("출근 기록 완료");

  // 본사: 오늘 기록을 아직 오지 않은 시각(21:00)으로 고치려 하면 막힌다
  await switchRole(page, "manager");
  await page.goto("/attendance");
  const today = page.locator('[data-testid="att-site"][data-site="site-a"]').getByTestId("att-row").filter({ hasText: "최성민" }).first();
  await today.getByTestId("att-fix").click();
  await page.getByTestId("att-fix-out").fill("21:00");
  await page.getByTestId("att-fix-note").fill("시험");
  await page.getByTestId("att-fix-save").click();
  await expect(page.getByRole("dialog")).toContainText("아직 오지 않은 시각으로 정정할 수 없습니다");
  await page.getByRole("button", { name: "취소", exact: true }).last().click();

  // 어제 기록(정우진 C현장 · 퇴근 누락)을 05:00~21:00(16시간)으로 — 14시간이 넘으면 확인 칸을 눌러야 저장
  await page.getByTestId("att-yesterday").click();
  const y = page.locator('[data-testid="att-site"][data-site="site-c"]').getByTestId("att-row").first();
  await y.getByTestId("att-fix").click();
  await page.getByTestId("att-fix-in").fill("05:00");
  await page.getByTestId("att-fix-out").fill("21:00");
  await page.getByTestId("att-fix-note").fill("반장 확인 — 새벽 반입 작업");
  await expect(page.getByTestId("att-fix-effect")).toContainText("16시간 0분");
  await expect(page.locator("label", { has: page.getByTestId("att-fix-long") })).toContainText("14시간 넘는 근무가 맞습니다");
  await expect(page.getByTestId("att-fix-save")).toBeDisabled();
  await page.getByTestId("att-fix-long").check();
  await expect(page.getByTestId("att-fix-save")).toBeEnabled();
  await page.getByTestId("att-fix-save").click();
  await expect(y).toContainText("본사 정정: 반장 확인");

  // 오늘 최성민 출근 12:00 → 07:30 (출근 버튼을 늦게 누름)
  await page.goto("/attendance");
  await today.getByTestId("att-fix").click();
  await page.getByTestId("att-fix-in").fill("07:30");
  await page.getByTestId("att-fix-note").fill("출근 버튼 늦게 누름 — 반장 확인");
  await page.getByTestId("att-fix-save").click();
  await expect(today).toContainText("본사 정정");

  // 현장 직원: 첫 화면 안내 → 내 정보 ‘본사가 고친 출퇴근’
  await switchRole(page, "field");
  await page.goto("/field");
  await expect(page.getByTestId("easy-corr-notice")).toContainText("본사가 출퇴근 시각을 고쳤어요");
  await page.getByTestId("easy-corr-notice").click();
  await expect(page).toHaveURL(/\/my/);
  const c = page.getByTestId("my-correction").first();
  await expect(c).toContainText("출근 12:00 → 07:30");
  await expect(c).toContainText("이유: 출근 버튼 늦게 누름 — 반장 확인");
});
