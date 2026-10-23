import { test, expect, type Page } from "@playwright/test";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";

async function freshStart(page: Page, prefs: Record<string, unknown> = {}) {
  await page.goto("/dashboard");
  await page.evaluate(
    ([pk, dk, p]) => {
      localStorage.removeItem(dk as string);
      sessionStorage.clear();
      localStorage.setItem(pk as string, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: "ceo", deviceView: "pc", mobilePersona: "same", tutorialDone: true, ...(p as object) }));
    },
    [PREFS, DB, prefs] as const,
  );
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test("P0: 모바일 원가 입력 → PC 손익 재계산 → 위험 → 조치 → Proof Event → 보고서", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);

  await page.goto("/sites/site-a");
  await expect(page.getByTestId("m-contract")).toContainText("10억 원");
  await expect(page.getByTestId("m-eac")).toContainText("8.5억 원");
  await expect(page.getByTestId("m-profit")).toContainText("1.5억 원");
  await expect(page.getByTestId("m-margin")).toContainText("15%");

  await page.getByTestId("open-report-sheet-pc").click();
  const sheet = page.getByTestId("report-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByTestId("fill-demo").click();
  await expect(sheet.getByTestId("impact-preview")).toContainText("8.9억 원");
  await sheet.getByTestId("submit-report").click();
  await expect(sheet.getByTestId("report-impact")).toContainText("8.9억 원");
  await expect(sheet.getByTestId("report-impact")).toContainText("1.1억 원");
  await expect(sheet.getByTestId("report-impact")).toContainText("11%");
  // 중복 저장 방지: 완료 화면에서는 등록 버튼이 사라진다
  await expect(sheet.getByTestId("submit-report")).toHaveCount(0);
  await sheet.getByRole("button", { name: "닫기" }).first().click();
  await expect(page.getByTestId("report-sheet")).toHaveCount(0);

  // 오버레이 잔존 없음 — 스크롤 잠금 해제
  await expect(page.locator("html")).not.toHaveClass(/tk-scroll-lock/);
  await expect(page.getByTestId("m-eac")).toContainText("8.9억 원");
  await expect(page.getByTestId("m-profit")).toContainText("1.1억 원");
  await expect(page.getByTestId("m-margin")).toContainText("11%");
  await expect(page.getByTestId("change-banner")).toContainText("4,000만");

  // 위험 감지 (규칙 기반)
  await page.getByTestId("nav-insights").click();
  await expect(page).toHaveURL(/\/insights/);
  const board = page.getByTestId("signal-board");
  await expect(board.locator('[data-rule="MARGIN_DROP"]')).toContainText("15% → 11%");
  await expect(board.locator('[data-rule="COST_OVERRUN"]')).toBeVisible();
  const unbilled = board.locator('[data-rule="UNBILLED_CHANGE"]');
  await expect(unbilled).toContainText("4,000만");

  // 조치 생성·배정 → 진행 중 → 완료
  await unbilled.getByTestId("create-action").click();
  await expect(page.getByTestId("assign-modal")).toBeVisible();
  await expect(page.getByTestId("assignee-select")).toHaveValue("u-field");
  await page.getByTestId("assign-confirm").click();
  await expect(page.getByTestId("assign-modal")).toHaveCount(0);
  const card = page.getByTestId("action-board").getByTestId("action-card").filter({ hasText: "추가공사 청구가능성 검토" });
  await expect(card).toHaveAttribute("data-status", "assigned");
  await card.getByTestId("action-start").click();
  await expect(card).toHaveAttribute("data-status", "in_progress");
  await card.getByTestId("action-complete").click();
  const cm = page.getByTestId("complete-modal");
  await cm.getByTestId("fill-result").click();
  await cm.getByTestId("complete-confirm").click();
  await expect(page.getByTestId("complete-modal")).toHaveCount(0);
  const doneCard = page.getByTestId("action-board").getByTestId("action-card").filter({ hasText: "추가공사 청구가능성 검토" });
  await expect(doneCard).toHaveAttribute("data-status", "done");
  await expect(doneCard).toContainText("Proof Event 결과 확인");
  // 청구 검토 신호는 해소, 이익률은 승인 전이므로 그대로 11%
  await expect(board.locator('[data-rule="UNBILLED_CHANGE"]')).toHaveCount(0);

  // 대표자 보고서
  await page.getByTestId("nav-report").click();
  await expect(page.getByTestId("report-bullets")).toContainText("15% → 11%");
  await expect(page.getByTestId("report-bullets")).toContainText("추가공사 청구가능성 검토");
  await expect(page.getByTestId("report-actions")).toContainText("결과 확인");
  await expect(page.getByTestId("report-compare")).toContainText("8.5억 → 8.9억");

  expect(errors, errors.join("\n")).toEqual([]);
});

test("v4.1 PC+Mobile: 같은 Route·같은 데이터, 양방향 Route Sync, 재귀 Preview 없음", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, { deviceView: "dual", mobilePersona: "field" });
  await page.goto("/sites/site-a");
  await expect(page.getByTestId("dual-view")).toBeVisible();
  const frameEl = page.getByTestId("device-frame");
  await expect(frameEl).toBeVisible();
  const box = await frameEl.boundingBox();
  expect(Math.round(box!.width)).toBe(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  const frame = page.frameLocator('[data-testid="device-frame"]');

  // 프레임 안에는 Device View·Demo Bar·추가 iframe이 없다
  await expect(frame.getByTestId("mobile-header")).toBeVisible();
  await expect(frame.locator("iframe")).toHaveCount(0);
  await expect(frame.getByTestId("device-switch")).toBeHidden();
  // 현장직원 관점: 손익 대신 원가 입력 현황
  await expect(frame.getByTestId("field-site-summary")).toBeVisible();

  // 모바일에서 원가 입력 → PC 손익 갱신
  await frame.getByTestId("open-report-sheet").click();
  await frame.getByTestId("fill-demo").click();
  await frame.getByTestId("submit-report").click();
  await expect(frame.getByTestId("report-done")).toBeVisible();
  await expect(page.getByTestId("m-eac")).toContainText("8.9억 원");
  await expect(page.getByTestId("m-margin")).toContainText("11%");

  // PC → Mobile Route Sync
  await page.getByTestId("nav-insights").click();
  await expect(page).toHaveURL(/\/insights$/);
  await expect.poll(async () => frameEl.evaluate((f) => (f as HTMLIFrameElement).contentWindow?.location.pathname)).toBe("/insights");

  // PC에서 조치 배정 → 모바일(현장직원) 내 조치에 즉시 표시
  await page.getByTestId("signal-board").locator('[data-rule="UNBILLED_CHANGE"]').getByTestId("create-action").click();
  await page.getByTestId("assign-confirm").click();
  await expect(frame.getByTestId("action-card").filter({ hasText: "추가공사 청구가능성 검토" })).toBeVisible();

  // Mobile → PC Route Sync (현장직원 하단 메뉴)
  await frame.getByTestId("bottom-nav").getByText("현장보고").click();
  await expect(page).toHaveURL(/\/field$/);

  expect(errors, errors.join("\n")).toEqual([]);
});

test("Mobile 단독 모드: 실제 390px 프레임 + 새로고침 후 모드 유지", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, { deviceView: "mobile" });
  await page.goto("/dashboard");
  await expect(page.getByTestId("device-frame")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("device-frame")).toBeVisible();
  await expect(page.getByTestId("device-mobile")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("device-pc").click();
  await expect(page.getByTestId("device-frame")).toHaveCount(0);
  await expect(page.getByTestId("kpi-strip")).toBeVisible();
});
