/**
 * D-74: 하자 접수 링크 — 계정 없는 사람이 주소·QR로 하자를 접수하고(위치·내용·사진·연락처), 진행 확인 주소로 보수 진행을 본다.
 * 시연판(DEMO)은 서버가 없어 같은 브라우저에서 접수한다 (실제 서버 경로는 tests/e2e-live 에서).
 */
import { test, expect, type Page } from "./demoTest";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const MONEY = /\d[\d,]*\s*(만\s*)?원(?![가-힣])|\d\s*억/;
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

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

test("하자 접수 링크: 본사가 만들고(전화번호·QR·안내문) → 휴대폰에서 접수 → 본사 작업지시(연락처 보여 주기)·회신·접수자에게 알리기 → ‘아직 문제가 있습니다’ → 답변 확인 → 주소 바꾸기 → 링크 닫기·다시 열기", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);

  // 1) 본사: 현장 상세 탭 맨 위 ‘하자 접수 링크’ — 회사 전화번호부터 넣는다 (접수 화면·안내문에 보일 번호)
  await page.goto("/sites/site-a?tab=requests");
  const card = page.getByTestId("intake-card");
  await expect(card.getByTestId("intake-empty")).toBeVisible();
  await expect(card.getByTestId("intake-phone-row")).toContainText("전화번호가 없습니다");
  await card.getByTestId("intake-phone-edit").click();
  await card.getByTestId("intake-phone-input").fill("1234");
  await card.getByTestId("intake-phone-save").click();
  await expect(card.getByTestId("intake-phone-form")).toContainText("전화번호를 확인해 주세요");
  await card.getByTestId("intake-phone-input").fill("031 123 4567");
  await card.getByTestId("intake-phone-save").click();
  await expect(card.getByTestId("intake-phone-value")).toHaveText("031-123-4567");
  // 링크 만들기: 이름은 ‘관리사무소용’이 미리 들어 있고, 접수 화면에 보일 건물 이름을 따로 적을 수 있다 (내부 공사명이 밖으로 나가지 않게)
  await expect(card.getByTestId("intake-label")).toHaveValue("관리사무소용");
  await card.getByTestId("intake-place").fill("○○물류센터");
  await card.getByTestId("intake-create").click();
  const dialog = page.getByTestId("intake-dialog");
  await expect(dialog.getByRole("img", { name: "하자 접수 QR" })).toBeVisible();
  const url = await dialog.getByTestId("intake-url").inputValue();
  expect(url).toMatch(/\/r\/[A-Za-z0-9][A-Za-z0-9_-]{20}[A-Za-z0-9]$/);
  await dialog.getByTestId("intake-copy").click();
  await expect(dialog.getByTestId("intake-copy-status")).toContainText("복사했습니다");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await dialog.getByTestId("intake-copy-message").click();
  await expect(dialog.getByTestId("intake-copy-status")).toContainText("보낼 글을 복사했습니다");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`[(주)태강지엘텍] ○○물류센터 하자는 아래 주소에서 사진과 함께 접수해 주세요.\n${url}`);
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
  // 같은 이름(띄어쓰기만 달라도)으로 또 만들 수 없다
  await card.getByTestId("intake-label").fill("관리사무소 용");
  await card.getByTestId("intake-create").click();
  await expect(card.getByTestId("intake-error")).toContainText("이미 열려 있습니다");

  // 2) 안내문 (A4 한 장 · QR · 회사 전화번호 · 적어 둔 건물 이름 · 금액 없음)
  await page.goto(noticeHref!);
  const notice = page.getByTestId("intake-notice-body");
  await expect(notice).toContainText("하자 접수 안내");
  await expect(page.getByTestId("intake-notice-site")).toHaveText("○○물류센터");
  await expect(page.getByTestId("intake-notice-phone")).toContainText("031-123-4567");
  await expect(page.getByTestId("intake-notice-call")).toContainText("전화 접수");
  await expect(page.getByTestId("intake-notice-url")).toHaveText(url);
  await expect(page.getByTestId("intake-notice-nophone")).toHaveCount(0);
  const noticeText = (await notice.innerText()).replace(/\s+/g, " ");
  expect(noticeText).not.toMatch(MONEY);
  expect(noticeText).not.toContain("가상 현장 A");
  const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);

  // 3) 접수하는 사람 (휴대폰 · 로그인 없음 · 메뉴 없음) — 회사 이름과 전화번호가 머리말에
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  const form = page.getByTestId("intake-page");
  await expect(form).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await expect(page.getByTestId("demo-bar")).toHaveCount(0);
  await expect(page.getByTestId("public-company")).toHaveText("(주)태강지엘텍");
  await expect(page.getByTestId("public-phone").first()).toHaveAttribute("href", "tel:0311234567");
  await expect(page.getByTestId("intake-site")).toHaveText("○○물류센터");
  // 빈칸으로 보내면 칸마다 이유 → 칸을 고치면 그 칸의 오류는 바로 사라진다
  await page.getByTestId("intake-submit").click();
  await expect(form).toContainText("하자가 있는 곳을 적어 주세요.");
  await expect(form).toContainText("동의해 주셔야 접수할 수 있습니다.");
  await page.getByTestId("intake-location").fill("3층 302호 거실 창");
  await expect(form).not.toContainText("하자가 있는 곳을 적어 주세요.");
  await page.getByTestId("intake-description").fill("비가 오면 창틀 아래로 물이 샙니다.");
  // 한 줄 칸에서 Enter를 눌러도 접수가 나가지 않는다 (PC에서 적다가 오류가 한꺼번에 뜨던 문제)
  await page.getByTestId("intake-name").fill("홍길동");
  await page.getByTestId("intake-name").press("Enter");
  await expect(page.getByTestId("intake-done")).toHaveCount(0);
  await page.getByTestId("intake-org").fill("관리사무소");
  // 적던 글은 화면을 새로 열어도 남는다 (사진을 찍다 화면이 다시 열리는 휴대폰)
  await page.reload();
  await expect(page.getByTestId("intake-location")).toHaveValue("3층 302호 거실 창");
  await expect(page.getByTestId("intake-name")).toHaveValue("홍길동");
  await page.getByTestId("intake-photo-input").setInputFiles({ name: "leak.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("intake-photo")).toHaveCount(1);
  await page.getByTestId("intake-consent").check();
  await page.getByTestId("intake-phone").fill("1234");
  await page.getByTestId("intake-submit").click();
  await expect(form).toContainText("전화번호를 확인해 주세요");
  // 휴대폰 자동 완성이 넣는 +82 꼴도 받는다
  await page.getByTestId("intake-phone").fill("+82 10-1234-5678");
  await page.getByTestId("intake-privacy").locator("summary").click();
  await expect(page.getByTestId("intake-privacy")).toContainText("90일이 지나면 이름·전화번호를 지웁니다");
  await expect(page.getByTestId("intake-privacy")).toContainText("배정된 보수 담당자");
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await page.getByTestId("intake-submit").click();
  await expect(page.getByTestId("intake-done")).toContainText("접수되었습니다");
  const no = await page.getByTestId("intake-no").innerText();
  expect(no).toMatch(/^\d{4}-1$/);
  const statusUrl = await page.getByTestId("intake-status-url").inputValue();
  expect(statusUrl).toMatch(/\/r\/s\/[A-Za-z0-9_-]{32}$/);
  await expect(page.getByTestId("intake-saved")).toContainText("이 기기에 저장해 두었습니다");
  await expect(page.getByTestId("intake-status-sms")).toHaveAttribute("href", /^sms:\?&body=/);
  // 다른 하자 이어서 접수: 이름·전화번호는 그대로, 위치·내용만 새로
  await page.getByTestId("intake-another").click();
  await expect(page.getByTestId("intake-location")).toHaveValue("");
  await expect(page.getByTestId("intake-name")).toHaveValue("홍길동");
  await expect(page.getByTestId("intake-consent")).toBeChecked();
  await expect(page.getByTestId("intake-mine-row")).toHaveCount(1);
  await page.getByTestId("intake-location").fill("ㅁㄴㅇㄹ");
  await page.getByTestId("intake-description").fill("잘못 누른 접수");
  await page.getByTestId("intake-submit").click();
  await expect(page.getByTestId("intake-no")).toHaveText(no.replace(/-1$/, "-2"));

  // 4) 진행 확인 — 접수 단계 · 본인이 적은 내용 · 보낸 사진은 장수만 · 이름·연락처 없음
  await page.goto(statusUrl);
  const status = page.getByTestId("intake-status");
  await expect(status).toHaveAttribute("data-state", "step-0");
  await expect(page.getByTestId("status-site")).toHaveText("○○물류센터");
  await expect(page.getByTestId("status-no")).toHaveText(no);
  await expect(page.getByTestId("status-label")).toHaveText("접수");
  await expect(page.getByTestId("status-hint")).toContainText("담당자가 내용을 확인하고 있습니다");
  await expect(page.getByTestId("status-request")).toContainText("3층 302호 거실 창");
  await expect(page.getByTestId("status-sent-photos")).toContainText("보낸 사진 1장");
  await expect(page.getByTestId("status-request").locator("img")).toHaveCount(0);
  await expect(page.getByTestId("status-confirm")).toHaveCount(0);
  const stText = (await status.innerText()).replace(/\s+/g, " ");
  expect(stText).not.toContain("홍길동");
  expect(stText).not.toContain("1234-5678");
  expect(stText).not.toMatch(MONEY);
  // 같은 QR로 다시 들어오면 맨 위에 ‘이 기기로 접수한 건’ — 여럿이 쓰는 기기에서는 지울 수 있다
  await page.goto(url);
  await expect(page.getByTestId("intake-mine-row")).toHaveCount(2);
  const mineBox = await page.getByTestId("intake-mine").boundingBox();
  const locBox = await page.getByTestId("intake-location").boundingBox();
  expect(mineBox!.y).toBeLessThan(locBox!.y);
  await page.getByTestId("intake-mine-forget").first().click();
  await expect(page.getByTestId("intake-mine-row")).toHaveCount(1);

  // 5) 본사: 요청함 — ‘처리할 것’만(오래된 것부터) · 링크 접수 2건 · 접수자 이름·전화 · 장난 접수 버리기 · 작업지시로 보내기
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/insights#requests");
  await expect(page.getByTestId("inbox-show-todo")).toHaveAttribute("aria-pressed", "true");
  const req = page.getByTestId("partner-request").filter({ hasText: "3층 302호 거실 창" });
  await expect(req).toContainText("비가 오면 창틀 아래로 물이 샙니다.");
  await expect(req.getByTestId("request-intake")).toContainText(`접수 번호 ${no}`);
  await expect(req.getByTestId("request-intake")).toContainText("접수 경로: 관리사무소용");
  await expect(req.getByTestId("request-intake-who")).toHaveText("관리사무소 홍길동");
  await expect(req.getByTestId("request-intake-phone")).toHaveAttribute("href", "tel:01012345678");
  await expect(req.getByTestId("request-photos").locator("img")).toHaveCount(1);
  // 장난 접수는 회신하지 않고 버린다 (사진까지 지우고 건수에 남지 않는다)
  const junk = page.getByTestId("partner-request").filter({ hasText: "ㅁㄴㅇㄹ" });
  await expect(junk).toHaveCount(1);
  page.once("dialog", (d) => d.accept());
  await junk.getByTestId("request-intake-discard").selectOption("spam");
  await expect(junk).toHaveCount(0);
  // 작업지시: 제목은 ‘위치 — 문제’ · 접수자 연락처를 보수 담당자에게 보여 주기(기본 켬) · 현장 전달 메모
  await req.getByTestId("request-to-order").click();
  const order = page.getByTestId("defect-order-modal");
  await expect(order.locator("#do-title")).toHaveValue("3층 302호 거실 창 — 비가 오면 창틀 아래로 물이 샙니다.");
  await expect(order.getByTestId("defect-order-contact")).toBeChecked();
  await order.getByTestId("defect-order-memo").fill("방문 전 관리사무소에 먼저 들를 것");
  await expect(order.getByTestId("defect-order-detail")).toContainText("본사 메모: 방문 전 관리사무소에 먼저 들를 것");
  await order.getByTestId("defect-order-send").click();
  await expect(req.getByTestId("request-wo")).toHaveAttribute("data-wo-status", "sent");
  // 하자보수 현황: 사람 이름 대신 ‘링크 접수 · 접수 번호 · 소속’ · 여기서 접수 QR·전화 접수로 갈 수 있다
  await page.goto("/defects");
  await expect(page.getByText(`링크 접수 ${no} · 관리사무소`).first()).toBeVisible();
  await expect(page.getByText("홍길동")).toHaveCount(0);
  await expect(page.getByText("ㅁㄴㅇㄹ")).toHaveCount(0);
  await expect(page.getByTestId("defects-phone-register")).toBeVisible();
  await expect(page.getByTestId("warranty-row-intake").first()).toContainText("접수 QR 1개");
  // 현장 상세 카드에 접수 2건 · 버림 1
  await page.goto("/sites/site-a?tab=requests");
  await expect(row.getByTestId("intake-count")).toContainText("접수 2건");
  await expect(row.getByTestId("intake-count")).toContainText("버림 1");
  // 진행 확인: 보수 배정
  await page.goto(statusUrl);
  await expect(status).toHaveAttribute("data-state", "step-1");
  await expect(page.getByTestId("status-label")).toHaveText("보수 배정");

  // 6) 현장: 작업지시 카드에 ‘방문 전에 연락할 분’(본사가 보여 주기를 골랐으므로)과 본사 메모 → 완료(사진)
  await asRole(page, "field");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-actions");
  const wo = page.getByTestId("wo-card").filter({ hasText: "3층 302호 거실 창" });
  await expect(wo).toContainText("하자보수");
  await expect(wo).toContainText("방문 전 관리사무소에 먼저 들를 것");
  await expect(wo.getByTestId("wo-contact")).toContainText("관리사무소 홍길동");
  await expect(wo.getByTestId("wo-contact-phone")).toHaveAttribute("href", "tel:01012345678");
  await wo.getByTestId("wo-receive").click();
  await wo.getByTestId("wo-complete").click();
  await page.getByTestId("wo-result-chip").first().click();
  await page.getByTestId("wo-photo").setInputFiles({ name: "fixed.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("wo-finish-send").click();
  await expect(page.getByTestId("wo-finish")).toBeHidden();

  // 7) 본사: 보수 사진과 함께 회신 → ‘접수자에게 알리기’(알림이 가지 않으므로 보낼 글·문자)
  await asRole(page, "ceo");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/insights#requests");
  await req.getByTestId("request-reply").click();
  await expect(page.getByTestId("reply-modal")).toContainText("접수자의 진행 확인 화면에 그대로 보입니다");
  await expect(page.getByTestId("reply-share-photos").locator("img")).toHaveCount(1);
  await expect(page.getByTestId("reply-share-photos")).toContainText("진행 확인 주소를 가진 사람이 볼 수 있습니다");
  await page.locator("#rp-text").fill("실리콘을 다시 시공했습니다. 물을 뿌려 새는 곳이 없는 것을 확인했습니다.");
  await page.getByTestId("reply-confirm").click();
  // 알림이 가지 않는 접수 — 회신 창이 그대로 ‘접수자에게 알리기’로 넘어간다 (점검 11차)
  const notify = page.getByTestId("reply-notify");
  await expect(notify).toBeVisible();
  await expect(notify.getByTestId("intake-notify-message")).toHaveValue(/보수를 마쳤습니다.*\/r\/s\//s);
  await expect(notify.getByTestId("intake-notify-sms")).toHaveAttribute("href", /^sms:01012345678\?&body=/);
  await page.getByTestId("reply-done-close").click();
  await expect(page.getByTestId("reply-modal")).toHaveCount(0);
  // 회신한 요청은 ‘처리할 것’에서 빠진다 → 전체에서 본다
  await page.getByTestId("inbox-show-all").click();
  await expect(req).toHaveAttribute("data-status", "answered");
  await expect(req.getByTestId("request-intake")).toHaveAttribute("data-notify", "1");
  await req.getByTestId("request-intake-notify").click();
  const message = await req.getByTestId("request-intake-message").inputValue();
  expect(message).toBe(`[(주)태강지엘텍] 접수하신 하자(접수 번호 ${no}) 보수를 마쳤습니다. 아래 주소에서 사진을 보시고 ‘잘 고쳐졌습니다’를 눌러 주세요.\n${statusUrl}`);
  await expect(req.getByTestId("request-intake-sms")).toHaveAttribute("href", /^sms:01012345678\?&body=/);
  await req.getByTestId("request-intake-copy").click();
  await expect(req.getByTestId("request-intake-status")).toContainText("복사했습니다");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(message);

  // 8) 접수자: 답변·보수 사진(누르면 크게) → ‘아직 문제가 있습니다’ → 같은 주소에서 새 접수로 이어진다
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(statusUrl);
  await expect(status).toHaveAttribute("data-state", "step-3");
  await expect(page.getByTestId("status-reply")).toContainText("실리콘을 다시 시공했습니다");
  await expect(page.getByTestId("status-repair-photos").locator("img")).toHaveCount(1);
  await page.getByTestId("status-repair-photos").getByRole("button").click();
  await expect(page.getByTestId("photo-zoom")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("photo-zoom")).toHaveCount(0);
  await expect(page.getByTestId("status-confirm-btn")).toHaveText("잘 고쳐졌습니다 (확인)");
  await page.getByTestId("status-reopen-open").click();
  await page.getByTestId("status-reopen-btn").click();
  await expect(page.getByTestId("status-error")).toContainText("어떤 문제가 남았는지");
  await page.getByTestId("status-issue").fill("비가 오니 같은 자리에서 다시 샙니다.");
  await page.getByTestId("status-reopen-btn").click();
  await expect(page.getByTestId("status-no")).toHaveText(`${no}-2`);
  await expect(status).toHaveAttribute("data-state", "step-0");
  await expect(page.getByTestId("status-prev")).toContainText(no);
  await expect(page.getByTestId("status-hint")).toContainText("다시 접수되었습니다");
  await expect(page.getByTestId("status-prev-reply")).toContainText("실리콘을 다시 시공했습니다");
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  // 9) 본사: ‘다시 접수’가 처리할 것으로 올라온다 → 작업지시 없이 답변으로 끝냄 → 접수자: ‘답변 확인했습니다’
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/insights#requests");
  const redo = page.getByTestId("partner-request").filter({ hasText: "비가 오니 같은 자리에서 다시 샙니다." });
  await expect(redo.getByTestId("request-reopened")).toContainText(`앞 접수 번호 ${no}`);
  await expect(redo.getByTestId("request-intake")).toContainText(`접수 번호 ${no}-2`);
  await redo.getByTestId("request-reply").click();
  await page.getByTestId("reply-close-no-repair").check();
  await page.locator("#rp-text").fill("결로로 보입니다. 환기 방법을 전화로 안내드렸습니다.");
  await page.getByTestId("reply-confirm").click();
  await expect(page.getByTestId("intake-notify-message")).toHaveValue(/답변드렸습니다/);
  await page.getByTestId("reply-done-close").click();
  await page.getByTestId("inbox-show-all").click();
  await expect(req.getByTestId("request-superseded")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(statusUrl);
  await expect(page.getByTestId("status-label")).toHaveText("답변 완료");
  await expect(page.getByTestId("status-steps")).toContainText("답변 완료");
  await expect(page.getByTestId("status-steps")).not.toContainText("보수 배정");
  await expect(page.getByTestId("status-confirm")).toContainText("시공사 답변을 확인해 주세요");
  await expect(page.getByTestId("status-confirm-btn")).toHaveText("답변 확인했습니다");
  await page.getByTestId("status-note").fill("알겠습니다");
  await page.getByTestId("status-confirm-btn").click();
  await expect(page.getByTestId("status-confirmed")).toContainText("알겠습니다");
  await expect(status).toHaveAttribute("data-state", "confirmed");
  await expect(page.getByTestId("status-confirm")).toHaveCount(0);
  // 본사 요청함: 접수자 확인 완료
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/insights#requests");
  await page.getByTestId("inbox-show-all").click();
  await expect(redo.getByTestId("request-confirmed")).toContainText("접수자 확인 완료");
  await expect(redo.getByTestId("request-confirmed")).toContainText("알겠습니다");

  // 10) 본사: 진행 확인 주소 바꾸기(주소가 다른 사람에게 알려졌을 때) → 앞의 주소는 닫히고 새 주소가 열린다
  await redo.getByTestId("request-intake-notify").click();
  await expect(redo.getByTestId("request-intake-message")).toHaveValue(new RegExp(statusUrl.split("/r/s/")[1]));
  page.once("dialog", (d) => d.accept());
  await redo.getByTestId("request-intake-renew").click();
  await expect(redo.getByTestId("request-intake-message")).not.toHaveValue(new RegExp(statusUrl.split("/r/s/")[1]));
  const renewed = (await redo.getByTestId("request-intake-message").inputValue()).match(/https?:\/\/\S+\/r\/s\/[A-Za-z0-9_-]{32}/)![0];
  expect(renewed).not.toBe(statusUrl);
  await page.goto(statusUrl);
  await expect(status).toHaveAttribute("data-state", "notfound");
  await expect(status).toContainText("주소를 새로 보냈다면 새 주소로");
  await page.goto(renewed);
  await expect(status).toHaveAttribute("data-state", "confirmed");

  // 11) 링크 닫기 → 그 주소로는 접수되지 않고 어디에 전화할지 알려 준다 · 안내문도 인쇄할 수 없다 → 다시 열기
  await page.goto("/sites/site-a?tab=requests");
  page.once("dialog", (d) => d.accept());
  await row.getByTestId("intake-close").click();
  await expect(card.getByTestId("intake-closed").getByTestId("intake-row")).toHaveAttribute("data-state", "closed");
  await page.goto(url);
  await expect(form).toHaveAttribute("data-state", "closed");
  await expect(page.getByTestId("public-gone-title")).toContainText("접수를 받지 않습니다");
  await expect(page.getByTestId("public-gone-company")).toHaveText("(주)태강지엘텍");
  await expect(page.getByTestId("public-phone")).toHaveAttribute("href", "tel:0311234567");
  await page.goto(noticeHref!);
  await expect(page.getByText("열려 있는 접수 링크를 찾을 수 없습니다")).toBeVisible();
  await page.goto("/sites/site-a?tab=requests");
  await card.getByTestId("intake-reopen").click();
  await expect(card.getByTestId("intake-list").getByTestId("intake-row")).toHaveAttribute("data-state", "open");
  await page.goto(url);
  await expect(form).toHaveAttribute("data-state", "open");
  // 활동 이력: 이름·연락처·접수자가 적은 글 없이 (현장·접수 번호만)
  await page.goto("/sites/site-a?tab=history");
  await expect(page.getByText(`하자 접수(링크): A현장 — 접수 번호 ${no}`, { exact: true })).toBeVisible();
  await expect(page.getByText("홍길동")).toHaveCount(0);
  await expect(page.getByText("ㅁㄴㅇㄹ")).toHaveCount(0);
});

test("하자 접수 링크: 없는 주소·잘린 주소·끝에 글자가 붙은 주소 · 전화로 받은 하자 등록 → 진행 확인 주소 문자 · 여러 건 버리기 · 현장 직원·발주처 계정에는 접수 링크 카드와 접수자 정보가 없다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  for (const bad of ["/r/AAAAAAAAAAAAAAAAAAAAAA", "/r/nope", "/r", "/r/AAAAAAAAAAAAAAAAAAAAAA/extra"]) {
    await page.goto(bad);
    await expect(page.getByTestId("intake-page")).toHaveAttribute("data-state", "notfound");
    await expect(page.getByTestId("public-gone-title")).toHaveText("열 수 없는 주소입니다");
    await expect(page.getByTestId("sidebar")).toHaveCount(0);
  }
  await page.goto("/r/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  await expect(page.getByTestId("intake-status")).toHaveAttribute("data-state", "notfound");
  await page.goto("/r/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/extra");
  await expect(page.getByTestId("intake-status")).toHaveAttribute("data-state", "notfound");
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  // 본사가 링크를 만들고 접수 두 건 — 문자·메신저가 주소 끝에 ‘.’·‘)’·글자를 붙여 보내도 열린다
  await page.goto("/sites/site-a?tab=requests");
  await page.getByTestId("intake-create").click();
  const url = await page.getByTestId("intake-url").inputValue();
  for (const [suffix, where] of [
    [".", "1층 로비 출입문"],
    [")입니다", "지하 1층 주차장 창"],
  ] as const) {
    await page.goto(`${url}${suffix}`);
    await expect(page.getByTestId("intake-page")).toHaveAttribute("data-state", "open");
    // 회사 전화번호를 넣지 않았으면 전화 버튼은 없다 (없는 번호를 지어내지 않는다)
    await expect(page.getByTestId("public-phone")).toHaveCount(0);
    await page.getByTestId("intake-location").fill(where);
    await page.getByTestId("intake-description").fill("문이 잘 닫히지 않습니다.");
    await page.getByTestId("intake-name").fill("김관리");
    await page.getByTestId("intake-phone").fill("02-123-4567");
    await page.getByTestId("intake-consent").check();
    await page.getByTestId("intake-submit").click();
    await expect(page.getByTestId("intake-done")).toBeVisible();
    // 다음 접수를 위해 적던 글 비우기 (다른 사람이 새로 들어온 상황)
    await page.evaluate(() => sessionStorage.clear());
  }
  // 전화로 받은 하자: 하자보수 화면에서 바로 등록 → 같은 목록에 ‘전화 접수’로 → 진행 확인 주소를 문자로 보낼 수 있다
  await page.goto("/defects");
  await page.getByTestId("defects-phone-register").click();
  const modal = page.getByTestId("phone-defect-modal");
  await modal.getByTestId("phone-defect-save").click();
  await expect(modal).toContainText("하자가 있는 곳을 적어 주세요.");
  await modal.getByTestId("phone-defect-location").fill("옥상 천창");
  await modal.getByTestId("phone-defect-description").fill("실리콘이 떨어졌다고 함");
  await modal.getByTestId("phone-defect-name").fill("박소장");
  await modal.getByTestId("phone-defect-phone").fill("010-2222-3333");
  // 이름·전화번호를 적으면 전화로 동의받았는지 표시해야 한다
  await modal.getByTestId("phone-defect-save").click();
  await expect(modal).toContainText("전화로 동의를 받았는지");
  await modal.getByTestId("phone-defect-consent").check();
  await modal.getByTestId("phone-defect-save").click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId("defect-row").filter({ hasText: "실리콘이 떨어졌다고 함" })).toContainText("전화 접수");
  await page.goto("/insights#requests");
  const phoned = page.getByTestId("partner-request").filter({ hasText: "실리콘이 떨어졌다고 함" });
  await expect(phoned.getByTestId("request-intake")).toContainText("전화 접수");
  await expect(phoned.getByTestId("request-intake-who")).toHaveText("박소장");
  await phoned.getByTestId("request-intake-notify").click();
  const sms = await phoned.getByTestId("request-intake-message").inputValue();
  const statusUrl = sms.match(/https?:\/\/\S+\/r\/s\/[A-Za-z0-9_-]{32}/)![0];
  await expect(phoned.getByTestId("request-intake-sms")).toHaveAttribute("href", /^sms:01022223333\?&body=/);
  // 장난·중복 접수 여러 건 버리기 (링크 접수 2건만 골라서)
  await page.getByTestId("inbox-discard").click();
  const discard = page.getByTestId("discard-modal");
  await expect(discard.getByTestId("discard-pick")).toHaveCount(3);
  await discard.locator("label").filter({ hasText: "1층 로비 출입문" }).getByTestId("discard-pick").check();
  await discard.locator("label").filter({ hasText: "지하 1층 주차장 창" }).getByTestId("discard-pick").check();
  page.once("dialog", (d) => d.accept());
  await discard.getByTestId("discard-go").click();
  await expect(discard).toHaveCount(0);
  await expect(page.getByText("1층 로비 출입문")).toHaveCount(0);
  await expect(phoned).toHaveCount(1);
  // 전화 접수의 진행 확인 주소가 열린다
  await page.goto(statusUrl);
  await expect(page.getByTestId("intake-status")).toHaveAttribute("data-state", "step-0");
  await expect(page.getByTestId("status-request")).toContainText("옥상 천창");
  // 발주처 계정: 포털에 링크·전화 접수가 섞이지 않는다
  await asRole(page, "partner");
  await page.goto("/partner#my-requests");
  await expect(page.getByText("옥상 천창")).toHaveCount(0);
  await expect(page.getByText("박소장")).toHaveCount(0);
  // 현장 직원: 접수 링크 카드·안내문 없음
  await asRole(page, "field");
  await page.goto("/sites/site-a?tab=requests");
  await expect(page.getByTestId("intake-card")).toHaveCount(0);
  await page.goto("/sites/site-a/intake?link=x");
  await expect(page.getByText("본사만 볼 수 있습니다")).toBeVisible();
});
