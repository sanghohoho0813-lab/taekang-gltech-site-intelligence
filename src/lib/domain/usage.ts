/**
 * 사용 현황 (계약 4단계 ‘실사용 검증’) — 현장 직원이 실제로 쓰는지, 본사가 제때 응답하는지 (결정론적 규칙, AI 아님)
 * - 로그인 기록이 아니라 실제로 남긴 업무 기록(출퇴근·보고·작업 인원·지시 처리)으로 판단한다
 * - 작업일 = 월~토 + 실제로 일한 일요일 (공휴일 미반영), 그 사람의 첫 기록일부터 센다 (늦게 합류한 사람을 불리하게 보지 않음)
 */
import type { DemoDB, DemoUser } from "./types";
import { shiftDate } from "./attendance";

export type Adoption = "settled" | "partial" | "none";

export const ADOPTION_LABEL: Record<Adoption, string> = {
  settled: "정착",
  partial: "일부 사용",
  none: "사용 전·중단",
};

export interface FieldUsage {
  user: DemoUser;
  /** 집계 시작일 (기간 시작과 첫 기록일 중 늦은 날) */
  since: string | null;
  workdays: number;
  attendDays: number;
  /** 퇴근까지 찍은 날 */
  outDays: number;
  reportDays: number;
  photoReports: number;
  reports: number;
  crewDays: number;
  ordersAssigned: number;
  ordersDone: number;
  /** 작업지시 접수까지 걸린 시간 중앙값 (시간) */
  orderAckHours: number | null;
  fixRequests: number;
  lastAt: string | null;
  attendRate: number | null;
  reportRate: number | null;
  status: Adoption;
  notes: string[];
}

export interface ResponseStat {
  key: string;
  label: string;
  /** 중앙값 (시간) */
  medianHours: number | null;
  n: number;
  /** 아직 처리 안 된 것 */
  open: number;
  /** 기준 시간을 넘겨 아직 처리 안 된 것 */
  overdue: number;
  targetHours: number;
}

export interface UsageSummary {
  from: string;
  to: string;
  field: FieldUsage[];
  response: ResponseStat[];
  settled: number;
}

const H = 3_600_000;
const hours = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / H;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 월~토 작업일 수 (from~to 포함) */
export function workdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = shiftDate(d, 1)) if (new Date(`${d}T12:00:00Z`).getUTCDay() !== 0) n += 1;
  return n;
}

const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * H).toISOString().slice(0, 10);

export function fieldUsage(db: DemoDB, user: DemoUser, from: string, to: string): FieldUsage {
  const inRange = (d: string) => d >= from && d <= to;
  const att = (db.attendance ?? []).filter((r) => r.userId === user.id && inRange(r.workDate));
  const reports = db.reports.filter((r) => r.createdBy === user.id && r.status !== "voided" && !r.importBatchId && inRange(r.reportDate));
  const crew = (db.crewChecks ?? []).filter((c) => c.by === user.id && !c.imported && inRange(c.workDate));
  const orders = (db.workOrders ?? []).filter((w) => w.assigneeUserId === user.id && inRange(kstDate(w.createdAt)));
  const fixes = (db.attendanceRequests ?? []).filter((q) => q.userId === user.id && inRange(q.workDate));

  const stamps = [...att.flatMap((r) => [r.inAt, r.outAt ?? ""]), ...reports.map((r) => r.createdAt), ...crew.map((c) => c.at), ...orders.flatMap((w) => w.history.filter((h) => h.by === user.id).map((h) => h.at)), ...fixes.map((q) => q.createdAt)].filter(Boolean).sort();
  const firstDay = [...att.map((r) => r.workDate), ...reports.map((r) => r.reportDate), ...crew.map((c) => c.workDate)].sort()[0] ?? null;
  const since = firstDay ? (firstDay > from ? firstDay : from) : null;
  const attendDates = new Set(att.map((r) => r.workDate));
  const attendDays = attendDates.size;
  // 일요일에 실제로 일한 날은 작업일로 더한다 (출근 기록일이 작업일보다 많아지지 않게)
  const sundayWorked = [...attendDates].filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0).length;
  const workdays = since ? workdaysBetween(since, to) + sundayWorked : 0;
  const outDays = new Set(att.filter((r) => r.outAt).map((r) => r.workDate)).size;
  const reportDays = new Set(reports.map((r) => r.reportDate)).size;
  const ackHours = orders.map((w) => {
    const ack = w.history.find((h) => h.to === "received" || h.to === "in_progress" || h.to === "done");
    return ack ? hours(w.createdAt, ack.at) : null;
  });
  const attendRate = workdays ? Math.min(1, attendDays / workdays) : null;
  // 보고율: 출근한 날 중 보고를 보낸 날 (출근 기록을 안 쓰는 현장이면 작업일 기준)
  const reportRate = attendDays ? Math.min(1, new Set(reports.map((r) => r.reportDate).filter((d) => att.some((a) => a.workDate === d))).size / attendDays) : workdays ? Math.min(1, reportDays / workdays) : null;

  let status: Adoption = "none";
  if (attendRate !== null && attendRate >= 0.8 && (reportRate ?? 0) >= 0.6) status = "settled";
  else if ((attendRate ?? 0) >= 0.4 || reportDays > 0 || crew.length > 0) status = "partial";

  const notes: string[] = [];
  const lastAt = stamps.at(-1) ?? null;
  if (!lastAt) notes.push("이 기간 업무 기록이 없습니다 — 계정 안내·첫 사용 교육 필요");
  else {
    const idleDays = workdaysBetween(shiftDate(kstDate(lastAt), 1), to);
    if (idleDays >= 3) notes.push(`마지막 기록 후 작업일 ${idleDays}일째 기록 없음`);
  }
  if (attendDays && outDays / attendDays < 0.7) notes.push(`퇴근을 찍지 않은 날이 많음 (${attendDays - outDays}일)`);
  if (reports.length && reports.filter((r) => r.photoIds.length).length / reports.length < 0.5) notes.push("사진 없는 보고가 절반 이상");
  const unacked = orders.filter((w) => w.status === "sent").length;
  if (unacked) notes.push(`확인 안 한 작업지시 ${unacked}건`);

  return {
    user,
    since,
    workdays,
    attendDays,
    outDays,
    reportDays,
    photoReports: reports.filter((r) => r.photoIds.length).length,
    reports: reports.length,
    crewDays: new Set(crew.map((c) => c.workDate)).size,
    ordersAssigned: orders.length,
    ordersDone: orders.filter((w) => w.status === "done" || w.status === "confirmed").length,
    orderAckHours: median(ackHours.filter((x): x is number => x !== null)),
    fixRequests: fixes.length,
    lastAt,
    attendRate,
    reportRate,
    status,
    notes,
  };
}

/** 본사 응답 시간 — 현장이 보낸 것에 본사가 얼마나 빨리 답하는지 */
export function responseStats(db: DemoDB, from: string, to: string, now: Date): ResponseStat[] {
  const inRange = (iso: string) => {
    const d = kstDate(iso);
    return d >= from && d <= to;
  };
  const nowIso = now.toISOString();
  const stat = (key: string, label: string, targetHours: number, items: { start: string; end?: string }[]): ResponseStat => {
    const doneH = items.filter((i) => i.end).map((i) => hours(i.start, i.end!));
    const open = items.filter((i) => !i.end);
    return { key, label, targetHours, medianHours: median(doneH), n: doneH.length, open: open.length, overdue: open.filter((i) => hours(i.start, nowIso) > targetHours).length };
  };
  // 엑셀로 옮긴 지난 공정 기록은 ‘현장 보고 확인’ 처리 시간에 넣지 않는다 (D-71)
  const reports = db.reports.filter((r) => r.status !== "voided" && !r.importBatchId && inRange(r.createdAt));
  const fixes = (db.attendanceRequests ?? []).filter((q) => inRange(q.createdAt));
  const orders = (db.workOrders ?? []).filter((w) => inRange(w.createdAt));
  const doneAt = (w: (typeof orders)[number]) => [...w.history].reverse().find((h) => h.to === "done")?.at;
  const confirmedAt = (w: (typeof orders)[number]) => w.history.find((h) => h.to === "confirmed" || h.to === "returned")?.at;
  const partner = db.partnerRequests.filter((r) => inRange(r.createdAt));
  return [
    stat("report", "현장 보고 확인", 24, reports.map((r) => ({ start: r.createdAt, end: r.review?.at }))),
    stat("fix", "근태 수정 요청 처리", 24, fixes.map((q) => ({ start: q.createdAt, end: q.reviewedAt }))),
    stat(
      "order",
      "작업지시 완료 확인",
      24,
      orders.filter((w) => doneAt(w)).map((w) => ({ start: doneAt(w)!, end: confirmedAt(w) && confirmedAt(w)! >= doneAt(w)! ? confirmedAt(w) : undefined })),
    ),
    stat("partner", "고객 요청 회신", 48, partner.map((r) => ({ start: r.createdAt, end: r.history.find((h) => h.status === "answered")?.at }))),
  ];
}

export function usageSummary(db: DemoDB, from: string, to: string, now: Date): UsageSummary {
  const users = db.users.filter((u) => u.role === "field" && !u.inactive);
  const field = users.map((u) => fieldUsage(db, u, from, to)).sort((a, b) => order(a.status) - order(b.status) || a.user.name.localeCompare(b.user.name, "ko"));
  return { from, to, field, response: responseStats(db, from, to, now), settled: field.filter((f) => f.status === "settled").length };
}

const order = (s: Adoption) => (s === "none" ? 0 : s === "partial" ? 1 : 2);

export function fmtHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}분`;
  if (h < 48) return `${Math.round(h * 10) / 10}시간`;
  return `${Math.round(h / 24)}일`;
}
