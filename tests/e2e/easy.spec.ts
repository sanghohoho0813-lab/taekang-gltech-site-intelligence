import { test, expect, type Page } from "@playwright/test";

/** 현장 직원(60~70대 포함) 쉬운 화면 — 글자 입력 없이 누르기만으로 보고, 큰 글씨·큰 버튼 */
const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";

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

/** 보이는 버튼의 최소 높이(px)와 보이는 글자의 최소 크기(px) */
async function sizes(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((root) => {
    const visible = (e: Element) => (e as HTMLElement).offsetParent !== null && !e.closest('[data-testid="fill-demo"]');
    const btns = [...root.querySelectorAll("button, a")].filter((b) => visible(b) && b.getAttribute("data-testid") !== "fill-demo").map((b) => b.getBoundingClientRect().height);
    const fonts = [...root.querySelectorAll("p, span, button, label, h1, h2, a, li")]
      .filter((e) => visible(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()))
      .filter((e) => !e.closest(".bg-\\[\\#FFF7D6\\]") && e.textContent!.trim() !== "DEMO")
      .map((e) => parseFloat(getComputedStyle(e).fontSize));
    return { minBtn: Math.min(...btns), minFont: Math.min(...fonts) };
  });
}

test("현장 직원 쉬운 화면: 타자 없이 보고 → 홈 상태·기록 반영 → 취소, 큰 글씨·큰 버튼", async ({ page }) => {
  await asField(page);
  await page.goto("/field");
  const home = page.getByTestId("easy-home");
  await expect(home).toBeVisible();
  await expect(page.getByTestId("easy-site-status")).toHaveCount(2);
  // 휴대폰 머리글: 전체 메뉴·시계·알림 대신 ‘글자 크게’ / 하단 메뉴는 이름 그대로 4개
  await expect(page.getByTestId("mobile-header").getByRole("button", { name: "전체 메뉴 열기" })).toHaveCount(0);
  await expect(page.getByTestId("font-toggle")).toBeVisible();
  await expect(page.getByTestId("bottom-nav").getByRole("link")).toHaveCount(4);
  await expect(page.getByTestId("bottom-nav")).toContainText("본사 요청");
  const h = await sizes(page, "easy-home");
  expect(h.minBtn).toBeGreaterThanOrEqual(44);
  expect(h.minFont).toBeGreaterThanOrEqual(16);

  await page.getByTestId("easy-go-report").click();
  await page.getByTestId("easy-site-site-a").click();
  await page.getByTestId("work-chip").first().click();
  await page.getByTestId("easy-next").click();
  await page.getByTestId("progress-same").click();
  await page.getByTestId("easy-next").click(); // 사진 없이 다음
  await page.getByTestId("issue-no").click();
  await page.getByTestId("cost-yes").click();
  await page.getByTestId("cost-cat-material").click();
  await page.getByTestId("amt-plus-100").click();
  await page.getByTestId("amt-plus-100").click();
  await expect(page.getByTestId("cost-amount")).toHaveValue("200");
  await page.getByTestId("easy-next").click();
  await page.getByTestId("impact-unknown").click();
  await page.getByTestId("easy-next").click();
  await page.getByTestId("reason-rework").click();
  const confirm = page.getByTestId("easy-confirm");
  await expect(confirm).toContainText("200만 원");
  await expect(confirm).toContainText("예산 여부 모름");
  const c = await sizes(page, "easy-report");
  expect(c.minBtn).toBeGreaterThanOrEqual(44);
  expect(c.minFont).toBeGreaterThanOrEqual(16);
  await page.getByTestId("submit-report").click();
  await expect(page.getByTestId("report-done")).toContainText("200만 원");

  await page.getByTestId("report-home").click();
  await expect(page.getByTestId("easy-site-status").filter({ hasText: "A현장" })).toContainText("오늘 보고 보냄");
  await expect(page.getByTestId("easy-site-status").filter({ hasText: "B현장" })).toContainText("아직 안 보냄");
  const rec = page.getByTestId("record-item").first();
  await expect(rec).toContainText("반영됨");
  // 보낸 보고 취소 (한 번 더 묻고 취소)
  await rec.getByTestId("record-cancel").click();
  await rec.getByTestId("record-cancel-yes").click();
  await expect(rec).toContainText("취소함");
  await expect(page.getByTestId("easy-site-status").filter({ hasText: "A현장" })).toContainText("아직 안 보냄");

  // 다시 보고 → 대표 대시보드 '오늘 현장 보고'에 A현장 보고함 표시
  await page.getByTestId("easy-go-photo").click();
  await page.getByTestId("easy-site-site-a").click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.getByTestId("photo-album").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: png });
  await page.getByTestId("easy-next").click();
  await page.getByTestId("submit-report").click();
  await page.getByTestId("report-home").click();
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "ceo" })), [PREFS] as const);
  await page.goto("/dashboard");
  const today = page.getByTestId("today-reports");
  await expect(today.getByTestId("today-report-row").filter({ hasText: "A현장" })).toHaveAttribute("data-reported", "1");
  await expect(today.getByTestId("today-report-row").filter({ hasText: "A현장" })).toContainText("사진 1");
  await expect(today.getByTestId("today-report-row").filter({ hasText: "B현장" })).toHaveAttribute("data-reported", "0");
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "field" })), [PREFS] as const);
  await page.goto("/field");

  // 글자 크게 → 아주 크게 → 보통 (어디서든 한 번에)
  await page.getByTestId("font-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-font", "lg");
  await page.getByTestId("font-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-font", "xl");
  // 아주 크게에서도 가로로 넘치지 않는다
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.getByTestId("font-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-font", "md");
});

test("현장 직원 사진만 보내기 · 추가 비용만 알리기 · 쓰다 만 보고 이어서", async ({ page }) => {
  await asField(page);
  // 추가 비용만: 인원·일수로 인건비
  await page.goto("/field/report?mode=cost");
  await page.getByTestId("easy-site-site-b").click();
  await page.getByTestId("cost-cat-labor").click();
  await page.getByTestId("labor-people-plus").click(); // 2명
  await expect(page.getByTestId("cost-readback")).toContainText("60만 원"); // 2명 × 1일 × 30만
  await page.getByTestId("easy-next").click();
  await page.getByTestId("impact-additional").click();
  await page.getByTestId("easy-next").click();
  await page.getByTestId("reason-schedule").click();
  await page.getByTestId("submit-report").click();
  await expect(page.getByTestId("report-done")).toContainText("60만 원");

  // 쓰다가 나가면 이어서 쓰기
  await page.goto("/field/report");
  await page.getByTestId("easy-site-site-a").click();
  await page.getByTestId("work-chip").nth(1).click();
  await page.goto("/field");
  await page.getByTestId("easy-go-report").click();
  await page.getByTestId("easy-site-site-a").click();
  await page.getByTestId("resume-yes").click();
  await expect(page.getByTestId("easy-confirm")).toBeVisible();
  await expect(page.getByTestId("confirm-work")).not.toContainText("작업을 넣어 주세요");

  // 사진만 보내기: 사진 없이는 못 보냄 → 사진 1장 넣고 보내기
  await page.goto("/field/report?mode=photo");
  await page.getByTestId("easy-site-site-a").click();
  await expect(page.getByTestId("easy-next")).toBeDisabled();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.getByTestId("photo-album").setInputFiles({ name: "site.png", mimeType: "image/png", buffer: png });
  await expect(page.getByTestId("easy-next")).toContainText("사진 1장");
  await page.getByTestId("easy-next").click();
  await page.getByTestId("submit-report").click();
  await expect(page.getByTestId("report-done")).toContainText("본사로 보냈습니다");
});

test("현장 직원 본사 요청: 큰 버튼으로 시작 → 다 했어요(눌러서 결과 고르기)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings");
  await page.evaluate(
    ([pk, dk]) => {
      localStorage.clear();
      localStorage.removeItem(dk);
      localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: "manager", deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 }));
    },
    [PREFS, DB] as const,
  );
  // 본사에서 A현장 위험 신호로 조치 배정
  await page.goto("/insights");
  await page.getByTestId("signal-board").locator("[data-rule]").filter({ has: page.getByTestId("create-action") }).first().getByTestId("create-action").click();
  await page.getByTestId("assignee-select").selectOption("u-field");
  await page.getByTestId("assign-confirm").click();
  // 현장 직원 휴대폰
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "field" })), [PREFS] as const);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/field");
  await expect(page.getByTestId("easy-go-actions")).toContainText("본사 요청 1건");
  await page.getByTestId("fieldnav-my-actions").click();
  const card = page.getByTestId("action-card").first();
  await expect(card).toContainText("아직 시작 안 함");
  await card.getByTestId("action-start").click();
  await expect(card).toContainText("하는 중");
  await card.getByTestId("action-complete").click();
  const modal = page.getByTestId("complete-modal");
  await expect(modal.getByTestId("complete-confirm")).toBeDisabled();
  await modal.getByTestId("result-chip").first().click();
  await modal.getByTestId("complete-confirm").click();
  await expect(page.getByTestId("complete-modal")).toHaveCount(0);
  await page.getByRole("tab", { name: /끝낸 일/ }).click();
  await expect(page.getByTestId("action-card").first()).toContainText("본사 확인 기다리는 중");
});

test.describe("GPS 출퇴근", () => {
  const A = { latitude: 37.2638, longitude: 127.0289 }; // 가상 A현장 중심에서 약 35m

  test("현장 안 출근(동의) → 본사 출퇴근 현황 → 의심 표시·정정 → 퇴근", async ({ page }) => {
    await asField(page);
    await page.context().grantPermissions(["geolocation"]);
    await page.context().setGeolocation({ ...A, accuracy: 15 });
    await page.goto("/field");
    await page.getByTestId("att-in").click();
    // 처음에는 위치 기록 동의를 먼저 묻는다
    await expect(page.getByTestId("att-card")).toContainText("출근·퇴근 버튼을 누를 때만");
    await page.getByTestId("att-consent-yes").click();
    // 담당 현장이 2곳이어도 위치로 A현장을 자동 선택
    await expect(page.getByTestId("att-result")).toContainText("출근 기록 완료");
    await expect(page.getByTestId("att-status")).toContainText("A현장 출근");
    await expect(page.getByTestId("att-status")).toContainText("현장 안");

    // 본사 화면
    await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "manager" })), [PREFS] as const);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/attendance");
    await expect(page.locator('[data-testid="att-site"][data-site="site-a"]').getByTestId("att-row")).toContainText("현장 안");
    await expect(page.locator('[data-testid="att-site"][data-site="site-b"]').getByTestId("att-row")).toContainText("A현장에 출근");
    await expect(page.getByTestId("att-flags")).not.toContainText("최성민 — B현장 출근 기록이 아직 없습니다");
    // DEMO 예시: 정우진 — 현장 밖 출근, 위치가 매일 똑같음, 어제 퇴근 누락
    await expect(page.getByTestId("att-flag-outside")).toContainText("정우진");
    await expect(page.getByTestId("att-flag-same_spot")).toContainText("정우진");
    await expect(page.getByTestId("att-flag-no_checkout")).toContainText("정우진");
    // 어제 퇴근 누락 정정 (사유 필수)
    await page.getByTestId("att-yesterday").click();
    const row = page.locator('[data-testid="att-site"][data-site="site-c"]').getByTestId("att-row");
    await expect(row).toContainText("퇴근 기록 없음");
    await row.getByTestId("att-fix").click();
    await page.getByTestId("att-fix-save").click();
    await expect(page.getByTestId("att-fix-modal")).toBeVisible(); // 사유 없으면 저장 안 됨
    await page.getByTestId("att-fix-note").fill("퇴근 버튼 누락 — 반장 확인");
    await page.getByTestId("att-fix-save").click();
    await expect(row).toContainText("본사 정정: 퇴근 버튼 누락");
    // 대시보드 카드
    await page.goto("/dashboard");
    await expect(page.getByTestId("today-reports").getByTestId("today-report-row").filter({ hasText: "A현장" })).toContainText("현장 안");

    // 현장 직원 퇴근
    await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "field" })), [PREFS] as const);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/field");
    await page.getByTestId("att-out").click();
    await expect(page.getByTestId("att-result")).toContainText("퇴근");
    await expect(page.getByTestId("att-status")).toContainText("오늘 근무 끝");
  });

  test("현장 밖에서 누르면 한 번 더 묻고, 그대로 기록하면 본사에 ‘현장 밖’", async ({ page }) => {
    await asField(page);
    await page.context().grantPermissions(["geolocation"]);
    await page.context().setGeolocation({ latitude: 37.3, longitude: 127.1, accuracy: 10 }); // 약 7.6km
    await page.goto("/field");
    await page.getByTestId("att-in").click();
    await page.getByTestId("att-consent-yes").click();
    // 담당 2곳 중 반경 안 현장이 없으면 현장을 고른다
    await page.getByTestId("att-site-site-a").click();
    await expect(page.getByTestId("att-card")).toContainText("떨어진 곳이에요");
    await page.getByTestId("att-anyway").click();
    await expect(page.getByTestId("att-status")).toContainText("현장 밖");
  });

  test("위치 기록에 동의하지 않아도 출근은 되고, 본사에 ‘위치 없음’", async ({ page }) => {
    await asField(page);
    await page.goto("/field");
    await page.getByTestId("att-in").click();
    await page.getByTestId("att-consent-no").click();
    await page.getByTestId("att-site-site-b").click();
    await expect(page.getByTestId("att-status")).toContainText("위치 없음");
  });
});
