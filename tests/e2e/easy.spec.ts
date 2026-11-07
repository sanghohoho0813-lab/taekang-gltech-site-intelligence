import { test, expect, type Page } from "./demoTest";

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
  await expect(page.getByTestId("report-done")).toContainText("본사로 보냈어요");
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
  // A현장에 추가 원가가 들어와 위험 신호가 생긴 상황 (현장 직원은 자기 담당 현장 조치만 맡는다 · D-66)
  await page.goto("/sites/site-a");
  await page.getByTestId("open-report-sheet-pc").click();
  const sheet = page.getByTestId("report-sheet");
  await sheet.getByTestId("fill-demo").click();
  await sheet.getByTestId("submit-report").click();
  await expect(sheet.getByTestId("report-impact")).toContainText("8.9억 원");
  // 본사에서 A현장 위험 신호로 조치 배정
  await page.goto("/insights");
  // 현장 직원은 자기 담당 현장(A현장)의 조치만 맡을 수 있다 (D-66)
  await page.getByTestId("signal-board").locator('[data-rule][data-site="site-a"]').filter({ has: page.getByTestId("create-action") }).first().getByTestId("create-action").click();
  await page.getByTestId("assignee-select").selectOption("u-field");
  await page.getByTestId("assign-confirm").click();
  // 현장 직원 휴대폰
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "field" })), [PREFS] as const);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/field");
  await expect(page.getByTestId("easy-go-actions")).toContainText("본사 요청 3건"); // 위험 조치 1 + 시드 작업지시 2
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
    await expect(page.getByTestId("att-card")).toContainText("버튼을 누를 때만 위치를 한 번 기록");
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
    // 퇴근은 한 번 더 묻는다 (D-65)
    await expect(page.getByTestId("att-out-ask")).toContainText("지금 퇴근할까요?");
    await page.getByTestId("att-out-yes").click();
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

test.describe("현장 QR 출근", () => {
  test("본사 단말기 등록 → 태블릿 연결·QR 표시 → 휴대폰으로 QR 사진 찍어 출근 → 본사 ‘QR 확인’", async ({ page, context }) => {
    await asField(page);
    await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "manager" })), [PREFS] as const);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/attendance");
    page.once("dialog", (d) => void d.accept()); // 회사 설정 변경 확인 (D-65)
    await page.getByTestId("att-mode-qr").click();
    const siteA = page.locator('[data-testid="att-site"][data-site="site-a"]');
    await siteA.getByTestId("kiosk-add").click();
    const code = (await page.getByTestId("pair-code").innerText()).trim();
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    await page.getByRole("button", { name: "닫기" }).last().click();

    // 현장 태블릿 (같은 브라우저 저장소 = DEMO) — 연결 코드로 연결
    const kiosk = await context.newPage();
    await kiosk.setViewportSize({ width: 800, height: 1100 });
    await kiosk.goto(`/kiosk?c=${code}`);
    await expect(kiosk.getByTestId("kiosk-live")).toContainText("A현장 출근 QR");
    const shot = await kiosk.getByTestId("kiosk-qr").screenshot();
    await kiosk.close();

    // 현장 직원 휴대폰: QR 사진 → 동의 → 출근
    await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "field" })), [PREFS] as const);
    await page.setViewportSize({ width: 390, height: 844 });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 37.2638, longitude: 127.0289, accuracy: 15 });
    await page.goto("/field");
    await expect(page.getByTestId("att-in")).toContainText("QR 없이 출근");
    await page.getByTestId("att-qr-file").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: shot });
    await page.getByTestId("att-consent-yes").click();
    await expect(page.getByTestId("att-result")).toContainText("현장 QR 확인");
    await expect(page.getByTestId("att-status")).toContainText("현장 QR 확인");

    // 본사: QR 확인 표시, 단말기 마지막 사용
    await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "manager" })), [PREFS] as const);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/attendance");
    await expect(siteA.getByTestId("att-row")).toContainText("QR 확인");
    await expect(siteA.getByTestId("kiosk-row").filter({ hasText: "연결됨" }).first()).toBeVisible();
    // QR 방식인데 정우진은 QR 없이 출근 → 확인 필요 항목
    await expect(page.getByTestId("att-flag-no_qr")).toContainText("정우진");
  });

  test("QR이 아닌 사진·다른 현장 QR은 출근되지 않는다", async ({ page, context }) => {
    await asField(page);
    await page.goto("/field");
    // 화면이 시연 데이터를 저장소에 만들 때까지 기다린다 (먼저 읽으면 비어 있어 가끔 실패하던 문제)
    await page.waitForFunction((dk) => !!localStorage.getItem(dk), DB);
    // 본사 설정: 현장 QR + GPS (DEMO 저장소)
    await page.evaluate(([dk]) => {
      const db = JSON.parse(localStorage.getItem(dk)!);
      db.settings = { ...(db.settings ?? {}), attendanceMode: "qr" };
      localStorage.setItem(dk, JSON.stringify(db));
    }, [DB] as const);
    await page.reload();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.getByTestId("att-qr-file").setInputFiles({ name: "x.png", mimeType: "image/png", buffer: png });
    await expect(page.getByTestId("att-card")).toContainText("QR을 읽지 못했어요");
    // 다른 현장(C현장, 정우진 담당) 태블릿 QR
    const kiosk = await context.newPage();
    await kiosk.goto("/kiosk");
    await kiosk.evaluate(() =>
      localStorage.setItem("tk-site-intel:kiosk", JSON.stringify({ kioskId: "kio_demo3", siteId: "site-c", siteName: "C현장", kioskName: "C현장 태블릿", companyName: "DEMO", secret: "demo-kiosk-secret-site-c-not-for-live", offset: 0 })),
    );
    await kiosk.reload();
    const shot = await kiosk.getByTestId("kiosk-qr").screenshot();
    await kiosk.close();
    await page.getByTestId("att-qr-file").setInputFiles({ name: "c.png", mimeType: "image/png", buffer: shot });
    await expect(page.getByTestId("att-card")).toContainText("내 담당 현장의 QR이 아닙니다");
    await expect(page.getByTestId("att-in")).toBeVisible(); // 출근되지 않음
  });
});

test("공정 일정: 현장 보고에서 오늘 한 공정 진척(누르기) → 본사 공정 일정에 반영, 기한 지난 공정 표시", async ({ page }) => {
  await asField(page);
  await page.goto("/field/report");
  await page.getByTestId("easy-site-site-a").click();
  await page.getByTestId("work-chip").filter({ hasText: "커튼월 유닛 설치" }).click();
  await page.getByTestId("easy-next").click();
  // 오늘 고른 공정만 + − 로
  await expect(page.getByTestId("easy-progress")).toContainText("커튼월 유닛 설치 (지금 45%)");
  await page.getByTestId("stage-stepper-0-plus").click();
  await page.getByTestId("stage-stepper-0-plus").click();
  await page.getByTestId("easy-next").click();
  await page.getByTestId("easy-next").click(); // 사진 없이
  await page.getByTestId("issue-no").click();
  await page.getByTestId("cost-no").click();
  await expect(page.getByTestId("confirm-stages")).toContainText("커튼월 유닛 설치 45% → 55%");
  await page.getByTestId("submit-report").click();
  await expect(page.getByTestId("report-done")).toBeVisible();

  // 본사
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "manager" })), [PREFS] as const);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/schedule");
  const a = page.locator('[data-testid="sched-site"][data-site="site-a"]');
  await expect(a.getByTestId("sched-stage").filter({ hasText: "커튼월 유닛 설치" })).toContainText("55%");
  await expect(a.getByTestId("sched-stage").filter({ hasText: "커튼월 유닛 제작" })).toHaveAttribute("data-status", "overdue");
  await expect(page.getByTestId("sched-summary")).toContainText("기한 지났거나 시작 못 한 공정");
  await expect(a.getByTestId("sched-head-late")).toContainText("기한 지난 공정 1개");
  // 현장 상세 공정 탭에도 계획 진척 표시
  await page.goto("/sites/site-a");
  await page.getByRole("tab", { name: /공정/ }).click();
  await expect(page.getByText(/계획 \d+%/).first()).toBeVisible();
});

test("작업 인원(출력): 팀 고르기 → 인원 → 단체 사진 → 보내기, 공수를 더 많이 보고하면 본사에 대조 표시", async ({ page }) => {
  await asField(page);
  await page.goto("/field");
  await page.getByTestId("easy-go-crew").click();
  await page.getByTestId("crew-site-site-a").click();
  // 지난번 보낸 팀이 바로 나온다 (지난번 4명)
  await page.getByTestId("crew-team-chip").first().click();
  await expect(page.getByTestId("crew-count")).toContainText("4");
  await page.getByTestId("crew-count-stepper-plus").click(); // 5명
  await page.getByTestId("easy-next").click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.getByTestId("crew-photo-file").setInputFiles({ name: "crew.png", mimeType: "image/png", buffer: png });
  await page.getByTestId("easy-next").click();
  await expect(page.getByTestId("crew-confirm-text")).toContainText("5명");
  await page.getByTestId("crew-send").click();
  await expect(page.getByTestId("crew-done")).toContainText("5명");

  // 같은 날 노무 공수 10명 × 3일 = 30 보고 (최근 30일 출력 4명×5일 + 5 = 25명·일)
  await page.goto("/field/report?mode=cost");
  await page.getByTestId("easy-site-site-a").click();
  await page.getByTestId("cost-cat-labor").click();
  for (let i = 0; i < 9; i++) await page.getByTestId("labor-people-plus").click();
  for (let i = 0; i < 4; i++) await page.getByTestId("labor-days-plus").click();
  await expect(page.getByTestId("cost-readback")).toContainText("900만 원");
  await page.getByTestId("easy-next").click();
  await page.getByTestId("impact-additional").click();
  await page.getByTestId("reason-quantity_increase").click();
  await page.getByTestId("submit-report").click();
  await expect(page.getByTestId("report-done")).toBeVisible();

  // 본사
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "manager" })), [PREFS] as const);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/attendance");
  const card = page.getByTestId("crew-card");
  await expect(card.getByTestId("crew-row")).toContainText("5명");
  await expect(card.getByTestId("crew-row").locator("img")).toBeVisible();
  await expect(card.getByTestId("crew-gap")).toHaveAttribute("data-over", "1");
  await expect(card.getByTestId("crew-flags")).toContainText("보고 공수가 출력 인원보다 많음");
  await expect(card.getByTestId("crew-flags")).toContainText("보낸 사람 출근 기록 없음"); // 최성민 오늘 출근 안 함
});

test("자재 반입·설치 (D-62): 반입 → 수량 → 사진 → 보내기 → 누계 · 오늘 기록 취소 · 설치 → 본사 자재 표·공사일보·품목 추가", async ({ page }) => {
  await asField(page);
  await page.goto("/field");
  await page.getByTestId("easy-go-material").click();
  await page.getByTestId("material-site-site-a").click();
  await page.getByTestId("material-kind-in").click();
  await page.getByTestId("material-item-mat-a-glass").click();
  // 큰 글씨·큰 버튼 (수량 화면)
  const sz = await sizes(page, "easy-material");
  expect(sz.minFont).toBeGreaterThanOrEqual(16);
  expect(sz.minBtn).toBeGreaterThanOrEqual(44);
  await page.getByTestId("material-qty-input").fill("4O"); // 글자는 들어가지 않는다
  await expect(page.getByTestId("material-qty-input")).toHaveValue("4");
  await page.getByTestId("material-qty-input").fill("40");
  await page.getByTestId("easy-next").click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.getByTestId("material-photo-file").setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: png });
  await page.getByTestId("material-note").fill("송장 대조");
  await page.getByTestId("easy-next").click();
  await expect(page.getByTestId("material-confirm-text")).toContainText("삼중 로이유리 40 장 반입");
  await page.getByTestId("material-send").click();
  await expect(page.getByTestId("material-done-totals")).toContainText("들어온 누계 220 장");
  await expect(page.getByTestId("material-done-totals")).toContainText("현장에 남은 것 116 장");

  // 오늘 내가 남긴 기록 → 사유를 골라 취소 (지우지 않고 취소 표시)
  await page.getByTestId("material-again").click();
  // 현장 두 곳을 맡은 사람은 현장부터 다시 고른다 (D-65)
  await page.getByTestId("material-site-site-a").click();
  await expect(page.getByTestId("material-today-row")).toHaveCount(1);
  await page.getByTestId("material-void").click();
  await page.getByTestId("material-void-reason").first().click();
  await expect(page.getByTestId("material-today-row")).toHaveCount(0);

  // 설치 10 EA (+10 버튼)
  await page.getByTestId("material-kind-install").click();
  await page.getByTestId("material-item-mat-a-unit").click();
  await page.getByTestId("material-plus-10").click();
  await page.getByTestId("easy-next").click();
  await page.getByTestId("easy-next").click();
  await page.getByTestId("material-send").click();
  await expect(page.getByTestId("material-done-totals")).toContainText("설치 누계 118 EA");

  // 본사: 현장 상세 → 자재
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "manager" })), [PREFS] as const);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sites/site-a?tab=material");
  await expect(page.getByTestId("material-row").filter({ hasText: "커튼월 유닛" })).toContainText("118 EA");
  await expect(page.getByTestId("material-row").filter({ hasText: "삼중 로이유리" })).toContainText("180 장"); // 취소한 40장은 빠짐
  await expect(page.locator('[data-testid="material-move"][data-voided="1"]')).toContainText("취소 — 수량을 잘못 넣었어요");
  // 품목 추가 (설계 수량 모르면 비움)
  await page.getByTestId("material-setup").click();
  await page.getByTestId("material-setup-add").click();
  await page.getByTestId("material-setup-name").last().fill("실링재");
  await page.getByTestId("material-setup-unit").last().fill("박스");
  await page.getByTestId("material-setup-save").click();
  await expect(page.getByTestId("material-row").filter({ hasText: "실링재" })).toContainText("설계 수량 없음");
  // 공사일보: 오늘 설치 10 EA (취소한 반입은 없음)
  await page.goto("/daily");
  const q = page.getByTestId("daily-material-qty");
  await expect(q).toContainText("커튼월 유닛");
  await expect(q).toContainText("10 EA");
  await expect(q).not.toContainText("40 장");
  // 주간 보고: 이번 주 설치(어제·그제 시연 기록 + 오늘 10) · 누계 118/240 (D-64)
  await page.getByTestId("daily-mode-week").click();
  const wm = page.getByTestId("weekly-materials");
  await expect(wm.locator("tr").filter({ hasText: "커튼월 유닛" })).toContainText("118 EA / 240");
  await expect(wm.locator("tr").filter({ hasText: "커튼월 유닛" })).toContainText("49.2%");
  // B현장: 설치가 반입보다 많음 표시
  await page.goto("/sites/site-b?tab=material");
  await expect(page.getByTestId("material-flag")).toContainText("반입 기록이 빠졌는지 확인");
});

test("자재 이력 가져오기 (D-63): 자료 이관에서 자재 수불부 붙여넣기 → 없는 품목은 행 번호로 안내 → 고쳐서 넣기 → 현장 자재 표에 ‘엑셀 가져옴’", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings");
  await page.evaluate(([pk]) => { localStorage.clear(); localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: "manager", deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 })); }, [PREFS] as const);
  await page.goto("/data");
  await page.getByTestId("import-kind-material").click();
  await page.getByTestId("import-text").fill(["현장,날짜,구분,품목,수량,메모", "A현장,2026-09-01,반입,커튼월 유닛,30,9월 수불부", "A현장,2026-09-02,설치,AL 프레임,10,"].join("\n"));
  await expect(page.getByTestId("import-preview")).toContainText("3행");
  await expect(page.getByTestId("import-preview")).toContainText("품목 정하기");
  await expect(page.getByTestId("import-apply")).toHaveCount(0);
  await page.getByTestId("import-text").fill(["현장,날짜,구분,품목,수량,메모", "A현장,2026-09-01,반입,커튼월 유닛,30,9월 수불부", "A현장,2026-09-02,설치,커튼월 유닛,10,"].join("\n"));
  await expect(page.getByTestId("import-summary")).toContainText("A현장 — 반입 1건 · 설치 1건");
  await expect(page.getByTestId("import-summary")).not.toContainText("원");
  await page.getByTestId("import-apply").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  await page.goto("/sites/site-a?tab=material");
  await expect(page.getByTestId("material-row").filter({ hasText: "커튼월 유닛" })).toContainText("174 EA"); // 반입 144 + 30
  await expect(page.getByTestId("material-move").filter({ hasText: "엑셀 가져옴" })).toHaveCount(2);
});

test("기성 청구 지연 (D-62): 위험 기준에서 기준을 낮추면 공정보다 기성이 늦은 현장에 신호 — 근거·청구 가능 추정", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings");
  await page.evaluate(([pk]) => { localStorage.clear(); localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: "ceo", deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 })); }, [PREFS] as const);
  await page.goto("/insights");
  await expect(page.locator('[data-rule="BILLING_LAG"]')).toHaveCount(0);
  await page.goto("/settings");
  await expect(page.locator("#th-billingLagPp")).toHaveValue("10");
  await page.locator("#th-billingLagPp").fill("5");
  await page.getByRole("button", { name: "기준 저장" }).click();
  await page.goto("/insights");
  // B현장: 공정률 72% vs 확정 기성 64.5% → 7.5%p > 5%p
  const sig = page.locator('[data-testid="signal-board"] [data-rule="BILLING_LAG"]');
  await expect(sig).toHaveCount(1);
  await expect(sig).toContainText("B현장 공정률 72%");
  await expect(sig).toContainText("확정 기성 64.5%");
});

test("지시·확인 왕복 (계약 검수 S2·S3): 작업지시 접수·완료 → 보고 연결 → 근태 수정 요청 → 본사 확인·보완 → 현장 보완 → 확인", async ({ page }) => {
  await asField(page);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  // ① 현장: 본사 지시(긴급) 확인 → 다 했어요 (작업량 + 사진)
  await page.goto("/field");
  await expect(page.getByTestId("easy-go-actions")).toContainText("본사 요청 2건");
  await page.getByTestId("fieldnav-my-actions").click();
  const urgent = page.locator('[data-testid="wo-card"][data-wo="wo-seed-1"]');
  await urgent.getByTestId("wo-receive").click();
  await expect(urgent).toHaveAttribute("data-status", "received");
  await urgent.getByTestId("wo-complete").click();
  await page.getByTestId("wo-result-chip").first().click();
  await page.getByTestId("wo-qty").fill("3");
  await page.getByTestId("wo-photo").setInputFiles({ name: "done.png", mimeType: "image/png", buffer: png });
  await page.getByTestId("wo-finish-send").click();
  await expect(urgent).toHaveCount(0); // 해야 할 일에서 빠지고
  await page.getByRole("tab", { name: /끝낸 일/ }).click();
  await expect(urgent).toHaveAttribute("data-status", "done"); // 끝낸 일에 ‘본사 확인 기다리는 중’
  await expect(urgent).toContainText("본사 확인 기다리는 중");
  // ② 현장 보고를 다른 지시(유리 반입 수량 확인)에 연결
  await page.goto("/field/report");
  await page.getByTestId("easy-site-site-a").click();
  await page.getByTestId("work-order-chip").filter({ hasText: "유리 반입 수량" }).click();
  await page.getByTestId("easy-next").click();
  await page.getByTestId("easy-next").click(); // 진행률(현장 전체) 그대로
  await page.getByTestId("easy-next").click(); // 사진 없이
  await page.getByTestId("issue-no").click();
  await page.getByTestId("cost-no").click();
  await expect(page.getByTestId("confirm-work")).toContainText("지시: 변경 구간 유리 반입 수량 확인");
  await page.getByTestId("submit-report").click();
  await expect(page.getByTestId("report-done")).toBeVisible();
  // ③ 근태 수정 요청: 오늘 출근을 못 누름 → 07:30
  await page.goto("/field");
  await page.getByTestId("att-fix-link").click();
  await page.getByTestId("fix-site-site-a").click();
  await page.getByTestId("fix-date-0").click();
  await page.getByTestId("fix-kind-missed_in").click();
  await page.getByTestId("fix-in").filter({ hasText: "07:30" }).click();
  await page.getByTestId("easy-next").click();
  await page.getByTestId("fix-reason-chip").first().click();
  await page.getByTestId("easy-next").click();
  await page.getByTestId("fix-send").click();
  await expect(page.getByTestId("fix-done")).toBeVisible();

  // ④ 본사
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "manager" })), [PREFS] as const);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("pending-fix")).toContainText("2"); // 정우진(시드) + 최성민
  await expect(page.getByTestId("pending-wo-done")).toContainText("1");
  await page.goto("/orders");
  const woRow = page.locator('[data-testid="wo-row"][data-wo="wo-seed-1"]');
  await expect(woRow).toContainText("3개");
  await expect(woRow.locator("img")).toBeVisible();
  await woRow.getByTestId("wo-confirm").click();
  await expect(woRow).toHaveAttribute("data-status", "confirmed");
  // 새 지시 보내기
  await page.getByTestId("wo-title").fill("B현장 단열유리 파손 1장 교체");
  await page.locator("#wo-site").selectOption("site-b");
  await page.getByTestId("wo-send").click();
  await expect(page.getByTestId("wo-row").filter({ hasText: "B현장 단열유리 파손" })).toHaveAttribute("data-status", "sent");
  // 현장 보고: 지시 연결 보고에 보완 요청
  await page.getByTestId("ord-tab-reports").click();
  const rv = page.getByTestId("rv-row").filter({ hasText: "지시: 변경 구간 유리 반입 수량 확인" });
  await rv.getByTestId("rv-return").click();
  await rv.getByTestId("rv-note").fill("송장 사진을 추가해 주세요");
  await rv.getByTestId("rv-return-send").click();
  await expect(page.getByTestId("rv-returned")).toContainText("송장 사진을 추가해 주세요");
  // 근태 수정 요청 승인
  await page.getByTestId("ord-tab-fixes").click();
  const fix = page.getByTestId("fix-row").filter({ hasText: "최성민" }).filter({ hasText: "확인 대기" });
  await fix.getByTestId("fix-confirm").click();
  await expect(page.getByTestId("fix-row").filter({ hasText: "최성민" }).first()).toHaveAttribute("data-status", "approved");
  await page.goto("/attendance");
  await expect(page.locator('[data-testid="att-site"][data-site="site-a"]').getByTestId("att-row")).toContainText("현장 요청 승인");

  // ⑤ 현장: 보완 요청 보고에 사진 보완
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "field" })), [PREFS] as const);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/field");
  await expect(page.getByTestId("easy-go-returned")).toContainText("보완 요청 1건");
  await page.getByTestId("easy-go-returned").click();
  const ret = page.getByTestId("record-returned");
  await expect(ret).toContainText("송장 사진을 추가해 주세요");
  await ret.getByTestId("record-supplement").click();
  await ret.getByTestId("supplement-photo").setInputFiles({ name: "invoice.png", mimeType: "image/png", buffer: png });
  await ret.getByTestId("supplement-send").click();
  await expect(page.getByTestId("record-returned")).toHaveCount(0);

  // ⑥ 본사: 보완된 보고 확인
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "manager" })), [PREFS] as const);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/orders?tab=reports");
  const rv2 = page.getByTestId("rv-row").filter({ hasText: "보완 1회" });
  await rv2.getByTestId("rv-confirm").click();
  await expect(page.getByTestId("rv-row").filter({ hasText: "보완 1회" })).toHaveCount(0);
});
