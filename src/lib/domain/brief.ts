/**
 * 아침 알림 (D-72) — 매일 아침 7시 30분 점검이 하루 한 번 보낸다. 같은 내용을 화면 ‘아침 알림 미리보기’도 보여 준다.
 * - 본사(대표·공무): 지난 근무일(월요일이면 토·일) 출근했는데 보고가 없는 현장 + 매일 손댈 처리 대기 (대시보드 ‘처리 대기’와 같은 계산 · 인건비·앱 의견·운영 자료는 빼고)
 * - 현장 직원: 내 작업지시 중 새 지시·오늘 기한·기한 지남·보완 요청, 본사가 보완을 요청한 내 보고
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
    // 사진만·비용만 보낸 것은 그날 보고로 치지 않는다 (현장 홈 ‘오늘 보고’와 같은 기준 · D-65·D-72 점검 반영)
    .filter((s) => !db.reports.some((r) => r.siteId === s.id && r.reportDate === date && r.status !== "voided" && !r.importBatchId && !r.kind))
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

const WD = ["일", "월", "화", "수", "목", "금", "토"];
/** 11/07(토) */
export const shortDay = (date: string) => `${date.slice(5, 7)}/${date.slice(8, 10)}(${WD[weekday(date)]})`;

/** 아침 알림이 돌아볼 날 — 어제, 월요일이면 토·일 둘 다 (일요일 출근을 놓치지 않게 · D-72 점검 반영) */
export function briefLookback(today: string): string[] {
  return weekday(today) === 1 ? [shiftDate(today, -2), shiftDate(today, -1)] : [shiftDate(today, -1)];
}

/**
 * 본사 아침 알림 — 지난 근무일 보고 빠진 현장 + 매일 손댈 처리 대기.
 * 잠금화면 문구: 제목은 ‘현장 N곳 · 처리 대기 M건’처럼 단위를 나누고, 주말 이틀은 한 묶음으로 (같은 현장이 두 번 세어지던 문제 · D-72 점검 반영)
 */
export function hqBrief(db: DemoDB, today: string, live: boolean): HqBrief {
  const lines: BriefLine[] = [];
  const days = briefLookback(today);
  const missingNames = new Set<string>();
  for (const day of days) {
    const missing = missingReportSites(db, day);
    if (!missing.length) continue;
    missing.forEach((m) => missingNames.add(m.name));
    lines.push({ key: `missing-${day}`, label: `${shortDay(day)} 출근했는데 보고 없는 현장 (${missing.map((m) => m.name).join(", ")})`, n: missing.length, href: `/daily?date=${day}` });
  }
  const items = pendingItems(db, today, live);
  let pending = 0;
  const parts: string[] = [];
  for (const k of HQ_KEYS) {
    const it = items.find((x) => x.key === k);
    if (it?.n) {
      lines.push({ key: k, label: SHORT[k] ?? it.label, n: it.n, href: it.href });
      parts.push(`${SHORT[k] ?? it.label} ${it.n}`);
      pending += it.n;
    }
  }
  const sites = missingNames.size;
  const when = days.length > 1 ? `주말(${days.map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`).join("·")})` : shortDay(days[0]);
  const head = sites ? `${when} 보고 없는 현장 ${sites}곳(${[...missingNames].join("·")})` : "";
  const title = sites && pending ? `오늘 아침: 보고 없는 현장 ${sites}곳 · 처리 대기 ${pending}건` : sites ? `오늘 아침: 보고 없는 현장 ${sites}곳` : `오늘 아침 처리 대기 ${pending}건`;
  return { lines, total: sites + pending, title, body: clip([head, parts.length ? `처리 대기 — ${parts.join(" · ")}` : ""].filter(Boolean).join(" / ")) };
}

export interface FieldBrief {
  userId: string;
  name: string;
  lines: BriefLine[];
  total: number;
  title: string;
  body: string;
}

/**
 * 현장 직원 아침 알림 — 현장 앱과 같은 말 ‘본사 요청’. 기한 지남 → 오늘 기한 → 보완 요청 → 새 지시 순으로 세고,
 * 알림 본문은 가장 급한 한 건(현장·제목)을 앞에 둔다 (숫자만 보고는 무슨 일인지 몰라 앱을 열어야 하던 문제 · D-72 점검 반영)
 */
export function fieldBriefs(db: DemoDB, today: string): FieldBrief[] {
  const open = (db.workOrders ?? []).filter((w) => !["done", "confirmed"].includes(w.status));
  const siteName = (id: string) => db.sites.find((s) => s.id === id)?.shortName ?? "현장";
  return db.users
    .filter((u) => u.role === "field" && !u.inactive)
    .map((u) => {
      const mine = open.filter((w) => w.assigneeUserId === u.id);
      const returned = mine.filter((w) => w.status === "returned");
      // 기한은 확인 여부와 상관없이 — 확인 안 한 지시도 기한이 지났으면 ‘기한 지남’ (D-72 점검 반영)
      const notReturned = mine.filter((w) => w.status !== "returned");
      const late = notReturned.filter((w) => !!w.dueDate && w.dueDate < today);
      const dueToday = notReturned.filter((w) => w.dueDate === today);
      // 아직 ‘확인했어요’를 누르지 않은 새 지시 (기한이 남은 것) — 본사에는 ‘미접수’로 보이는 것
      const fresh = notReturned.filter((w) => w.status === "sent" && !(w.dueDate && w.dueDate <= today));
      // 위험 조치 중 이 사람에게 맡긴 것 — 기한이 오늘이거나 지난 것 (현장 홈 ‘본사 요청’과 같은 목록)
      const actions = db.actions.filter((a) => a.assigneeUserId === u.id && !["done", "dismissed", "recommended", "on_hold"].includes(a.status) && !!a.dueDate && a.dueDate <= today);
      // 보완 요청 뒤 덧붙이지 않은 내 보고 — 지금 담당 현장 것만 (휴대폰에 안 보이는 보고를 매일 알리지 않게)
      const mySites = new Set(db.sites.filter((s) => s.fieldUserId === u.id || (u.siteIds ?? []).includes(s.id)).map((s) => s.id));
      const reports = db.reports.filter((r) => r.createdBy === u.id && mySites.has(r.siteId) && r.status !== "voided" && r.review?.status === "returned" && !(r.supplements ?? []).some((s) => s.at > r.review!.at));
      const lines: BriefLine[] = [
        { key: "late", label: "기한 지난 본사 요청", n: late.length, href: "/my-actions" },
        { key: "due", label: "오늘까지 할 본사 요청", n: dueToday.length + actions.length, href: "/my-actions" },
        { key: "wo-returned", label: "다시 해 달라는 본사 요청", n: returned.length, href: "/my-actions" },
        { key: "report-returned", label: "보완해 달라는 내 보고", n: reports.length, href: "/my#my-reports" },
        { key: "new", label: "새 본사 요청 (확인 전)", n: fresh.length, href: "/my-actions" },
      ].filter((l) => l.n > 0);
      const total = lines.reduce((a, l) => a + l.n, 0);
      // 가장 급한 한 건: 기한 지남 → 오늘 기한 → 다시 해 달라는 것 → 보완 보고 → 새 지시
      const first =
        late[0] ? `${siteName(late[0].siteId)} · ${late[0].title} — 기한 지남`
        : dueToday[0] ? `${siteName(dueToday[0].siteId)} · ${dueToday[0].title} — 오늘까지`
        : actions[0] ? `${siteName(actions[0].siteId)} · ${actions[0].title} — 오늘까지`
        : returned[0] ? `${siteName(returned[0].siteId)} · ${returned[0].title} — 다시 해 주세요`
        : reports[0] ? `${siteName(reports[0].siteId)} 보고 — 보완해서 다시 보내 주세요`
        : fresh[0] ? `${siteName(fresh[0].siteId)} · ${fresh[0].title} — 확인해 주세요`
        : "";
      const body = clip(`${first}${total > 1 ? ` (외 ${total - 1}건)` : ""}`, 80);
      return { userId: u.id, name: u.name, lines, total, title: `오늘 확인할 본사 요청 ${total}건`, body };
    })
    .filter((b) => b.total > 0);
}
