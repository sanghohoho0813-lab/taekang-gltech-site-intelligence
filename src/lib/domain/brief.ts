/**
 * 아침 알림 (D-72) — 매일 아침 점검이 하루 한 번 보낸다. 같은 내용을 화면 ‘아침 알림 미리보기’도 보여 준다.
 * - 본사(대표·공무): 어제 출근했는데 보고가 없는 현장 + 오늘 손댈 처리 대기 (대시보드 ‘처리 대기’와 같은 계산)
 * - 현장 직원: 내 작업지시 중 오늘 기한·기한 지남·보완 요청, 본사가 보완을 요청한 내 보고
 * - 할 일이 없으면 보내지 않는다. 일요일은 쉰다. 잠금화면에 보이므로 금액은 넣지 않는다.
 */
import type { DemoDB } from "./types";
import { shiftDate } from "./attendance";
import { pendingItems, type PendingKey } from "./pending";

/** 아침 알림에 넣는 처리 대기 — 매일 손댈 것만 (인건비·운영 자료·앱 의견·하자보증은 따로 알리거나 대시보드에서) */
const HQ_KEYS: PendingKey[] = ["wo-late", "report", "wo-done", "fix", "defect", "partner", "cost"];
const SHORT: Partial<Record<PendingKey, string>> = {
  "wo-late": "기한 지난·미접수 작업지시",
  report: "확인 안 한 현장 보고",
  "wo-done": "완료 확인할 작업지시",
  fix: "근태 수정 요청",
  defect: "하자보수 본사 할 일",
  partner: "회신 안 한 고객 요청",
  cost: "공무 확인 대기 원가",
};

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
/** 아침 알림을 쉬는 날 (일요일) */
export const briefRestDay = (date: string) => weekday(date) === 0;

/** 그날 출근(또는 작업 인원 기록)이 있었는데 현장 보고가 없는 진행 중 현장 (엑셀로 옮긴 기록은 보고로 치지 않음) */
export function missingReportSites(db: DemoDB, date: string): { siteId: string; name: string }[] {
  return db.sites
    .filter((s) => s.status === "active")
    .filter((s) => (db.attendance ?? []).some((a) => a.siteId === s.id && a.workDate === date) || (db.crewChecks ?? []).some((c) => c.siteId === s.id && c.workDate === date && !c.imported))
    .filter((s) => !db.reports.some((r) => r.siteId === s.id && r.reportDate === date && r.status !== "voided" && !r.importBatchId))
    .map((s) => ({ siteId: s.id, name: s.shortName }));
}

export interface BriefLine {
  key: string;
  label: string;
  n: number;
  href: string;
}
export interface HqBrief {
  lines: BriefLine[];
  total: number;
  title: string;
  body: string;
}

const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** 본사 아침 알림 — 어제(일요일이면 토요일) 보고 빠진 현장 + 처리 대기 */
export function hqBrief(db: DemoDB, today: string, live: boolean): HqBrief {
  const yesterday = shiftDate(today, weekday(today) === 1 ? -2 : -1);
  const missing = missingReportSites(db, yesterday);
  const lines: BriefLine[] = [];
  if (missing.length) lines.push({ key: "missing", label: `${yesterday.slice(5).replace("-", "/")} 출근했는데 보고 없는 현장 (${missing.map((m) => m.name).join(", ")})`, n: missing.length, href: "/daily" });
  const items = pendingItems(db, today, live);
  for (const k of HQ_KEYS) {
    const it = items.find((x) => x.key === k);
    if (it?.n) lines.push({ key: k, label: SHORT[k] ?? it.label, n: it.n, href: it.href });
  }
  const total = lines.reduce((a, l) => a + l.n, 0);
  const body = clip(lines.map((l) => (l.key === "missing" ? `보고 없는 현장 ${l.n}곳(${missing.map((m) => m.name).join("·")})` : `${l.label} ${l.n}건`)).join(" · "));
  return { lines, total, title: `오늘 아침 확인할 일 ${total}건`, body };
}

export interface FieldBrief {
  userId: string;
  name: string;
  lines: BriefLine[];
  total: number;
  title: string;
  body: string;
}

/** 현장 직원 아침 알림 — 내 작업지시(오늘 기한·기한 지남·보완 요청)와 보완 요청 받은 내 보고 */
export function fieldBriefs(db: DemoDB, today: string): FieldBrief[] {
  const open = (db.workOrders ?? []).filter((w) => !["done", "confirmed"].includes(w.status));
  return db.users
    .filter((u) => u.role === "field" && !u.inactive)
    .map((u) => {
      const mine = open.filter((w) => w.assigneeUserId === u.id);
      const returned = mine.filter((w) => w.status === "returned");
      const dueToday = mine.filter((w) => w.status !== "returned" && w.dueDate === today);
      const late = mine.filter((w) => w.status !== "returned" && !!w.dueDate && w.dueDate < today);
      // 보완 요청 뒤 덧붙이지 않은 내 보고
      const reports = db.reports.filter((r) => r.createdBy === u.id && r.status !== "voided" && r.review?.status === "returned" && !(r.supplements ?? []).some((s) => s.at > r.review!.at));
      const lines: BriefLine[] = [
        { key: "due", label: "오늘 기한 작업지시", n: dueToday.length, href: "/my-actions" },
        { key: "late", label: "기한 지난 작업지시", n: late.length, href: "/my-actions" },
        { key: "wo-returned", label: "보완 요청 받은 작업지시", n: returned.length, href: "/my-actions" },
        { key: "report-returned", label: "보완 요청 받은 보고", n: reports.length, href: "/my#my-reports" },
      ].filter((l) => l.n > 0);
      const total = lines.reduce((a, l) => a + l.n, 0);
      return { userId: u.id, name: u.name, lines, total, title: `오늘 할 일 ${total}건`, body: clip(lines.map((l) => `${l.label} ${l.n}건`).join(" · ")) };
    })
    .filter((b) => b.total > 0);
}
