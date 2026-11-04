/**
 * 개인위치정보 (D-43) — 대표가 규칙을 정함 → 관리자 화면에는 좌표(지도) 없음 → 직원 동의 화면에 같은 조건 →
 * 직원이 ‘내 위치 기록’에서 보고 그만두기 → 본사 동의 현황 반영
 */
import { test, expect, type Page } from "@playwright/test";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";
const A = { latitude: 37.2638, longitude: 127.0289 }; // 가상 A현장 중심에서 약 35m
const PERSON_MAP = `a[href*="${encodeURIComponent("누른 위치")}"]`;

async function start(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await page.evaluate(
    ([pk, dk]) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.removeItem(dk);
      localStorage.setItem(pk, JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: "ceo", deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 }));
    },
    [PREFS, DB] as const,
  );
}
const asRole = (page: Page, role: string) => page.evaluate(([pk, r]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: r })), [PREFS, role] as const);

test("개인위치정보: 대표 규칙 → 관리자 지도 숨김 → 직원 동의 조건 → 내 위치 기록에서 그만두기 → 본사 현황", async ({ page }) => {
  await start(page);
  await page.goto("/settings"); // DEMO: 설정 화면 · LIVE: 운영 관리 → 개인위치정보
  const box = page.getByTestId("admin-privacy");
  await expect(box).toContainText("보관 기간이 정해지지 않았습니다");
  // 대표: 1년 · 대표만
  await page.getByTestId("privacy-days").selectOption("365");
  await page.getByTestId("privacy-viewers-ceo").check({ force: true });
  await page.getByTestId("privacy-save").click();
  await expect(box).not.toContainText("보관 기간이 정해지지 않았습니다");
  await expect(page.getByTestId("privacy-notice")).toContainText("1년이 지나면 좌표를 자동으로 지웁니다");
  await expect(page.getByTestId("privacy-notice")).toContainText("회사 본사(대표만)");
  await expect(page.getByTestId("privacy-count")).not.toContainText("0건");
  // 최성민은 예전 문구(1판)로 동의 → ‘다시 동의 필요’
  await expect(page.locator('[data-testid="privacy-person"][data-user="u-field"]')).toContainText("다시 동의 필요");
  // 대표는 출퇴근 현황에서 직원 위치 지도 링크를 본다
  await page.goto("/attendance");
  await expect(page.locator(PERSON_MAP).first()).toBeVisible();

  // 관리자: 지도 링크 없음 · 규칙 변경 불가
  await asRole(page, "manager");
  await page.goto("/attendance");
  await expect(page.getByTestId("att-flag-outside")).toContainText("정우진");
  await expect(page.locator(PERSON_MAP)).toHaveCount(0);
  await page.goto("/settings"); // DEMO: 설정 화면 · LIVE: 운영 관리 → 개인위치정보
  await expect(page.getByTestId("admin-privacy")).toContainText("대표만 바꿀 수 있음");
  await expect(page.getByTestId("privacy-save")).toHaveCount(0);
  await expect(page.getByTestId("privacy-stats")).toHaveCount(0);

  // 현장 직원: 동의 화면에 회사가 정한 조건 그대로 → 동의하고 출근
  await asRole(page, "field");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ ...A, accuracy: 15 });
  await page.goto("/field");
  await page.getByTestId("att-in").click();
  await expect(page.getByTestId("att-card")).toContainText("회사가 위치 기록 조건을 바꿔서 다시 여쭤봐요");
  await expect(page.getByTestId("att-consent-notice")).toContainText("1년이 지나면 좌표를 자동으로 지웁니다");
  await expect(page.getByTestId("att-consent-notice")).toContainText("대표만");
  await page.getByTestId("att-consent-yes").click();
  await expect(page.getByTestId("att-result")).toContainText("출근 기록 완료");

  // 내 정보 → 내 위치 기록
  await page.goto("/my");
  const mine = page.getByTestId("my-location");
  await expect(page.getByTestId("my-location-state")).toHaveAttribute("data-state", "agreed");
  await expect(mine).toContainText("1년 지나면 좌표 자동 삭제");
  await expect(mine).toContainText("본사 대표만, 그리고 나");
  await expect(page.getByTestId("my-location-row").first()).toContainText("출근 · A현장");
  await expect(mine.getByRole("link", { name: "지도" }).first()).toBeVisible();
  await page.getByTestId("my-location-withdraw").click();
  await page.getByTestId("my-location-withdraw-yes").click();
  await expect(page.getByTestId("my-location-msg")).toContainText("위치 기록을 그만뒀어요");
  await expect(page.getByTestId("my-location-state")).toHaveAttribute("data-state", "none");
  await expect(mine.getByRole("link", { name: "지도" })).toHaveCount(0);
  await expect(page.getByTestId("my-location-row").first()).toContainText("좌표 지움");

  // 본사(대표): 최성민 ‘동의 안 함’, 좌표 0건 / 정우진은 그대로 → 퇴사 처리로 좌표 지우기
  await asRole(page, "ceo");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings"); // DEMO: 설정 화면 · LIVE: 운영 관리 → 개인위치정보
  const choi = page.locator('[data-testid="privacy-person"][data-user="u-field"]');
  await expect(choi).toContainText("동의 안 함");
  await expect(choi).toContainText("좌표 0건");
  const jung = page.locator('[data-testid="privacy-person"][data-user="u-field2"]');
  await expect(jung).toContainText("동의");
  await jung.getByTestId("privacy-erase").click();
  await jung.getByTestId("privacy-erase-reason").fill("퇴사");
  await jung.getByTestId("privacy-erase-yes").click();
  await expect(jung).toContainText("좌표 0건");
  // 활동 이력에 남음
  await page.goto("/audit");
  const rows = page.locator('[data-testid="audit-row"][data-type="privacy"]');
  await expect(rows.filter({ hasText: "퇴사" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "동의 철회" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "개인위치정보 규칙 변경" })).toHaveCount(1);
});
