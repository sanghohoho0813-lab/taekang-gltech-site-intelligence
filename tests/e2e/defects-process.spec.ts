/**
 * D-75: 하자보수 한 화면 처리 — 하자보수 화면에서 작업지시 보내기·회신·접수자에게 알리기·처리 이력,
 * 메뉴 배지(하자보수·휴대폰 더보기), 처리 대기·현장 개요에서 바로 들어가기, 관리대장 칸.
 */
import { test, expect, type Page } from "./demoTest";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

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

/** 접수 링크를 만들고 휴대폰으로 하자 두 건을 접수한다 */
async function twoIntakes(page: Page) {
  await page.goto("/sites/site-a?tab=requests");
  await page.getByTestId("intake-create").click();
  const url = await page.getByTestId("intake-url").inputValue();
  await page.getByTestId("intake-dialog-done").click();
  for (const [loc, desc] of [
    ["3층 302호 거실 창", "비가 오면 창틀 아래로 물이 샙니다."],
    ["1층 로비 출입문", "문이 끝까지 닫히지 않습니다."],
  ]) {
    await page.goto(url);
    await page.getByTestId("intake-location").fill(loc);
    await page.getByTestId("intake-description").fill(desc);
    await page.getByTestId("intake-photo-input").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByTestId("intake-photo")).toHaveCount(1);
    await page.getByTestId("intake-name").fill("홍길동");
    await page.getByTestId("intake-phone").fill("01012345678");
    await page.getByTestId("intake-org").fill("관리사무소");
    await page.getByTestId("intake-consent").check();
    await page.getByTestId("intake-submit").click();
    await expect(page.getByTestId("intake-done")).toBeVisible();
    await page.evaluate(() => sessionStorage.clear());
  }
}

test("하자보수 화면에서 끝까지: 메뉴 배지 → 작업지시 보내기 → 현장 완료 → 보수 완료 회신 → 접수자에게 알리기 → 처리 이력 · 버리기", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await twoIntakes(page);

  // 메뉴: ‘하자보수’에 본사 할 일 2 · ‘위험 분석·조치’ 배지는 하자를 빼고 센다 (같은 건을 두 번 세지 않게)
  await page.goto("/dashboard");
  await expect(page.getByTestId("nav-defects")).toContainText("2");
  // 처리 대기의 하자 항목 → 하자보수 ‘본사 할 일’ 보기
  await page.getByTestId("pending-defect").click();
  await expect(page).toHaveURL(/\/defects\?view=todo/);
  await expect(page.getByTestId("defect-view-todo")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("defect-row")).toHaveCount(2);

  // 1) 작업지시 보내기 — 요청함으로 가지 않고 이 화면의 창에서
  const row = page.getByTestId("defect-row").filter({ hasText: "3층 302호 거실 창" });
  await expect(row).toHaveAttribute("data-next", "assign");
  await row.getByTestId("defect-order").click();
  const order = page.getByTestId("defect-order-modal");
  await expect(order.locator("#do-title")).toHaveValue("3층 302호 거실 창 — 비가 오면 창틀 아래로 물이 샙니다.");
  await expect(order.getByTestId("defect-order-contact")).toBeChecked();
  await order.getByTestId("defect-order-send").click();
  await expect(order).toHaveCount(0);
  await expect(page).toHaveURL(/\/defects/);
  // ‘본사 할 일’에서는 빠지고, ‘진행 중’에서 현장 보수 중
  await expect(page.getByTestId("defect-row").filter({ hasText: "3층 302호 거실 창" })).toHaveCount(0);
  await page.getByTestId("defect-view-open").click();
  await expect(row).toHaveAttribute("data-next", "repairing");
  await expect(row.getByTestId("defect-open")).toHaveText("작업지시 보기");
  await expect(page.getByTestId("nav-defects")).toContainText("1");

  // 2) 장난 접수는 펼쳐서 버린다 (사진까지 지움)
  const junk = page.getByTestId("defect-row").filter({ hasText: "1층 로비 출입문" });
  await junk.getByTestId("defect-more").click();
  await junk.getByTestId("request-intake-discard").click();
  page.once("dialog", (d) => d.accept());
  await junk.getByTestId("request-intake-discard-spam").click();
  await expect(junk).toHaveCount(0);
  await expect(page.getByTestId("nav-defects")).not.toContainText("1");

  // 3) 현장이 완료(사진)
  await asRole(page, "field");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-actions");
  const wo = page.getByTestId("wo-card").filter({ hasText: "3층 302호 거실 창" });
  await wo.getByTestId("wo-receive").click();
  await wo.getByTestId("wo-complete").click();
  await page.getByTestId("wo-result-chip").first().click();
  await page.getByTestId("wo-photo").setInputFiles({ name: "f.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("wo-finish-send").click();
  await expect(page.getByTestId("wo-finish")).toBeHidden();

  // 4) 본사: 다시 본사 할 일 1 (회신할 것) → 이 화면에서 보수 사진과 함께 회신
  await asRole(page, "ceo");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/defects");
  await expect(page.getByTestId("nav-defects")).toContainText("1");
  await expect(row).toHaveAttribute("data-next", "reply");
  await row.getByTestId("defect-reply").click();
  const reply = page.getByTestId("reply-modal");
  await expect(reply.getByTestId("reply-share-photos").locator("img")).toHaveCount(1);
  await reply.locator("#rp-text").fill("실리콘을 다시 시공했습니다. 물을 뿌려 새는 곳이 없는 것을 확인했습니다.");
  await reply.getByTestId("reply-confirm").click();
  // 회신하면 그 줄은 ‘본사 할 일’에서 빠지므로, 같은 창에서 바로 접수자에게 알린다 (점검 11차)
  await expect(reply.getByTestId("reply-notify")).toBeVisible();
  await expect(reply.getByTestId("intake-notify-message")).toHaveValue(/보수를 마쳤습니다.*\/r\/s\//s);
  await reply.getByTestId("intake-notify-copy").click();
  await expect(reply.getByTestId("intake-notify-status")).toContainText("복사했습니다");
  await reply.getByTestId("reply-done-close").click();
  await expect(reply).toHaveCount(0);
  // 초점은 목록으로 (화면 맨 위로 사라지지 않게)
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName)).not.toBe("BODY");
  await page.getByTestId("defect-view-all").click();
  await expect(row).toHaveAttribute("data-next", "client");
  await expect(row.getByTestId("defect-next")).toHaveText("접수자 확인 대기");

  // 5) 펼치면: 접수자(본사만) · 접수자에게 알리기 · 사진 · 처리 이력(시간순)
  await row.getByTestId("defect-more").click();
  const detail = row.getByTestId("defect-detail");
  await expect(detail.getByTestId("request-intake-who")).toHaveText("관리사무소 홍길동");
  await expect(detail.getByTestId("request-intake")).toHaveAttribute("data-notify", "1");
  await detail.getByTestId("request-intake-notify").click();
  await expect(detail.getByTestId("request-intake-message")).toHaveValue(/보수를 마쳤습니다.*\/r\/s\//s);
  await detail.getByTestId("request-intake-copy").click();
  await expect(detail.getByTestId("request-intake-status")).toContainText("복사했습니다");
  await expect(detail.getByTestId("defect-detail-photos").locator("img")).toHaveCount(1);
  await expect(detail.getByTestId("defect-detail-reply-photos").locator("img")).toHaveCount(1);
  const events = detail.getByTestId("defect-event");
  const labels = (await events.allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
  const order1 = ["링크 접수", "작업지시", "현장 확인", "보수 완료 보고", "회신"].map((l) => labels.findIndex((t) => t.includes(l)));
  expect(order1.every((i) => i >= 0)).toBe(true);
  expect([...order1].sort((a, b) => a - b)).toEqual(order1);
  await expect(detail.getByTestId("defect-timeline")).toContainText("실리콘을 다시 시공했습니다");
  // 이력에 접수자 이름·전화는 다시 적지 않는다
  expect(await detail.getByTestId("defect-timeline").innerText()).not.toMatch(/홍길동|1234-5678/);
});

test("현장 개요의 하자보수 요약 → 그 현장 본사 할 일 · 휴대폰 ‘더보기’ 배지 · 관리대장은 같은 글을 두 번 찍지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await twoIntakes(page);
  // 현장 개요: 하자보수 요약 — 본사 할 일이 있으면 ‘처리하기’
  await page.goto("/sites/site-a");
  const sum = page.getByTestId("site-defects");
  await expect(sum).toContainText("본사 할 일 2건");
  await expect(sum.getByTestId("site-defects-qr")).toContainText("하자 접수 QR 1개 · 접수 2건");
  await sum.getByTestId("site-defects-open").click();
  await expect(page).toHaveURL(/\/defects\?site=site-a&view=todo/);
  await expect(page.getByTestId("defect-site")).toHaveValue("site-a");
  await expect(page.getByTestId("defect-view-todo")).toHaveAttribute("aria-checked", "true");
  // 다른 현장 개요: 하자 없음
  await page.goto("/sites/site-b");
  await expect(page.getByTestId("site-defects")).toContainText("아직 들어온 하자가 없습니다");
  // 관리대장: 링크 접수는 제목이 곧 적은 내용 — 한 번만, ‘보수 완료 · 확인’ 한 칸
  await page.goto("/defects");
  await page.getByTestId("defect-view-ledger").click();
  const led = page.getByTestId("defect-ledger");
  const r = led.getByTestId("defect-ledger-row").filter({ hasText: "3층 302호 거실 창" });
  expect(((await r.innerText()).match(/비가 오면 창틀 아래로 물이 샙니다/g) ?? []).length).toBe(1);
  await expect(led.locator("th")).toContainText(["보수 완료 · 확인"]);
  await expect(led.locator("th", { hasText: "요청자 확인" })).toHaveCount(0);
  // 휴대폰: 아래 메뉴에 없는 하자보수의 할 일은 ‘더보기’에 숫자로 · 전체 메뉴에도
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("bottom-more-badge")).toHaveText(/\d+/);
  const more = Number(await page.getByTestId("bottom-more-badge").innerText());
  expect(more).toBeGreaterThanOrEqual(2);
  await page.getByTestId("bottom-more").click();
  await expect(page.getByTestId("drawer-badge-defects")).toHaveText("2");
  // 현장 직원에게는 하자보수 배지가 없다
  await asRole(page, "field");
  await page.goto("/field");
  await expect(page.getByTestId("drawer-badge-defects")).toHaveCount(0);
});

test("점검 11차: 메뉴로 들어오면 본사 할 일부터 · 주소에 현장·보기 · ‘일부만 끝냈어요’ → 회신해도 ‘남은 보수 확인’ → 보완 요청 · ?req= 로 그 줄 · 관리대장 인쇄 칸 너비", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await twoIntakes(page);
  // 메뉴로 들어오면 본사 할 일이 있을 때 그 보기부터 (배지와 같은 목록)
  await page.goto("/dashboard");
  await page.getByTestId("nav-defects").click();
  await expect(page.getByTestId("defect-view-todo")).toHaveAttribute("aria-checked", "true");
  // 현장을 고르면 주소도 바뀐다 · 새로 고쳐도 같은 화면
  await page.getByTestId("defect-site").selectOption("site-a");
  await expect(page).toHaveURL(/\/defects\?site=site-a&view=todo/);
  await page.reload();
  await expect(page.getByTestId("defect-site")).toHaveValue("site-a");
  await expect(page.getByTestId("defect-view-todo")).toHaveAttribute("aria-checked", "true");
  // 없는 현장 번호는 ‘모든 현장’으로 (선택 칸과 목록이 어긋나지 않게)
  await page.goto("/defects?site=nope&view=all");
  await expect(page.getByTestId("defect-site")).toHaveValue("all");
  await expect(page.getByTestId("defect-row")).not.toHaveCount(0);

  // 작업지시 → 현장이 ‘일부만 끝냈어요’
  await page.goto("/defects?view=todo");
  const row = page.getByTestId("defect-row").filter({ hasText: "1층 로비 출입문" });
  const id = await row.getAttribute("data-id");
  await row.getByTestId("defect-order").click();
  await page.getByTestId("defect-order-send").click();
  await expect(page.getByTestId("defect-order-modal")).toHaveCount(0);
  await asRole(page, "field");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-actions");
  const wo = page.getByTestId("wo-card").filter({ hasText: "1층 로비 출입문" });
  await wo.getByTestId("wo-receive").click();
  await wo.getByTestId("wo-complete").click();
  await page.getByTestId("wo-result-chip").nth(1).click();
  await page.getByTestId("wo-photo").setInputFiles({ name: "f.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("wo-finish-send").click();
  await expect(page.getByTestId("wo-finish")).toBeHidden();

  // 본사: 회신 창은 작업지시 완료 확인을 끈 채 → 회신해도 ‘남은 보수 확인’으로 본사 할 일에 남는다
  await asRole(page, "ceo");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/defects?view=todo");
  await expect(row).toHaveAttribute("data-next", "reply");
  await row.getByTestId("defect-reply").click();
  await expect(page.getByTestId("reply-confirm-wo")).not.toBeChecked();
  await page.locator("#rp-text").fill("1차 보수를 했고 남은 곳은 다음 주에 마무리하겠습니다.");
  await page.getByTestId("reply-confirm").click();
  await page.getByTestId("reply-done-close").click();
  await expect(row).toHaveAttribute("data-next", "check");
  await expect(row.getByTestId("defect-next")).toHaveText("남은 보수 확인");
  // 보완 요청 → 현장 보수 중 (본사 할 일에서 빠짐)
  await row.getByTestId("defect-check").click();
  const ck = page.getByTestId("check-modal");
  await ck.getByTestId("check-return").click();
  await expect(ck).toContainText("다시 할 일을 적어 주세요");
  await ck.getByTestId("check-note").fill("아래쪽 문틀도 마저 조정해 주세요");
  await ck.getByTestId("check-return").click();
  await expect(ck).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await page.getByTestId("defect-view-open").click();
  await expect(row).toHaveAttribute("data-next", "repairing");
  await expect(row.getByTestId("defect-next")).toHaveText("보완 요청 — 다시 보수");

  // ?req= (검색·알림·작업지시 화면에서): 전체 보기에서 그 줄을 펼친다 · 이력에 보완 요청
  await page.goto(`/defects?req=${id}`);
  await expect(page.getByTestId("defect-view-all")).toHaveAttribute("aria-checked", "true");
  await expect(row.getByTestId("defect-detail")).toBeVisible();
  await expect(row.getByTestId("defect-timeline")).toContainText("보완 요청 (다시 보수)");
  await expect(row.getByTestId("defect-timeline")).toContainText("아래쪽 문틀도 마저");
  // 작업지시 화면의 하자 카드도 하자보수로 돌아온다
  await page.goto("/orders");
  const card = page.getByTestId("wo-row").filter({ hasText: "1층 로비 출입문" });
  await expect(card).toContainText("하자보수 · 링크 접수");
  await expect(card.getByTestId("wo-to-request")).toHaveAttribute("href", `/defects?req=${id}`);

  // 관리대장: 인쇄해도 칸 너비가 그대로 (번호 칸이 좁고 내용 칸이 넓다)
  await page.goto("/defects?view=ledger&site=site-a");
  // evaluateAll은 기다리지 않는다 — 표가 그려진 뒤에 잰다
  await expect(page.getByTestId("defect-ledger-row")).not.toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  const widths = await page.getByTestId("defect-ledger-table").locator("thead tr").nth(1).locator("th").evaluateAll((ths) => ths.map((t) => t.getBoundingClientRect().width));
  await page.emulateMedia({ media: "screen" });
  expect(widths[0]).toBeLessThan(widths[2] / 3);
  expect(widths[2]).toBeGreaterThan(widths[4]);
});

test("D-76 하자 일원화: 요청함에는 하자가 없고 안내만 · 옛 요청함 링크는 하자보수의 그 줄로 · 현장 요청 탭에서 바로 · 끝냈다는 보고에 하자보수에서 보완 요청 · 여러 건 버리기는 고른 현장만", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await twoIntakes(page);
  // 요청함: 하자 없음 · 하자보수로 가는 안내 한 줄 (본사 할 일 수) · 견적·주문 같은 고객 요청은 그대로
  await page.goto("/insights#requests");
  const inbox = page.getByTestId("partner-inbox");
  await expect(inbox.getByTestId("partner-request").filter({ hasText: "3층 302호 거실 창" })).toHaveCount(0);
  await expect(inbox.getByTestId("inbox-defects-link")).toContainText("본사 할 일 2건");
  await expect(inbox.getByTestId("partner-request").first()).toBeVisible();
  await expect(inbox.getByTestId("partner-request").filter({ hasText: "하자보수" })).toHaveCount(0);
  // 옛 링크 (/insights?req=하자) → 하자보수의 그 줄을 펼쳐서
  await page.goto("/defects?view=all");
  const row = page.getByTestId("defect-row").filter({ hasText: "3층 302호 거실 창" });
  const id = await row.getAttribute("data-id");
  await page.goto(`/insights?req=${id}#requests`);
  await expect(page).toHaveURL(new RegExp(`/defects\\?req=${id}`));
  await expect(row.getByTestId("defect-detail")).toBeVisible();
  // 현장 상세 요청 탭: 줄을 누르면 처리 화면으로
  await page.goto("/sites/site-a?tab=requests");
  await expect(page.getByTestId("site-request-open").filter({ hasText: "비가 오면 창틀 아래로 물이 샙니다." })).toHaveAttribute("href", `/defects?req=${id}`);

  // 작업지시 → 현장이 ‘지시대로 끝냈어요’ → 본사가 사진을 보고 하자보수에서 바로 보완 요청
  await page.goto("/defects?view=todo");
  await row.getByTestId("defect-order").click();
  await page.getByTestId("defect-order-send").click();
  await expect(page.getByTestId("defect-order-modal")).toHaveCount(0);
  await asRole(page, "field");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-actions");
  const wo = page.getByTestId("wo-card").filter({ hasText: "3층 302호 거실 창" });
  await wo.getByTestId("wo-receive").click();
  await wo.getByTestId("wo-complete").click();
  await page.getByTestId("wo-result-chip").first().click();
  await page.getByTestId("wo-photo").setInputFiles({ name: "f.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("wo-finish-send").click();
  await expect(page.getByTestId("wo-finish")).toBeHidden();
  await asRole(page, "ceo");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/defects?view=todo");
  await expect(row).toHaveAttribute("data-next", "reply");
  await row.getByTestId("defect-more").click();
  await row.getByTestId("defect-detail-return").click();
  const ck = page.getByTestId("check-modal");
  await expect(ck).toContainText("완료 보고 확인");
  await ck.getByTestId("check-note").fill("창틀 아래쪽 실리콘이 덜 채워졌습니다");
  await ck.getByTestId("check-return").click();
  await expect(ck).toHaveCount(0);
  await page.getByTestId("defect-view-open").click();
  await expect(row.getByTestId("defect-next")).toHaveText("보완 요청 — 다시 보수");
  await expect(row.getByTestId("defect-timeline")).toContainText("창틀 아래쪽 실리콘이 덜 채워졌습니다");

  // 여러 건 버리기: 버릴 수 있는 접수가 있는 현장만 단추 · 작업지시를 보낸 건은 고를 수 없다
  await page.getByTestId("defect-site").selectOption("site-b");
  await expect(page.getByTestId("defects-discard")).toHaveCount(0);
  await page.getByTestId("defect-site").selectOption("site-a");
  await page.getByTestId("defects-discard").click();
  const dm = page.getByTestId("discard-modal");
  await expect(dm.getByTestId("discard-pick")).toHaveCount(1);
  await expect(dm).toContainText("1층 로비 출입문");
  await expect(dm).not.toContainText("3층 302호 거실 창");
});
