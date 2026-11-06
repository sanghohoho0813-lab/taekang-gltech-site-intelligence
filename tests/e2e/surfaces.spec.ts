import { readFileSync } from "node:fs";
import { test, expect, type Page } from "./demoTest";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";

/** 화면이 준비되기 전(하이드레이션 전) 클릭이 무시될 수 있어, 테마가 실제로 바뀔 때까지 다시 누른다 */
async function pickTheme(page: Page, id: string) {
  await expect(async () => {
    await page.getByTestId(`theme-${id}`).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

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
  expect(text).not.toMatch(/\d+(\.\d+)?억|\d[\d,]*만 원|이익률|EAC|총원가|B현장|C현장/);
  await page.getByTestId("p-type").selectOption("change_review");
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
  await expect(page.getByTestId("easy-home")).toBeVisible();
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
  const sidebarBg = () => page.getByTestId("sidebar").evaluate((el) => getComputedStyle(el).backgroundColor);
  for (const id of ids) {
    await pickTheme(page, id);
    // 테마마다 사이드바 색이 달라야 한다 — 색이 실제로 바뀔 때까지 기다린 뒤 기록
    await expect.poll(async () => (shells.has(await sidebarBg()) ? "같은 색" : "새 색")).toBe("새 색");
    shells.add(await sidebarBg());
  }
  expect(shells.size).toBe(7);
  await page.getByTestId("font-lg").click();
  await expect(page.locator("html")).toHaveAttribute("data-font", "lg");
  const fs = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(parseFloat(fs)).toBeGreaterThan(20);

  await pickTheme(page, "deep-teal");
  await page.getByTestId("device-dual").click();
  const frame = page.frameLocator('[data-testid="device-frame"]');
  // 모바일 프레임은 앱 전체를 새로 불러오므로 넉넉히 기다린다
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "deep-teal", { timeout: 20_000 });
  await pickTheme(page, "emerald-gold");
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "emerald-gold", { timeout: 20_000 });
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

test("시연 모드: 처음부터 PC+Mobile, 안내 바 버튼만으로 끝까지 진행 (타자 없음)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page); // PC 모드에서 시작해도 시연은 PC+Mobile로 진행
  await page.goto("/presentation");
  await page.getByTestId("start-presentation").click();
  const frame = page.frameLocator('[data-testid="device-frame"]');
  const panel = page.getByTestId("tour-panel");
  const next = () => page.getByTestId("tour-next").click();
  const act = async (key: string) => {
    const b = page.getByTestId("tour-action");
    await expect(b).toHaveAttribute("data-action", key);
    await b.click();
    await expect(page.getByTestId("tour-action").and(page.locator(`[data-action="${key}"]`))).toHaveCount(0, { timeout: 15000 });
  };

  // ① 대표 대시보드 — 대표 휴대폰에 같은 대시보드
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("dual-view")).toBeVisible();
  await expect(panel).toHaveAttribute("data-layout", "dock");
  await expect(frame.getByTestId("kpi-strip")).toContainText("30.7억");

  // ② A현장 — 대표 휴대폰에도 손익
  await next();
  await expect(page).toHaveURL(/\/sites\/site-a$/);
  await expect(frame.getByTestId("m-eac")).toContainText("8.5억 원");

  // ③ 현장소장 휴대폰 — 버튼 2번 (비용 입력 → 보고 등록)
  await next();
  await expect(frame.getByTestId("report-sheet")).toBeVisible();
  await expect(frame.getByTestId("m-eac")).toHaveCount(0); // 현장직원 화면에는 손익 없음
  await act("fill");
  await act("submit");
  await expect(page.getByTestId("tour-live")).toContainText("+4,000만 원");

  // ④ 대표 PC·휴대폰 동시 재계산
  await next();
  await expect(frame.getByTestId("report-sheet")).toHaveCount(0);
  await expect(frame.getByTestId("m-eac")).toContainText("8.9억 원");
  await expect(frame.getByTestId("m-margin")).toContainText("11%");
  await expect(page.getByTestId("m-eac")).toContainText("8.9억 원");
  await expect(page.getByTestId("tour-live")).toContainText("8.5억 → 8.9억");

  // ⑤ 본사 공무과장 배정 → 현장소장 휴대폰 진행·완료 → 본사 결과 확인 (버튼 4번)
  await next();
  await expect(page).toHaveURL(/\/insights$/);
  await expect(page.getByTestId("demo-role")).toHaveValue("manager");
  await act("assign");
  await expect(frame.getByTestId("action-card").filter({ hasText: "추가공사 청구가능성 검토" })).toBeVisible();
  await act("start");
  await act("complete");
  const pcCard = page.getByTestId("action-board").getByTestId("action-card").filter({ hasText: "추가공사 청구가능성 검토" });
  await expect(pcCard).toHaveClass(/tour-target/); // 결과 확인할 카드로 이동·강조
  await act("confirm");
  await expect(page.getByTestId("tour-live")).toContainText("결과 확인 완료");

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

  // 시연 종료 → 다시 시작하면 이전 시연 데이터와 관계없이 처음 상태
  await page.getByTestId("demo-tour").click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("mobile-persona")).toHaveValue("same");
  await page.getByTestId("demo-tour").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("kpi-strip")).toContainText("3.96억");
  await expect(page.getByTestId("tour-panel")).toHaveAttribute("aria-label", /1\/6/);
  const left = await page.evaluate(() => JSON.parse(localStorage.getItem("tk-site-intel:db:v1") || "{}").actions.filter((a: { siteId: string }) => a.siteId === "site-a").length);
  expect(left).toBe(0);
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
    for (const r of ["/dashboard", "/sites/site-a", "/field", "/insights", "/finance", "/report", "/partner", "/settings", "/why-ax", "/evidence", "/labor", "/orders", "/schedule", "/attendance", "/data", "/usage", "/help", "/daily", "/audit", "/photos", "/quality", "/acceptance", "/launch", "/design", "/field/check", "/my"]) {
      await page.goto(r);
      await page.waitForTimeout(250);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${r} @${w}px horizontal overflow`).toBeLessThanOrEqual(1);
    }
  });
}

test("S4 투입·인건비: 출력 × 단가 추정 vs 실제 노무비, 누락 표시, 팀 단가 저장, 처리 대기 연결", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, { role: "ceo" });
  await page.goto("/dashboard");
  await expect(page.getByTestId("pending-labor").locator("b")).not.toHaveText("0");
  await page.getByTestId("pending-labor").click();
  await expect(page).toHaveURL(/\/labor/);
  const a = page.locator('[data-testid="labor-site"][data-site="site-a"]');
  await expect(a.getByTestId("labor-estimate")).toContainText("만 원");
  await expect(a.getByTestId("labor-flags")).toContainText("노무비 입력 없음");
  await expect(a.getByTestId("labor-flags")).toContainText("팀 단가 미설정");
  const team = a.getByTestId("labor-team").first();
  await expect(team).toContainText("기본 일당");
  const before = await a.getByTestId("labor-estimate").innerText();
  await team.getByTestId("labor-rate").fill("40");
  await a.getByTestId("labor-rate-save").click();
  await expect(team).not.toContainText("기본 일당");
  await expect(a.getByTestId("labor-estimate")).not.toHaveText(before);
  // 저장한 단가는 새로고침 후에도 유지 (회사 설정)
  await page.reload();
  await expect(page.locator('[data-testid="labor-site"][data-site="site-a"]').getByTestId("labor-team").first().getByTestId("labor-rate")).toHaveValue("40");
  // 기간 전환·CSV
  await page.getByTestId("labor-30d").click();
  const dl = page.waitForEvent("download");
  await page.getByTestId("labor-csv").click();
  // (이 테스트 환경의 헤드리스 브라우저는 한글 파일명을 ‘download’로 바꾸므로 내용으로 확인)
  const csvText = readFileSync((await (await dl).path())!, "utf8");
  expect(csvText).toContain("현장,기간,팀,구분,출력 일수,인원일,1인 1일 단가,추정 인건비,단가 설정");
  expect(csvText).toContain("400000");
  // 현장소장·발주처는 접근 불가
  await page.getByTestId("demo-role").selectOption("partner");
  await page.goto("/labor");
  await expect(page.getByTestId("access-denied")).toBeVisible();
  await expect(page.getByTestId("labor-site")).toHaveCount(0);
});

test("S7 고객 기초: 견적 문의·주문 요청(품목·수량) → 본사 요청함 확인·회신 → 포털 반영, 금액 비노출", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, { role: "partner" });
  await page.goto("/partner");
  // 주문 요청은 수량 필수
  await page.getByTestId("p-type").selectOption("order");
  await page.locator("#p-title").fill("지하 주차장 방화유리 교체");
  await page.getByTestId("p-item").fill("방화유리");
  await page.locator("#p-desc").fill("파손 6장 교체 요청");
  await page.getByTestId("partner-submit").click();
  await expect(page.getByText("주문 수량을 입력해주세요.")).toBeVisible();
  await page.getByTestId("p-qty").fill("6장");
  await page.getByTestId("partner-submit").click();
  await expect(page.getByTestId("partner-sent")).toBeVisible();
  const mine = page.getByTestId("partner-request-item").filter({ hasText: "지하 주차장 방화유리 교체" });
  await expect(mine).toContainText("주문 요청");
  await expect(mine).toContainText("방화유리 · 6장");
  // 시드 견적 문의도 내 요청에 보인다
  await expect(page.getByTestId("partner-request-item").filter({ hasText: "견적 문의" }).first()).toBeVisible();

  // 본사: 처리 대기 → 요청함
  await page.getByTestId("demo-role").selectOption("manager");
  await page.goto("/dashboard");
  await expect(page.getByTestId("pending-partner")).toContainText("2");
  await page.goto("/insights#requests");
  const req = page.getByTestId("partner-inbox").getByTestId("partner-request").filter({ hasText: "지하 주차장 방화유리 교체" });
  await expect(req).toContainText("주문 요청");
  await expect(req.getByTestId("request-goods")).toContainText("방화유리 · 6장");
  await req.getByTestId("request-reply").click();
  const rm = page.getByTestId("reply-modal");
  await expect(rm).toContainText("금액·내부 원가는 적지 말고");
  await rm.getByText("DEMO 회신 채우기").click();
  await rm.getByTestId("reply-confirm").click();
  await expect(req).toHaveAttribute("data-status", "answered");

  // 포털: 회신 반영, 내부 금액 없음
  await page.getByTestId("demo-role").selectOption("partner");
  await page.goto("/partner");
  const item = page.getByTestId("partner-request-item").filter({ hasText: "지하 주차장 방화유리 교체" });
  await expect(item).toHaveAttribute("data-status", "answered");
  await expect(item).toContainText("납품·시공일을 확정해 안내");
  const text = (await page.getByTestId("partner-portal").innerText()).replace(/\s+/g, " ");
  expect(text).not.toMatch(/\d+(\.\d+)?억|\d[\d,]*만 원|이익률|EAC|총원가/);
});

test("자료 이관·점검: 준비 점검 → 기성·입금 붙여넣기(오류→수정) → 넣기 → 중복 건너뜀 → 한글 엑셀(CP949) 팀 단가 → 취소", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, { role: "manager" });
  await page.goto("/data");
  // 준비 점검: B현장은 작업 인원 보고 없음 → ‘가져오기’ 누르면 작업 인원 양식으로
  const b = page.locator('[data-testid="ready-site"][data-site="site-b"]');
  await expect(b.locator('[data-key="crew"]')).toHaveAttribute("data-status", "warn");
  await b.locator('[data-key="crew"]').getByTestId("ready-import").click();
  await expect(page.getByTestId("import-kind-crew")).toHaveAttribute("aria-checked", "true");

  // 양식 내려받기 — 엑셀(.xlsx)이 기본, CSV도 가능 (D-45)
  await page.getByTestId("import-kind-billing").click();
  const dl = page.waitForEvent("download");
  await page.getByTestId("import-template").click();
  const xlsx = await dl;
  expect(xlsx.suggestedFilename()).toBe("양식_기성입금이력.xlsx");
  const bytes = readFileSync((await xlsx.path())!);
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK"); // zip = 엑셀 통합 문서
  expect(bytes.toString("latin1")).toContain("xl/workbook.xml");
  const dlCsv = page.waitForEvent("download");
  await page.getByTestId("import-template-csv").click();
  expect(readFileSync((await (await dlCsv).path())!, "utf8")).toContain("현장,구분,날짜,금액,메모");

  // 오류가 있으면 넣기 버튼이 없다
  const bad = "현장,구분,날짜,금액\nB현장,기성,2026-03-31,120000000\nB현장,선금,2026-04-30,1000";
  await page.getByTestId("import-text").fill(bad);
  await expect(page.getByTestId("import-errors")).toContainText("3행");
  await expect(page.getByTestId("import-apply")).toHaveCount(0);
  const good = "현장,구분,날짜,금액\nB현장,기성,2026-03-31,120000000\nB현장,입금,2026-04-30,120000000";
  await page.getByTestId("import-text").fill(good);
  await expect(page.getByTestId("import-summary")).toContainText("B현장 — 기성 1건 · 입금 1건");
  await expect(page.getByTestId("import-rebaseline")).toBeChecked();
  await page.getByTestId("import-apply").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  // 같은 내용을 다시 붙여넣으면 모두 중복
  await page.getByTestId("import-text").fill(good);
  await expect(page.getByTestId("import-dups")).toContainText("이미 있음");
  await expect(page.getByTestId("import-apply")).toHaveCount(0);
  // 기성·수금 화면: 날짜가 가장 이른 기성이라 B현장 1차가 되고, 기존 기성은 2차부터로 밀린다
  await page.goto("/finance");
  await expect(page.locator("main")).toContainText(/B현장 1차\s*2026\.03\.31/);

  // 엑셀 파일 그대로 (LibreOffice 저장 — 안내 시트 + 자료 시트, 위쪽 제목, 날짜·#,##0 서식, 수식)
  await page.goto("/data");
  await page.getByTestId("import-kind-billing").click();
  await page.getByTestId("import-file").setInputFiles("tests/e2e/fixtures/billing_excel.xlsx");
  await expect(page.getByTestId("import-card")).toContainText("‘기성입금’ 시트를 읽었습니다");
  await expect(page.getByTestId("import-notes")).toContainText("열 이름은 3행에서 찾았습니다");
  // 위에서 붙여넣은 2건은 중복으로 건너뛰고, 7행(글자로 적은 날짜·금액)만 새로
  await expect(page.getByTestId("import-dups")).toContainText("4행");
  await expect(page.getByTestId("import-dups")).toContainText("5행");
  await expect(page.getByTestId("import-summary")).toContainText("B현장 — 기성 1건 · 입금 0건");
  await page.getByTestId("import-apply").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  // 예전 형식(.xls)은 이유를 알려주고 받지 않는다
  await page.getByTestId("import-file").setInputFiles("tests/e2e/fixtures/legacy.xls");
  await expect(page.getByText("Excel 통합 문서(.xlsx)")).toBeVisible();

  // 한글 엑셀 ‘CSV(쉼표로 분리)’ = CP949 파일
  await page.goto("/data");
  await page.getByTestId("import-kind-rates").click();
  await page.getByTestId("import-file").setInputFiles("tests/e2e/fixtures/rates_cp949.csv");
  await expect(page.getByTestId("import-summary")).toContainText("실링팀 (엑셀): 새로 28만 원");
  await expect(page.getByTestId("import-summary")).toContainText("유리 설치팀 (가상 협력업체): 새로 32만 원");
  await page.getByTestId("import-apply").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  await page.goto("/labor");
  await expect(page.locator('[data-testid="labor-site"][data-site="site-a"]').getByTestId("labor-rate").first()).toHaveValue("32");

  // 가져오기 취소 → 단가 원래대로
  await page.goto("/data");
  const batch = page.getByTestId("import-batch").filter({ hasText: "팀 단가" });
  await batch.getByTestId("import-undo").click();
  await batch.getByTestId("import-undo-confirm").click();
  await expect(batch).toHaveAttribute("data-undone", "1");
  await page.goto("/labor");
  await expect(page.locator('[data-testid="labor-site"][data-site="site-a"]').getByTestId("labor-team").first()).toContainText("기본 일당");

  // 현장직원·발주처는 접근 불가
  await page.getByTestId("demo-role").selectOption("field");
  await page.goto("/data");
  await expect(page.getByTestId("access-denied")).toBeVisible();
});

test("4단계 준비: 사용 현황 · 역할별 사용 안내(인쇄) · 대표 전체 자료 백업", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, { role: "ceo" });
  // 사용 현황 — 현장 직원별 정착도 + 본사 응답 시간 4종
  await page.goto("/usage");
  await expect(page.getByTestId("usage-user")).toHaveCount(2);
  for (const st of await page.getByTestId("usage-user").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")))) expect(["settled", "partial", "none"]).toContain(st);
  await expect(page.getByTestId("usage-resp")).toHaveCount(4);
  const dl = page.waitForEvent("download");
  await page.getByTestId("usage-csv").click();
  expect(readFileSync((await (await dl).path())!, "utf8")).toContain("이름,직함,상태,집계 시작");
  await page.getByTestId("usage-30").click();
  await expect(page.getByTestId("usage-field")).toContainText("첫 기록일부터");

  // 사용 안내 — 대표는 대표 매뉴얼부터, 다른 역할 매뉴얼도 볼 수 있음
  await page.goto("/help");
  await expect(page.getByTestId("help-manual")).toHaveAttribute("data-manual", "ceo");
  await page.getByTestId("help-tab-field").click();
  await expect(page.getByTestId("help-manual")).toContainText("‘오늘 보고하기’");
  await expect(page.getByTestId("help-print")).toBeVisible();

  // 전체 자료 백업 (대표만)
  await page.goto("/data");
  const bk = page.waitForEvent("download");
  await page.getByTestId("backup-download").click();
  const json = JSON.parse(readFileSync((await (await bk).path())!, "utf8"));
  expect(json.format).toBe("taekang-site-intelligence-backup");
  expect(json.data.sites.length).toBe(3);
  await page.getByTestId("demo-role").selectOption("manager");
  await page.goto("/data");
  await expect(page.getByTestId("import-card")).toBeVisible();
  await expect(page.getByTestId("backup-card")).toHaveCount(0);

  // 현장 직원: 내 정보 → 사용 안내 (현장용·문제 해결만, 큰 글씨)
  await page.getByTestId("demo-role").selectOption("field");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my");
  await page.getByTestId("my-help").click();
  await expect(page).toHaveURL(/\/help/);
  await expect(page.getByTestId("help-manual")).toHaveAttribute("data-manual", "field");
  await expect(page.getByTestId("help-tab-hq")).toHaveCount(0);
  await expect(page.getByTestId("help-tab-faq")).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);

  // 발주처: 포털 → 사용 안내 (포털 매뉴얼만)
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "partner" })), [PREFS] as const);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/partner");
  await page.getByTestId("partner-help").click();
  await expect(page.getByTestId("help-manual")).toHaveAttribute("data-manual", "partner");
  await expect(page.getByTestId("help-manual")).not.toContainText("원가");
});

test("공사일보 자동 작성: 현장 보고 → 일보(작업·공정 진척·인원·특이사항·사진, 금액 없음) → 주간 보고(미래 날짜는 ‘예정’)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page, { role: "field" });
  // 현장소장이 오늘 보고(공정 + 사진 없이) + 작업 인원을 보냄
  await page.goto("/field");
  await page.getByTestId("easy-go-crew").click();
  await page.getByTestId("crew-site-site-a").click();
  await page.getByTestId("crew-team-chip").first().click();
  await page.getByTestId("crew-count-stepper-plus").click();
  await page.getByTestId("easy-next").click();
  await page.getByTestId("easy-next").click(); // 사진 없이
  await page.getByTestId("crew-send").click();
  await expect(page.getByTestId("crew-done")).toBeVisible();

  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "manager" })), [PREFS] as const);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await page.getByTestId("today-daily-link").click();
  await expect(page).toHaveURL(/\/daily/);
  const doc = page.getByTestId("daily-doc");
  await expect(doc).toContainText("공 사 일 보");
  await expect(page.getByTestId("daily-crew")).toContainText("작업 인원");
  await expect(page.getByTestId("daily-crew")).toContainText("명");
  // 어제(시드 보고): 작업 내용·특이사항·명일 계획
  await page.getByTestId("daily-prev").click();
  await expect(page.getByTestId("daily-work")).toContainText("커튼월");
  await expect(page.getByTestId("daily-issues")).not.toContainText("없음");
  // 금액은 일보에 없다
  expect((await doc.innerText()).replace(/\s+/g, " ")).not.toMatch(/\d[\d,]*만 원|\d+(\.\d+)?억|원가|이익/);
  // 주간 보고
  await page.getByTestId("daily-mode-week").click();
  const wk = page.getByTestId("weekly-doc");
  await expect(wk).toContainText("주간 공정 보고");
  await expect(page.getByTestId("weekly-days").locator("tbody tr")).toHaveCount(7);
  const future = page.locator('[data-testid="weekly-days"] tr[data-future="1"]');
  if (await future.count()) await expect(future.first()).toContainText("예정");
  await expect(page.getByTestId("daily-print")).toBeVisible();
  // 현장직원·발주처는 접근 불가
  await page.getByTestId("demo-role").selectOption("partner");
  await page.goto("/daily");
  await expect(page.getByTestId("access-denied")).toBeVisible();
});

test("운영 배포 준비: 보안 헤더(CSP·위치/카메라 권한·검색 차단) · 홈 화면 앱(manifest·아이콘) · 상태 확인 · CSP 위반 없음", async ({ page }) => {
  const res = await page.request.get("/dashboard");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("default-src 'self'");
  expect(h["content-security-policy"]).toContain("object-src 'none'");
  expect(h["permissions-policy"]).toContain("geolocation=(self)");
  expect(h["x-robots-tag"]).toContain("noindex");
  expect(h["x-frame-options"]).toBe("SAMEORIGIN");
  const mf = await (await page.request.get("/manifest.webmanifest")).json();
  expect(mf).toMatchObject({ display: "standalone", start_url: "/" });
  expect(mf.icons.map((i: { sizes: string }) => i.sizes)).toEqual(["192x192", "512x512", "512x512"]);
  for (const icon of ["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"]) expect((await page.request.get(icon)).status(), icon).toBe(200);
  expect(await (await page.request.get("/api/health")).json()).toMatchObject({ ok: true, mode: "demo" });

  // 화면을 돌아다니며 CSP 위반(차단된 스크립트·스타일·이미지)이 없는지
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(m.text())) violations.push(m.text());
  });
  await freshStart(page, { role: "ceo", deviceView: "dual" });
  for (const r of ["/dashboard", "/sites/site-a", "/daily", "/attendance", "/labor", "/data", "/usage", "/help", "/report", "/partner"]) {
    await page.goto(r);
    await page.waitForTimeout(250);
  }
  // PC+Mobile 미리보기(같은 주소 iframe)가 CSP에 막히지 않는다
  await page.goto("/dashboard");
  await expect(page.locator("iframe").first()).toBeVisible();
  const frame = page.frameLocator("iframe").first();
  await expect(frame.locator("body")).not.toBeEmpty();
  expect(violations).toEqual([]);
});

test("활동 이력: 설정 변경이 이력에 남고 종류·검색으로 찾기 · CSV · 현장직원 접근 차단", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, { role: "manager" });
  await page.goto("/labor");
  const team = page.locator('[data-testid="labor-site"][data-site="site-a"]').getByTestId("labor-team").first();
  await team.getByTestId("labor-rate").fill("33");
  await page.locator('[data-testid="labor-site"][data-site="site-a"]').getByTestId("labor-rate-save").click();
  await expect(team).not.toContainText("기본 일당");
  await page.goto("/audit");
  await expect(page.getByTestId("audit-row").first()).toBeVisible();
  await page.getByTestId("audit-type").selectOption("settings");
  const rows = page.getByTestId("audit-row");
  await expect(rows.first()).toContainText("운영 설정 변경");
  for (const t of await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-type")))) expect(t).toBe("settings");
  await page.getByTestId("audit-type").selectOption("");
  await page.getByTestId("audit-q").fill("운영 설정");
  await page.getByTestId("audit-search").click();
  await expect(rows.first()).toContainText("운영 설정");
  const dl = page.waitForEvent("download");
  await page.getByTestId("audit-csv").click();
  expect(readFileSync((await (await dl).path())!, "utf8")).toContain("시각,사람,현장,종류,내용");
  await page.getByTestId("demo-role").selectOption("field");
  await page.goto("/audit");
  await expect(page.getByTestId("access-denied")).toBeVisible();
});

test("휴대폰 알림 카드: 시연에서는 ‘실제 운영에서 켬’ 안내, 현장 첫 화면 권유는 시연에서 숨김", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page, { role: "field" });
  await page.goto("/my");
  await expect(page.getByTestId("push-card")).toHaveAttribute("data-state", "demo");
  await expect(page.getByTestId("push-card")).toContainText("실제 운영에서");
  await page.goto("/field");
  await expect(page.getByTestId("easy-go-report")).toBeVisible();
  await expect(page.getByTestId("push-nudge")).toHaveCount(0);
});

test("사진대장: 현장 ‘사진만 보내기’ → 본사 사진대장(번호·일자·공종·내용) → 빼고 넣기 → 인쇄 장수 · 발주처 차단", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page, { role: "field" });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  for (const name of ["a.png", "b.png"]) {
    await page.goto("/field");
    await page.getByTestId("easy-go-photo").click();
    await page.getByTestId("easy-site-site-a").click();
    await page.getByTestId("photo-album").setInputFiles({ name, mimeType: "image/png", buffer: png });
    await page.getByTestId("easy-next").click();
    await page.getByTestId("submit-report").click();
    await expect(page.getByTestId("report-home")).toBeVisible();
  }
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "manager" })), [PREFS] as const);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/photos");
  await expect(page.getByTestId("ledger-thumb")).toHaveCount(2);
  const cells = page.getByTestId("ledger-cell");
  await expect(cells).toHaveCount(2);
  await expect(cells.first()).toContainText("번호");
  await expect(cells.first()).toContainText("공종");
  await expect(page.getByTestId("ledger-page")).toHaveCount(1);
  await page.getByTestId("ledger-thumb").first().click();
  await expect(page.getByTestId("ledger-count")).toHaveText("1");
  await expect(cells).toHaveCount(1);
  await expect(page.getByTestId("ledger-print")).toContainText("1장");
  // 금액 없음
  expect((await page.getByTestId("ledger-page").innerText()).replace(/\s+/g, " ")).not.toMatch(/\d[\d,]*만 원|억/);
  await page.getByTestId("demo-role").selectOption("partner");
  await page.goto("/photos");
  await expect(page.getByTestId("access-denied")).toBeVisible();
});

test("합계 카드 = 아래 표 (D-61): 기성·수금 합계는 현장별 표의 합, 출퇴근 ‘확인 필요’ 숫자는 아래 목록 건수", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  // "30.7억 원" · "8,060만" · "1억 5,000만 원" · "—" → 원
  const won = (t: string) => {
    const s = t.replace(/원|\s|,/g, "");
    if (!s || s === "—") return 0;
    // ‘단위 억 원’ 표의 숫자만 있는 칸은 억 (D-66: 1억 미만도 0.81처럼 억으로 표시)
    if (/^[\d.]+$/.test(s)) return Number(s) * 1e8;
    if (s === "<0.01") return 0;
    const m = /^(?:([\d.]+)억)?(?:([\d.]+)만)?$/.exec(s);
    if (!m) throw new Error(`금액 아님: ${t}`);
    return Number(m[1] ?? 0) * 1e8 + Number(m[2] ?? 0) * 1e4;
  };
  await page.goto("/finance");
  const rows = page.getByTestId("finance-table").locator("tbody tr");
  await expect(rows).toHaveCount(3);
  const col = async (i: number) => {
    let sum = 0;
    for (const r of await rows.all()) sum += won(((await r.locator("td").nth(i).innerText()).split("\n")[0]));
    return sum;
  };
  const card = (id: string) => page.getByTestId(`fin-total-${id}`);
  const value = async (id: string) => won(await card(id).locator("p.num").innerText());
  // 표는 억 소수 둘째 자리까지 보여 주므로 현장 3곳 반올림 차이(최대 0.015억)까지 허용
  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1_500_000);
  expect(await value("contract")).toBeGreaterThan(1e9); // 0 = 0 으로 그냥 통과하지 않게
  near(await value("contract"), await col(3));
  near(await value("profit"), await col(4));
  near(await value("billed"), await col(5));
  near(await value("outstanding"), await col(8));
  near(won(await card("outstanding").locator("b").innerText()), await col(7));

  await page.goto("/attendance");
  const head = await page.getByTestId("att-flags").locator("h2, h3").first().innerText();
  const n = /(\d+)건/.exec(head)?.[1] ?? "0";
  await expect(page.getByTestId("att-stat-flags")).toContainText(`${n}건`);
  await page.getByTestId("att-yesterday").click();
  await expect(page.getByTestId("att-stat-missing")).toContainText("오늘 날짜에서만 셉니다");
});
