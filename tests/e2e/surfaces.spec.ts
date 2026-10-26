import { test, expect, type Page } from "@playwright/test";

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

test("파트너 Closed Loop: 요청 등록 → 본사 요청함 → 검토·회신 → 포털 상태 갱신, 내부 금액 비노출", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, { role: "partner" });
  await page.goto("/partner");
  const portal = page.getByTestId("partner-portal");
  await expect(portal).toBeVisible();
  // 내부 원가·이익·미수 비노출
  // 금액(억·만 원)·이익률·EAC·다른 현장이 전혀 표시되지 않아야 한다
  const text = (await portal.innerText()).replace(/\s+/g, " ");
  expect(text).not.toMatch(/\d+(\.\d+)?억|\d[\d,]*만 원|이익률|EAC|B현장|C현장/);
  await page.getByTestId("partner-fill").click();
  await page.getByTestId("partner-submit").click();
  await expect(page.getByTestId("partner-sent")).toBeVisible();
  await expect(page.getByTestId("partner-request-item").first()).toHaveAttribute("data-status", "received");

  // 본사 관리자 전환 → 요청함
  await page.getByTestId("demo-role").selectOption("manager");
  await page.goto("/insights#requests");
  const req = page.getByTestId("partner-inbox").getByTestId("partner-request").filter({ hasText: "3층 남측 커튼월 유리 사양 변경" });
  await expect(req).toHaveAttribute("data-status", "received");
  await req.getByTestId("request-review").click();
  await expect(req).toHaveAttribute("data-status", "reviewing");
  await req.getByTestId("request-reply").click();
  const rm = page.getByTestId("reply-modal");
  await rm.getByText("DEMO 회신 채우기").click();
  await rm.getByTestId("reply-confirm").click();
  await expect(req).toHaveAttribute("data-status", "answered");

  // 파트너 포털에 회신 반영
  await page.getByTestId("demo-role").selectOption("partner");
  await page.goto("/partner");
  const item = page.getByTestId("partner-request-item").filter({ hasText: "3층 남측 커튼월 유리 사양 변경" });
  await expect(item).toHaveAttribute("data-status", "answered");
  await expect(item).toContainText("변경공사 견적을 회신드리겠습니다");
  // 미래 메뉴는 404가 아니라 Preview
  await page.getByTestId("future-card").first().click();
  await expect(page.getByText("현재 구현되지 않은 기능입니다")).toBeVisible();
});

test("역할 프리뷰: 현장직원은 손익·정산이 숨겨지고, 파트너는 내부 화면 접근 차단", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, { role: "field" });
  await page.goto("/dashboard");
  await expect(page.getByTestId("field-report-form")).toBeVisible();
  await expect(page.getByTestId("sidebar")).not.toContainText("기성·수금");
  await page.goto("/sites/site-a");
  await expect(page.getByTestId("field-site-summary")).toBeVisible();
  await expect(page.getByTestId("profit-engine")).toHaveCount(0);
  await page.goto("/finance");
  await expect(page.getByTestId("access-denied")).toBeVisible();

  await page.getByTestId("demo-role").selectOption("partner");
  await expect(page).toHaveURL(/\/partner$/);
  await page.goto("/report");
  await expect(page.getByTestId("access-denied")).toBeVisible();
});

test("7 Theme 실제 전환 + 글자 크기 + 모바일 프레임 테마 공유", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await page.goto("/settings");
  const ids = ["deep-navy", "navy-gold", "emerald-gold", "forest-sage", "deep-teal", "onyx-gold", "pure-white"];
  const shells = new Set<string>();
  for (const id of ids) {
    await page.getByTestId(`theme-${id}`).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    const bg = await page.getByTestId("sidebar").evaluate((el) => getComputedStyle(el).backgroundColor);
    shells.add(bg);
  }
  expect(shells.size).toBe(7);
  await page.getByTestId("font-lg").click();
  await expect(page.locator("html")).toHaveAttribute("data-font", "lg");
  const fs = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(parseFloat(fs)).toBeGreaterThan(20);

  await page.getByTestId("theme-deep-teal").click();
  await page.getByTestId("device-dual").click();
  const frame = page.frameLocator('[data-testid="device-frame"]');
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "deep-teal");
  await page.getByTestId("theme-emerald-gold").click();
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "emerald-gold");
});

test("CSV 검증 오류 표시 → 정상 가져오기 → 손익 반영, Demo Reset 복구", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await page.goto("/settings");
  const input = page.getByTestId("csv-input");
  await input.fill("site_code,date,category,amount,forecast_impact,reason,note\nTK-DEMO-X,2026-13-01,metal,-5,maybe,why,");
  await expect(page.getByTestId("csv-result")).toContainText("오류");
  await expect(page.getByTestId("csv-import")).toBeDisabled();
  await input.fill("site_code,date,category,amount,forecast_impact,reason,note\nTK-DEMO-A,2026-10-20,material,\"10,000,000\",additional,price_increase,알루미늄 단가 상승");
  await expect(page.getByTestId("csv-result")).toContainText("검증 통과 1행");
  await page.getByTestId("csv-import").click();
  await page.goto("/sites/site-a");
  await expect(page.getByTestId("m-eac")).toContainText("8.6억 원");

  await page.getByTestId("demo-reset").click();
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByTestId("m-eac")).toContainText("8.5억 원");
});

test("되돌리기: 보고 등록 후 되돌리면 손익 원복 / 튜토리얼 종료 후 오버레이 잔존 없음", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await page.goto("/sites/site-a");
  await page.getByTestId("open-report-sheet-pc").click();
  await page.getByTestId("fill-demo").click();
  await page.getByTestId("submit-report").click();
  await page.getByTestId("report-undo").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("report-sheet")).toHaveCount(0);
  await expect(page.getByTestId("m-eac")).toContainText("8.5억 원");

  await page.goto("/settings");
  await page.getByTestId("tutorial-replay").click();
  await expect(page.getByTestId("tour-panel")).toBeVisible();
  for (let i = 0; i < 3; i++) await page.getByTestId("tour-next").click();
  await page.getByTestId("tour-next").click();
  await expect(page.getByTestId("tour-panel")).toHaveCount(0);
  await expect(page.locator(".tour-target")).toHaveCount(0);
  // 클릭 가능 상태 확인
  await page.getByTestId("nav-dashboard").click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("시연 모드: 처음부터 PC+Mobile, 단계마다 휴대폰 화면이 바뀌고 실제 입력이 반영됨", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page); // PC 모드에서 시작해도 시연은 PC+Mobile로 진행
  await page.goto("/presentation");
  await page.getByTestId("start-presentation").click();
  const frame = page.frameLocator('[data-testid="device-frame"]');
  const panel = page.getByTestId("tour-panel");
  const next = () => page.getByTestId("tour-next").click();

  // ① 대표 대시보드 — 대표 휴대폰에 같은 대시보드
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("dual-view")).toBeVisible();
  await expect(panel).toHaveAttribute("data-layout", "dock");
  await expect(frame.getByTestId("kpi-strip")).toContainText("30.7억");

  // ② A현장 — 대표 휴대폰에도 손익 엔진
  await next();
  await expect(page).toHaveURL(/\/sites\/site-a$/);
  await expect(frame.getByTestId("m-eac")).toContainText("8.5억 원");

  // ③ 현장소장 휴대폰 — 입력 창이 열리고, 저장은 사람이 직접
  await next();
  await expect(frame.getByTestId("report-sheet")).toBeVisible();
  await expect(frame.getByTestId("m-eac")).toHaveCount(0); // 현장직원 화면에는 손익 없음
  await expect(page.getByTestId("tour-live")).toHaveAttribute("data-state", "waiting");
  await frame.getByTestId("fill-demo").click();
  await frame.getByTestId("submit-report").click();
  await expect(page.getByTestId("tour-live")).toHaveAttribute("data-state", "done");

  // ④ 대표 PC·휴대폰 동시 재계산
  await next();
  await expect(frame.getByTestId("report-sheet")).toHaveCount(0);
  await expect(frame.getByTestId("m-eac")).toContainText("8.9억 원");
  await expect(frame.getByTestId("m-margin")).toContainText("11%");
  await expect(page.getByTestId("m-eac")).toContainText("8.9억 원");
  await expect(page.getByTestId("tour-live")).toContainText("8.5억 → 8.9억");

  // ⑤ 본사 공무과장 배정 → 현장소장 휴대폰에서 진행·완료 → 본사 결과 확인
  await next();
  await expect(page).toHaveURL(/\/insights$/);
  await expect(page.getByTestId("demo-role")).toHaveValue("manager");
  await expect(frame.getByRole("heading", { name: "내 조치" })).toBeVisible();
  await page.getByTestId("signal-board").locator('[data-rule="UNBILLED_CHANGE"]').getByTestId("create-action").click();
  await page.getByTestId("assign-confirm").click();
  const phoneCard = frame.getByTestId("action-card").filter({ hasText: "추가공사 청구가능성 검토" });
  await expect(phoneCard).toBeVisible();
  await expect(page.getByTestId("tour-live")).toHaveAttribute("data-stage", "assigned");
  await phoneCard.getByTestId("action-start").click();
  await expect(page.getByTestId("tour-live")).toHaveAttribute("data-stage", "in_progress");
  await phoneCard.getByTestId("action-complete").click();
  await frame.getByTestId("fill-result").click();
  await frame.getByTestId("complete-confirm").click();
  await expect(page.getByTestId("tour-live")).toHaveAttribute("data-stage", "done");
  const pcCard = page.getByTestId("action-board").getByTestId("action-card").filter({ hasText: "추가공사 청구가능성 검토" });
  await expect(pcCard).toHaveClass(/tour-target/); // 결과 확인할 카드로 이동·강조
  await pcCard.getByTestId("proof-confirm").click();
  await expect(page.getByTestId("tour-live")).toHaveAttribute("data-stage", "confirmed");

  // 안내 접기·펼치기
  await page.getByTestId("tour-collapse").click();
  await expect(panel).toHaveAttribute("data-collapsed", "1");
  await page.getByTestId("tour-expand").click();

  // ⑥ 대표 보고서 — 대표 휴대폰에도 같은 보고서
  await next();
  await expect(page).toHaveURL(/\/report$/);
  await expect(page.getByTestId("demo-role")).toHaveValue("ceo");
  await expect(frame.getByTestId("report-summary")).toContainText("3.56억");
  await expect(page.getByTestId("report-actions")).toContainText("청구 검토 0원 → 4,000만 원");

  await page.getByTestId("tour-exit").click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("mobile-persona")).toHaveValue("same");
});

test("첫 방문·이전 버전 설정: 넓은 화면은 PC+Mobile로 시작", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await page.evaluate(([pk, dk]) => {
    localStorage.removeItem(dk);
    localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", role: "ceo", deviceView: "pc", tutorialDone: true })); // viewRev 없음 = 이전 버전 설정
  }, [PREFS, DB] as const);
  await page.reload();
  await expect(page.getByTestId("dual-view")).toBeVisible();
  await expect(page.getByTestId("device-dual")).toHaveAttribute("aria-checked", "true");
  // 사용자가 PC를 고르면 그 선택은 유지
  await page.getByTestId("device-pc").click();
  await page.reload();
  await expect(page.getByTestId("dual-view")).toHaveCount(0);
});

for (const w of [1280, 1440, 1920]) {
  test(`PC+Mobile ${w}px: 가로 넘침 없음, 상단 바 한 줄`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await freshStart(page, { deviceView: "dual" });
    for (const r of ["/dashboard", "/sites/site-a", "/insights", "/finance", "/report", "/partner"]) {
      await page.goto(r);
      await page.waitForTimeout(250);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${r} @${w}px dual overflow`).toBeLessThanOrEqual(1);
      const barH = await page.getByTestId("demo-bar").evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(barH, `${r} @${w}px demo bar wraps`).toBeLessThanOrEqual(0);
    }
  });
}

for (const w of [390, 430, 768, 1024, 1280, 1440, 1920]) {
  test(`반응형 ${w}px: 가로 넘침 없음 (주요 화면)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await freshStart(page);
    for (const r of ["/dashboard", "/sites/site-a", "/field", "/insights", "/finance", "/report", "/partner", "/settings", "/why-ax", "/evidence"]) {
      await page.goto(r);
      await page.waitForTimeout(250);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${r} @${w}px horizontal overflow`).toBeLessThanOrEqual(1);
    }
  });
}
