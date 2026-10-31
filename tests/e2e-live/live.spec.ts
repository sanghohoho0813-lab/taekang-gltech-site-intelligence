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
    // 공무 확인 후 반영으로
    await page.getByTestId("admin-tab-settings").click();
    await pick(page, "approval-review");
    await page.getByTestId("settings-save").click();
    await expect(page.getByText("운영 설정을 저장했습니다")).toBeVisible();
  });

  test("현장소장 첫 로그인 → 비밀번호 변경 강제 → 휴대폰 보고(공수) → 공무 확인 대기", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
    await page.locator("#f-work").fill("1층 앵커·브라켓 설치");
    await page.locator("#f-progress").fill("5");
    await page.getByTestId("add-cost").click();
    await page.locator("#c-cat-0").selectOption("labor");
    await pick(page, "cost-byqty-0");
    await page.locator("#c-md-0").fill("12");
    await page.locator("#f-reason").selectOption("quantity_increase");
    await page.getByTestId("submit-report").click();
    await expect(page.getByTestId("report-impact")).toHaveAttribute("data-pending", "1");
    await expect(page.getByTestId("report-impact")).toContainText("360만 원");
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
    await page.locator("#p-title").fill("3층 유리 사양 변경 작업지시");
    await page.locator("#p-desc").fill("서면 작업지시로 남깁니다. 변경견적을 회신해주세요.");
    await page.getByTestId("partner-submit").click();
    await expect(page.getByTestId("partner-sent")).toBeVisible();
    const st = await page.evaluate(async () => (await (await fetch("/api/state")).json()).db);
    expect(st.scope).toBe("partner");
    expect(st.costEntries).toHaveLength(0);
    expect(st.actions).toHaveLength(0);
    // 사진 원본·관리 API 차단
    expect((await page.request.get("/api/photos/anything")).status()).toBe(404);
    expect((await page.request.post("/api/commands", { data: { name: "submitFieldReport", args: { siteId } } })).status()).toBe(403);
    await ctx.close();
  });

  test("다른 사이트에서 보낸 쓰기 요청은 차단 (Origin 확인)", async ({ browser }) => {
    const page = await login(browser, CEO.email, CEO.password);
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
      for (const r of ["/dashboard", `/sites/${siteId}`, "/admin", "/admin?tab=members", "/report", "/settings"]) {
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
