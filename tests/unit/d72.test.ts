/** D-72 아침 알림 (본사 요약·현장 오늘 할 일) · 준공 보고서 · 주간 보고서 미결 작업지시 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { setCompanySettings } from "@/lib/data/adminCommands";
import { createWorkOrder } from "@/lib/data/opsCommands";
import { briefDueToday, runDailyChecks } from "@/lib/data/dailyJobs";
import { briefRestDay, fieldBriefs, hqBrief, missingReportSites } from "@/lib/domain/brief";
import { pendingItems } from "@/lib/domain/pending";
import type { DemoDB } from "@/lib/domain/types";
import { completionReport } from "@/lib/domain/completion";
import { importData } from "@/lib/data/importCommands";
import { setSiteWarranty } from "@/lib/data/adminCommands";
import { weeklyLog, weekStart } from "@/lib/domain/dailylog";
import { reviewWorkOrder, workOrderStep } from "@/lib/data/opsCommands";

const NOW = new Date("2026-11-09T00:30:00Z"); // 월요일 09:30 KST
const TODAY = "2026-11-09";
const ctx = (userId = "u-manager", now = NOW) => ({ userId, now });
const at = (date: string) => new Date(`${date}T00:30:00Z`);

describe("아침 알림 — 내용", () => {
  it("본사: 지난 근무일(월요일이면 토요일) 출근했는데 보고 없는 현장 + 처리 대기(대시보드와 같은 계산) · 금액 없음", () => {
    const db = createSeed(NOW);
    expect(missingReportSites(db, "2026-11-07").map((s) => s.name)).toEqual(["A현장", "C현장"]);
    const h = hqBrief(db, TODAY, false);
    // 월요일: 토·일 둘 다 본다 (일요일 출근을 놓치지 않게)
    expect(h.lines[0]).toMatchObject({ key: "missing-2026-11-07", n: 2, href: "/daily?date=2026-11-07" });
    expect(h.lines[0].label).toContain("11/07(토)");
    expect(h.lines[1]).toMatchObject({ key: "missing-2026-11-08", n: missingReportSites(db, "2026-11-08").length });
    const pending = pendingItems(db, TODAY, false);
    for (const l of h.lines.filter((x) => !x.key.startsWith("missing"))) expect(pending.find((p) => p.key === l.key)?.n).toBe(l.n);
    expect(h.total).toBe(h.lines.reduce((a, l) => a + l.n, 0));
    expect(h.title).toBe(`오늘 아침 확인할 일 ${h.total}건`);
    expect(h.body).toContain("11/07(토) 보고 없는 현장 2곳(A현장·C현장)");
    expect(h.body).not.toMatch(/원|억/);
    // 화요일이면 월요일을 본다
    expect(hqBrief(db, "2026-11-10", false).lines.map((l) => l.key)).not.toContain("missing-2026-11-07");
    // 엑셀로 옮긴 기록은 보고로 치지 않는다
    const withImported: DemoDB = { ...db, reports: [...db.reports, { ...db.reports[0], id: "imp-x", siteId: "site-c", reportDate: "2026-11-07", importBatchId: "imp-b" }] };
    expect(missingReportSites(withImported, "2026-11-07").map((s) => s.name)).toContain("C현장");
  });

  it("현장 직원: 새 지시(확인 안 함)·오늘 기한·기한 지남·보완 요청만, 본인 것만", () => {
    let db = createSeed(NOW);
    // 시연 데이터: 박 소장에게 아직 확인 안 한 지시 1건
    expect(fieldBriefs(db, TODAY).map((x) => [x.userId, x.body])).toEqual([["u-field", "새 작업지시 (확인 안 함) 1건"]]);
    const wo = createWorkOrder(db, { siteId: "site-a", title: "3층 실링 보수", assigneeUserId: "u-field", dueDate: TODAY }, ctx());
    db = workOrderStep(wo.db, { workOrderId: wo.result.workOrderId, action: "receive" }, ctx("u-field")).db;
    db = createWorkOrder(db, { siteId: "site-c", title: "철골 볼트 확인", assigneeUserId: "u-field2", dueDate: "2026-11-12" }, ctx()).db;
    const f = fieldBriefs(db, TODAY);
    expect(f.find((x) => x.userId === "u-field")).toMatchObject({ title: "오늘 할 일 2건", body: "새 작업지시 (확인 안 함) 1건 · 오늘 기한 작업지시 1건" });
    expect(f.find((x) => x.userId === "u-field2")).toMatchObject({ body: "새 작업지시 (확인 안 함) 1건" });
    // 다음 날이면 ‘기한 지난’
    expect(fieldBriefs(db, "2026-11-10").find((x) => x.userId === "u-field")!.body).toContain("기한 지난 작업지시 1건");
  });
});

describe("아침 알림 — 매일 점검", () => {
  it("하루 한 번 · 일요일 쉼 · 끄면 안 감 · 보낸 날을 남긴다", () => {
    let db = createSeed(NOW);
    db = createWorkOrder(db, { siteId: "site-a", title: "3층 실링 보수", assigneeUserId: "u-field", dueDate: TODAY }, ctx()).db;
    expect(briefDueToday(db, TODAY)).toBe(true);
    const r = runDailyChecks(db, NOW, false);
    expect(r.brief).toEqual({ hq: 2, field: 1 });
    const hq = r.notices.find((n) => n.tag === "brief-hq")!;
    expect(hq).toMatchObject({ url: "/dashboard" });
    expect(hq.to.sort()).toEqual(["u-ceo", "u-manager"]);
    expect(r.notices.find((n) => n.tag === "brief-field")).toMatchObject({ to: ["u-field"], title: "오늘 할 일 2건", url: "/my-actions" });
    expect(JSON.stringify(r.notices)).not.toMatch(/\d\s*원|억/);
    expect(r.db.settings?.briefSentOn).toBe(TODAY);
    // 같은 날 다시 → 없음
    expect(runDailyChecks(r.db, new Date(NOW.getTime() + 3_600_000), false)).toMatchObject({ changed: false, notices: [] });
    // 다음 날은 다시
    expect(runDailyChecks(r.db, at("2026-11-10"), false).brief.hq).toBe(2);
    // 일요일 쉼
    expect(briefRestDay("2026-11-15")).toBe(true);
    expect(runDailyChecks(db, at("2026-11-15"), false).notices.filter((n) => n.tag.startsWith("brief"))).toEqual([]);
    // 끄면 안 감 — 하자보증 알림은 따로
    const off = setCompanySettings(db, { morningBrief: false }, ctx("u-ceo")).db;
    expect(runDailyChecks(off, NOW, false)).toMatchObject({ changed: false, notices: [] });
  });

  it("할 일이 없으면 보내지 않지만, 확인한 날은 남긴다 (다시 계산하지 않게)", () => {
    const db = createSeed(NOW);
    const quiet: DemoDB = { ...db, attendance: [], crewChecks: [], reports: db.reports.map((r) => ({ ...r, review: r.review ?? { status: "confirmed" as const, at: NOW.toISOString(), by: "u-manager" } })), workOrders: [], attendanceRequests: [], partnerRequests: [] };
    const r = runDailyChecks(quiet, NOW, false);
    expect(r.notices.filter((n) => n.tag.startsWith("brief"))).toEqual([]);
    expect(r.brief).toEqual({ hq: 0, field: 0 });
    expect(r.db.settings?.briefSentOn).toBe(TODAY);
  });

  it("운영 설정: 켜기·끄기는 본사가 바꾸고 활동 이력에 남음 · 보낸 날은 설정 저장으로 바꿀 수 없고 지워지지도 않음", () => {
    const sent = runDailyChecks(createSeed(NOW), NOW, false).db;
    const off = setCompanySettings(sent, { morningBrief: false }, ctx("u-ceo"));
    expect(off.db.settings).toMatchObject({ morningBrief: false, briefSentOn: TODAY });
    expect(off.db.activityLogs[0].summary).toContain("아침 알림 끔");
    const on = setCompanySettings(off.db, { morningBrief: true }, ctx("u-ceo")).db;
    expect(on.settings?.morningBrief).toBeUndefined();
    expect(on.settings?.briefSentOn).toBe(TODAY);
    // 다른 설정만 바꿔도 켜짐·꺼짐은 그대로
    expect(setCompanySettings(off.db, { helpPhone: "02-1234-5678" }, ctx("u-ceo")).db.settings?.morningBrief).toBe(false);
    expect(() => setCompanySettings(sent, { briefSentOn: "2026-01-01" } as never, ctx("u-ceo"))).toThrow(/입력값/);
    expect(() => setCompanySettings(sent, { morningBrief: "yes" } as never, ctx("u-ceo"))).toThrow(/입력값/);
  });
});

describe("준공 보고서", () => {
  const importProgress = (db: DemoDB, ...rows: string[]) => importData(db, { kind: "progress", text: ["현장,날짜,공정 단계,진행률,메모", ...rows].join("\n"), idempotencyKey: `k-${Math.random()}` }, ctx()).db;

  it("공정 단계별 완료일(기록에서 100%가 된 날)·월별 공정률·기록 없음은 지어내지 않음", () => {
    let db = createSeed(NOW);
    const a = db.sites.find((s) => s.id === "site-a")!;
    // 앵커·브라켓 설치: 지금 100%지만 기록 없음 → 엑셀로 7월 기록
    expect(completionReport(db, "site-a", TODAY)!.stages[0]).toMatchObject({ progressPct: 100 });
    expect(completionReport(db, "site-a", TODAY)!.stages[0].doneDate).toBeUndefined();
    db = importProgress(db, "A현장,2026-06-01,앵커·브라켓 설치,40,", "A현장,2026-07-20,앵커·브라켓 설치,100,", "A현장,2026-07-31,전체,30,");
    const r = completionReport(db, "site-a", TODAY)!;
    const st = r.stages.find((x) => x.name === "앵커·브라켓 설치")!;
    expect(st).toMatchObject({ doneDate: "2026-07-20", late: "2026-07-20" > a.stages[0].endDate });
    expect(r.stages.filter((x) => x.progressPct < 100).every((x) => x.doneDate === undefined)).toBe(true);
    // 월별: 앞쪽 기록 없는 달(4~6월)은 한 칸으로, 이후 월말 값(기록 없으면 앞 달 값), 마지막 달은 지금 공정률
    expect(r.emptyLead).toEqual({ from: a.startDate.slice(0, 7), to: "2026-06" });
    expect(r.months[0]).toEqual({ month: "2026-07", pct: 30 });
    expect(r.months.find((m) => m.month === "2026-08")?.pct).toBe(30);
    expect(r.months.at(-1)).toEqual({ month: "2026-11", pct: a.progressPct });
    expect(r.months.find((m) => m.month === "2026-10")?.pct).toBe(57);
    expect(r.finished).toBe(false);
    expect(r.days).toBeGreaterThan(200);
    // 엑셀 이관은 ‘현장 보고한 날’에 넣지 않는다
    expect(r.reportDays).toBe(completionReport(createSeed(NOW), "site-a", TODAY)!.reportDays);
    expect(r.completedDate).toBeUndefined();
    expect(r.to).toBe(TODAY);
  });

  it("준공일이 있으면 그날까지 · 하자보증(계약서 기준) · 공개한 사진만 최대 12장 · 금액·이름 없음", () => {
    const db = setSiteWarranty(createSeed(NOW), { siteId: "site-a", months: 24, completedDate: "2026-11-01" }, ctx()).db;
    const r = completionReport(db, "site-a", TODAY)!;
    // 준공일은 있지만 공정률이 100%가 아니면 ‘준공 보고서’가 아니다
    expect(r).toMatchObject({ completedDate: "2026-11-01", to: "2026-11-01", finished: false });
    expect(r.warranty).toContain("계약서 기준");
    expect(r.months.at(-1)?.month).toBe("2026-11");
    expect(r.photos.length).toBeLessThanOrEqual(12);
    expect(r.photos.every((p) => p.shared)).toBe(true);
    expect(r.defects.total).toBe(db.partnerRequests.filter((x) => x.siteId === "site-a" && x.type === "defect").length);
    const shown = JSON.stringify({ ...r, site: undefined, photos: r.photos.map((p) => p.shared?.caption ?? "") });
    expect(shown).not.toMatch(/\d\s*원|억|박지훈|김부장|정우진/);
    expect(completionReport(db, "no-site", TODAY)).toBeNull();
  });
});

describe("준공 보고서 — 점검 반영", () => {
  it("본사가 공정률을 100%로 마감하면 완료일이 남고, 준공일이 있으면 ‘준공 보고서’ · 마지막 달은 지금 공정률", async () => {
    const { updateProgress } = await import("@/lib/data/adminCommands");
    let db = createSeed(NOW);
    const a = db.sites.find((s) => s.id === "site-a")!;
    db = updateProgress(db, { siteId: "site-a", progressPct: 100, stages: a.stages.map((st) => ({ id: st.id, progressPct: 100 })) }, ctx("u-ceo")).db;
    expect(db.sites.find((s) => s.id === "site-a")!.stages.every((st) => st.doneOn === TODAY || (st.progressPct >= 100 && st.doneOn))).toBe(true);
    db = setSiteWarranty(db, { siteId: "site-a", months: 24, completedDate: TODAY }, ctx()).db;
    const r = completionReport(db, "site-a", TODAY)!;
    expect(r.finished).toBe(true);
    expect(r.months.at(-1)).toEqual({ month: "2026-11", pct: 100 });
    expect(r.stages.filter((x) => x.name !== "앵커·브라켓 설치").every((x) => x.doneDate === TODAY)).toBe(true);
    // 다시 내리면 완료일이 지워진다
    const back = updateProgress(db, { siteId: "site-a", progressPct: 90, stages: [{ id: a.stages[4].id, progressPct: 50 }] }, ctx("u-ceo")).db;
    expect(back.sites.find((s) => s.id === "site-a")!.stages[4].doneOn).toBeUndefined();
  });

  it("완료일은 마지막으로 100%가 된 날 (잘못 올렸다 내린 기록 뒤) · 아주 긴 공사는 최근 36개월", () => {
    // 100 → 80 → 100 순서의 기록
    const base = createSeed(NOW);
    const site = base.sites.find((s) => s.id === "site-a")!;
    const st = site.stages[0];
    const mk = (id: string, date: string, from: number, to: number) => ({ ...base.reports[0], id, siteId: "site-a", reportDate: date, createdAt: `${date}T01:00:00Z`, status: "submitted" as const, stages: [{ stageId: st.id, name: st.name, from, to }], progress: undefined, importBatchId: "x" });
    const withRe: DemoDB = { ...base, reports: [...base.reports, mk("r1", "2026-07-01", 90, 100), mk("r2", "2026-07-02", 100, 80), mk("r3", "2026-07-20", 80, 100)] };
    expect(completionReport(withRe, "site-a", TODAY)!.stages[0].doneDate).toBe("2026-07-20");
    // 긴 공사: 2023년 착공 → 최근 36개월, 마지막 달은 이번 달
    const long: DemoDB = { ...base, sites: base.sites.map((s) => (s.id === "site-b" ? { ...s, startDate: "2023-01-10" } : s)) };
    const lr = completionReport(long, "site-b", TODAY)!;
    expect(lr.months.at(-1)?.month).toBe("2026-11");
    expect(lr.months.length + (lr.emptyLead ? 1 : 0)).toBeLessThanOrEqual(36);
  });
});

describe("주간 보고서 — 그 주 말일 기준 미결 작업지시", () => {
  it("그 주 뒤에 만든 지시는 빼고, 그 주에 확인한 지시도 빼고, 상태는 그 주 말일 기준", () => {
    let db = createSeed(NOW);
    const site = db.sites.find((s) => s.id === "site-a")!;
    const lastWeek = weekStart("2026-11-02");
    const before = weeklyLog(db, site, lastWeek, TODAY).openOrders.map((o) => o.title);
    // 오늘 만든 지시 → 지난주 보고서에는 없음
    db = createWorkOrder(db, { siteId: "site-a", title: "오늘 만든 지시", assigneeUserId: "u-field" }, ctx()).db;
    expect(weeklyLog(db, site, lastWeek, TODAY).openOrders.map((o) => o.title)).toEqual(before);
    expect(weeklyLog(db, site, weekStart(TODAY), TODAY).openOrders.some((o) => o.title === "오늘 만든 지시")).toBe(true);
    // 지난주에 만들고 이번 주에 확인 → 지난주 보고서에는 ‘미결’로 남는다
    const old = createWorkOrder(createSeed(at("2026-11-03")), { siteId: "site-a", title: "지난주 지시", assigneeUserId: "u-field" }, ctx("u-manager", at("2026-11-03")));
    let d2 = workOrderStep(old.db, { workOrderId: old.result.workOrderId, action: "complete", note: "끝냄" }, ctx("u-field", at("2026-11-04"))).db;
    d2 = reviewWorkOrder(d2, { workOrderId: old.result.workOrderId, decision: "confirm" }, ctx("u-manager", NOW)).db;
    const s2 = d2.sites.find((s) => s.id === "site-a")!;
    expect(weeklyLog(d2, s2, lastWeek, TODAY).openOrders.find((o) => o.title === "지난주 지시")).toMatchObject({ status: "done" });
    expect(weeklyLog(d2, s2, weekStart(TODAY), TODAY).openOrders.some((o) => o.title === "지난주 지시")).toBe(false);
  });
});
