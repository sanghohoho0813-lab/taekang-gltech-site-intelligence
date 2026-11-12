/**
 * D-74: 하자 접수 링크 — 계정 없는 사람이 주소·QR로 하자를 접수하고(위치·내용·사진·연락처), 진행 확인 주소로 보수 진행을 본다.
 * 시연판(DEMO)은 서버가 없어 같은 브라우저에서 접수한다 (실제 서버 경로는 tests/e2e-live 에서).
 */
import { test, expect, type Page } from "./demoTest";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const MONEY = /\d[\d,]*\s*(만\s*)?원(?![가-힣])|\d\s*억/;

async function freshStart(page: Page, role = "ceo") {
  await page.goto("/dashboard");
  await page.evaluate(
    ([pk, dk, r]) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.removeItem(dk);
      localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: r, deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 }));
    },
    [PREFS, DB, role] as const,
  );
}
const asRole = (page: Page, role: string) => page.evaluate(([pk, r]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: r })), [PREFS, role] as const);

test("하자 접수 링크: 본사가 만들고(QR·안내문) → 휴대폰에서 접수(사진·연락처·동의) → 진행 확인 → 본사 작업지시·회신 → 접수자 확인 → 링크 닫기", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);

  // 1) 본사: 현장 상세에서 접수 링크 만들기 → QR·주소
  await page.goto("/sites/site-a?tab=requests");
  const card = page.getByTestId("intake-card");
  await expect(card.getByTestId("intake-empty")).toBeVisible();
  await card.getByTestId("intake-label").fill("관리사무소용");
  await card.getByTestId("intake-create").click();
  const dialog = page.getByTestId("intake-dialog");
  await expect(dialog.getByRole("img", { name: "하자 접수 QR" })).toBeVisible();
  const url = await dialog.getByTestId("intake-url").inputValue();
  expect(url).toMatch(/\/r\/[A-Za-z0-9][A-Za-z0-9_-]{20}[A-Za-z0-9]$/);
  await dialog.getByTestId("intake-copy").click();
  await expect(dialog.getByTestId("intake-copy-status")).toContainText("복사했습니다");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  const noticeHref = await dialog.getByTestId("intake-print-link").getAttribute("href");
  await dialog.getByTestId("intake-dialog-done").click();
  const row = card.getByTestId("intake-row");
  await expect(row).toHaveAttribute("data-state", "open");
  await expect(row).toContainText("관리사무소용");
  await expect(row.getByTestId("intake-count")).toContainText("접수 없음");
  // 주소·QR은 다시 볼 수 있다 (접수만 되는 주소)
  await row.getByTestId("intake-show").click();
  await expect(page.getByTestId("intake-url")).toHaveValue(url);
  await page.getByTestId("intake-dialog-done").click();
  // 같은 이름으로 또 만들 수 없다
  await card.getByTestId("intake-label").fill("관리사무소용");
  await card.getByTestId("intake-create").click();
  await expect(card.getByTestId("intake-error")).toContainText("이미 열려 있습니다");

  // 2) 안내문 (A4 한 장 · QR · 금액 없음)
  await page.goto(noticeHref!);
  const notice = page.getByTestId("intake-notice-body");
  await expect(notice).toContainText("하자 접수 안내");
  await expect(page.getByTestId("intake-notice-site")).toContainText("가상 현장 A");
  await expect(page.getByTestId("intake-notice-url")).toHaveText(url);
  expect((await notice.innerText()).replace(/\s+/g, " ")).not.toMatch(MONEY);
  const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);

  // 3) 접수하는 사람 (휴대폰 · 로그인 없음 · 메뉴 없음)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  const form = page.getByTestId("intake-page");
  await expect(form).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await expect(page.getByTestId("demo-bar")).toHaveCount(0);
  await expect(page.getByTestId("public-company")).toHaveText("(주)태강지엘텍");
  await expect(page.getByTestId("intake-site")).toContainText("가상 현장 A");
  // 빈칸으로 보내면 칸마다 이유
  await page.getByTestId("intake-submit").click();
  await expect(form).toContainText("하자가 있는 곳을 적어 주세요.");
  await expect(form).toContainText("동의해 주셔야 접수할 수 있습니다.");
  await page.getByTestId("intake-location").fill("3층 302호 거실 창");
  await page.getByTestId("intake-description").fill("비가 오면 창틀 아래로 물이 샙니다.");
  await page.getByTestId("intake-photo-input").setInputFiles({ name: "leak.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("intake-photo")).toHaveCount(1);
  await page.getByTestId("intake-name").fill("홍길동");
  await page.getByTestId("intake-phone").fill("1234");
  await page.getByTestId("intake-org").fill("관리사무소");
  await page.getByTestId("intake-consent").check();
  await page.getByTestId("intake-submit").click();
  await expect(form).toContainText("전화번호를 확인해 주세요");
  await page.getByTestId("intake-phone").fill("01012345678");
  await page.getByTestId("intake-privacy").locator("summary").click();
  await expect(page.getByTestId("intake-privacy")).toContainText("90일이 지나면 이름·전화번호를 지웁니다");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByTestId("intake-submit").click();
  await expect(page.getByTestId("intake-done")).toContainText("접수되었습니다");
  const no = await page.getByTestId("intake-no").innerText();
  expect(no).toMatch(/^\d{4}-1$/);
  const statusUrl = await page.getByTestId("intake-status-url").inputValue();
  expect(statusUrl).toMatch(/\/r\/s\/[A-Za-z0-9_-]{32}$/);
  // 저장된 데이터에 진행 확인 주소의 비밀값이 없다 (해시만)
  expect(await page.evaluate((dk) => localStorage.getItem(dk)!, DB)).not.toContain(statusUrl.split("/r/s/")[1]);

  // 4) 진행 확인 — 접수 단계 · 본인이 적은 내용과 사진 · 이름·연락처 없음
  await page.getByTestId("intake-status-open").click();
  await expect(page).toHaveURL(statusUrl);
  const status = page.getByTestId("intake-status");
  await expect(status).toHaveAttribute("data-state", "step-0");
  await expect(page.getByTestId("status-no")).toHaveText(no);
  await expect(page.getByTestId("status-label")).toHaveText("접수");
  await expect(page.getByTestId("status-request")).toContainText("3층 302호 거실 창");
  await expect(page.getByTestId("status-sent-photos").locator("img")).toHaveCount(1);
  await expect(page.getByTestId("status-confirm")).toHaveCount(0);
  const stText = (await status.innerText()).replace(/\s+/g, " ");
  expect(stText).not.toContain("홍길동");
  expect(stText).not.toContain("1234-5678");
  expect(stText).not.toMatch(MONEY);
  // 같은 QR로 다시 들어오면 ‘이 휴대폰으로 접수한 건’이 보인다
  await page.goto(url);
  await expect(page.getByTestId("intake-mine-row")).toHaveCount(1);
  await expect(page.getByTestId("intake-mine-row")).toContainText(`접수 번호 ${no}`);

  // 5) 본사: 요청함에 ‘링크 접수’ · 접수자 이름·전화 · 작업지시로 보내기
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/insights#requests");
  const req = page.getByTestId("partner-request").filter({ hasText: "3층 302호 거실 창" });
  await expect(req.getByTestId("request-intake")).toContainText(`접수 번호 ${no}`);
  await expect(req.getByTestId("request-intake-who")).toHaveText("관리사무소 홍길동");
  await expect(req.getByTestId("request-intake-phone")).toHaveAttribute("href", "tel:01012345678");
  await expect(req.getByTestId("request-photos").locator("img")).toHaveCount(1);
  await req.getByTestId("request-to-order").click();
  await page.getByTestId("defect-order-send").click();
  await expect(req.getByTestId("request-wo")).toHaveAttribute("data-wo-status", "sent");
  // 하자보수 현황: 사람 이름 대신 ‘링크 접수 · 접수 번호 · 소속’
  await page.goto("/defects");
  await expect(page.getByText(`링크 접수 ${no} · 관리사무소`).first()).toBeVisible();
  await expect(page.getByText("홍길동")).toHaveCount(0);
  // 현장 상세 카드에 접수 1건
  await page.goto("/sites/site-a?tab=requests");
  await expect(row.getByTestId("intake-count")).toContainText("접수 1건");
  // 진행 확인: 보수 배정
  await page.goto(statusUrl);
  await expect(status).toHaveAttribute("data-state", "step-1");
  await expect(page.getByTestId("status-label")).toHaveText("보수 배정");

  // 6) 현장: 작업지시 완료(사진) — 접수자 이름·연락처는 현장 휴대폰에 없다
  await asRole(page, "field");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-actions");
  const wo = page.getByTestId("wo-card").filter({ hasText: "3층 302호 거실 창" });
  await expect(wo).toContainText("하자보수");
  expect(await wo.innerText()).not.toMatch(/홍길동|1234-5678/);
  await wo.getByTestId("wo-receive").click();
  await wo.getByTestId("wo-complete").click();
  await page.getByTestId("wo-result-chip").first().click();
  await page.getByTestId("wo-photo").setInputFiles({ name: "fixed.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("wo-finish-send").click();
  await expect(page.getByTestId("wo-finish")).toBeHidden();

  // 7) 본사: 보수 사진과 함께 회신
  await asRole(page, "ceo");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/insights#requests");
  await req.getByTestId("request-reply").click();
  await expect(page.getByTestId("reply-share-photos").locator("img")).toHaveCount(1);
  await page.locator("#rp-text").fill("실리콘을 다시 시공했습니다. 물을 뿌려 새는 곳이 없는 것을 확인했습니다.");
  await page.getByTestId("reply-confirm").click();
  await expect(req).toHaveAttribute("data-status", "answered");

  // 8) 접수자: 회신·보수 사진 → ‘보수 확인했습니다’
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(statusUrl);
  await expect(status).toHaveAttribute("data-state", "step-3");
  await expect(page.getByTestId("status-reply")).toContainText("실리콘을 다시 시공했습니다");
  await expect(page.getByTestId("status-repair-photos").locator("img")).toHaveCount(1);
  await page.getByTestId("status-note").fill("잘 고쳐졌습니다");
  await page.getByTestId("status-confirm-btn").click();
  await expect(page.getByTestId("status-confirmed")).toBeVisible();
  await expect(status).toHaveAttribute("data-state", "confirmed");
  await expect(page.getByTestId("status-confirm")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  // 본사 요청함: 확인 완료
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/insights#requests");
  await expect(req.getByTestId("request-confirmed")).toContainText("잘 고쳐졌습니다");

  // 9) 본사: 진행 확인 주소 다시 만들기 → 앞의 주소는 닫히고 새 주소가 열린다
  page.once("dialog", (d) => d.accept());
  await req.getByTestId("request-intake-renew").click();
  const message = await req.getByTestId("request-intake-message").inputValue();
  expect(message).toContain(`접수 번호 ${no}`);
  const renewed = message.match(/https?:\/\/\S+\/r\/s\/[A-Za-z0-9_-]{32}/)![0];
  expect(renewed).not.toBe(statusUrl);
  await page.goto(statusUrl);
  await expect(status).toHaveAttribute("data-state", "notfound");
  await page.goto(renewed);
  await expect(status).toHaveAttribute("data-state", "confirmed");

  // 10) 링크 닫기 → 그 주소로는 접수되지 않는다 · 안내문도 인쇄할 수 없다
  await page.goto("/sites/site-a?tab=requests");
  page.once("dialog", (d) => d.accept());
  await row.getByTestId("intake-close").click();
  await expect(row).toHaveAttribute("data-state", "closed");
  await page.goto(url);
  await expect(form).toHaveAttribute("data-state", "closed");
  await expect(page.getByTestId("public-gone-title")).toContainText("접수를 받지 않습니다");
  await page.goto(noticeHref!);
  await expect(page.getByText("열려 있는 접수 링크를 찾을 수 없습니다")).toBeVisible();
  // 활동 이력: 이름·연락처 없이
  await page.goto("/sites/site-a?tab=history");
  await expect(page.getByText(`하자 접수(링크): A현장 · 3층 302호 거실 창 — 접수 번호 ${no}`)).toBeVisible();
  await expect(page.getByText("홍길동")).toHaveCount(0);
});

test("하자 접수 링크: 없는 주소·잘린 주소 안내 · 현장 직원·발주처 계정에는 접수 링크 카드와 접수자 정보가 없다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  for (const bad of ["/r/AAAAAAAAAAAAAAAAAAAAAA", "/r/nope", "/r"]) {
    await page.goto(bad);
    await expect(page.getByTestId("intake-page")).toHaveAttribute("data-state", "notfound");
    await expect(page.getByTestId("public-gone-title")).toHaveText("열 수 없는 주소입니다");
    await expect(page.getByTestId("sidebar")).toHaveCount(0);
  }
  await page.goto("/r/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  await expect(page.getByTestId("intake-status")).toHaveAttribute("data-state", "notfound");
  // 본사가 링크를 만들고 접수 한 건
  await page.goto("/sites/site-a?tab=requests");
  await page.getByTestId("intake-create").click();
  const url = await page.getByTestId("intake-url").inputValue();
  await page.goto(url);
  await page.getByTestId("intake-location").fill("1층 로비 출입문");
  await page.getByTestId("intake-description").fill("문이 잘 닫히지 않습니다.");
  await page.getByTestId("intake-name").fill("김관리");
  await page.getByTestId("intake-phone").fill("02-123-4567");
  await page.getByTestId("intake-consent").check();
  await page.getByTestId("intake-submit").click();
  await expect(page.getByTestId("intake-done")).toBeVisible();
  // 발주처 계정: 포털에 링크 접수가 섞이지 않는다 · 현장 상세의 접수 링크 카드 없음
  await asRole(page, "partner");
  await page.goto("/partner#my-requests");
  await expect(page.getByText("1층 로비 출입문")).toHaveCount(0);
  await expect(page.getByText("김관리")).toHaveCount(0);
  // 현장 직원: 접수 링크 카드·안내문 없음
  await asRole(page, "field");
  await page.goto("/sites/site-a?tab=requests");
  await expect(page.getByTestId("intake-card")).toHaveCount(0);
  await page.goto("/sites/site-a/intake?link=x");
  await expect(page.getByText("본사만 볼 수 있습니다")).toBeVisible();
});
