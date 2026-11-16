/**
 * 출퇴근 확인 규칙 (본사 화면) — 결정론적 규칙, AI 아님
 * 의심 표시는 '확인해 볼 것'이지 부정 확정이 아니다. 본사가 사람에게 확인한다.
 */
import type { AttendanceRecord, DemoDB, FieldReport, Site } from "./types";
import { todayIso } from "./format";

export type AttendanceFlagKind = "outside" | "no_location" | "weak" | "nosite" | "shared_device" | "same_spot" | "no_checkout" | "missing" | "no_qr" | "sent_later" | "overlap";

export interface AttendanceFlag {
  kind: AttendanceFlagKind;
  userId: string;
  siteId?: string;
  recordId?: string;
  workDate?: string;
  text: string;
}

export const FLAG_LABEL: Record<AttendanceFlagKind, string> = {
  outside: "현장 밖 출근·퇴근",
  no_location: "위치 없이 출근",
  weak: "위치 불확실",
  nosite: "현장 위치 미등록",
  shared_device: "같은 휴대폰으로 여러 명",
  same_spot: "위치가 매일 똑같음",
  no_checkout: "퇴근 기록 없음",
  missing: "미출근",
  no_qr: "현장 QR 없이 출근",
  sent_later: "통신 불량 — 나중에 전송",
  overlap: "같은 시간 두 현장 (근무시간 두 번 셈)",
};

/** 위험도 순 (위가 먼저) */
export const FLAG_ORDER: AttendanceFlagKind[] = ["shared_device", "same_spot", "no_qr", "outside", "overlap", "sent_later", "no_location", "missing", "no_checkout", "weak", "nosite"];

const att = (db: DemoDB) => db.attendance ?? [];

/** 현장에 배정된 현장 직원 (현장 담당 + 출근 기록이 있는 사람) */
export function siteCrew(db: DemoDB, site: Site, date: string): string[] {
  const ids = new Set<string>();
  if (site.fieldUserId && db.users.some((u) => u.id === site.fieldUserId && !u.inactive)) ids.add(site.fieldUserId);
  // 이 현장 하나만 배정된 현장 직원도 매일 나올 사람으로 본다 — 담당 미지정 현장의 미출근이 안 잡히던 문제 (D-77 리허설). 여러 현장을 도는 사람은 출근한 날만
  for (const u of db.users) {
    if (u.role !== "field" || u.inactive) continue;
    // 진행 중인 배정 현장이 이곳 하나뿐이면 (준공한 현장 배정은 세지 않는다 · D-78)
    const live = (u.siteIds ?? []).filter((id) => db.sites.some((x) => x.id === id && x.status === "active"));
    if (live.length === 1 && live[0] === site.id) ids.add(u.id);
  }
  for (const r of att(db)) if (r.siteId === site.id && r.workDate === date) ids.add(r.userId);
  return [...ids];
}

/** 하루 기준 의심 표시 */
export function dayFlags(db: DemoDB, date: string, now = new Date()): AttendanceFlag[] {
  const flags: AttendanceFlag[] = [];
  const records = att(db).filter((r) => r.workDate === date);
  const name = (id: string) => db.users.find((u) => u.id === id)?.name ?? "알 수 없음";
  const qrMode = db.settings?.attendanceMode === "qr";
  for (const r of records) {
    // QR 출근 방식인데 현장 태블릿 QR이 확인되지 않은 출근
    if (qrMode && r.inQr?.status !== "ok")
      flags.push({ kind: "no_qr", userId: r.userId, siteId: r.siteId, recordId: r.id, workDate: date, text: `${name(r.userId)} — ${r.inQr ? `QR 확인 실패 (${r.inQr.status === "expired" ? "만료된 QR" : r.inQr.status === "wrong_site" ? "다른 현장 QR" : r.inQr.status === "revoked" ? "해제된 단말기" : "QR 오류"})` : "QR 없이 출근"}` });
    // 통신 불량으로 나중에 보낸 출퇴근 — 본사가 누른 시각 요청을 처리하기 전까지 (D-55)
    for (const [what, sl, sent] of [["출근", r.inSentLater, r.inAt], ["퇴근", r.outSentLater, r.outAt]] as const) {
      if (!sl || !sent) continue;
      const req = sl.requestId ? (db.attendanceRequests ?? []).find((q) => q.id === sl.requestId) : undefined;
      if (req && req.status !== "pending") continue;
      // 요청 없이 표시만 된 경우: 도착 뒤 본사가 정정했으면(또는 그날 요청을 처리했으면) 끝난 것으로 (리뷰 반영)
      if (!req && ((r.corrections ?? []).some((c) => c.at >= sent) || (db.attendanceRequests ?? []).some((q) => q.userId === r.userId && q.siteId === r.siteId && q.workDate === r.workDate && q.status !== "pending" && (q.reviewedAt ?? "") >= sent))) continue;
      flags.push({ kind: "sent_later", userId: r.userId, siteId: r.siteId, recordId: r.id, workDate: date, text: `${name(r.userId)} — ${what} ${hhmm(sl.pressedAt)}에 눌렀는데 통신이 안 돼 ${hhmm(sent)}에 도착 (${req ? "‘지시·확인’에서 누른 시각 승인/반려" : "누른 시각은 휴대폰 시계 기준 — 확인 후 정정"})` });
    }
    const geos = [r.inGeo, r.outGeo].filter(Boolean);
    // 본사가 예외(GPS 실패·누락 등)를 승인한 기록은 위치 의심 표시를 하지 않는다 (사유는 화면에 표시)
    if (r.exceptionNote) continue;
    if (geos.some((g) => g!.status === "outside")) flags.push({ kind: "outside", userId: r.userId, siteId: r.siteId, recordId: r.id, workDate: date, text: `${name(r.userId)} — 현장에서 떨어진 곳에서 눌렀습니다` });
    else if (r.inGeo.status === "none") flags.push({ kind: "no_location", userId: r.userId, siteId: r.siteId, recordId: r.id, workDate: date, text: `${name(r.userId)} — 위치 없이 출근했습니다` });
    else if (geos.some((g) => g!.status === "weak")) flags.push({ kind: "weak", userId: r.userId, siteId: r.siteId, recordId: r.id, workDate: date, text: `${name(r.userId)} — 위치 오차가 커서 확인이 필요합니다` });
    else if (r.inGeo.status === "nosite") flags.push({ kind: "nosite", userId: r.userId, siteId: r.siteId, recordId: r.id, workDate: date, text: `현장 위치가 등록되지 않아 판단할 수 없습니다` });
  }
  // 같은 사람이 같은 시간에 두 현장 — 근무시간이 두 번 셈해진다 (D-80 · 월 마감에만 보이고 출퇴근 현황엔 ‘의심 없음’이던 문제)
  for (const o of overlapPairs(db, date, date)) {
    const sn = (id: string) => db.sites.find((x) => x.id === id)?.shortName ?? "";
    flags.push({ kind: "overlap", userId: o.userId, recordId: o.earlier.id, workDate: date, text: `${name(o.userId)} — ${sn(o.earlier.siteId)} ${span(o.earlier)}와 ${sn(o.later.siteId)} ${span(o.later)}이 ${o.minutes}분 겹칩니다` });
  }
  // 같은 휴대폰으로 같은 날 여러 명 출근 → 대리 출근 의심
  const byDevice = new Map<string, Set<string>>();
  for (const r of records) for (const d of [r.inDevice, r.outDevice]) if (d) byDevice.set(d, (byDevice.get(d) ?? new Set()).add(r.userId));
  for (const [, users] of byDevice) {
    if (users.size < 2) continue;
    const list = [...users];
    for (const u of list) flags.push({ kind: "shared_device", userId: u, workDate: date, text: `${list.map(name).join(", ")} — 같은 휴대폰으로 출퇴근했습니다` });
  }
  // 지난 날짜를 열었을 때: 그날 퇴근 기록이 없으면 표시 — 지난달 퇴근 누락이 날짜를 골라도 안 보이던 문제 (D-78 첫 달 리허설)
  if (date < todayIso(now)) {
    for (const r of records.filter((x) => !x.outAt)) flags.push({ kind: "no_checkout", userId: r.userId, siteId: r.siteId, recordId: r.id, workDate: r.workDate, text: `${name(r.userId)} — ${r.workDate.replace(/-/g, ".")} 퇴근 기록이 없습니다 (근무 시간 확인 필요)` });
  }
  // 미출근 (오늘만, 현장 담당인데 출근 기록 없음)
  if (date === todayIso(now)) {
    for (const s of db.sites.filter((x) => x.status === "active")) {
      for (const u of siteCrew(db, s, date)) {
        // 다른 담당 현장에 출근했으면 미출근이 아니다
        if (!records.some((r) => r.userId === u)) flags.push({ kind: "missing", userId: u, siteId: s.id, workDate: date, text: `${name(u)} — ${s.shortName} 출근 기록이 아직 없습니다` });
      }
    }
  }
  return flags;
}

/** 여러 날에 걸친 의심 표시 (퇴근 누락·위치가 매일 똑같음) */
export function recentFlags(db: DemoDB, today: string, days = 14): AttendanceFlag[] {
  const flags: AttendanceFlag[] = [];
  const from = shiftDate(today, -days);
  const recent = att(db).filter((r) => r.workDate >= from && r.workDate <= today);
  const name = (id: string) => db.users.find((u) => u.id === id)?.name ?? "알 수 없음";
  for (const r of recent) {
    if (!r.outAt && r.workDate < today) flags.push({ kind: "no_checkout", userId: r.userId, siteId: r.siteId, recordId: r.id, workDate: r.workDate, text: `${name(r.userId)} — ${r.workDate.replace(/-/g, ".")} 퇴근 기록이 없습니다 (근무 시간 확인 필요)` });
  }
  // 실제 GPS는 매번 조금씩 달라진다. 소수점 6자리까지 같은 좌표가 3일 이상이면 위치 조작 앱을 의심
  const byUser = new Map<string, Map<string, Set<string>>>();
  for (const r of recent) {
    const g = r.inGeo;
    if (g.lat === undefined || g.lng === undefined) continue;
    const key = `${g.lat},${g.lng}`;
    const m = byUser.get(r.userId) ?? new Map<string, Set<string>>();
    m.set(key, (m.get(key) ?? new Set()).add(r.workDate));
    byUser.set(r.userId, m);
  }
  for (const [u, spots] of byUser) {
    for (const [, dates] of spots) {
      if (dates.size >= 3) {
        flags.push({ kind: "same_spot", userId: u, text: `${name(u)} — ${dates.size}일 동안 출근 위치가 소수점까지 똑같습니다 (위치 조작 앱 확인 필요)` });
        break;
      }
    }
  }
  return flags;
}

/** 보고가 '지난 날짜'로 작성됐는지 (작성일 − 보고일, 일) */
export function backdatedDays(r: Pick<FieldReport, "reportDate" | "createdAt">): number {
  const written = todayIso(new Date(r.createdAt));
  return Math.round((new Date(`${written}T00:00:00`).getTime() - new Date(`${r.reportDate}T00:00:00`).getTime()) / 86_400_000);
}

export function minutesOf(r: AttendanceRecord): number | null {
  return r.outAt ? Math.round((new Date(r.outAt).getTime() - new Date(r.inAt).getTime()) / 60_000) : null;
}

export interface MonthRow {
  userId: string;
  days: number;
  minutes: number;
  noCheckout: number;
  outside: number;
  noLocation: number;
  corrected: number;
  /** 현장 QR 확인된 출근 수 */
  qrOk: number;
}

/** 기간 합계 (급여·공수 정산 근거) */
/** 오늘 출근하고 아직 일하는 중(퇴근 전) — 퇴근 누락으로 세지 않는다 (D-77 리허설: 오늘 근무가 월 합계·사용 현황·인건비에 ‘퇴근 누락’으로 찍히던 문제) */
export function isOpenShift(r: Pick<AttendanceRecord, "outAt" | "workDate">, today = todayIso()): boolean {
  return !r.outAt && r.workDate >= today;
}

export function periodSummary(db: DemoDB, from: string, to: string, today = todayIso()): MonthRow[] {
  const rows = new Map<string, MonthRow>();
  // 출근일수는 ‘서로 다른 날’ 수 — 하루에 두 현장을 오가도 1일 (급여 근거 · D-66 점검 반영)
  const dates = new Map<string, Set<string>>();
  for (const r of att(db)) {
    if (r.workDate < from || r.workDate > to) continue;
    const row = rows.get(r.userId) ?? { userId: r.userId, days: 0, minutes: 0, noCheckout: 0, outside: 0, noLocation: 0, corrected: 0, qrOk: 0 };
    const ds = dates.get(r.userId) ?? new Set<string>();
    ds.add(r.workDate);
    dates.set(r.userId, ds);
    row.days = ds.size;
    const m = minutesOf(r);
    if (m === null) {
      if (!isOpenShift(r, today)) row.noCheckout += 1;
    } else row.minutes += m;
    if ([r.inGeo, r.outGeo].some((g) => g?.status === "outside")) row.outside += 1;
    if (r.inGeo.status === "none") row.noLocation += 1;
    if (r.corrections?.length) row.corrected += 1;
    if (r.inQr?.status === "ok") row.qrOk += 1;
    rows.set(r.userId, row);
  }
  return [...rows.values()].sort((a, b) => b.days - a.days);
}

export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 한국 시간 "07:42" */
export function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/**
 * 같은 사람·같은 날 다른 현장(다른 기록)과 시간이 겹치는지 (D-79) — 정정·근태 수정 승인으로 겹침을 새로 만들지 않게.
 * 겹치면 근무시간이 두 번 셈해진다 (월 마감 ‘시간 겹침’). 겹치는 다른 기록을 돌려준다.
 * - 둘 다 퇴근이 있으면: 구간이 겹치는지
 * - 고칠 기록에 퇴근이 없으면: 출근 시각이 다른 기록 구간 안인지
 * - 다른 기록에 퇴근이 없으면: 그 출근 시각이 고칠 기록 구간 안인지
 */
export function overlappingRecord(db: DemoDB, rec: { id?: string; userId: string; workDate: string; inAt: string; outAt?: string }): AttendanceRecord | undefined {
  const a0 = new Date(rec.inAt).getTime();
  const a1 = rec.outAt ? new Date(rec.outAt).getTime() : null;
  // 같은 날 + 앞뒤 하루 — 자정을 넘긴 야간 기록과 다음 날 기록도 본다 (D-79 버그 배시 m-1)
  const near = new Set([shiftDate(rec.workDate, -1), rec.workDate, shiftDate(rec.workDate, 1)]);
  return (db.attendance ?? []).find((o) => {
    if (o.id === rec.id || o.userId !== rec.userId || !near.has(o.workDate)) return false;
    const b0 = new Date(o.inAt).getTime();
    const b1 = o.outAt ? new Date(o.outAt).getTime() : null;
    if (a1 !== null && b1 !== null) return a0 < b1 && b0 < a1;
    if (a1 === null && b1 !== null) return a0 >= b0 && a0 < b1;
    if (a1 !== null && b1 === null) return b0 >= a0 && b0 < a1;
    return false;
  });
}

/** 겹칠 때 보여 줄 말 */
export function overlapMessage(db: DemoDB, o: AttendanceRecord): string {
  const site = db.sites.find((s) => s.id === o.siteId)?.shortName ?? "다른 현장";
  return `${Number(o.workDate.slice(5, 7))}/${Number(o.workDate.slice(8, 10))} ${site} 기록(${hhmm(o.inAt)}~${o.outAt ? hhmm(o.outAt) : "퇴근 없음"})과 시간이 겹칩니다 — 근무시간이 두 번 셈해집니다. 그 기록을 먼저 고치거나 시각을 다시 확인해 주세요.`;
}

const span = (r: Pick<AttendanceRecord, "inAt" | "outAt">) => `${hhmm(r.inAt)}~${r.outAt ? hhmm(r.outAt) : "퇴근 없음"}`;

/** 같은 사람의 시간이 겹치는 두 기록과 정리안 (D-80) */
export interface OverlapPair {
  userId: string;
  /** 뒤 기록의 근무일 */
  workDate: string;
  /** 먼저 시작한 기록 */
  earlier: AttendanceRecord;
  /** 나중에 시작한 기록 */
  later: AttendanceRecord;
  /** 겹친 시간 (분) */
  minutes: number;
  /** 정리안: 앞 기록의 퇴근을 뒤 기록 출근 시각으로 (앞 현장에서 퇴근을 늦게 누른 경우가 가장 흔함) */
  proposeOutAt: string;
  /** 뒤 기록이 앞 기록 안에 다 들어가 있으면 — 정리안대로 하면 뒤 기록이 끝난 뒤 앞 현장에 있던 시간(분)이 빠진다 */
  tailLostMin: number;
  /** 뒤 기록에 퇴근이 없거나 두 기록이 같은 시각에 시작해 정리안을 낼 수 없음 — 직접 확인 */
  manual: boolean;
}

/**
 * 기간 안(뒤 기록의 근무일 기준)의 겹침 — 같은 사람·앞뒤 하루까지 (자정을 넘긴 야간 포함).
 * 앞 기록의 퇴근이 없으면 겹침을 셀 수 없어 넣지 않는다 (퇴근 누락은 따로 잡힌다).
 */
export function overlapPairs(db: DemoDB, from: string, to: string, userId?: string): OverlapPair[] {
  const out: OverlapPair[] = [];
  const lo = shiftDate(from, -1);
  const byUser = new Map<string, AttendanceRecord[]>();
  for (const r of att(db)) {
    if (r.workDate < lo || r.workDate > to || (userId && r.userId !== userId)) continue;
    byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  }
  for (const [u, list] of byUser) {
    const recs = list.slice().sort((a, b) => a.inAt.localeCompare(b.inAt));
    for (let i = 0; i < recs.length; i++) {
      const a = recs[i];
      if (!a.outAt) continue;
      const a0 = new Date(a.inAt).getTime();
      const a1 = new Date(a.outAt).getTime();
      for (let j = i + 1; j < recs.length; j++) {
        const b = recs[j];
        const b0 = new Date(b.inAt).getTime();
        if (b0 >= a1) break;
        if (b.workDate < from || b.workDate > to) continue;
        const b1 = b.outAt ? new Date(b.outAt).getTime() : null;
        const end = b1 === null ? a1 : Math.min(a1, b1);
        const minutes = Math.round((end - b0) / 60_000);
        const manual = b1 === null || b0 <= a0;
        out.push({ userId: u, workDate: b.workDate, earlier: a, later: b, minutes, proposeOutAt: b.inAt, tailLostMin: b1 !== null && b1 < a1 ? Math.round((a1 - b1) / 60_000) : 0, manual });
      }
    }
  }
  return out.sort((x, y) => x.workDate.localeCompare(y.workDate) || x.userId.localeCompare(y.userId));
}
