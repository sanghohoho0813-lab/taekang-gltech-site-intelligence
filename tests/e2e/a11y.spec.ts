/**
 * 접근성 자동 점검 (WCAG 2.1 A·AA, axe-core) — 현장 직원(60~70대) 화면과 본사·발주처 주요 화면 (D-40)
 * 글자 대비·버튼 이름·입력 이름표·제목 순서 등. 위반이 하나라도 있으면 실패한다.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";

async function start(page: Page, role: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/dashboard");
  await page.evaluate(
    ([pk, dk, r]) => {
      localStorage.removeItem(dk);
      localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: r, deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 }));
    },
    [PREFS, DB, role] as const,
  );
}

async function scan(page: Page, route: string) {
  await page.goto(route);
  await page.waitForTimeout(500);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.map((v) => `${route} · ${v.id} (${v.impact}) × ${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

const CASES: { role: string; width: number; routes: string[] }[] = [
  { role: "field", width: 390, routes: ["/field", "/field/report", "/field/crew", "/field/fix", "/field/check", "/my", "/my-actions", "/help"] },
  { role: "ceo", width: 1440, routes: ["/dashboard", "/sites/site-a", "/daily", "/photos", "/labor", "/usage", "/data", "/audit", "/attendance", "/orders", "/schedule", "/insights", "/finance", "/report", "/settings", "/quality", "/help"] },
  { role: "partner", width: 1280, routes: ["/partner", "/help"] },
];

for (const c of CASES) {
  test(`접근성 (WCAG 2.1 AA) — ${c.role} 화면 ${c.routes.length}개`, async ({ page }) => {
    await start(page, c.role, c.width);
    const all: string[] = [];
    for (const r of c.routes) all.push(...(await scan(page, r)));
    expect(all, all.join("\n")).toEqual([]);
  });
}

test("현장 직원 화면: 누르는 것은 모두 손가락 크기(높이·너비 44px 이상)", async ({ page }) => {
  await start(page, "field", 390);
  const small: string[] = [];
  for (const r of ["/field", "/field/report", "/field/crew", "/field/fix", "/field/check", "/my", "/my-actions", "/help"]) {
    await page.goto(r);
    await page.waitForTimeout(400);
    const found = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main a, main button, main [role=radio], main input:not([type=hidden]):not(.sr-only), main select, header a, header button, nav a")]
        .filter((el) => {
          const s = getComputedStyle(el);
          const b = el.getBoundingClientRect();
          return s.visibility !== "hidden" && s.display !== "none" && b.width > 0 && b.height > 0 && !el.closest("[data-demo-bar], .sr-only");
        })
        .map((el) => ({ t: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 24), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
        .filter((x) => x.h < 44 || x.w < 44),
    );
    small.push(...found.map((f) => `${r} · ${f.t} (${f.w}×${f.h})`));
  }
  expect(small, small.join("\n")).toEqual([]);
});
