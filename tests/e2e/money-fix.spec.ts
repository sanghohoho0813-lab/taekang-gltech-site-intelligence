/** D-89: 돈 기록 바로잡기 — 입금과 함께 유보금 · 유보금 나눠 받음 · 잘못 넣은 입금 취소(이유) · 공제(지체상금) 등록·취소 · 휴대폰 폭 */
import { test, expect, type Page } from "./demoTest";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";

async function freshStart(page: Page, role = "ceo") {
  await page.goto("/dashboard");
  await page.evaluate(
    ([pk, dk, r]) => {
      localStorage.removeItem(dk);
      sessionStorage.clear();
      localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: r, deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 }));
    },
    [PREFS, DB, role] as const,
  );
}

/** ‘1억 2,345만’ 같은 금액 글을 원으로 */
function wonOf(text: string): number {
  const eok = /([\d.,]+)\s*억/.exec(text);
  const man = /([\d,]+)\s*만/.exec(text.replace(/[\d.,]+\s*억/, ""));
  return Math.round((eok ? Number(eok[1].replace(/,/g, "")) * 100_000_000 : 0) + (man ? Number(man[1].replace(/,/g, "")) * 10_000 : 0));
}

test("D-89 입금 + 유보금 → 유보금 나눠 받음 → 잘못 넣은 입금 취소(이유) → 공제 등록·취소", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, "manager");
  // 기성 1억을 먼저 넣는다 (A현장)
  await page.goto("/finance");
  await page.getByRole("button", { name: "기성청구 등록" }).click();
  await page.locator("#m-site").selectOption("site-a");
  await page.locator("#m-amt").fill("100000000");
  await page.getByRole("button", { name: "등록", exact: true }).click();
  await expect(page.locator("#m-amt")).toHaveCount(0);

  // 입금 9,500만 + 유보금 500만 (받을 날 비움)
  await page.getByRole("button", { name: "입금 등록" }).click();
  await page.locator("#m-site").selectOption("site-a");
  await page.locator("#m-amt").fill("95000000");
  await page.getByTestId("pay-withheld").getByText("유보금 (나중에 받음)").click();
  await page.getByTestId("pay-withheld-amount").fill("5000000");
  await expect(page.getByTestId("pay-withheld")).toContainText("그중 유보금 500만");
  await page.getByTestId("pay-withheld-note").fill("하자보수 유보 5%");
  await page.getByRole("button", { name: "등록", exact: true }).click();
  await expect(page.locator("#m-amt")).toHaveCount(0);
  const card = page.getByTestId("withheld-card");
  await expect(card.getByTestId("withheld-row").filter({ hasText: "A현장" })).toContainText("500만");
  await expect(page.getByTestId("fin-total-outstanding")).toContainText("그중 유보금");
  await expect(page.getByTestId("payment-row").filter({ hasText: "유보금 500만 원 떼고 받음" })).toHaveCount(1);

  // 유보금 200만만 먼저 받음 → 남은 300만
  await card.getByTestId("withheld-release").first().click();
  const rel = page.getByTestId("release-modal");
  await rel.getByTestId("release-amount").fill("2000000");
  await expect(rel).toContainText("남은 유보금 300만");
  await rel.getByTestId("release-confirm").click();
  await expect(rel).toHaveCount(0);
  await expect(card.getByTestId("withheld-row").filter({ hasText: "A현장" })).toContainText("300만");
  await expect(page.getByTestId("payment-row").filter({ hasText: "유보금 받음" })).toHaveCount(1);

  // 잘못 넣은 입금 취소 — 이유 없으면 막힘 · 미수금이 돌아온다
  const before = wonOf(await page.getByTestId("fin-total-outstanding").innerText());
  const wrong = page.getByTestId("payment-row").filter({ hasText: "9,500만" }).first();
  await wrong.getByTestId("money-void").click();
  const vm = page.getByTestId("money-void-modal");
  await vm.getByTestId("money-void-confirm").click();
  await expect(vm).toContainText("이유");
  await vm.getByTestId("money-void-reason").fill("다른 현장 입금을 잘못 넣음");
  await vm.getByTestId("money-void-confirm").click();
  await expect(vm).toHaveCount(0);
  const after = wonOf(await page.getByTestId("fin-total-outstanding").innerText());
  expect(Math.abs(after - before - 95_000_000)).toBeLessThan(1_000_000);
  await page.getByTestId("voided-toggle-payment").click();
  await expect(page.getByTestId("voided-list-payment")).toContainText("다른 현장 입금을 잘못 넣음");

  // 공제(지체상금) 따로 등록 → 공제 목록 · 미수금 카드에 ‘발주처 공제’ → 취소하면 사라짐
  await card.getByTestId("withheld-add").click();
  const am = page.getByTestId("withheld-modal");
  await am.getByTestId("withheld-site").selectOption("site-a");
  await am.getByTestId("pay-withheld-type").selectOption("delay_penalty");
  await am.getByTestId("pay-withheld-amount").fill("3000000");
  await am.getByTestId("withheld-confirm").click();
  await expect(am).toContainText("공제 사유");
  await am.getByTestId("pay-withheld-note").fill("공기 지연 6일 — 원청 공문 11/10");
  await am.getByTestId("withheld-confirm").click();
  await expect(am).toHaveCount(0);
  const ded = card.getByTestId("withheld-deductions");
  await expect(ded).toContainText("지체상금");
  await expect(ded).toContainText("300만");
  await expect(page.getByTestId("fin-total-outstanding")).toContainText("발주처 공제");
  await ded.getByTestId("withheld-void").click();
  const wv = page.getByTestId("withheld-void-modal");
  await wv.getByTestId("withheld-void-reason").fill("발주처가 지체상금을 면제함");
  await wv.getByTestId("withheld-void-confirm").click();
  await expect(wv).toHaveCount(0);
  await expect(card.getByTestId("withheld-deductions")).toHaveCount(0);
  await expect(page.getByTestId("fin-total-outstanding")).not.toContainText("발주처 공제");
});

test("D-89 휴대폰 폭: 기성·수금 화면(유보금·공제 카드·입금 창)이 가로로 넘치지 않음", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await freshStart(page, "manager");
  await page.goto("/finance");
  await page.getByRole("button", { name: "입금 등록" }).click();
  await page.getByTestId("pay-withheld").getByText("공제 (받지 못함)").click();
  await expect(page.getByTestId("pay-withheld-type")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByTestId("withheld-card").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
