/**
 * 휴대폰 점검 (D-46) — 현장: 내 정보 → 점검 → 사진 한 장 → 결과·고치는 방법 → 본사로 보내기 / 본사: 사용 현황에 표시
 */
import { test, expect, type Page } from "@playwright/test";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";
const A = { latitude: 37.2638, longitude: 127.0289 };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function start(page: Page, role: string) {
  await page.setViewportSize({ width: 390, height: 844 });
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

test("휴대폰 점검: 자동 확인 → 사진 → 결과·안내 → 본사로 보내기 → 사용 현황에 표시", async ({ page }) => {
  await start(page, "field");
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ ...A, accuracy: 18 });
  await page.goto("/my");
  await expect(page.getByTestId("my-device-check")).toContainText("1분이면 끝나요");
  await page.getByTestId("my-device-check").click();
  await expect(page).toHaveURL(/\/field\/check$/);
  await page.getByTestId("device-start").click();
  const item = (k: string) => page.locator(`[data-testid="device-item"][data-key="${k}"]`);
  await expect(item("network")).toHaveAttribute("data-status", "ok");
  await expect(item("location")).toHaveAttribute("data-status", "ok");
  await expect(item("location")).toContainText("정확도 약 18m");
  await expect(item("storage")).toHaveAttribute("data-status", "ok");
  await expect(item("push")).toHaveAttribute("data-status", "skip"); // DEMO에는 알림 없음
  // 홈 화면 앱으로 열지 않았으므로 안내가 보인다
  await expect(item("home")).toHaveAttribute("data-status", "warn");
  await expect(item("home")).toContainText("홈 화면에 추가");
  // 사진 한 장
  await page.getByTestId("device-photo-input").setInputFiles({ name: "test.png", mimeType: "image/png", buffer: PNG });
  await expect(item("photo")).toHaveAttribute("data-status", "ok");
  await expect(page.getByTestId("device-result")).toHaveAttribute("data-verdict", "warn");
  await page.getByTestId("device-send").click();
  await expect(page.getByTestId("device-sent")).toContainText("확인 권장");
  await page.goto("/my");
  await expect(page.getByTestId("my-device-check")).toContainText("마지막 확인 권장");

  // 본사: 사용 현황에 휴대폰 점검 결과 (위치 좌표 없음)
  await page.evaluate(([pk]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: "manager" })), [PREFS] as const);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/usage");
  const choi = page.locator('[data-testid="usage-user"][data-user="u-field"]').getByTestId("usage-device");
  await expect(choi).toHaveAttribute("data-verdict", "warn");
  await expect(choi).toContainText("홈 화면 아이콘");
  await expect(page.locator('[data-testid="usage-user"][data-user="u-field2"]').getByTestId("usage-device")).toHaveAttribute("data-verdict", "none");
});

test("휴대폰 점검: 위치가 막혀 있으면 ‘고쳐야 해요’와 설정 방법", async ({ page }) => {
  await start(page, "field");
  await page.context().clearPermissions();
  await page.goto("/field/check");
  await page.getByTestId("device-start").click();
  const loc = page.locator('[data-testid="device-item"][data-key="location"]');
  await expect(loc).toHaveAttribute("data-status", /fail|warn/, { timeout: 20_000 });
  await page.getByTestId("device-photo-skip").click();
  await expect(page.locator('[data-testid="device-item"][data-key="photo"]')).toHaveAttribute("data-status", "skip");
  await expect(loc).toContainText(/위치가 막혀|위치가 정확하지/);
});
