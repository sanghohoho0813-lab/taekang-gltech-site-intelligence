/**
 * 출퇴근 확인 규칙 (본사 화면) — 결정론적 규칙, AI 아님
 * 의심 표시는 '확인해 볼 것'이지 부정 확정이 아니다. 본사가 사람에게 확인한다.
 */
import type { AttendanceRecord, DemoDB, FieldReport, Site } from "./types";
import { todayIso } from "./format";

export type AttendanceFlagKind = "outside" | "no_location" | "weak" | "nosite" | "shared_device" | "same_spot" | "no_checkout" | "missing" | "no_qr" | "sent_later";

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
};

/** 위험도 순 (위가 먼저) */
export const FLAG_ORDER: AttendanceFlagKind[] = ["shared_device", "same_spot", "no_qr", "outside", "sent_later", "no_location", "missing", "no_checkout", "weak", "nosite"];

const att = (db: DemoDB) => db.attendance ?? [];

/** 현장에 배정된 현장 직원 (현장 담당 + 출근 기록이 있는 사람) */
export function siteCrew(db: DemoDB, site: Site, date: string): string[] {
  const ids = new Set<string>();
  if (site.fieldUserId && db.users.some((u) => u.id === site.fieldUserId && !u.inactive)) ids.add(site.fieldUserId);
  // 이 현장 하나만 배정된 현장 직원도 매일 나올 사람으로 본다 — 담당 미지정 현장의 미출근이 안 잡히던 문제 (D-77 리허설). 여러 현장을 도는 사람은 출근한 날만
  for (const u of db.users) if (u.role === "field" && !u.inactive && (u.siteIds ?? []).length === 1 && u.siteIds![0] === site.id) ids.add(u.id);
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
  // 같은 휴대폰으로 같은 날 여러 명 출근 → 대리 출근 의심
  const byDevice = new Map<string, Set<string>>();
  for (const r of records) for (const d of [r.inDevice, r.outDevice]) if (d) byDevice.set(d, (byDevice.get(d) ?? new Set()).add(r.userId));
  for (const [, users] of byDevice) {
    if (users.size < 2) continue;
    const list = [...users];
    for (const u of list) flags.push({ kind: "shared_device", userId: u, workDate: date, text: `${list.map(name).join(", ")} — 같은 휴대폰으로 출퇴근했습니다` });
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
