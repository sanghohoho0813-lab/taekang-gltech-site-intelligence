/**
 * 검수 확인서 (D-51) — 단계 선택 → 기준·확인 방법·시스템 근거 → 체크·보완 사항 → 인쇄 모양, 금액 없음, 현장 직원 차단
 */
import { test, expect, type Page } from "./demoTest";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";
async function start(page: Page, role: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/dashboard");
  await page.evaluate(
    ([pk, dk, r]) => {
      localStorage.clear();
      localStorage.removeItem(dk);
      localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: r, deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 }));
    },
    [PREFS, DB, role] as const,
  );
}

test("검수 확인서: 단계별 항목·근거 → 체크·보완 사항 → 인쇄 모양, 금액 없음", async ({ page }) => {
  await start(page, "manager", 1440);
  await page.goto("/acceptance");
  const doc = page.getByTestId("acc-doc");
  await expect(doc).toHaveAttribute("data-stage", "1");
  await expect(page.getByTestId("acc-period")).toHaveText("작성일 현재 상태");
  await expect(page.getByTestId("acc-client")).toContainText("태강지엘텍");
  await expect(doc.getByTestId("acc-item")).toHaveCount(4);
  await expect(page.getByTestId("acc-foot")).toContainText("DEMO · 가상 시연 데이터");

  // 2단계: 시나리오 S1·S2·S3·S6 + 실기기 + 위치정보, 기간 입력
  await page.getByTestId("acc-stage-2").click();
  await expect(doc).toHaveAttribute("data-stage", "2");
  await expect(page.getByTestId("acc-stage-title")).toContainText("GPS 근태");
  await expect(doc.getByTestId("acc-item")).toHaveCount(6);
  const s1 = doc.locator('[data-testid="acc-item"][data-key="S1"]');
  await expect(s1).toContainText("출근 기록");
  await expect(s1.locator('[data-has="1"]').first()).toBeVisible();
  // 기간을 아주 옛날로 바꾸면 기록 없음
  await page.getByTestId("acc-from").fill("2025-01-01");
  await page.getByTestId("acc-to").fill("2025-01-31");
  await expect(s1.locator('[data-has="1"]')).toHaveCount(0);
  await expect(page.getByTestId("acc-gaps")).toContainText("S1 출퇴근");
  await page.getByTestId("acc-to").fill("2026-11-04");
  await page.getByTestId("acc-from").fill("2026-10-23");
  await expect(s1.locator('[data-has="1"]').first()).toBeVisible();

  // 체크: 합격 → 다시 누르면 꺼짐, 보완으로 바꾸기
  await s1.getByTestId("acc-pass").click();
  await expect(s1).toHaveAttribute("data-mark", "pass");
  await expect(s1.getByTestId("acc-pass")).toHaveAttribute("aria-checked", "true");
  await s1.getByTestId("acc-pass").click();
  await expect(s1).toHaveAttribute("data-mark", "");
  await s1.getByTestId("acc-fix").click();
  await expect(s1).toHaveAttribute("data-mark", "fix");
  await page.getByTestId("acc-overall-fix").click();
  await page.getByTestId("acc-note").fill("S1 퇴근 누락 2건 정정 후 11/12 다시 확인");

  // 단계를 바꿔도 단계별로 따로 기억 (화면 안에서만)
  await page.getByTestId("acc-stage-3").click();
  await expect(doc.getByTestId("acc-item")).toHaveCount(4);
  await expect(page.getByTestId("acc-note")).toHaveValue("");
  await page.getByTestId("acc-stage-2").click();
  await expect(page.getByTestId("acc-note")).toHaveValue("S1 퇴근 누락 2건 정정 후 11/12 다시 확인");
  await expect(doc.locator('[data-testid="acc-item"][data-key="S1"]')).toHaveAttribute("data-mark", "fix");

  // 금액은 어떤 단계에도 없다
  for (const s of [1, 2, 3, 4]) {
    await page.getByTestId(`acc-stage-${s}`).click();
    const text = (await doc.innerText()).replace(/\s+/g, " ");
    expect(text, `${s}단계`).not.toMatch(/\d[\d,]*\s*(만\s*)?원(?![가-힣])|\d\s*억/);
  }

  // 인쇄 모양: 조작 영역은 숨기고, 보완 사항은 글로, 서명란 2칸
  await page.getByTestId("acc-stage-2").click();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("acc-note")).toBeHidden();
  await expect(page.getByTestId("acc-note-print")).toContainText("S1 퇴근 누락 2건");
  await expect(page.getByTestId("acc-print")).toBeHidden();
  await expect(page.getByTestId("acc-sign")).toContainText("발주자");
  await expect(page.getByTestId("acc-sign")).toContainText("수행사");
  await expect(page.getByTestId("acc-sign")).toContainText("(서명 또는 인)");
  await page.emulateMedia({ media: "screen" });
});

test("검수 확인서: 4단계 시연에서는 앱 오류를 ‘오류·의견’ 화면에서 확인하도록 안내 · 휴대폰 폭 넘침 없음 · 현장 직원은 못 봄", async ({ page }) => {
  await start(page, "ceo", 390);
  await page.goto("/acceptance");
  await page.getByTestId("acc-stage-4").click();
  const fb = page.locator('[data-testid="acc-item"][data-key="feedback"]');
  await expect(fb).toContainText("‘오류·의견’ 화면");
  for (const s of [1, 2, 3, 4]) {
    await page.getByTestId(`acc-stage-${s}`).click();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${s}단계 390px`).toBeLessThanOrEqual(1);
  }
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "field" })), [PREFS] as const);
  await page.goto("/acceptance");
  await expect(page.getByTestId("access-denied")).toBeVisible();
});
