/** D-84: 변경공사 청구·회수 — 설계변경 추가 원가 → 변경공사 만들기 → 발주처 청구(다음 확인할 날) → 확인 기록 → 요청과 다른 금액 승인은 사유 → 회수율 · 위험 신호 풀림 */
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

test("변경공사 청구·회수: 청구 안 한 추가 원가 → 만들기 → 발주처 청구·다음 확인 → 기록 → 일부 승인 사유 → 회수율", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  // 현장 보고로 설계변경 추가 원가 4,000만 (자재 3,000만 + 노무 1,000만)
  await page.goto("/sites/site-a");
  await page.getByTestId("open-report-sheet-pc").click();
  const sheet = page.getByTestId("report-sheet");
  await sheet.getByTestId("fill-demo").click();
  await sheet.getByTestId("submit-report").click();
  await expect(sheet.getByTestId("report-impact")).toBeVisible();
  await sheet.getByRole("button", { name: "닫기" }).first().click();

  await page.goto("/finance#co-board");
  const board = page.getByTestId("co-board");
  await expect(board.getByTestId("co-sum-unclaimed")).toContainText("4,000만");
  const extras = board.getByTestId("co-unclaimed").getByTestId("co-extra");
  await expect(extras).toHaveCount(2);
  await extras.nth(0).locator("input[type=checkbox]").check();
  await extras.nth(1).locator("input[type=checkbox]").check();
  await board.getByTestId("co-make").click();
  const cm = page.getByTestId("co-create-modal");
  await expect(cm.getByTestId("co-amount")).toHaveValue("40,000,000");
  await cm.getByTestId("co-title").fill("3층 남측 유리 사양 상향");
  await cm.getByTestId("co-amount").fill("46000000");
  await cm.getByTestId("co-create-confirm").click();
  await expect(page.getByTestId("co-create-modal")).toHaveCount(0);
  await expect(board.getByTestId("co-sum-unclaimed")).toContainText("없음");

  const row = board.getByTestId("co-open").getByTestId("change-order").filter({ hasText: "3층 남측 유리 사양 상향" });
  await expect(row).toHaveAttribute("data-status", "review");
  await expect(row).toContainText("근거 추가 원가 4,000만");
  // 발주처 청구 — 다음 확인할 날 기본 14일 뒤
  await row.getByTestId("co-submit").click();
  const sm = page.getByTestId("co-status-modal");
  await sm.getByTestId("co-status-note").fill("견적서·사진 메일 발송");
  await sm.getByTestId("co-confirm").click();
  await expect(page.getByTestId("co-status-modal")).toHaveCount(0);
  await expect(row).toHaveAttribute("data-status", "submitted");
  await expect(row.getByTestId("co-follow")).toContainText("다음 확인");
  // 확인 기록
  await row.getByTestId("co-log").click();
  const lm = page.getByTestId("co-log-modal");
  await lm.getByTestId("co-log-note").fill("원청 공무 통화 — 다음 주 검토 회의");
  await lm.getByTestId("co-log-confirm").click();
  await expect(page.getByTestId("co-log-modal")).toHaveCount(0);
  await expect(row).toContainText("원청 공무 통화");
  await row.getByTestId("co-log-toggle").click();
  await expect(row.getByTestId("co-log-list").locator("li")).toHaveCount(3);
  // 요청과 다른 금액 승인 — 사유 없으면 막힘
  await row.getByTestId("co-approve").click();
  const am = page.getByTestId("co-status-modal");
  await am.getByTestId("co-amt").fill("44000000");
  // 근거 원가로 만든 건은 ‘예상 원가’ 칸이 접혀 있다 (두 번 계상 방지)
  await expect(am.getByTestId("co-cost")).toHaveCount(0);
  await am.getByTestId("co-confirm").click();
  await expect(am).toContainText("무엇을 받고");
  await am.getByTestId("co-basis").getByText("발주처 공문·메일로 승인").click();
  await am.getByTestId("co-confirm").click();
  await expect(am).toContainText("사유");
  await am.getByTestId("co-status-note").fill("원청 단가 협의로 감액");
  await am.getByTestId("co-confirm").click();
  await expect(page.getByTestId("co-status-modal")).toHaveCount(0);
  // 공문으로 승인 → 그 공문을 올리는 창이 바로 열린다 (D-88) — ‘나중에’
  const em = page.getByTestId("co-evidence-modal");
  await expect(em).toContainText("승인을 반영했습니다");
  await expect(em.getByTestId("co-evidence-kind-letter")).toBeChecked();
  await em.getByRole("button", { name: "나중에" }).click();
  await expect(em).toHaveCount(0);
  const done = board.getByTestId("co-decided").getByTestId("change-order").filter({ hasText: "3층 남측 유리 사양 상향" });
  await expect(done.getByTestId("co-paper")).toHaveAttribute("data-paper", "missing");
  await expect(done).toHaveAttribute("data-status", "approved");
  await expect(done.getByTestId("co-decision-note")).toContainText("원청 단가 협의로 감액");
  await expect(done).toContainText("원가 대비 승인 110%");
  await expect(done).toContainText("승인 근거: 발주처 공문·메일로 승인");
  // 승인율 = 청구 4,600만 대비 승인 4,400만 · 근거 원가 대비 110%
  await expect(board.getByTestId("co-sum-recovery")).toContainText("96%");
  await expect(board.getByTestId("co-sum-recovery")).toContainText("근거 원가 대비 110%");
  // 위험 신호 ‘설계변경 추가원가 — 변경공사 미등록’이 풀림
  await page.goto("/insights");
  await expect(page.getByTestId("signal-board")).toBeVisible();
  await expect(page.getByTestId("signal-board").locator('[data-rule="UNBILLED_CHANGE"]')).toHaveCount(0);
});

test("변경공사: 반려는 사유 필수 → 다시 청구(근거 원가 그대로) · 휴대폰에서 가로로 넘치지 않음", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page);
  await page.goto("/finance#co-board");
  const board = page.getByTestId("co-board");
  const row = board.getByTestId("co-open").getByTestId("change-order").first();
  await expect(row).toBeVisible();
  const title = (await row.locator("b").first().innerText()).trim();
  await row.getByTestId("co-reject").click();
  const rm = page.getByTestId("co-status-modal");
  await rm.getByTestId("co-confirm").click();
  await expect(rm).toContainText("반려 사유");
  await rm.getByTestId("co-status-note").fill("원청 — 설계 범위 안이라 불인정");
  await rm.getByTestId("co-confirm").click();
  await expect(page.getByTestId("co-status-modal")).toHaveCount(0);
  const rejected = board.getByTestId("co-decided").getByTestId("change-order").filter({ hasText: title }).first();
  await expect(rejected).toHaveAttribute("data-status", "rejected");
  // 반려 뒤 다시 청구할지 정할 것 — 챙길 것에 셈
  await expect(rejected.getByTestId("co-reclaim-undecided")).toBeVisible();
  await expect(board.getByTestId("co-sum-due")).toContainText("반려 뒤 결정 1");
  await rejected.getByTestId("co-reclaim").click();
  const cm = page.getByTestId("co-create-modal");
  await cm.getByTestId("co-title").fill("아트리움 유리 사양 변경 (도면 근거 보강)");
  await cm.getByTestId("co-create-confirm").click();
  await expect(page.getByTestId("co-create-modal")).toHaveCount(0);
  await expect(board.getByTestId("co-open").getByTestId("change-order").filter({ hasText: "도면 근거 보강" })).toContainText("재청구 건");
  await expect(rejected).toContainText("다시 청구함");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("변경공사: 우리 책임 추가 원가는 ‘청구 안 함’(이유) → 목록에서 빠지고 되돌릴 수 있음", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await page.goto("/sites/site-a");
  await page.getByTestId("open-report-sheet-pc").click();
  const sheet = page.getByTestId("report-sheet");
  await sheet.getByTestId("fill-demo").click();
  await sheet.getByTestId("submit-report").click();
  await expect(sheet.getByTestId("report-impact")).toBeVisible();
  await sheet.getByRole("button", { name: "닫기" }).first().click();
  await page.goto("/finance#co-board");
  const board = page.getByTestId("co-board");
  const extras = board.getByTestId("co-unclaimed").getByTestId("co-extra");
  await expect(extras).toHaveCount(2);
  await extras.nth(0).locator("input[type=checkbox]").check();
  await board.getByTestId("co-decline").click();
  const rm = page.getByTestId("co-reason-modal");
  await rm.getByTestId("co-reason-confirm").click();
  await expect(rm).toContainText("이유");
  await rm.getByTestId("co-reason-note").fill("우리 책임 — 청구 근거 없음");
  await rm.getByTestId("co-reason-confirm").click();
  await expect(page.getByTestId("co-reason-modal")).toHaveCount(0);
  await expect(extras).toHaveCount(1);
  await board.getByTestId("co-declined-toggle").click();
  await expect(board.getByTestId("co-declined")).toContainText("우리 책임");
  await board.getByTestId("co-declined").getByTestId("co-undo-decline").click();
  await expect(extras).toHaveCount(2);
});

const JPG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");

test("D-88 변경공사 증빙 파일: 변경계약서로 승인 → 날인본 PDF·사진 올리기 → 서면 증빙 있음 → 크게 보기 → 이유 적고 지우기", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await page.goto("/finance#co-board");
  const board = page.getByTestId("co-board");
  const row = board.getByTestId("co-open").getByTestId("change-order").first();
  const title = (await row.locator("b").first().innerText()).trim();
  // 진행 중인 건에도 견적서를 붙일 수 있다 — 종류는 직접 고른다(미리 골라 두지 않음)
  await row.getByTestId("co-evidence-add").click();
  let em = page.getByTestId("co-evidence-modal");
  await expect(em.getByTestId("co-evidence-kind-estimate")).not.toBeChecked();
  // 사진·PDF가 아닌 파일은 올리지 않는다
  await em.getByTestId("co-evidence-input").setInputFiles({ name: "memo.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(em.getByTestId("co-evidence-picked")).toContainText("사진·PDF가 아님");
  await expect(em.getByTestId("co-evidence-upload")).toBeDisabled();
  await em.getByTestId("co-evidence-input").setInputFiles({ name: "견적서.jpg", mimeType: "image/jpeg", buffer: JPG });
  // 종류를 안 고르면 막힘 → 고르면 올라감
  await em.getByTestId("co-evidence-upload").click();
  await expect(em).toContainText("파일마다 무슨 자료인지");
  await em.getByTestId("co-evidence-kind").getByText("견적·내역서").click();
  await expect(em.getByTestId("co-evidence-row-kind")).toHaveValue("estimate");
  await em.getByTestId("co-evidence-upload").click();
  await expect(em).toHaveCount(0);
  await expect(row.getByTestId("co-evidence")).toHaveAttribute("data-count", "1");

  // 변경계약서로 승인 → 올리기 창이 바로 열리고 종류는 변경계약서
  await row.getByTestId("co-approve").click();
  const am = page.getByTestId("co-status-modal");
  await am.getByTestId("co-basis").getByText("변경계약서 날인").click();
  await expect(am).toContainText("날인한 변경계약서");
  await am.getByTestId("co-confirm").click();
  em = page.getByTestId("co-evidence-modal");
  await expect(em.getByTestId("co-evidence-kind-contract")).toBeChecked();
  await em.getByTestId("co-evidence-caption").fill("유리 사양 변경계약서 날인본");
  await em.getByTestId("co-evidence-input").setInputFiles([
    { name: "변경계약서_날인.pdf", mimeType: "application/pdf", buffer: PDF },
    { name: "날인면.jpg", mimeType: "image/jpeg", buffer: JPG },
  ]);
  await expect(em.getByTestId("co-evidence-upload")).toContainText("2개 올리기");
  await em.getByTestId("co-evidence-upload").click();
  await expect(em).toHaveCount(0);
  const done = board.getByTestId("co-decided").getByTestId("change-order").filter({ hasText: title }).first();
  await expect(done).toHaveAttribute("data-status", "approved");
  await expect(done.getByTestId("co-evidence")).toHaveAttribute("data-count", "3");
  await expect(done.getByTestId("co-paper")).toHaveCount(0);
  await expect(board.getByTestId("co-paper-summary")).toHaveCount(0);
  // 기록에 남는다
  await done.getByTestId("co-log-toggle").click();
  await expect(done.getByTestId("co-log-list")).toContainText("변경계약서 (날인본) 올림 — 변경계약서_날인.pdf");

  // 사진은 크게, PDF는 내려받기
  await done.getByTestId("co-evidence-file").filter({ hasText: "날인면.jpg" }).click();
  const view = page.getByTestId("co-evidence-view");
  await expect(view.getByTestId("co-evidence-image")).toBeVisible();
  await view.getByTestId("co-evidence-zoom").click();
  await expect(view.getByTestId("co-evidence-zoom")).toContainText("화면에 맞추기");
  await view.getByRole("button", { name: "닫기" }).last().click();
  await done.getByTestId("co-evidence-file").filter({ hasText: "변경계약서_날인.pdf" }).click();
  await expect(view.getByTestId("co-evidence-download")).toHaveAttribute("download", "변경계약서_날인.pdf");
  // 지우기 — 이유 없으면 막힘
  await view.getByTestId("co-evidence-remove").click();
  await view.getByTestId("co-evidence-remove-confirm").click();
  await expect(view).toContainText("이유");
  await view.getByTestId("co-evidence-reason").fill("다른 건 계약서를 잘못 올림");
  await view.getByTestId("co-evidence-remove-confirm").click();
  await expect(view).toHaveCount(0);
  await expect(done.getByTestId("co-evidence")).toHaveAttribute("data-count", "2");
  // 날인면 사진(변경계약서)이 남아 있어 서면 증빙은 그대로 있음
  await expect(done.getByTestId("co-paper")).toHaveCount(0);
  await expect(done.getByTestId("co-log-list")).toContainText("이유: 다른 건 계약서를 잘못 올림");
});

test("D-88 휴대폰 폭: 증빙 줄·올리기 창이 가로로 넘치지 않음", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await freshStart(page);
  await page.goto("/finance#co-board");
  const row = page.getByTestId("co-board").getByTestId("co-open").getByTestId("change-order").first();
  await row.getByTestId("co-evidence-add").click();
  await page.getByTestId("co-evidence-modal").getByTestId("co-evidence-input").setInputFiles({ name: "아주_긴_파일_이름_변경계약서_날인본_2026년_11월_원청_공문_첨부.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.getByTestId("co-evidence-row-kind").selectOption("letter");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByTestId("co-evidence-upload").click();
  await expect(page.getByTestId("co-evidence-modal")).toHaveCount(0);
  await expect(row.getByTestId("co-evidence-file")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("D-88 사용성: 파일마다 종류 · 잘못 고른 종류 고치기 · 옛 승인은 ‘종이로 보관 중’ · 건수 눌러 그 건만 · 관리자는 승인 계약서 못 지움", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, "manager");
  await page.goto("/finance#co-board");
  const board = page.getByTestId("co-board");
  const row = board.getByTestId("co-open").getByTestId("change-order").first();
  const title = (await row.locator("b").first().innerText()).trim();
  // 공문으로 승인 → 첨부 창: 기본 종류 공문, 사진 한 장은 파일 줄에서 ‘견적’으로 따로
  await row.getByTestId("co-approve").click();
  const am = page.getByTestId("co-status-modal");
  await am.getByTestId("co-basis").getByText("발주처 공문·메일로 승인").click();
  await am.getByTestId("co-confirm").click();
  const em = page.getByTestId("co-evidence-modal");
  await em.getByTestId("co-evidence-input").setInputFiles([
    { name: "원청공문.pdf", mimeType: "application/pdf", buffer: PDF },
    { name: "견적서사진.jpg", mimeType: "image/jpeg", buffer: JPG },
    { name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: JPG },
  ]);
  const rows = em.getByTestId("co-evidence-picked-row");
  await expect(rows.nth(2)).toContainText("HEIC");
  await expect(rows.nth(0).getByTestId("co-evidence-row-kind")).toHaveValue("letter");
  await rows.nth(1).getByTestId("co-evidence-row-kind").selectOption("estimate");
  await expect(em.getByTestId("co-evidence-upload")).toContainText("2개 올리기");
  await em.getByTestId("co-evidence-upload").click();
  await expect(em).toHaveCount(0);
  const done = board.getByTestId("co-decided").getByTestId("change-order").filter({ hasText: title }).first();
  await expect(done.getByTestId("co-evidence-file").filter({ hasText: "원청공문.pdf" })).toContainText("공문·메일");
  await expect(done.getByTestId("co-evidence-file").filter({ hasText: "견적서사진.jpg" })).toContainText("견적·내역서");
  await expect(done.getByTestId("co-paper")).toHaveCount(0);
  // 관리자: 승인 건의 공문은 지울 수 없고(대표만) 설명만 고칠 수 있다
  await done.getByTestId("co-evidence-file").filter({ hasText: "원청공문.pdf" }).click();
  const view = page.getByTestId("co-evidence-view");
  await expect(view.getByTestId("co-evidence-remove")).toBeDisabled();
  await view.getByTestId("co-evidence-edit").click();
  await expect(view.getByTestId("co-evidence-edit-kind-other")).toBeDisabled();
  await view.getByTestId("co-evidence-edit-caption").fill("원청 공문 11/14 수신");
  await view.getByTestId("co-evidence-edit-confirm").click();
  await expect(view).toContainText("원청 공문 11/14 수신");
  await view.getByRole("button", { name: "닫기" }).last().click();
  // 견적서 사진을 ‘변경계약서’로 잘못 올렸다 → 고치기 (관리자도 견적 → 다른 종류는 가능)
  await done.getByTestId("co-evidence-file").filter({ hasText: "견적서사진.jpg" }).click();
  await view.getByTestId("co-evidence-edit").click();
  await view.getByTestId("co-evidence-edit-kind-other").check({ force: true });
  await view.getByTestId("co-evidence-edit-confirm").click();
  await expect(view).toContainText("그 밖의 자료");
  await view.getByRole("button", { name: "닫기" }).last().click();
  await done.getByTestId("co-log-toggle").click();
  await expect(done.getByTestId("co-log-list")).toContainText("증빙 고침 — 견적서사진.jpg: 종류 견적·내역서 → 그 밖의 자료");

  // 옛 승인(서면 파일 없음) 하나 더 — 건수를 누르면 그 건만, ‘종이로 보관 중’이면 알림이 꺼짐
  await page.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k)!);
    d.changeOrders.push({ id: "co-old-1", siteId: "site-a", title: "8월 옥상 방수 변경 (옛 승인)", amount: 12000000, status: "approved", requestedAt: "2026-08-01T00:00:00.000Z", decidedAt: "2026-08-20T00:00:00.000Z", sourceEntryIds: [], note: "" });
    localStorage.setItem(k, JSON.stringify(d));
  }, DB);
  await page.reload();
  await expect(board.getByTestId("co-paper-summary")).toContainText("1건");
  await board.getByTestId("co-paper-filter").click();
  await expect(board.getByTestId("co-decided").getByTestId("change-order")).toHaveCount(1);
  const old = board.getByTestId("co-decided").getByTestId("change-order").first();
  await old.getByTestId("co-paper-kept").click();
  const pk = page.getByTestId("co-paper-kept-modal");
  await pk.getByTestId("co-paper-note").fill("본사 캐비닛 2번 · 2026 변경계약 바인더");
  await pk.getByTestId("co-paper-kept-confirm").click();
  await expect(pk).toHaveCount(0);
  await expect(board.getByTestId("co-paper-summary")).toHaveCount(0);
  await board.getByTestId("co-paper-filter-off").click();
  const oldRow = board.getByTestId("co-decided").getByTestId("change-order").filter({ hasText: "8월 옥상 방수" });
  await expect(oldRow.getByTestId("co-paper")).toHaveAttribute("data-paper", "kept");
  await expect(oldRow.getByTestId("co-paper")).toContainText("본사 캐비닛 2번");
});
