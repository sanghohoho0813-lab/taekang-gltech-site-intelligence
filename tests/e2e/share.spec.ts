/**
 * D-73: 보고서 링크 — 본사가 월간 공정 보고서·준공 보고서를 ‘로그인 없이 여는 읽기 전용 주소’로 만들어 보낸다.
 * 시연판(DEMO)은 서버가 없어 같은 브라우저에서 연다 (실제 서버 경로는 tests/e2e-live 에서).
 */
import { test, expect, type Page } from "./demoTest";

const PREFS = "tk-site-intel:prefs:v1";
const DB = "tk-site-intel:db:v1";
const MONEY = /\d[\d,]*\s*(만\s*)?원(?![가-힣])|\d\s*억/;

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
const asRole = (page: Page, role: string) => page.evaluate(([pk, r]) => localStorage.setItem(pk, JSON.stringify({ ...JSON.parse(localStorage.getItem(pk)!), role: r })), [PREFS, role] as const);

async function makeLink(page: Page, days?: 7 | 14 | 30): Promise<string> {
  await page.getByTestId("share-open").click();
  await expect(page.getByTestId("share-scope")).toContainText("안 들어감");
  if (days) await page.getByTestId(`share-days-${days}`).click();
  await page.getByTestId("share-create").click();
  const url = await page.getByTestId("share-url").inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{32}$/);
  return url;
}

test("월간 보고서 링크: 만들기 → 주소·보낼 글 복사 → 로그인 없는 읽기 전용 화면(금액·요청 내용 없음) → 열어 본 횟수 → 사진 공개를 끄면 빠짐 → 닫으면 안 열림", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  // 이번 달 사진 2장을 발주처 공개
  await page.goto("/photos");
  await page.getByTestId("ledger-sample").click();
  await page.getByTestId("ledger-share").nth(4).click();
  await page.getByTestId("ledger-share").nth(5).click();
  await expect(page.getByTestId("ledger-shared-count")).toContainText("발주처 공개 2장");

  await page.goto("/partner/report");
  const shown = await page.getByTestId("report-photo").count();
  expect(shown).toBeGreaterThan(0);
  const url = await makeLink(page, 7);
  // 보낼 글: 회사·보고서 이름·주소 — 금액 없음
  const msg = await page.getByTestId("share-message").inputValue();
  expect(msg).toContain("A현장 11월 공정 보고서입니다");
  expect(msg).toContain(url);
  expect(msg).toContain("로그인 없음");
  expect(msg).not.toMatch(MONEY);
  await expect(page.getByTestId("share-demo-note")).toBeVisible();
  // 주소를 복사하기 전에는 실수로 닫히지 않는다 (Esc·닫기 → 한 번 더 물음) — 주소는 다시 볼 수 없으므로
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("share-url")).toBeVisible();
  page.once("dialog", (d) => {
    expect(d.message()).toContain("아직 복사하지 않았습니다");
    void d.dismiss();
  });
  await page.getByTestId("share-done").click();
  await expect(page.getByTestId("share-url")).toHaveValue(url);
  await page.getByTestId("share-copy").click();
  await expect(page.getByTestId("share-copy")).toContainText("복사됨");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await page.getByTestId("share-copy-message").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(msg);
  await page.getByTestId("share-done").click();
  await expect(page.getByTestId("share-dialog")).toHaveCount(0);
  // 저장된 데이터에 주소의 비밀값이 없다 (해시만)
  const token = url.split("/s/")[1];
  expect(await page.evaluate((dk) => localStorage.getItem(dk)!, DB)).not.toContain(token);

  // 로그인 없는 화면: 메뉴·시연 막대 없이 문서만
  await page.goto(url);
  const share = page.getByTestId("share-page");
  await expect(share).toHaveAttribute("data-state", "open");
  await expect(share).toHaveAttribute("data-kind", "monthly");
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await expect(page.getByTestId("demo-bar")).toHaveCount(0);
  await expect(page.getByTestId("share-company")).toHaveText("(주)태강지엘텍");
  await expect(page.getByTestId("share-note")).toContainText("읽기 전용");
  await expect(page.getByTestId("report-body")).toContainText("월간 공정 보고서");
  await expect(page.getByTestId("report-asof")).toContainText("작성일");
  await expect(page.getByTestId("report-kpi-progress")).toContainText("작성일 기준");
  await expect(page.getByTestId("report-photo")).toHaveCount(shown);
  // 요청은 건수만 — 제목·글 없음
  await expect(page.getByTestId("report-request-counts")).toBeVisible();
  await expect(page.getByTestId("report-requests")).toHaveCount(0);
  const text = (await share.innerText()).replace(/\s+/g, " ");
  expect(text).not.toMatch(MONEY);
  expect(text).not.toContain("견적 문의");
  expect(text).not.toContain("최성민");
  await expect(page).toHaveTitle(/A현장 11월 공정 보고서/);
  // 휴대폰 폭 넘침 없음
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(share).toHaveAttribute("data-state", "open");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 현장 상세: 보낸 링크 1개 · 한 번 열어 봄 (30분 안에 다시 열어도 한 번)
  await page.goto("/sites/site-a?tab=requests");
  const row = page.getByTestId("shares-card").getByTestId("share-row");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-state", "open");
  await expect(row).toContainText("A현장 11월 공정 보고서");
  await expect(row.getByTestId("share-views")).toContainText("1번 열어 봄");

  // 사진 공개를 끄면 링크에서도 바로 빠진다
  await page.goto("/photos");
  await page.getByTestId("ledger-share").nth(4).click();
  await expect(page.getByTestId("ledger-shared-count")).toContainText("발주처 공개 1장");
  await page.goto(url);
  await expect(page.getByTestId("report-photo")).toHaveCount(shown - 1);
  await expect(page.getByTestId("share-hidden-photos")).toContainText("1장");

  // 닫으면 바로 안 열린다
  await page.goto("/sites/site-a?tab=requests");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("share-revoke").click();
  await expect(row).toHaveAttribute("data-state", "revoked");
  await expect(page.getByTestId("share-revoke")).toHaveCount(0);
  await page.goto(url);
  await expect(share).toHaveAttribute("data-state", "revoked");
  await expect(page.getByTestId("share-gone-title")).toContainText("닫은 보고서 링크");
  await expect(page.getByTestId("report-body")).toHaveCount(0);
  // 활동 이력에 만들기·닫기
  await page.goto("/sites/site-a?tab=history");
  await expect(page.getByText("보고서 링크 만듦 — A현장 11월 공정 보고서 (7일 동안 열림)")).toBeVisible();
  await expect(page.getByText("보고서 링크 닫음 — A현장 11월 공정 보고서")).toBeVisible();
});

test("준공 보고서 링크(준공 전 안내 · 본사 전용 표시 없음 · 인쇄) · 본사는 지난 달·발주처 계정 없는 현장도 · 없는 주소 안내 · 현장·발주처는 만들 수 없음", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await page.goto("/sites/site-a/completion");
  await page.getByTestId("share-open").click();
  // 준공 전이면 어떤 제목으로 나가는지 먼저 알려 준다
  await expect(page.getByTestId("share-dialog")).toContainText("‘공사 진행 정리 (준공 전)’ 제목으로 나갑니다");
  await page.getByTestId("share-create").click();
  const url = await page.getByTestId("share-url").inputValue();
  await page.goto(url);
  const share = page.getByTestId("share-page");
  await expect(share).toHaveAttribute("data-kind", "completion");
  await expect(page.getByTestId("completion-title")).toHaveText("공사 진행 정리 (준공 전)");
  await expect(page.getByTestId("completion-stage")).toHaveCount(5);
  await expect(page.getByTestId("completion-sign")).toContainText("담당");
  // 본사 화면 전용 표시(계획 대비·안내)는 링크에 없다
  const text = (await share.innerText()).replace(/\s+/g, " ");
  expect(text).not.toContain("계획보다 늦음");
  expect(text).not.toContain("계획 안");
  expect(text).not.toContain("날짜 기록 없음");
  expect(text).not.toMatch(MONEY);
  const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBeLessThanOrEqual(5);

  // 본사: 지난달보다 앞선 달도 골라 링크로 보낼 수 있다
  await page.goto("/partner/report");
  const older = page.getByTestId("report-month-older");
  await older.selectOption("2026-08");
  await expect(page).toHaveURL(/month=2026-08/);
  await expect(page.getByTestId("report-month")).toContainText("2026년 8월");
  await expect(page.getByTestId("report-month-range")).toHaveCount(0);
  await page.getByTestId("share-open").click();
  await expect(page.getByTestId("share-dialog")).toContainText("A현장 8월 공정 보고서");
  await page.getByTestId("share-create").click();
  await expect(page.getByTestId("share-message")).toHaveValue(/A현장 8월 공정 보고서입니다/);
  const aug = await page.getByTestId("share-url").inputValue();
  await page.goto(aug);
  await expect(page.getByTestId("report-month")).toContainText("2026년 8월 (2026.08.01 ~ 2026.08.31)");
  // 발주처 계정이 없는 현장도 본사는 보고서를 만들 수 있다
  await page.goto("/partner/report?site=site-b");
  await expect(page.getByTestId("report-preview")).toContainText("발주처 계정이 없습니다");
  await expect(page.getByTestId("report-site-name")).toContainText("가상 현장 B");
  await expect(page.getByTestId("share-open")).toBeVisible();

  // 현장 상세에 두 링크 · 보고서 고르기 연결
  await page.goto("/sites/site-a?tab=requests");
  await expect(page.getByTestId("share-row")).toHaveCount(2);
  await expect(page.getByTestId("shares-monthly-link")).toHaveAttribute("href", "/partner/report?site=site-a");

  // 없는 주소 · 형식이 다른 주소
  for (const bad of ["/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "/s/nope"]) {
    await page.goto(bad);
    await expect(share).toHaveAttribute("data-state", "notfound");
    await expect(page.getByTestId("share-gone-title")).toHaveText("열 수 없는 주소입니다");
    await expect(page.getByTestId("share-demo-hint")).toBeVisible();
  }

  // 발주처: 보고서는 보지만 링크는 만들 수 없고, 그 전 달도 고를 수 없다
  await asRole(page, "partner");
  await page.goto("/partner/report");
  await expect(page.getByTestId("report-body")).toBeVisible();
  await expect(page.getByTestId("share-open")).toHaveCount(0);
  await expect(page.getByTestId("report-month-older")).toHaveCount(0);
  await page.goto("/partner/report?month=2026-08");
  await expect(page.getByTestId("report-month-range")).toContainText("이번 달과 지난달만");
  // 현장 직원: 준공 보고서·링크 목록을 못 본다
  await asRole(page, "field");
  await page.goto("/sites/site-a/completion");
  await expect(page.getByText("본사만 볼 수 있습니다")).toBeVisible();
  await expect(page.getByTestId("share-open")).toHaveCount(0);
});
