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
  page.once("dialog", (d) => d.accept());
  await junk.getByTestId("request-intake-discard").selectOption("spam");
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
  await expect(reply).toHaveCount(0);
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
