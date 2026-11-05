/**
 * LIVE 운영 시작 흐름 — 빈 회사 → 계정·현장 등록 → 현장 첫 로그인·보고 → 공무 확인 → 대표 손익
 * + 보안 경계 (로그인 없음·권한 없음·다른 사이트 요청·역할별 데이터)
 * 테스트는 순서대로 같은 DB를 이어서 쓴다.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";

const CEO = { email: "ceo@taekang.test", password: "Taekang2026" };
const FIELD = { email: "park@taekang.test", password: "ParkField2026" };
const PARTNER = { email: "client@wonchung.test", password: "Client2026x" };
let fieldTemp = "";
let partnerTemp = "";
let siteId = "";

/** 시각적으로 숨긴 라디오·체크박스(sr-only)는 사람이 하듯 감싼 label을 눌러 고른다 */
async function pick(page: Page, testId: string) {
  const input = page.getByTestId(testId);
  await page.locator("label", { has: input }).first().click();
  await expect(input).toBeChecked();
}

async function login(browser: Browser, email: string, password: string, vp = { width: 1440, height: 900 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator("#l-email").fill(email);
  await page.locator("#l-pw").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

test.describe.serial("LIVE 운영 시작 흐름", () => {
  test("배포 직후 점검: 상태 확인(DB 연결)·홈 화면 앱 파일은 로그인 없이, 회사 데이터는 로그인 필요", async ({ page }) => {
    const h = await page.request.get("/api/health");
    expect(h.status()).toBe(200);
    expect(await h.json()).toMatchObject({ ok: true, mode: "live", db: "ok", migrations: 1 });
    const mf = await page.request.get("/manifest.webmanifest");
    expect(mf.status()).toBe(200);
    expect((await mf.json()).name).toBe("TAEKANG 현장");
    expect((await page.request.get("/apple-touch-icon.png")).status()).toBe(200);
    expect((await page.request.get("/api/state")).status()).toBe(401);
    expect((await page.request.get("/api/export")).status()).toBe(401);
  });

  test("로그인 없이 화면·API 접근 불가, 최초 설정 화면 안내", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("아직 회사 설정 전입니다")).toBeVisible();
    expect((await page.request.get("/api/state")).status()).toBe(401);
    expect((await page.request.post("/api/commands", { data: { name: "setThresholds", args: {} } })).status()).toBe(401);
  });

  test("최초 설정 → 빈 회사 대시보드 '시작하기' 안내 (데모 표시 없음)", async ({ page }) => {
    await page.goto("/setup");
    await page.locator("#s-name").fill("김대표");
    await page.locator("#s-email").fill(CEO.email);
    await page.locator("#s-pw").fill(CEO.password);
    await page.locator("#s-pw2").fill(CEO.password);
    await page.getByTestId("setup-submit").click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId("getting-started")).toBeVisible();
    await expect(page.getByTestId("demo-bar")).toHaveCount(0);
    await expect(page.getByTestId("sample-data-banner")).toHaveCount(0);
    await expect(page.getByText("DEMO · 가상 시연 데이터")).toHaveCount(0);
    // 두 번째 설정 시도는 거부
    const again = await page.request.post("/api/setup", { data: { companyName: "x", name: "x", email: "x@x.test", password: "abcd1234" } });
    expect(again.status()).toBe(403);
  });

  test("관리자: 현장소장·발주처 계정 추가 → 현장 등록 (계획 이익률 자동)", async ({ browser }) => {
    const page = await login(browser, CEO.email, CEO.password);
    await page.goto("/admin?tab=members");
    for (const [name, email, role] of [
      ["박현장", "park@taekang.test", "field"],
      ["원청 공무", "client@wonchung.test", "partner"],
    ] as const) {
      await page.getByTestId("member-new").click();
      await page.locator("#mf-name").fill(name);
      await page.locator("#mf-email").fill(email);
      await pick(page, `mf-role-${role}`);
      await page.getByTestId("member-save").click();
      // 이전 계정 안내가 남아 있을 수 있으므로, 방금 만든 계정 안내로 바뀐 뒤 읽는다
      await expect(page.getByTestId("issued-password")).toContainText(email);
      const issued = await page.getByTestId("issued-password").innerText();
      const pw = /임시 비밀번호\s*(\S+)/.exec(issued)![1];
      if (role === "field") fieldTemp = pw;
      else partnerTemp = pw;
    }
    // 방금 만든 두 사람의 로그인 쪽지 (임시 비밀번호·접속 QR 포함 · D-54)
    await page.getByTestId("issued-slips").click();
    const dlg = page.getByTestId("slip-dialog");
    await expect(dlg.getByTestId("slip-card")).toHaveCount(2);
    await expect(dlg.getByTestId("slip-password")).toHaveText([fieldTemp, partnerTemp]);
    await expect(dlg.getByTestId("slip-qr").first()).toHaveAttribute("data-text", new URL("/login", page.url()).toString());
    await dlg.getByRole("button", { name: "닫기" }).first().click();
    await page.getByTestId("admin-tab-sites").click();
    await page.getByTestId("site-new").click();
    await page.locator("#sf-name").fill("○○물류센터 커튼월·창호 공사");
    await page.locator("#sf-short").fill("물류센터");
    await page.locator("#sf-client").fill("○○건설(주) · 원청");
    await page.locator("#sf-start").fill("2026-11-01");
    await page.locator("#sf-end").fill("2027-05-31");
    await page.locator("#sf-field").selectOption({ label: "박현장" });
    await page.locator("#sf-contract").fill("800000000");
    for (const [c, v] of [["material", "360000000"], ["labor", "160000000"], ["subcontract", "100000000"], ["equipment", "30000000"], ["overhead", "30000000"]]) await page.locator(`#sf-b-${c}`).fill(v);
    await expect(page.getByTestId("site-plan-summary")).toContainText("계획 이익률 15%");
    await page.getByTestId("site-save").click();
    await expect(page.getByTestId("admin-site-row")).toHaveCount(1);
    siteId = await page.evaluate(async () => (await (await fetch("/api/state")).json()).db.sites[0].id);
    // 발주처에 현장 공개
    await page.getByTestId("admin-tab-members").click();
    await page.getByTestId("member-row").filter({ hasText: "원청 공무" }).getByRole("button", { name: "수정" }).click();
    await page.getByTestId("member-form").getByText("물류센터").click();
    await page.getByTestId("member-save").click();
    await expect(page.getByTestId("member-row").filter({ hasText: "원청 공무" })).toContainText("물류센터");
    // 출퇴근 GPS 기준이 되는 현장 위치 등록
    await page.goto("/attendance");
    await page.getByTestId(`att-geo-${siteId}`).click();
    await page.locator("#g-lat").fill("37.5012");
    await page.locator("#g-lng").fill("127.0396");
    await page.locator("#g-rad").fill("300");
    await page.getByTestId("geo-save").click();
    await expect(page.locator(`[data-testid="att-site"][data-site="${siteId}"]`)).toContainText("반경 300m");
    // 공무 확인 후 반영으로
    await page.goto("/admin");
    await page.getByTestId("admin-tab-settings").click();
    await pick(page, "approval-review");
    await page.getByTestId("settings-save").click();
    await expect(page.getByText("운영 설정을 저장했습니다")).toBeVisible();
  });

  test("현장소장 첫 로그인 → 비밀번호 변경 강제 → GPS 출근 → 휴대폰 보고(공수) → 공무 확인 대기", async ({ browser }) => {
    // 현장 중심에서 약 25m 떨어진 곳에 있는 휴대폰
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["geolocation"], geolocation: { latitude: 37.5014, longitude: 127.0398, accuracy: 20 } });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.locator("#l-email").fill(FIELD.email);
    await page.locator("#l-pw").fill(fieldTemp);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/account\?force=1/);
    // 비밀번호를 바꾸기 전에는 데이터 API 차단
    expect((await page.request.get("/api/state")).status()).toBe(403);
    await page.locator("#a-cur").fill(fieldTemp);
    await page.locator("#a-new").fill(FIELD.password);
    await page.locator("#a-new2").fill(FIELD.password);
    await page.getByTestId("password-submit").click();
    await expect(page).toHaveURL(/\/field/);
    // GPS 출근 — 처음에는 위치 기록 동의 → 서버가 현장 안/밖 판정
    await page.getByTestId("att-in").click();
    await page.getByTestId("att-consent-yes").click();
    await expect(page.getByTestId("att-result")).toContainText("출근 기록 완료");
    await expect(page.getByTestId("att-status")).toContainText("현장 안");
    // 쉬운 화면 — 글자 입력 없이 누르기만으로 보고 (현장 1곳이면 현장 선택 생략)
    await expect(page.getByTestId("easy-site-status")).toContainText("아직 안 보냄");
    await page.getByTestId("easy-go-report").click();
    await page.getByTestId("work-chip").filter({ hasText: "앵커·브라켓 설치" }).click();
    await page.getByTestId("easy-next").click();
    await page.getByTestId("progress-stepper-plus").click(); // 0% → 5%
    await page.getByTestId("easy-next").click();
    await page.getByTestId("easy-next").click(); // 사진 없이 다음
    await page.getByTestId("issue-no").click();
    await page.getByTestId("cost-yes").click();
    await page.getByTestId("cost-cat-labor").click();
    for (let i = 0; i < 3; i++) await page.getByTestId("labor-people-plus").click(); // 4명
    for (let i = 0; i < 4; i++) await page.getByTestId("labor-days-plus").click(); // 3일
    await expect(page.getByTestId("cost-readback")).toContainText("360만 원"); // 12공수 × 30만
    await page.getByTestId("easy-next").click();
    await page.getByTestId("impact-additional").click();
    await page.getByTestId("easy-next").click();
    await page.getByTestId("reason-quantity_increase").click();
    await expect(page.getByTestId("easy-confirm")).toContainText("360만 원");
    await expect(page.getByTestId("easy-confirm")).toContainText("0% → 5%");
    await expect(page.getByTestId("confirm-geo")).toContainText("현장 안");
    await page.getByTestId("submit-report").click();
    await expect(page.getByTestId("report-impact")).toHaveAttribute("data-pending", "1");
    await expect(page.getByTestId("report-impact")).toContainText("360만 원");
    await page.getByTestId("report-home").click();
    await expect(page.getByTestId("easy-site-status")).toContainText("오늘 보고 보냄");
    // 작업 인원(출력) — 새 팀 이름 입력 → 3명 → 사진 없이 → 보내기
    await page.getByTestId("easy-go-crew").click();
    await page.getByTestId("crew-new-team").click();
    await page.getByTestId("crew-team-name").fill("철근팀");
    await page.getByTestId("crew-kind-direct").click();
    await page.getByTestId("easy-next").click();
    await page.getByTestId("crew-count-stepper-plus").click();
    await page.getByTestId("crew-count-stepper-plus").click();
    await page.getByTestId("easy-next").click();
    await page.getByTestId("easy-next").click(); // 사진 없이
    await page.getByTestId("crew-send").click();
    await expect(page.getByTestId("crew-done")).toContainText("철근팀 3명");
    await page.goto("/field");
    await expect(page.getByTestId("my-records")).toContainText("본사 확인 중");
    // 현장소장에게는 금액·예산 데이터가 오지 않는다
    const st = await page.evaluate(async () => (await (await fetch("/api/state")).json()).db);
    expect(st.scope).toBe("field");
    expect(st.contracts.every((c: { contractAmount: number }) => c.contractAmount === 0)).toBe(true);
    expect(st.budgets).toHaveLength(0);
    // 관리 명령·사용자 목록 차단
    expect((await page.request.post("/api/commands", { data: { name: "setCompanySettings", args: { costApproval: "immediate" } } })).status()).toBe(403);
    expect((await page.request.get("/api/admin/members")).status()).toBe(403);
    await page.goto("/finance");
    await expect(page.getByTestId("access-denied")).toBeVisible();
    // 출퇴근 현황(본사 화면)도 못 보고, 서버는 본인 출퇴근 기록만 보낸다
    await page.goto("/attendance");
    await expect(page.getByTestId("access-denied")).toBeVisible();
    await page.goto("/labor");
    await expect(page.getByTestId("access-denied")).toBeVisible();
    const mine = await page.evaluate(async () => (await (await fetch("/api/state")).json()).db.attendance as { userId: string }[]);
    expect(mine.length).toBeGreaterThan(0);
    expect(new Set(mine.map((r) => r.userId)).size).toBe(1);
    await ctx.close();
  });

  test("공무 승인(금액 확정) 전에는 손익 불변, 승인 후 반영", async ({ browser }) => {
    const page = await login(browser, CEO.email, CEO.password);
    await page.goto(`/sites/${siteId}`);
    await expect(page.getByTestId("m-eac")).toContainText("6.8억 원");
    await page.goto("/admin?tab=review");
    await expect(page.getByTestId("review-row")).toContainText("공수 12");
    await page.getByTestId("review-approve").click();
    await page.locator("#rv-amt").fill("3500000");
    await page.getByTestId("review-confirm").click();
    await expect(page.getByTestId("review-row")).toHaveCount(0);
    await page.goto(`/sites/${siteId}`);
    await expect(page.getByTestId("m-eac")).toContainText("6.83억 원");
    await page.goto("/report");
    await expect(page.getByTestId("report-summary")).toBeVisible();
    // 공정 일정: 공정 단계가 없는 현장은 전체 기간으로 계산하고 단계 등록을 안내
    await page.goto("/schedule");
    await expect(page.locator(`[data-testid="sched-site"][data-site="${siteId}"]`)).toContainText("물류센터");
    await expect(page.locator(`[data-testid="sched-site"][data-site="${siteId}"]`).getByTestId("sched-no-stages")).toContainText("공정 단계");
    // 본사 출퇴근 현황: 박현장 현장 안 출근 + 보고도 현장 안에서 보냄 (서버 판정)
    await page.goto("/attendance");
    await expect(page.locator(`[data-testid="att-site"][data-site="${siteId}"]`).getByTestId("att-row")).toContainText("현장 안");
    await expect(page.getByTestId("att-report-row").first()).toContainText("현장 안");
    // 작업 인원: 사진 없이 보낸 철근팀 3명 (서버 판정 위치 = 현장 안)
    await expect(page.getByTestId("crew-card").getByTestId("crew-row")).toContainText("철근팀");
    await expect(page.getByTestId("crew-card").getByTestId("crew-row")).toContainText("현장 안");
    await expect(page.getByTestId("crew-card").getByTestId("crew-flags")).toContainText("단체 사진 없음");
    // 투입·인건비(S4): 출력 3명 × 기본 일당 = 90만 원 추정 vs 공무 확정 노무비 350만 원(12공수) → ‘실제 > 추정’
    await page.goto("/labor");
    const lab = page.locator(`[data-testid="labor-site"][data-site="${siteId}"]`);
    await expect(lab.getByTestId("labor-team")).toContainText("철근팀");
    await expect(lab.getByTestId("labor-estimate")).toContainText("90만 원");
    await expect(lab.getByTestId("labor-actual")).toContainText("350만 원");
    await expect(lab.getByTestId("labor-flags")).toContainText("실제 노무비가 추정보다 많음");
    await lab.getByTestId("labor-rate").first().fill("35");
    await lab.getByTestId("labor-rate-save").click();
    await expect(lab.getByTestId("labor-team")).not.toContainText("기본 일당");
    await expect(lab.getByTestId("labor-estimate")).toContainText("105만 원");
    await page.reload();
    await expect(page.locator(`[data-testid="labor-site"][data-site="${siteId}"]`).getByTestId("labor-rate").first()).toHaveValue("35");
    // 범위 밖 단가는 서버가 거부
    const bad = await page.request.post("/api/commands", { data: { name: "setCompanySettings", args: { teamRates: [{ team: "철근팀", dayRate: 5 }] } } });
    expect(bad.status()).toBe(400);
  });

  test("자료 이관: 준비 점검 → 지난 변경공사·기성 가져오기(서버 재검증) → 계약·미수 반영 → 중복 건너뜀 → 취소", async ({ browser }) => {
    const page = await login(browser, CEO.email, CEO.password);
    await page.goto("/data");
    const site = page.locator(`[data-testid="ready-site"][data-site="${siteId}"]`);
    await expect(site).toContainText("물류센터");
    await expect(site.locator('[data-key="stages"]')).toHaveAttribute("data-status", "warn"); // 공정 단계 미등록
    await expect(site.locator('[data-key="geo"]')).toHaveAttribute("data-status", "ok");
    // 변경공사(승인 2,000만 원) → 계약금액 8억 → 8.2억
    await page.getByTestId("import-kind-change").click();
    await page.getByTestId("import-text").fill("현장,제목,금액,상태,요청일,승인금액,결정일\n물류센터,1층 출입구 자동문 추가,20000000,승인,2026-11-01,,2026-11-01");
    await expect(page.getByTestId("import-summary")).toContainText("승인 2,000만 원");
    await page.getByTestId("import-apply").click();
    await expect(page.getByTestId("import-done")).toBeVisible();
    await page.goto(`/sites/${siteId}`);
    await expect(page.getByTestId("m-contract")).toContainText("8.2억 원");
    // 기성·입금 (서버 저장 후 다시 읽어도 유지)
    await page.goto("/data");
    await page.getByTestId("import-kind-billing").click();
    const bill = "현장,구분,날짜,금액\n물류센터,기성,2026-11-01,100000000\n물류센터,입금,2026-11-02,60000000";
    await page.getByTestId("import-text").fill(bill);
    await page.getByTestId("import-apply").click();
    await expect(page.getByTestId("import-done")).toBeVisible();
    await page.reload();
    await page.getByTestId("import-kind-billing").click();
    await page.getByTestId("import-text").fill(bill);
    await expect(page.getByTestId("import-dups")).toContainText("이미 있음");
    // 서버는 브라우저를 거치지 않은 잘못된 원문도 다시 검사한다
    const bad = await page.request.post("/api/commands", { data: { name: "importData", args: { kind: "billing", text: "현장,구분,날짜,금액\n물류센터,입금,2026-11-03,999000000", idempotencyKey: "live-bad" } } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toContain("입금 합계");
    await page.goto("/finance");
    await expect(page.locator("main")).toContainText(/물류센터 1차\s*2026\.11\.01/);
    // 기성 가져오기 취소 → 기성 기록이 사라짐
    await page.goto("/data");
    const batch = page.getByTestId("import-batch").filter({ hasText: "기성·입금 이력" });
    await batch.getByTestId("import-undo").click();
    await batch.getByTestId("import-undo-confirm").click();
    await expect(batch).toHaveAttribute("data-undone", "1");
    await page.goto("/finance");
    await expect(page.locator("main")).not.toContainText(/물류센터 1차/);
    // 전체 자료 백업: 대표만, 비밀번호·QR 비밀값 없음
    const exp = await page.request.get("/api/export");
    expect(exp.status()).toBe(200);
    expect(exp.headers()["content-disposition"]).toMatch(/attachment; filename="taekang_backup_\d{8}\.json"/);
    const backupText = await exp.text();
    expect(backupText).not.toMatch(/password_hash|token_hash|"secret"|pairHash|scrypt\$/);
    const backup = JSON.parse(backupText);
    expect(backup.data.sites.map((x: { shortName: string }) => x.shortName)).toContain("물류센터");
    expect(backup.data.importBatches.length).toBeGreaterThanOrEqual(2);
    // 활동 이력: 서버에서 조건으로 찾기 (자료 가져오기·취소가 남아 있음)
    await page.goto("/audit");
    await page.getByTestId("audit-type").selectOption("import");
    await expect(page.getByTestId("audit-row").filter({ hasText: "자료 가져오기 취소" })).toHaveCount(1);
    await expect(page.getByTestId("audit-row").filter({ hasText: "변경공사 1건" })).toHaveCount(1);
    expect((await page.request.get("/api/activity?from=2026-01-01&to=2026-12-31&type=import")).status()).toBe(200);
    // 사용 현황: 박현장의 실제 출근·보고가 집계된다
    await page.goto("/usage");
    await expect(page.getByTestId("usage-user").filter({ hasText: "박현장" })).toContainText("출근 기록");
    // 현장소장은 가져오기·백업 불가
    const field = await login(browser, FIELD.email, FIELD.password, { width: 390, height: 844 });
    expect((await field.request.get("/api/export")).status()).toBe(403);
    expect((await field.request.get("/api/activity?from=2026-01-01&to=2026-12-31")).status()).toBe(403);
    expect((await field.request.post("/api/commands", { data: { name: "importData", args: { kind: "billing", text: bill, idempotencyKey: "live-f" } } })).status()).toBe(403);
    expect((await field.request.post("/api/commands", { data: { name: "undoImport", args: { batchId: "x" } } })).status()).toBe(403);
  });

  test("현장 QR: 본사 단말기 등록 → 로그인 없는 태블릿 연결 → 현장소장 QR 확인 → 해제", async ({ browser }) => {
    const admin = await login(browser, CEO.email, CEO.password);
    await admin.goto("/attendance");
    await admin.getByTestId("att-mode-qr").click();
    await expect(admin.getByTestId("att-mode-qr")).toHaveAttribute("aria-checked", "true");
    await admin.locator(`[data-testid="att-site"][data-site="${siteId}"]`).getByTestId("kiosk-add").click();
    const code = (await admin.getByTestId("pair-code").innerText()).trim();
    // 본사 화면 데이터에도 단말기 비밀값은 없다
    const st = await admin.evaluate(async () => (await (await fetch("/api/state")).json()).db);
    expect(JSON.stringify(st.kiosks)).not.toMatch(/secret|pairHash/);
    // 빈 회사로 시작했으므로 단말기는 방금 만든 1대뿐
    expect(st.kiosks).toHaveLength(1);
    const kioskId = (st.kiosks as { id: string; siteId: string }[]).find((k) => k.siteId === siteId)!.id;

    // 현장 태블릿: 로그인 없이 /kiosk → 코드로 연결
    const tab = await browser.newContext({ viewport: { width: 800, height: 1100 } });
    const kp = await tab.newPage();
    await kp.goto(`/kiosk?c=${code}`);
    await expect(kp.getByTestId("kiosk-live")).toBeVisible();
    // 같은 코드로 두 번째 연결은 거부
    expect((await kp.request.post("/api/kiosk/pair", { data: { code } })).status()).toBe(404);
    const shot = await kp.getByTestId("kiosk-qr").screenshot();

    // 현장소장: 이미 GPS로 출근 → QR 확인 대기 → QR 사진으로 확인
    const fc = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["geolocation"], geolocation: { latitude: 37.5014, longitude: 127.0398, accuracy: 20 } });
    const fp = await fc.newPage();
    await fp.goto("/login");
    await fp.locator("#l-email").fill(FIELD.email);
    await fp.locator("#l-pw").fill(FIELD.password);
    await fp.getByTestId("login-submit").click();
    await expect(fp).toHaveURL(/\/field/);
    await expect(fp.getByTestId("att-qr-pending")).toBeVisible();
    await fp.getByTestId("att-qr-confirm-file").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: shot });
    await expect(fp.getByTestId("att-result")).toContainText("현장 QR 확인 완료");
    await fc.close();

    await admin.reload();
    await expect(admin.locator(`[data-testid="att-site"][data-site="${siteId}"]`).getByTestId("att-row")).toContainText("QR 확인");
    // 해제하면 태블릿 상태 확인에서 '해제됨'
    admin.once("dialog", (d) => void d.accept());
    await admin.locator(`[data-testid="att-site"][data-site="${siteId}"]`).getByTestId("kiosk-row").getByRole("button", { name: "해제" }).click();
    await expect(admin.getByText("단말기를 해제했습니다")).toBeVisible();
    expect((await (await kp.request.get(`/api/kiosk/status?id=${kioskId}`)).json()).active).toBe(false);
    await tab.close();
    // 다음 테스트를 위해 GPS만으로 되돌림
    await admin.getByTestId("att-mode-gps").click();
  });

  test("지시·확인: 본사 작업지시 → 현장소장 접수·완료 → 본사 확인 / GPS 문제 수정 요청 → 승인", async ({ browser }) => {
    const admin = await login(browser, CEO.email, CEO.password);
    await admin.goto("/orders");
    await admin.locator("#wo-site").selectOption(siteId);
    await admin.getByTestId("wo-title").fill("1층 앵커 토크 재점검");
    await admin.getByTestId("wo-send").click();
    await expect(admin.getByTestId("wo-row").filter({ hasText: "1층 앵커 토크 재점검" })).toHaveAttribute("data-status", "sent");

    const fp = await login(browser, FIELD.email, FIELD.password, { width: 390, height: 844 });
    await fp.goto("/my-actions");
    const card = fp.getByTestId("wo-card").filter({ hasText: "1층 앵커 토크 재점검" });
    await card.getByTestId("wo-receive").click();
    await card.getByTestId("wo-complete").click();
    await fp.getByTestId("wo-qty").fill("24");
    await fp.getByTestId("wo-finish-send").click();
    await expect(fp.getByTestId("wo-finish")).toHaveCount(0);
    // 오늘 GPS 출근 기록에 대해 ‘위치가 잘못 찍혔어요’ 요청
    await fp.goto("/field/fix");
    await fp.getByTestId("fix-date-0").click();
    await fp.getByTestId("fix-kind-gps_issue").click();
    await fp.getByTestId("fix-reason-chip").filter({ hasText: "GPS" }).click();
    await fp.getByTestId("easy-next").click();
    await fp.getByTestId("fix-send").click();
    await expect(fp.getByTestId("fix-done")).toBeVisible();

    await admin.reload();
    const row = admin.getByTestId("wo-row").filter({ hasText: "1층 앵커 토크 재점검" });
    await expect(row).toContainText("24개");
    await row.getByTestId("wo-confirm").click();
    await expect(row).toHaveAttribute("data-status", "confirmed");
    await admin.getByTestId("ord-tab-fixes").click();
    await admin.getByTestId("fix-row").filter({ hasText: "확인 대기" }).getByTestId("fix-confirm").click();
    await expect(admin.getByTestId("fix-row").first()).toHaveAttribute("data-status", "approved");
    await admin.goto("/attendance");
    await expect(admin.locator(`[data-testid="att-site"][data-site="${siteId}"]`).getByTestId("att-row")).toContainText("현장 요청 승인");
  });

  test("발주처: 첫 로그인 후 공개 현장만, 요청 등록, 내부 정보 없음", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.locator("#l-email").fill(PARTNER.email);
    await page.locator("#l-pw").fill(partnerTemp);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/account/);
    await page.locator("#a-cur").fill(partnerTemp);
    await page.locator("#a-new").fill(PARTNER.password);
    await page.locator("#a-new2").fill(PARTNER.password);
    await page.getByTestId("password-submit").click();
    await expect(page).toHaveURL(/\/partner/);
    const portal = page.getByTestId("partner-portal");
    await expect(portal).toContainText("물류센터");
    const text = (await portal.innerText()).replace(/\s+/g, " ");
    expect(text).not.toMatch(/\d+(\.\d+)?억|이익률|EAC/);
    // 견적 문의(S7): 품목 없이 보내면 거부 → 품목·수량 넣고 접수
    await page.locator("#p-title").fill("1층 로비 고정창 추가 견적 문의");
    await page.locator("#p-desc").fill("대략적인 금액과 시공 가능 시기를 알려주세요.");
    await page.getByTestId("partner-submit").click();
    await expect(page.getByText("품목·사양을 입력해주세요.")).toBeVisible();
    await page.getByTestId("p-item").fill("24mm 로이 복층유리");
    await page.getByTestId("p-qty").fill("약 18㎡");
    await page.getByTestId("partner-submit").click();
    await expect(page.getByTestId("partner-sent")).toBeVisible();
    await expect(page.getByTestId("partner-request-item").first()).toContainText("견적 문의");
    await expect(page.getByTestId("partner-request-item").first()).toContainText("24mm 로이 복층유리 · 약 18㎡");
    const st = await page.evaluate(async () => (await (await fetch("/api/state")).json()).db);
    expect(st.scope).toBe("partner");
    expect(st.costEntries).toHaveLength(0);
    expect(st.actions).toHaveLength(0);
    // 사진 원본·관리 API 차단
    expect((await page.request.get("/api/photos/anything")).status()).toBe(404);
    expect((await page.request.post("/api/commands", { data: { name: "submitFieldReport", args: { siteId } } })).status()).toBe(403);
    expect((await page.request.post("/api/commands", { data: { name: "setCompanySettings", args: { teamRates: [] } } })).status()).toBe(403);
    await ctx.close();
    // 본사: 처리 대기 → 요청함에 품목·수량과 함께 도착 → 회신
    const hq = await login(browser, CEO.email, CEO.password);
    await hq.goto("/dashboard");
    await expect(hq.getByTestId("pending-partner").locator("b")).toHaveText("1");
    await hq.goto("/insights#requests");
    const req = hq.getByTestId("partner-inbox").getByTestId("partner-request").filter({ hasText: "1층 로비 고정창 추가" });
    await expect(req).toContainText("견적 문의");
    await expect(req.getByTestId("request-goods")).toContainText("24mm 로이 복층유리 · 약 18㎡");
    await req.getByTestId("request-reply").click();
    await hq.locator("#rp-text").fill("실측 후 사양별 견적서를 보내드리겠습니다.");
    await hq.getByTestId("reply-confirm").click();
    await expect(req).toHaveAttribute("data-status", "answered");
  });

  test("휴대폰 알림: 내 정보의 알림 카드 · 공식 푸시 서버만 등록 · 켜기/끄기 · 다른 사이트 요청 차단", async ({ browser }) => {
    const page = await login(browser, FIELD.email, FIELD.password, { width: 390, height: 844 });
    const st = await (await page.request.get("/api/push")).json();
    expect(st).toMatchObject({ enabled: true, subscribed: 0 });
    expect(st.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    await page.goto("/my");
    const card = page.getByTestId("push-card");
    await expect(card).toBeVisible();
    await expect(card).not.toHaveAttribute("data-state", "loading");
    expect(["off", "unsupported", "denied"]).toContain(await card.getAttribute("data-state"));
    // 서버 API: 임의 주소는 거부, 공식 푸시 서버 주소만 저장
    const keys = await page.evaluate(async () => {
      const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
      const raw = new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey));
      const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return { p256dh: b64u(raw), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) };
    });
    const bad = await page.request.post("/api/push", { data: { subscription: { endpoint: "https://evil.example.com/x", keys } } });
    expect(bad.status()).toBe(400);
    const ok = await page.request.post("/api/push", { data: { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/e2e-test-token", keys } } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).count).toBe(1);
    expect((await (await page.request.get("/api/push")).json()).subscribed).toBe(1);
    // 다른 사이트에서 보낸 등록 요청은 차단
    expect((await page.request.post("/api/push", { headers: { Origin: "https://evil.example" }, data: { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys } } })).status()).toBe(403);
    // 본사가 지시를 보내도(발송은 시험 주소라 실패) 명령은 정상 처리
    const hq = await login(browser, CEO.email, CEO.password);
    const wo = await hq.request.post("/api/commands", { data: { name: "createWorkOrder", args: { siteId, title: "알림 시험 지시", detail: "", assigneeUserId: (await (await page.request.get("/api/auth/me")).json()).me.id } } });
    expect(wo.status()).toBe(200);
    // 끄기 → 0
    const off = await page.request.delete("/api/push", { data: { endpoint: "https://fcm.googleapis.com/fcm/send/e2e-test-token" } });
    expect((await off.json()).count).toBe(0);
    // 로그인 안 한 요청은 거부
    const anon = await browser.newContext();
    expect((await anon.request.get(new URL("/api/push", page.url()).toString())).status()).toBe(401);
    await anon.close();
  });

  test("인터넷이 끊겨도 보고가 사라지지 않음: 사진까지 휴대폰에 보관 → 첫 화면 안내 → 연결되면 보내기 → 본사에 1건만 도착", async ({ browser }) => {
    const hq = await login(browser, CEO.email, CEO.password);
    const countReports = async () => ((await (await hq.request.get("/api/state")).json()).db.reports as { siteId: string; photoIds: string[] }[]).filter((r) => r.siteId === siteId).length;
    const before = await countReports();
    const page = await login(browser, FIELD.email, FIELD.password, { width: 390, height: 844 });
    await page.goto("/field");
    await page.getByTestId("easy-go-photo").click();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.getByTestId("photo-album").setInputFiles({ name: "basement.png", mimeType: "image/png", buffer: png });
    await page.getByTestId("easy-next").click();
    // 지하층: 서버로 가는 요청만 끊긴 상태
    await page.route("**/api/commands", (r) => r.abort("internetdisconnected"));
    await page.getByTestId("submit-report").click();
    await expect(page.getByTestId("report-queued")).toBeVisible();
    await expect(page.getByTestId("report-done")).toContainText("앱을 닫아도 괜찮아요");
    // 앱을 다시 열어도(새로고침) 남아 있다
    await page.goto("/field");
    await expect(page.getByTestId("outbox-waiting")).toContainText("아직 못 보낸 보고 1건");
    await expect(page.getByTestId("outbox-waiting")).toContainText("사진 1장");
    expect(await countReports()).toBe(before);
    // 신호가 잡힘 → 지금 보내기
    await page.unroute("**/api/commands");
    await page.getByTestId("outbox-send").click();
    await expect(page.getByTestId("outbox")).toHaveCount(0);
    expect(await countReports()).toBe(before + 1);
    // 한 번 더 보내도 중복으로 쌓이지 않는다 (같은 중복 방지 키)
    await page.reload();
    await expect(page.getByTestId("easy-go-report")).toBeVisible();
    expect(await countReports()).toBe(before + 1);
    const st = (await (await hq.request.get("/api/state")).json()).db;
    const last = (st.reports as { siteId: string; photoIds: string[]; createdAt: string }[]).filter((r) => r.siteId === siteId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    expect(last.photoIds).toHaveLength(1);
  });

  test("통신 불량 출근: 휴대폰에 저장(누른 시각·첫 동의 포함) → 신호가 잡히면 보내기 → 기록은 받은 시각 · 본사에 ‘통신 불량 · 자동’ 확인 요청 → 승인하면 누른 시각으로", async ({ browser }) => {
    // 새 현장 직원 (물류센터 담당)
    const hq = await login(browser, CEO.email, CEO.password);
    await hq.goto("/admin?tab=members");
    await hq.getByTestId("member-new").click();
    await hq.locator("#mf-name").fill("지하현장");
    await hq.locator("#mf-email").fill("b1@taekang.test");
    await pick(hq, "mf-role-field");
    await hq.getByTestId("member-form").getByText("물류센터").click();
    await hq.getByTestId("member-save").click();
    await expect(hq.getByTestId("issued-password")).toContainText("b1@taekang.test");
    const temp = /임시 비밀번호\s*(\S+)/.exec(await hq.getByTestId("issued-password").innerText())![1];
    const page = await login(browser, "b1@taekang.test", temp, { width: 390, height: 844 });
    await page.locator("#a-cur").fill(temp);
    await page.locator("#a-new").fill("Basement2026");
    await page.locator("#a-new2").fill("Basement2026");
    await page.getByTestId("password-submit").click();
    await expect(page).toHaveURL(/\/field/);
    await page.context().grantPermissions(["geolocation"]);
    await page.context().setGeolocation({ latitude: 37.5014, longitude: 127.0398, accuracy: 20 });

    // 지하에서 출근을 누르고 약 10분 뒤에 신호가 잡힌 상황 (휴대폰 시계 = 10분 전)
    const pressed = new Date(Date.now() - 10 * 60_000);
    await page.clock.setFixedTime(pressed);
    await page.route("**/api/commands", (r) => r.abort("internetdisconnected"));
    await page.getByTestId("att-in").click();
    await page.getByTestId("att-consent-yes").click();
    await expect(page.getByTestId("att-result")).toContainText("휴대폰에 저장했어요");
    await expect(page.getByTestId("att-queued")).toContainText("휴대폰에 저장됨");
    await expect(page.getByTestId("att-queued").getByTestId("att-out")).toBeVisible(); // 저장된 출근 다음엔 퇴근 버튼
    await expect(page.getByTestId("outbox-waiting")).toContainText("아직 못 보낸 기록 1건");
    // 새로고침해도 남아 있다
    await page.reload();
    await expect(page.getByTestId("att-queued")).toContainText("휴대폰에 저장됨");
    await page.unroute("**/api/commands");
    await page.getByTestId("outbox-send").click();
    await expect(page.getByTestId("outbox")).toHaveCount(0);
    await expect(page.getByTestId("att-status")).toContainText("물류센터 출근");

    const rec = async () =>
      ((await (await hq.request.get("/api/state")).json()).db.attendance as { siteId: string; inAt: string; inSentLater?: { pressedAt: string; requestId?: string } }[]).find((r) => r.siteId === siteId && r.inSentLater)!;
    const r0 = await rec();
    // 기록은 서버가 받은 시각 (누른 시각보다 9분 넘게 늦음) · 첫 동의도 함께 기록
    expect(Date.parse(r0.inAt) - Date.parse(r0.inSentLater!.pressedAt)).toBeGreaterThan(9 * 60_000);
    expect(r0.inSentLater!.requestId).toBeTruthy();
    await hq.goto("/orders?tab=fixes");
    const row = hq.getByTestId("fix-row").filter({ hasText: "통신 불량 · 자동" });
    await expect(row).toContainText("누른 시각 확인");
    await expect(row).toContainText("지하현장");
    await row.getByTestId("fix-confirm").click();
    await expect(hq.getByTestId("fix-row").filter({ hasText: "통신 불량 · 자동" })).toHaveAttribute("data-status", "approved");
    const r1 = await rec();
    // 승인하면 누른 시각(분 단위)으로
    expect(Math.abs(Date.parse(r1.inAt) - pressed.getTime())).toBeLessThan(60_000);
    await hq.context().close();
    await page.context().close();
  });

  test("개인위치정보: 대표가 보관 기간·열람 범위를 정함 → 현장소장 ‘내 위치 기록’ → 그만두기 → 서버에서 좌표 삭제", async ({ browser }) => {
    const ceo = await login(browser, CEO.email, CEO.password);
    await ceo.goto("/admin?tab=privacy");
    await expect(ceo.getByTestId("admin-privacy")).toContainText("보관 기간이 정해지지 않았습니다");
    await ceo.getByTestId("privacy-days").selectOption("365");
    await pick(ceo, "privacy-viewers-ceo");
    await ceo.getByTestId("privacy-save").click();
    await expect(ceo.getByTestId("privacy-notice")).toContainText("1년이 지나면 좌표를 자동으로 지웁니다");
    const park = ceo.locator('[data-testid="privacy-person"]').filter({ hasText: "박현장" }).first();
    await expect(park).toContainText("다시 동의 필요");
    // 대표는 서버에서 좌표를 받는다
    const before = await (await ceo.request.get("/api/state")).json();
    expect(JSON.stringify(before.db.attendance)).toMatch(/"lat"/);

    // 현장소장: ‘기간 미정’으로 동의했으므로 기간이 정해지면 다음 출근 때 한 번 다시 묻는다(D-49) → 그만두기
    const field = await login(browser, FIELD.email, FIELD.password, { width: 390, height: 844 });
    await field.goto("/my");
    await expect(field.getByTestId("my-location-state")).toHaveAttribute("data-state", "outdated");
    await expect(field.getByTestId("my-location")).toContainText("1년 지나면 좌표 자동 삭제");
    await expect(field.getByTestId("my-location-row").first()).toBeVisible();
    await field.getByTestId("my-location-withdraw").click();
    await field.getByTestId("my-location-withdraw-yes").click();
    await expect(field.getByTestId("my-location-msg")).toContainText("위치 기록을 그만뒀어요");
    await expect(field.getByTestId("my-location-state")).toHaveAttribute("data-state", "none");
    // 규칙·삭제는 대표만 (현장 직원이 직접 보내도 서버가 거부)
    const origin = new URL(field.url()).origin;
    const denied = await field.request.post("/api/commands", { headers: { Origin: origin }, data: { name: "setLocationPolicy", args: { retentionDays: 30, viewers: "hq" } } });
    expect(denied.status()).toBe(403);

    // 서버 DB에서 좌표가 지워졌다 (대표가 받아도 없음) · 판정은 남음
    const after = await (await ceo.request.get("/api/state")).json();
    const mine = (after.db.attendance as { userId: string; inGeo: { status: string; lat?: number; purged?: boolean } }[]).filter((r) => r.userId === after.db.users.find((u: { name: string }) => u.name === "박현장")?.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.inGeo.lat === undefined && !!r.inGeo.status)).toBe(true);
    expect(mine.some((r) => r.inGeo.purged)).toBe(true);
    await ceo.reload();
    await expect(park).toContainText("동의 안 함");
    await ceo.context().close();
    await field.context().close();
  });

  test("오류·의견: 화면 오류 자동 기록(개인정보 지움) · 현장 의견 → 대표 반영 → 현장에 결과 · 로그인 없이 보내기 차단", async ({ browser }) => {
    const field = await login(browser, FIELD.email, FIELD.password, { width: 390, height: 844 });
    await field.goto("/my");
    // 화면에서 예상 못 한 오류 (전화번호가 섞인 문구)
    const sentErr = field.waitForResponse((r) => r.url().endsWith("/api/client-error") && r.request().method() === "POST");
    await field.evaluate(() => setTimeout(() => { throw new Error("테스트 화면 오류 010-1234-5678"); }, 0));
    expect((await sentErr).status()).toBe(200);
    // 현장 의견
    await field.getByTestId("fb-cat-photo").click();
    await field.getByTestId("fb-send").click();
    await expect(field.getByTestId("fb-msg")).toContainText("보냈어요");

    const ceo = await login(browser, CEO.email, CEO.password);
    await ceo.goto("/quality");
    const err = ceo.getByTestId("quality-error").filter({ hasText: "테스트 화면 오류" });
    await expect(err).toHaveAttribute("data-source", "client");
    await expect(err).toContainText("[숫자]");
    await expect(err).not.toContainText("1234-5678");
    await expect(err).toContainText("/my");
    const fb = ceo.getByTestId("quality-fb").filter({ hasText: "사진이 잘 안 올라가요" });
    await fb.getByTestId("fb-status-done").click();
    await fb.getByTestId("fb-reply").fill("사진 크기를 줄여 더 빨리 올라가게 했습니다");
    await fb.getByTestId("fb-save").click();
    await expect(fb).toHaveAttribute("data-status", "done");
    // 현장 직원은 오류 기록을 볼 수 없다 / 로그인 없이 오류 보내기 차단
    expect((await field.request.get("/api/errors")).status()).toBe(403);
    const anon = await browser.newContext();
    expect((await anon.request.post(new URL("/api/client-error", ceo.url()).toString(), { data: { message: "x" } })).status()).toBe(401);
    await anon.close();
    await field.reload();
    await expect(field.locator('[data-testid="fb-mine-item"][data-status="done"]')).toContainText("사진 크기를 줄여");
    await ceo.context().close();
    await field.context().close();
  });

  test("검수 확인서·그림 안내: 운영 기록으로 근거(출근·앱 오류 횟수) · 가상 데이터 표시 없음 · 현장 직원은 확인서 못 봄", async ({ browser }) => {
    const ceo = await login(browser, CEO.email, CEO.password);
    await ceo.goto("/acceptance");
    await ceo.getByTestId("acc-stage-2").click();
    const s1 = ceo.locator('[data-testid="acc-item"][data-key="S1"]');
    await expect(s1.locator('[data-has="1"]').first()).toContainText("출근 기록");
    await expect(ceo.getByTestId("acc-foot")).not.toContainText("DEMO");
    await ceo.getByTestId("acc-stage-4").click();
    // 앞 시험에서 기록된 화면 오류를 서버 오류 기록에서 센다
    await expect(ceo.locator('[data-testid="acc-item"][data-key="feedback"]')).toContainText(/기록된 앱 오류\s*[1-9]\d*회/);
    const text = (await ceo.getByTestId("acc-doc").innerText()).replace(/\s+/g, " ");
    expect(text).not.toMatch(/\d[\d,]*\s*(만\s*)?원(?![가-힣])|\d\s*억/);
    await ceo.context().close();

    const field = await login(browser, FIELD.email, FIELD.password, { width: 390, height: 844 });
    await field.goto("/acceptance");
    await expect(field.getByTestId("access-denied")).toBeVisible();
    await field.goto("/help");
    await field.getByTestId("help-quick-link").click();
    await expect(field.getByTestId("quick-step")).toHaveCount(6);
    for (const el of await field.getByTestId("quick-img").all()) {
      await el.scrollIntoViewIfNeeded();
      await expect.poll(() => el.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    }
    await field.context().close();
  });

  test("시범 운영 준비: 직원별 첫 로그인·첫 출근 · 첫 로그인 전 직원은 임시 비밀번호를 새로 만들어 쪽지로 → 그 비밀번호로 로그인", async ({ browser }) => {
    const ceo = await login(browser, CEO.email, CEO.password);
    await ceo.goto("/admin?tab=members");
    await ceo.getByTestId("member-new").click();
    await ceo.locator("#mf-name").fill("신입현장");
    await ceo.locator("#mf-email").fill("new@taekang.test");
    await pick(ceo, "mf-role-field");
    await ceo.getByTestId("member-save").click();
    await expect(ceo.getByTestId("issued-password")).toContainText("new@taekang.test");

    await ceo.goto("/launch");
    await expect(ceo.getByTestId("launch-summary")).toBeVisible();
    await expect(ceo.getByTestId("launch-site")).toHaveCount(1);
    await expect(ceo.locator('[data-testid="launch-site"] [data-key="geo"]')).toHaveAttribute("data-status", "ok");
    const park = ceo.locator('[data-testid="launch-person"]').filter({ hasText: "박현장" });
    await expect(park).toContainText("첫 로그인 끝");
    await expect(park).toContainText("첫 출근");
    await expect(park).toContainText("park@taekang.test");
    const fresh = ceo.locator('[data-testid="launch-person"]').filter({ hasText: "신입현장" });
    await expect(fresh).toContainText("첫 로그인 전");
    await expect(fresh).toContainText("담당 현장 없음");
    await expect(ceo.getByTestId("launch-blockers")).toContainText("신입현장 담당 현장");
    await fresh.getByTestId("launch-pick").check();
    await ceo.getByTestId("launch-slips").click();
    await expect(ceo.getByTestId("launch-reset-ask")).toContainText("신입현장");
    await ceo.getByTestId("launch-reset-yes").click();
    const pw = (await ceo.getByTestId("slip-dialog").getByTestId("slip-password").innerText()).trim();
    expect(pw).toMatch(/^[A-Za-z2-9]{10}$/);
    await expect(ceo.getByTestId("slip-dialog")).toContainText("new@taekang.test");
    await ceo.context().close();
    // 쪽지의 임시 비밀번호로 로그인 → 새 비밀번호 정하기 화면
    const n = await login(browser, "new@taekang.test", pw, { width: 390, height: 844 });
    await expect(n).toHaveURL(/\/account/);
    await n.context().close();
  });

  test("휴대폰 분실: 대표가 ‘모든 기기 로그아웃’ → 그 휴대폰은 바로 로그인 풀림 → 활동 이력에 남음", async ({ browser }) => {
    const phone = await login(browser, FIELD.email, FIELD.password, { width: 390, height: 844 });
    expect((await phone.request.get("/api/state")).status()).toBe(200);
    const ceo = await login(browser, CEO.email, CEO.password);
    await ceo.goto("/admin?tab=members");
    const row = ceo.getByTestId("member-row").filter({ hasText: "박현장" });
    await expect(row.getByTestId("member-devices")).toContainText("로그인된 기기");
    await expect(row.getByTestId("member-devices")).toContainText("마지막 사용");
    await row.getByTestId("member-signout").click();
    await row.getByTestId("member-signout-yes").click();
    await expect(row.getByTestId("member-devices")).toHaveAttribute("data-devices", "0");
    expect((await phone.request.get("/api/state")).status()).toBe(401);
    await ceo.goto("/audit");
    await expect(ceo.locator('[data-testid="audit-row"][data-type="member"]').filter({ hasText: "모든 기기 로그아웃 — 박현장" })).toHaveCount(1);
    await phone.context().close();
    await ceo.context().close();
  });

  test("다른 사이트에서 보낸 쓰기 요청은 차단 (Origin 확인)", async ({ browser }) => {
    const page = await login(browser, CEO.email, CEO.password);
    // 형식이 틀린 본문(null·배열)은 서버 오류(500)가 아니라 400
    for (const body of ["null", "[]", "1"]) expect((await page.request.post("/api/commands", { headers: { "Content-Type": "application/json" }, data: body })).status()).toBe(400);
    const r = await page.request.post("/api/commands", { headers: { Origin: "https://evil.example" }, data: { name: "setThresholds", args: {} } });
    expect(r.status()).toBe(403);
  });

  test("비활성화하면 그 사람의 로그인이 즉시 끊긴다", async ({ browser }) => {
    const field = await login(browser, FIELD.email, FIELD.password, { width: 390, height: 844 });
    expect((await field.request.get("/api/state")).status()).toBe(200);
    const admin = await login(browser, CEO.email, CEO.password);
    await admin.goto("/admin?tab=members");
    await admin.getByTestId("member-row").filter({ hasText: "박현장" }).getByRole("button", { name: "비활성" }).click();
    await expect(admin.getByTestId("member-row").filter({ hasText: "박현장" })).toContainText("비활성");
    expect((await field.request.get("/api/state")).status()).toBe(401);
  });

  test("로그아웃 후 데이터 접근 불가 / 화면 가로 넘침 없음", async ({ browser }) => {
    for (const w of [390, 1440]) {
      const page = await login(browser, CEO.email, CEO.password, { width: w, height: 900 });
      for (const r of ["/dashboard", `/sites/${siteId}`, "/admin", "/admin?tab=members", "/report", "/settings", "/labor", "/attendance", "/orders", "/schedule", "/data", "/usage", "/help", "/audit", "/daily", "/quality", "/acceptance", "/launch", "/help/quick", "/admin?tab=privacy", "/field/check", "/my"]) {
        await page.goto(r);
        await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, `${r} @${w}`).toBeLessThanOrEqual(1);
      }
      if (w === 1440) {
        await page.getByTestId("user-menu").click();
        await page.getByTestId("logout").click();
        await expect(page).toHaveURL(/\/login/);
        expect((await page.request.get("/api/state")).status()).toBe(401);
      }
    }
  });
});
