/**
 * 공사일보·주간 공정 보고 자동 작성 — 현장이 이미 보낸 보고·작업 인원·출퇴근·작업지시·사진으로 만든다.
 * 현장소장이 따로 쓰지 않아도 되게 하는 것이 목적이며, 금액은 넣지 않는다 (감리·발주처 제출 문서 성격).
 */
import type { CostCategory, DemoDB, FieldReport, Site, SitePhoto, WorkOrder } from "./types";
import { hhmm, minutesOf, shiftDate } from "./attendance";
import { movesOn } from "./material";

export interface DailyCrewRow {
  team: string;
  kind: "direct" | "subcontract";
  headcount: number;
  photo: boolean;
  imported: boolean;
}

export interface DailyLog {
  site: Site;
  date: string;
  weekday: string;
  reports: FieldReport[];
  writers: string[];
  crew: DailyCrewRow[];
  crewTotal: number;
  staff: { name: string; title: string; inAt: string; outAt?: string; minutes: number | null }[];
  work: string[];
  stages: { name: string; from: number; to: number }[];
  issues: string[];
  plans: string[];
  materials: { category: CostCategory; note: string }[];
  /** 자재 반입·설치 수량 (D-62 · 금액 없음) */
  materialQty: { kind: "in" | "install"; name: string; unit: string; qty: number; note?: string; photo: boolean }[];
  orders: { title: string; event: string; note?: string }[];
  photos: SitePhoto[];
  review: { status: "confirmed" | "returned" | "none"; by?: string; at?: string };
  /** 보고가 없거나 비어 있는 경우 안내 */
  gaps: string[];
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
export const weekdayOf = (d: string) => WEEKDAY[new Date(`${d}T12:00:00Z`).getUTCDay()];
const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
const ORDER_EVENT: Partial<Record<WorkOrder["status"], string>> = { sent: "지시", received: "접수", in_progress: "시작", done: "완료 보고", confirmed: "본사 확인", returned: "보완 요청" };

export function dailyLog(db: DemoDB, site: Site, date: string): DailyLog {
  const user = (id?: string) => db.users.find((u) => u.id === id);
  const reports = db.reports.filter((r) => r.siteId === site.id && r.reportDate === date && r.status !== "voided").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const crew = (db.crewChecks ?? [])
    .filter((c) => c.siteId === site.id && c.workDate === date)
    .map((c) => ({ team: c.team, kind: c.kind, headcount: c.headcount, photo: !!c.photoId, imported: !!c.imported }))
    .sort((a, b) => b.headcount - a.headcount);
  const staff = (db.attendance ?? [])
    .filter((a) => a.siteId === site.id && a.workDate === date)
    .map((a) => ({ name: user(a.userId)?.name ?? "알 수 없음", title: user(a.userId)?.title ?? "", inAt: hhmm(a.inAt), outAt: a.outAt ? hhmm(a.outAt) : undefined, minutes: minutesOf(a) }))
    .sort((a, b) => a.inAt.localeCompare(b.inAt));
  const orders = (db.workOrders ?? [])
    .filter((w) => w.siteId === site.id)
    .flatMap((w) =>
      w.history
        .filter((h) => kstDate(h.at) === date && ORDER_EVENT[h.to])
        .map((h) => ({ title: w.title, event: ORDER_EVENT[h.to]!, note: h.to === "done" ? [w.doneQty, w.doneNote].filter(Boolean).join(" · ") || undefined : h.note })),
    );
  const doneToday = (db.workOrders ?? []).filter((w) => w.siteId === site.id && w.history.some((h) => h.to === "done" && kstDate(h.at) === date));
  const work = uniq([...reports.map((r) => r.workDone), ...doneToday.map((w) => `${w.title}${w.doneQty ? ` (${w.doneQty})` : ""} — 작업지시 완료`)]);
  const stages = reports.flatMap((r) => r.stages ?? []);
  // 같은 단계가 하루에 여러 번 바뀌면 처음 → 마지막
  const byStage = new Map<string, { name: string; from: number; to: number }>();
  for (const s of stages) {
    const prev = byStage.get(s.stageId);
    byStage.set(s.stageId, prev ? { ...prev, to: s.to } : { name: s.name, from: s.from, to: s.to });
  }
  const entryIds = new Set(reports.flatMap((r) => r.costEntryIds));
  const materials = db.costEntries
    .filter((e) => entryIds.has(e.id) && e.status !== "voided" && e.status !== "rejected" && e.category !== "labor" && e.category !== "overhead")
    .map((e) => ({ category: e.category, note: e.note }));
  const materialQty = movesOn(db, site.id, date).map(({ move, item }) => ({ kind: move.kind, name: item?.name ?? "(지운 품목)", unit: item?.unit ?? "", qty: move.qty, ...(move.note ? { note: move.note } : {}), photo: !!move.photoId }));
  const photoIds = new Set([
    ...reports.flatMap((r) => [...r.photoIds, ...(r.supplements ?? []).flatMap((s) => s.photoIds)]),
    ...doneToday.flatMap((w) => w.donePhotoIds ?? []),
    ...movesOn(db, site.id, date).flatMap(({ move }) => (move.photoId ? [move.photoId] : [])),
  ]);
  const photos = db.photos.filter((p) => photoIds.has(p.id));
  const reviewed = reports.filter((r) => r.review);
  const lastReview = reviewed.map((r) => r.review!).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  const gaps: string[] = [];
  if (!reports.length) gaps.push("이 날 현장 보고가 없습니다 — 작업 내용·사진이 비어 있습니다");
  if (!crew.length) gaps.push("작업 인원(출력) 보고가 없습니다");
  if (reports.length && !photos.length) gaps.push("사진이 없습니다");
  return {
    site,
    date,
    weekday: weekdayOf(date),
    reports,
    writers: uniq(reports.map((r) => user(r.createdBy)?.name ?? "")),
    crew,
    crewTotal: crew.reduce((a, c) => a + c.headcount, 0),
    staff,
    work,
    stages: [...byStage.values()],
    issues: uniq(reports.map((r) => r.issues)),
    plans: uniq(reports.map((r) => r.tomorrowPlan)),
    materials,
    materialQty,
    orders,
    photos,
    review: lastReview ? { status: lastReview.status, by: user(lastReview.by)?.name, at: lastReview.at } : { status: "none" },
    gaps,
  };
}

export interface WeeklyLog {
  site: Site;
  from: string;
  to: string;
  days: { date: string; weekday: string; crewTotal: number; staff: number; reports: number; photos: number; work: string }[];
  crewTotal: number;
  reportDays: number;
  stages: { name: string; from: number; to: number }[];
  issues: { date: string; text: string }[];
  openOrders: { title: string; status: WorkOrder["status"]; dueDate?: string }[];
  nextStages: { name: string; startDate: string; endDate: string; progressPct: number }[];
}

/** 월요일 시작 주간 */
export function weekStart(date: string): string {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftDate(date, wd === 0 ? -6 : 1 - wd);
}

export function weeklyLog(db: DemoDB, site: Site, from: string): WeeklyLog {
  const to = shiftDate(from, 6);
  const days = Array.from({ length: 7 }, (_, i) => dailyLog(db, site, shiftDate(from, i)));
  const byStage = new Map<string, { name: string; from: number; to: number }>();
  for (const d of days)
    for (const r of d.reports)
      for (const s of r.stages ?? []) {
        const prev = byStage.get(s.stageId);
        byStage.set(s.stageId, prev ? { ...prev, to: s.to } : { name: s.name, from: s.from, to: s.to });
      }
  const nextFrom = shiftDate(to, 1);
  const nextTo = shiftDate(to, 7);
  return {
    site,
    from,
    to,
    days: days.map((d) => ({ date: d.date, weekday: d.weekday, crewTotal: d.crewTotal, staff: d.staff.length, reports: d.reports.length, photos: d.photos.length, work: d.work[0] ?? "" })),
    crewTotal: days.reduce((a, d) => a + d.crewTotal, 0),
    reportDays: days.filter((d) => d.reports.length).length,
    stages: [...byStage.values()],
    issues: days.flatMap((d) => d.issues.map((text) => ({ date: d.date, text }))),
    openOrders: (db.workOrders ?? []).filter((w) => w.siteId === site.id && w.status !== "confirmed").map((w) => ({ title: w.title, status: w.status, dueDate: w.dueDate })),
    nextStages: site.stages.filter((s) => s.progressPct < 100 && s.startDate <= nextTo && s.endDate >= nextFrom).map((s) => ({ name: s.name, startDate: s.startDate, endDate: s.endDate, progressPct: s.progressPct })),
  };
}
