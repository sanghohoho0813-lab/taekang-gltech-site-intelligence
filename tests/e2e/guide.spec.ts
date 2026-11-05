/**
 * 그림 안내 1장 (D-52) — 사용 안내에서 들어가기, 그림 6개가 실제로 보이고, A4 한 장으로 인쇄, 휴대폰 폭 넘침 없음
 */
import { test, expect, type Page } from "./demoTest";

const PREFS = "tk-site-intel:prefs:v1";
async function start(page: Page, role: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/dashboard");
  await page.evaluate(
    ([pk, r]) => {
      localStorage.clear();
      localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: r, deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 }));
    },
    [PREFS, role] as const,
  );
}

test("현장 직원: 사용 안내 → 그림 안내 1장, 그림 6개가 보이고 휴대폰 폭에 맞다", async ({ page }) => {
  await start(page, "field", 390);
  await page.goto("/help");
  await page.getByTestId("help-quick-link").click();
  await expect(page).toHaveURL(/\/help\/quick$/);
  await expect(page.getByTestId("quick-step")).toHaveCount(6);
  await expect(page.getByTestId("quick-step").first()).toContainText("출근하기");
  const imgs = page.getByTestId("quick-img");
  await expect(imgs).toHaveCount(6);
  for (const el of await imgs.all()) {
    await el.scrollIntoViewIfNeeded();
    await expect.poll(() => el.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  }
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  // 본사 전화가 설정돼 있지 않으면 직접 쓰는 빈칸
  await expect(page.getByTestId("quick-phone")).toContainText("본사로 전화");
  await page.getByTestId("quick-back").click();
  await expect(page).toHaveURL(/\/help$/);
});

test("본사: 그림 안내는 A4 한 장으로 인쇄되고, 검수 확인서는 단계마다 두 장 이내", async ({ page }) => {
  await start(page, "manager", 1280);
  await page.goto("/help/quick");
  await expect(page.getByTestId("quick-step")).toHaveCount(6);
  for (const el of await page.getByTestId("quick-img").all()) await expect.poll(() => el.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  const pages = async () => ((await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } })).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(await pages()).toBe(1); // 브라우저 기본 여백(약 12mm)을 둬도 한 장
  await page.goto("/acceptance");
  for (const s of [1, 2, 3, 4]) {
    await page.getByTestId(`acc-stage-${s}`).click();
    expect(await pages(), `${s}단계`).toBeLessThanOrEqual(2);
  }
});
