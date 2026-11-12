/** D-68: 하자보수 요청 한 바퀴(발주처 사진 → 본사 작업지시 → 현장 완료 → 보수 사진 회신 → 발주처 확인) · 월간 공정 보고서 · 오늘 출근 현장 */
import { test, expect, type Page } from "./demoTest";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";
// 2×2 PNG (사진 고르기 시험용)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");

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
const asRole = (page: Page, role: string) => page.evaluate(([pk, r]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: r })), [PREFS, role] as const);

test("하자보수: 발주처 사진 첨부 → 본사 작업지시 → 현장 완료 사진 → 보수 사진 회신 → 발주처 확인 → 월간 보고서", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await freshStart(page, { role: "partner" });
  // 1) 발주처: 하자보수 요청 (위치 필수 · 사진 1장)
  await page.goto("/partner#request");
  await page.getByTestId("p-type").selectOption("defect");
  await page.locator("#p-title").fill("3층 거실 창 누수");
  await page.locator("#p-desc").fill("비 올 때 창틀 아래로 물이 샙니다.");
  await page.getByTestId("partner-submit").click();
  await expect(page.getByText("하자가 있는 곳을 적어주세요.", { exact: false })).toBeVisible();
  await page.getByTestId("p-location").fill("3층 302호 거실 창");
  await page.getByTestId("p-photo").setInputFiles({ name: "leak.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("p-photos").locator("img")).toHaveCount(1);
  await page.getByTestId("partner-submit").click();
  await expect(page.getByTestId("partner-sent")).toBeVisible();
  const mine = page.getByTestId("partner-request-item").filter({ hasText: "3층 거실 창 누수" });
  await expect(mine).toHaveAttribute("data-type", "defect");
  await expect(mine.getByTestId("partner-request-location")).toContainText("3층 302호 거실 창");
  await expect(mine.getByTestId("partner-request-photos").locator("img")).toHaveCount(1);

  // 2) 본사: 요청함에서 작업지시로 보내기
  await asRole(page, "ceo");
  await page.goto("/insights#requests");
  const req = page.getByTestId("partner-request").filter({ hasText: "3층 거실 창 누수" });
  await expect(req.getByTestId("request-photos").locator("img")).toHaveCount(1);
  await req.getByTestId("request-to-order").click();
  await expect(page.getByTestId("defect-order-modal")).toBeVisible();
  await page.getByTestId("defect-order-send").click();
  await expect(req.getByTestId("request-wo")).toHaveAttribute("data-wo-status", "sent");
  await expect(req).toHaveAttribute("data-status", "reviewing");

  // 3) 현장: 작업지시 카드에 ‘하자보수’와 발주처 사진 → 다 했어요 (사진)
  await asRole(page, "field");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-actions");
  const card = page.getByTestId("wo-card").filter({ hasText: "3층 거실 창 누수" });
  await expect(card).toContainText("하자보수");
  await expect(card.getByTestId("wo-ref-photos").locator("img")).toHaveCount(1);
  await card.getByTestId("wo-receive").click();
  await card.getByTestId("wo-complete").click();
  await page.getByTestId("wo-result-chip").first().click();
  await page.getByTestId("wo-photo").setInputFiles({ name: "fixed.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("wo-finish-send").click();
  // 다 한 지시는 할 일 목록에서 빠진다 (완료 보고 → 본사 확인 대기)
  await expect(page.getByTestId("wo-finish")).toBeHidden();
  await expect(card.and(page.locator('[data-status="received"]'))).toHaveCount(0);

  // 4) 본사: 보수 완료 사진과 함께 회신
  await asRole(page, "ceo");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/insights#requests");
  await req.getByTestId("request-wo").waitFor();
  await expect(req.getByTestId("request-wo")).toHaveAttribute("data-wo-status", "done");
  await req.getByTestId("request-reply").click();
  await expect(page.getByTestId("reply-share-photos").locator("img")).toHaveCount(1);
  await page.locator("#rp-text").fill("보수를 마쳤습니다. 물을 뿌려 새는 곳이 없는 것을 확인했습니다.");
  await page.getByTestId("reply-confirm").click();
  await expect(req).toHaveAttribute("data-status", "answered");
  await expect(req.getByTestId("request-reply-photos").locator("img")).toHaveCount(1);

  // 5) 발주처: 보수 완료 · 보수 사진 · ‘보수 확인했어요’ — 보수 사진은 ‘공정 사진’에는 넣지 않는다
  await asRole(page, "partner");
  await page.goto("/partner#my-requests");
  await expect(mine.getByTestId("partner-repair")).toHaveAttribute("data-stage", "done");
  await expect(mine.getByTestId("partner-reply-photos").locator("img")).toHaveCount(1);
  await expect(page.getByTestId("partner-photo")).toHaveCount(0);
  await mine.getByTestId("partner-confirm").click();
  await expect(mine.getByTestId("partner-confirmed")).toBeVisible();
  await expect(mine.getByTestId("partner-confirm")).toHaveCount(0);

  // 6) 월간 보고서: 금액 없이, 하자보수 ‘확인 완료’
  await page.getByTestId("partner-report-link").click();
  await expect(page).toHaveURL(/\/partner\/report/);
  const body = page.getByTestId("report-body");
  await expect(body.getByTestId("report-request").filter({ hasText: "3층 거실 창 누수" })).toContainText("확인 완료");
  await expect(body.getByTestId("report-stage-row").first()).toBeVisible();
  expect((await body.innerText()).replace(/\s+/g, " ")).not.toMatch(/\d+(\.\d+)?억|\d[\d,]*만 원|이익률|원가/);
  await page.getByTestId("report-month-1").click();
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
  await expect(body.getByTestId("report-request").filter({ hasText: "3층 거실 창 누수" })).toHaveCount(0);

  // 7) 본사 요청함: 발주처 확인 완료
  await asRole(page, "ceo");
  await page.goto("/insights#requests");
  // 요청함은 ‘처리할 것’만 먼저 보여 준다 (D-74) — 끝난 요청은 ‘전체’에서
  await page.getByTestId("inbox-show-all").click();
  await expect(req.getByTestId("request-confirmed")).toBeVisible();
});

test("월간 보고서는 현장직원에게 보이지 않고, 본사는 미리보기로 본다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await freshStart(page, { role: "field" });
  await page.goto("/partner/report");
  await expect(page.getByTestId("access-denied")).toBeVisible();
  await asRole(page, "ceo");
  await page.goto("/partner/report");
  await expect(page.getByTestId("report-body")).toContainText("월간 공정 보고서");
  await expect(page.getByTestId("report-print")).toBeVisible();
});

test("두 현장 담당: 오늘 출근한 현장이 맨 위에 ‘오늘 출근’으로", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page, { role: "field" });
  await page.goto("/field");
  await expect(page.getByTestId("bottom-nav")).toBeVisible();
  // 오늘 B현장에 출근한 기록을 넣는다 (시연판 저장소)
  await page.evaluate((dk) => {
    const db = JSON.parse(localStorage.getItem(dk)!);
    const t = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    db.attendance = [...(db.attendance ?? []), { id: "att-e2e-b", siteId: "site-b", userId: "u-field", workDate: t, inAt: new Date().toISOString(), inGeo: { status: "inside", lat: 37.5, lng: 127, accuracyM: 10, distanceM: 20 }, inDevice: "dev-e2e" }];
    localStorage.setItem(dk, JSON.stringify(db));
  }, DB);
  await page.goto("/field/report");
  const sites = page.locator('[data-testid^="easy-site-"]');
  await expect(sites.first()).toHaveAttribute("data-testid", "easy-site-site-b");
  await expect(sites.first().getByTestId("site-checked-in")).toHaveText("오늘 출근");
  await expect(page.getByTestId("easy-site-site-a").getByTestId("site-checked-in")).toHaveCount(0);
});
