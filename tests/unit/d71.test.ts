/** D-71 지난 공정 진행 이력 가져오기(검증·앞뒤 맞추기·반영·취소) · 하자보증 만료 알림 · 현장 준공 ↔ 하자보증 준공일 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { voidReport } from "@/lib/data/commands";
import { importData, undoImport } from "@/lib/data/importCommands";
import { parsePctCell, planImport, type ProgressRow } from "@/lib/domain/importers";
import { monthRange, partnerMonthly, partnerProgressFeed, progressHistory } from "@/lib/domain/partnerFeed";
import { dailyLog } from "@/lib/domain/dailylog";
import { acceptanceItems } from "@/lib/domain/acceptance";
import type { DemoDB } from "@/lib/domain/types";
import { saveSite, setSiteWarranty } from "@/lib/data/adminCommands";
import { runDailyChecks } from "@/lib/data/dailyJobs";
import { warrantyEnd, warrantyNoticeDue } from "@/lib/domain/warranty";
import { viewFor } from "@/server/authz";

const NOW = new Date("2026-11-08T03:00:00Z"); // 12:00 KST
const TODAY = "2026-11-08";
const ctx = (now = NOW) => ({ userId: "u-manager", now });
const HEAD = "현장,날짜,공정 단계,진행률,메모";
const csv = (...rows: string[]) => [HEAD, ...rows].join("\n");
const plan = (db: DemoDB, ...rows: string[]) => planImport(db, "progress", csv(...rows), TODAY);
const imp = (db: DemoDB, ...rows: string[]) => importData(db, { kind: "progress", text: csv(...rows), idempotencyKey: `k-${Math.random()}` }, ctx());

describe("공정 진행 이력 — 검증", () => {
  it("진행률 칸: 35 · 35% · 엑셀 백분율(0.35) · 35.0은 받고, 소수 %는 받지 않는다", () => {
    expect(parsePctCell("35")).toBe(35);
    expect(parsePctCell("35%")).toBe(35);
    expect(parsePctCell(" 35 % ")).toBe(35);
    expect(parsePctCell("0.35")).toBe(35);
    expect(parsePctCell("35.0")).toBe(35);
    expect(parsePctCell("1")).toBe(1);
    expect(parsePctCell("1.5")).toBeNaN();
    expect(parsePctCell("0.355")).toBeNaN();
    expect(parsePctCell("-5")).toBeNaN();
    expect(parsePctCell("")).toBeNaN();
  });

  it("날짜별 누계 → 앞 기록 값부터 이어 붙인다 (처음은 0), ‘전체’는 현장 공정률", () => {
    const db = createSeed(NOW);
    const p = plan(db, "C현장,2026-08-01,철골 하부구조,30,1단 설치", "C현장,2026.9.1,철골 하부구조,60%,", "C현장,2026-10-01,철골 하부구조,90,", "C현장,2026-10-01,전체,35,");
    expect(p.errors).toEqual([]);
    const rows = p.rows as ProgressRow[];
    expect(rows.map((r) => [r.date, r.stageName, r.from, r.pct])).toEqual([
      ["2026-08-01", "철골 하부구조", 0, 30],
      ["2026-09-01", "철골 하부구조", 30, 60],
      ["2026-10-01", "철골 하부구조", 60, 90],
      ["2026-10-01", "전체 공정률", 0, 35],
    ]);
    expect(p.summary[0].label).toContain("3개 날짜");
    expect(p.summary[0]).not.toHaveProperty("amount");
  });

  it("잘못된 줄: 없는 단계·착공일 전·오늘·100 초과·같은 날 다른 값·줄어든 누계·지금보다 높은 값", () => {
    const db = createSeed(NOW);
    const p = plan(
      db,
      "C현장,2026-08-01,없는 단계,10,", // 2
      "C현장,2026-07-01,철골 하부구조,10,", // 3 착공 2026-07-11 전
      `C현장,${TODAY},철골 하부구조,50,`, // 4 오늘
      "C현장,2026-08-02,유리 설치,101,", // 5
      "C현장,2026-08-10,철골 하부구조,40,", // 6
      "C현장,2026-08-10,철골 하부구조,45,", // 7 같은 날 다른 값
      "C현장,2026-08-20,철골 하부구조,30,", // 8 6행 40%보다 낮음
      "C현장,2026-09-20,아트리움 프레임 제작,50,", // 9 지금 40%보다 높음
    );
    const at = (line: number) => p.errors.filter((e) => e.line === line).map((e) => e.message).join(" / ");
    expect(at(2)).toMatch(/단계가 C현장에 없습니다/);
    expect(at(3)).toMatch(/착공일\(2026-07-11\) 전/);
    expect(at(4)).toMatch(/어제까지/);
    expect(at(5)).toMatch(/0~100/);
    expect(at(7)).toMatch(/6행과 같은 날 같은 단계인데 진행률이 다릅니다/);
    expect(at(8)).toMatch(/앞선 기록\(2026-08-10 40%\)보다 낮습니다/);
    expect(at(9)).toMatch(/지금 아트리움 프레임 제작\(40%\)보다 높습니다/);
    // 오류가 하나라도 있으면 아무것도 넣지 않는다
    expect(() => imp(db, "C현장,2026-08-01,없는 단계,10,")).toThrow(/오류/);
  });

  it("이미 있는 현장 보고와 앞뒤를 맞춘다: 그날 기록 있으면 건너뜀, 뒤 보고의 시작 값보다 높으면 오류", () => {
    const db = createSeed(NOW);
    // A현장 커튼월 유닛 설치: 10-01 25→30, 10-09 30→35, 10-16 35→40, 10-23 40→45 (시연 데이터)
    const ok = plan(db, "A현장,2026-09-15,커튼월 유닛 설치,20,", "A현장,2026-10-01,커튼월 유닛 설치,30,");
    expect(ok.errors).toEqual([]);
    expect((ok.rows as ProgressRow[]).map((r) => [r.date, r.from, r.pct])).toEqual([["2026-09-15", 0, 20]]);
    expect(ok.duplicates[0].text).toMatch(/그날 기록이 이미 있음 \(25% → 30% 유지\)/);
    const hi = plan(db, "A현장,2026-09-20,커튼월 유닛 설치,28,");
    expect(hi.errors[0].message).toMatch(/뒤의 현장 보고\(2026-10-01 시작 25%\)보다 높습니다/);
    const mid = plan(db, "A현장,2026-10-05,커튼월 유닛 설치,32,");
    expect(mid.errors[0].message).toMatch(/뒤의 현장 보고\(2026-10-09 시작 30%\)/);
    // 사이에 들어가는 값은 앞 보고의 끝 값부터
    const between = plan(db, "A현장,2026-10-05,커튼월 유닛 설치,30,");
    expect(between.rows).toHaveLength(0);
    expect(between.duplicates[0].text).toMatch(/변화 없음/);
  });

  it("앞 기록과 같은 값(변화 없음)은 넣지 않고, 다음 줄의 시작 값으로만 쓴다", () => {
    const db = createSeed(NOW);
    const p = plan(db, "C현장,2026-08-01,철골 하부구조,30,", "C현장,2026-08-15,철골 하부구조,30,", "C현장,2026-09-01,철골 하부구조,50,", "C현장,2026-09-01,철골 하부구조,50,");
    expect(p.errors).toEqual([]);
    expect((p.rows as ProgressRow[]).map((r) => [r.date, r.from, r.pct])).toEqual([
      ["2026-08-01", 0, 30],
      ["2026-09-01", 30, 50],
    ]);
    expect(p.duplicates.map((d) => d.line)).toEqual([3, 5]);
  });
});

describe("공정 진행 이력 — 반영·취소", () => {
  it("현장·날짜마다 본사 확인한 보고 한 건 · 지금 공정률은 그대로 · 월간 보고서·공사일보·공정 변화 기록에 이어진다", () => {
    const db0 = createSeed(NOW);
    const { db, result } = imp(db0, "C현장,2026-08-01,철골 하부구조,30,1단 설치", "C현장,2026-09-01,철골 하부구조,60,", "C현장,2026-09-01,아트리움 프레임 제작,10,제작 착수", "C현장,2026-10-01,전체,35,");
    expect(result).toMatchObject({ added: 4, siteIds: ["site-c"] });
    const mine = db.reports.filter((r) => r.importBatchId === result.batchId);
    expect(mine.map((r) => r.reportDate)).toEqual(["2026-10-01", "2026-09-01", "2026-08-01"]);
    const sep = mine.find((r) => r.reportDate === "2026-09-01")!;
    expect(sep).toMatchObject({ workDone: "제작 착수", createdBy: "u-manager", status: "submitted", review: { status: "confirmed" }, photoIds: [], costEntryIds: [] });
    expect(sep.stages).toEqual([
      { stageId: "site-c-stage-1", name: "철골 하부구조", from: 30, to: 60 },
      { stageId: "site-c-stage-2", name: "아트리움 프레임 제작", from: 0, to: 10 },
    ]);
    expect(mine.find((r) => r.reportDate === "2026-10-01")).toMatchObject({ workDone: "지난 공정 진행 기록", stages: [], progress: { from: 0, to: 35 } });
    // 지금 값은 그대로
    expect(db.sites.find((s) => s.id === "site-c")).toEqual(db0.sites.find((s) => s.id === "site-c"));
    // 발주처 월간 보고서 (9월)
    const feed = partnerProgressFeed(db, "site-c", TODAY, 120);
    const m = partnerMonthly(db, "site-c", "2026-09", feed);
    expect(m.from).toBe(monthRange("2026-09").from);
    expect(m.stages).toEqual([
      { stage: "철골 하부구조", from: 30, to: 60 },
      { stage: "아트리움 프레임 제작", from: 0, to: 10 },
    ]);
    // 공사일보 — 작성자는 ‘자료 이관’, 사진 없음 경고 없음
    const site = db.sites.find((s) => s.id === "site-c")!;
    const d = dailyLog(db, site, "2026-09-01");
    expect(d.writers).toEqual(["자료 이관"]);
    expect(d.stages).toHaveLength(2);
    expect(d.gaps.some((g) => g.includes("사진"))).toBe(false);
    // 본사 공정 변화 기록 — 지난 기록 표시
    const h = progressHistory(db, "site-c", TODAY);
    expect(h.map((x) => [x.date, x.imported])).toEqual([
      ["2026-10-01", true],
      ["2026-09-01", true],
      ["2026-08-01", true],
    ]);
    expect(h.find((x) => x.date === "2026-10-01")!.changes[0].stage).toBe("전체 공정률");
    expect(progressHistory(db, "site-a", TODAY).every((x) => !x.imported)).toBe(true);
    // 활동 이력
    expect(db.activityLogs[0].summary).toMatch(/공정 진행 이력 4건 \(C현장\)/);
    expect(db.activityLogs[0].summary).not.toMatch(/합계/);
  });

  it("같은 파일을 다시 올리면 모두 ‘이미 있음’ · 7일 안에 통째로 취소", () => {
    const rows = ["C현장,2026-08-01,철골 하부구조,30,", "C현장,2026-09-01,철골 하부구조,60,"];
    const first = imp(createSeed(NOW), ...rows);
    expect(plan(first.db, ...rows).rows).toHaveLength(0);
    expect(() => imp(first.db, ...rows)).toThrow(/새로 넣을 행이 없습니다/);
    const undone = undoImport(first.db, { batchId: first.result.batchId }, ctx(new Date(NOW.getTime() + 3_600_000)));
    expect(undone.result.removed).toBe(2);
    expect(undone.db.reports.some((r) => r.importBatchId)).toBe(false);
    expect(undone.db.reports).toHaveLength(createSeed(NOW).reports.length);
    expect(() => undoImport(first.db, { batchId: first.result.batchId }, ctx(new Date(NOW.getTime() + 8 * 86_400_000)))).toThrow(/7일/);
  });

  it("가져온 기록 한 건을 되돌려도 지금 공정률은 바뀌지 않는다 (현장 보고 되돌리기와 다름)", () => {
    // 지금 값(90%)과 같은 값으로 끝나는 기록 — 예전 되돌리기 규칙이면 90 → 60으로 내려갔다
    const { db } = imp(createSeed(NOW), "C현장,2026-09-01,철골 하부구조,60,", "C현장,2026-10-01,철골 하부구조,90,", "C현장,2026-10-01,전체,35,");
    const r = db.reports.find((x) => x.importBatchId && x.reportDate === "2026-10-01")!;
    const after = voidReport(db, r.id, ctx()).db;
    const c = after.sites.find((s) => s.id === "site-c")!;
    expect(c.progressPct).toBe(35);
    expect(c.stages.find((x) => x.id === "site-c-stage-1")!.progressPct).toBe(90);
    expect(after.reports.find((x) => x.id === r.id)!.status).toBe("voided");
  });

  it("검수 근거의 ‘현장 보고’ 수에는 넣지 않는다", () => {
    const db0 = createSeed(NOW);
    const { db } = imp(db0, "C현장,2026-10-20,철골 하부구조,80,", "C현장,2026-10-27,철골 하부구조,85,");
    const ev = (x: DemoDB) => JSON.stringify(acceptanceItems(x, 2, "2026-10-01", TODAY, NOW).flatMap((i) => i.evidence.filter((e) => e.label === "현장 보고")));
    expect(ev(db0)).toContain("현장 보고");
    expect(ev(db)).toBe(ev(db0));
  });
});


const kstNoon = (date: string) => new Date(`${date}T03:00:00Z`);
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** B현장: 2026-06-01 준공 · 6개월 → 2026-11-30까지 */
function withWarranty(months = 6, completedDate = "2026-06-01") {
  return setSiteWarranty(createSeed(NOW), { siteId: "site-b", months, completedDate }, ctx()).db;
}

describe("하자보증 만료 알림 — 단계", () => {
  it("남은 날이 들어가는 가장 가까운 단계 하나 · 보낸 단계는 다시 없음 · 끝나면 없음", () => {
    const db = withWarranty();
    const site = db.sites.find((s) => s.id === "site-b")!;
    const end = warrantyEnd("2026-06-01", 6);
    expect(end).toBe("2026-11-30");
    expect(warrantyNoticeDue(site, shift(end, -61))).toBeNull();
    expect(warrantyNoticeDue(site, shift(end, -60))).toMatchObject({ days: 60, daysLeft: 60 });
    expect(warrantyNoticeDue(site, shift(end, -45))).toMatchObject({ days: 60 });
    expect(warrantyNoticeDue(site, shift(end, -25))).toMatchObject({ days: 30 });
    expect(warrantyNoticeDue(site, shift(end, -7))).toMatchObject({ days: 7 });
    expect(warrantyNoticeDue(site, end)).toMatchObject({ days: 7, daysLeft: 0 });
    expect(warrantyNoticeDue(site, shift(end, 1))).toBeNull();
    const sent = { ...site, warranty: { ...site.warranty!, notices: [{ days: 60, at: "x" }] } };
    expect(warrantyNoticeDue(sent, shift(end, -45))).toBeNull();
    expect(warrantyNoticeDue(sent, shift(end, -25))).toMatchObject({ days: 30 });
    // 준공 전·보증 미입력은 없음
    expect(warrantyNoticeDue(createSeed(NOW).sites.find((s) => s.id === "site-a")!, TODAY)).toBeNull();
  });

  it("매일 점검: 본사(대표·공무)에게만, 금액 없이, 단계마다 한 번 — 늦게 켜면 지난 단계는 건너뛴다", () => {
    const db0 = withWarranty();
    const end = "2026-11-30";
    const first = runDailyChecks(db0, kstNoon(shift(end, -45)));
    expect(first.changed).toBe(true);
    expect(first.warranty).toEqual([{ siteId: "site-b", days: 60 }]);
    expect(first.notices).toHaveLength(1);
    expect(first.notices[0]).toMatchObject({ title: "하자보증 만료 45일 전", url: "/sites/site-b?tab=requests", tag: "warranty-site-b" });
    expect(first.notices[0].to.sort()).toEqual(["u-ceo", "u-manager"]);
    expect(first.notices[0].body).toContain("B현장");
    expect(JSON.stringify(first.notices)).not.toMatch(/원|만 원|억/);
    expect(first.db.activityLogs[0]).toMatchObject({ by: "system", siteId: "site-b" });
    expect(first.db.rev).toBe(db0.rev + 1);
    // 같은 날 다시 → 없음 (db 그대로)
    const again = runDailyChecks(first.db, kstNoon(shift(end, -44)));
    expect(again).toMatchObject({ changed: false, notices: [] });
    expect(again.db).toBe(first.db);
    const thirty = runDailyChecks(first.db, kstNoon(shift(end, -30)));
    expect(thirty.warranty).toEqual([{ siteId: "site-b", days: 30 }]);
    const seven = runDailyChecks(thirty.db, kstNoon(shift(end, -7)));
    expect(seven.notices[0].title).toBe("하자보증 만료 7일 전");
    expect(runDailyChecks(seven.db, kstNoon(end)).changed).toBe(false);
    // 늦게 켬: 처음 점검이 20일 남았을 때 → 30일 단계 하나만, 60일 단계는 보낸 것으로
    const late = runDailyChecks(db0, kstNoon(shift(end, -20)));
    expect(late.notices).toHaveLength(1);
    expect(late.db.sites.find((s) => s.id === "site-b")!.warranty!.notices!.map((n) => n.days)).toEqual([60, 30]);
    // 끝난 보증 → 없음
    expect(runDailyChecks(db0, kstNoon(shift(end, 3))).changed).toBe(false);
  });

  it("메모만 고치면 보낸 알림 기록 유지, 기간·준공일을 고치면 다시 센다 · 발주처·현장 화면에는 알림 기록 없음", () => {
    const sent = runDailyChecks(withWarranty(), kstNoon("2026-10-20")).db;
    const memo = setSiteWarranty(sent, { siteId: "site-b", months: 6, completedDate: "2026-06-01", note: "계약서 제12조" }, ctx()).db;
    expect(memo.sites.find((s) => s.id === "site-b")!.warranty!.notices).toHaveLength(1);
    const longer = setSiteWarranty(sent, { siteId: "site-b", months: 7, completedDate: "2026-06-01" }, ctx()).db;
    expect(longer.sites.find((s) => s.id === "site-b")!.warranty!.notices).toBeUndefined();
    const partner = viewFor({ id: "u-partner", role: "partner", companyId: "c", siteIds: ["site-b"] } as never, sent);
    expect(JSON.stringify(partner.sites)).not.toContain("notices");
  });
});

describe("현장 ‘준공’ ↔ 하자보증 준공일", () => {
  const base = (db: DemoDB, siteId: string, extra: Record<string, unknown> = {}) => {
    const s = db.sites.find((x) => x.id === siteId)!;
    const c = db.contracts.find((x) => x.siteId === siteId)!;
    const budgets = Object.fromEntries(db.budgets.filter((b) => b.siteId === siteId).map((b) => [b.category, b.amount]));
    return { id: s.id, name: s.name, shortName: s.shortName, workType: s.workType, region: s.region, clientName: s.clientName, status: s.status, startDate: s.startDate, endDate: s.endDate, contractAmount: c.contractAmount, budgets, ...extra } as Parameters<typeof saveSite>[1];
  };
  it("보증 기간이 있고 준공일이 비어 있으면, 준공으로 바꾸며 준공일을 같이 넣는다", () => {
    // A현장: 24개월 · 준공일 없음 (시연 데이터)
    const db0 = createSeed(NOW);
    const out = saveSite(db0, base(db0, "site-a", { status: "completed", warrantyCompletedDate: "2026-11-07" }), ctx()).db;
    const a = out.sites.find((s) => s.id === "site-a")!;
    expect(a.status).toBe("completed");
    expect(a.warranty).toMatchObject({ months: 24, completedDate: "2026-11-07", setBy: "u-manager" });
    expect(out.activityLogs[0].summary).toContain("하자보증 준공 2026.11.07부터");
  });
  it("준공이 아닐 때·보증 기간이 없을 때·이미 준공일이 있을 때·미래·착공 전 날짜는 거부", () => {
    const db0 = createSeed(NOW);
    const err = (db: DemoDB, siteId: string, extra: Record<string, unknown>) => {
      try {
        saveSite(db, base(db, siteId, extra), ctx());
        return "";
      } catch (e) {
        return (e as { fieldErrors?: Record<string, string> }).fieldErrors?.warrantyCompletedDate ?? String(e);
      }
    };
    expect(err(db0, "site-a", { status: "active", warrantyCompletedDate: "2026-11-07" })).toMatch(/‘준공’일 때만/);
    expect(err(db0, "site-c", { status: "completed", warrantyCompletedDate: "2026-11-07" })).toMatch(/하자보증 기간을 먼저/);
    expect(err(withWarranty(), "site-b", { status: "completed", warrantyCompletedDate: "2026-11-07" })).toMatch(/이미 준공일이 있습니다/);
    expect(err(db0, "site-a", { status: "completed", warrantyCompletedDate: "2026-11-09" })).toMatch(/오늘이나 그 전/);
    expect(err(db0, "site-a", { status: "completed", warrantyCompletedDate: "2026-02-30" })).toMatch(/없는 날짜/);
    expect(err(db0, "site-a", { status: "completed", warrantyCompletedDate: "2026-01-02" })).toMatch(/착공일보다 빠릅니다/);
    // 비워 두면 상태만 바뀐다
    expect(saveSite(db0, base(db0, "site-a", { status: "completed" }), ctx()).db.sites.find((s) => s.id === "site-a")!.warranty!.completedDate).toBeUndefined();
  });
});
