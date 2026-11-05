/**
 * 현장 직원 그림 안내(/help/quick)에 쓰는 휴대폰 화면 그림을 다시 찍는다 (D-52).
 *
 *   1) 시연(DEMO) 서버 켜기:  npm run build && npx next start -p 3100
 *   2) 찍기:                 npm run guide:shots            (다른 주소: npm run guide:shots -- http://127.0.0.1:3000)
 *
 * - 시연 가상 데이터·고정 시각(한국 2026-11-04 수 12:00)·현장 직원(최성민)으로 찍는다 — 실제 이름·현장이 아니다.
 * - 화면 이름이 바뀌면 다시 찍고, src/lib/help/quick.ts 설명도 함께 고친다.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = (process.argv[2] ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const OUT = fileURLToPath(new URL("../public/guide/", import.meta.url));
const NOW = new Date("2026-11-04T03:00:00Z");
const SITE_A = { latitude: 37.2638, longitude: 127.0289, accuracy: 15 }; // 가상 A현장 안

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "ko-KR",
  timezoneId: "Asia/Seoul",
  geolocation: SITE_A,
  permissions: ["geolocation"],
});
const page = await ctx.newPage();
await page.clock.install({ time: NOW });
await page.goto(`${BASE}/dashboard`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem(
    "tk-site-intel:prefs:v1",
    JSON.stringify({ theme: "onyx-gold", fontScale: "md", reduceMotion: true, role: "field", deviceView: "pc", mobilePersona: "same", tutorialDone: true, viewRev: 2 }),
  );
});

// 화면 아래 고정 메뉴·위 머리글이 버튼을 가리지 않게 가운데로 옮겨서 찍는다 (머리글 버튼은 그대로)
const shot = async (testId, file) => {
  const el = page.getByTestId(testId).first();
  await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  const covered = await el.evaluate((e) => {
    const r = e.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && !e.contains(top);
  });
  if (covered) throw new Error(`${file}: 찍을 곳이 다른 화면 요소에 가려져 있습니다`);
  await el.screenshot({ path: OUT + file, type: "jpeg", quality: 82, animations: "disabled" });
  console.log("찍음", file);
};

await page.goto(`${BASE}/field`);
await page.getByTestId("att-in").waitFor();
await page.waitForTimeout(400);
await shot("font-toggle", "00-font.jpg");
await shot("att-card", "01-checkin.jpg");
await shot("easy-go-crew", "02-crew.jpg");
await shot("easy-go-actions", "03-actions.jpg");
await shot("easy-go-report", "04-report.jpg");
await shot("att-fix-link", "06-fix.jpg");

// 출근(위치 동의) → ‘퇴근하기’가 보이는 모습
await page.getByTestId("att-in").click();
await page.getByTestId("att-consent-yes").click();
await page.getByTestId("att-out").waitFor();
await page.waitForTimeout(300);
await shot("att-card", "05-checkout.jpg");

await browser.close();
console.log(`완료 → ${OUT}`);
