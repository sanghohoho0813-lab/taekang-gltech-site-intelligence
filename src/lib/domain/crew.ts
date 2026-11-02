/**
 * 작업 인원(출력) 대조 규칙 — 결정론적 규칙, AI 아님. 표시는 ‘확인할 대상’이지 부정 확정이 아니다.
 */
import type { CrewCheck, DemoDB } from "./types";

export type CrewFlagKind = "photo_reused" | "manday_over" | "no_photo" | "outside" | "reporter_absent";

export interface CrewFlag {
  kind: CrewFlagKind;
  siteId: string;
  crewId?: string;
  text: string;
}

export const CREW_FLAG_LABEL: Record<CrewFlagKind, string> = {
  photo_reused: "같은 단체 사진 재사용",
  manday_over: "보고 공수가 출력 인원보다 많음",
  no_photo: "단체 사진 없음",
  outside: "현장 밖에서 보냄",
  reporter_absent: "보낸 사람 출근 기록 없음",
};

const crew = (db: DemoDB) => db.crewChecks ?? [];

/** 기간 안 노무 공수 보고 합계 vs 출력 인원일 합계 (현장별) */
export function mandayGap(db: DemoDB, siteId: string, from: string, to: string): { reported: number; crewDays: number } {
  const reported = db.costEntries
    .filter((e) => e.siteId === siteId && e.category === "labor" && e.qty && (e.status === "active" || e.status === "pending") && e.date >= from && e.date <= to)
    .reduce((s, e) => s + (e.qty?.manDays ?? 0), 0);
  const crewDays = crew(db)
    .filter((c) => c.siteId === siteId && c.workDate >= from && c.workDate <= to)
    .reduce((s, c) => s + c.headcount, 0);
  return { reported: Math.round(reported * 10) / 10, crewDays };
}

/** 공수 보고가 출력 인원일보다 10% 넘게 많고 2공수 이상 차이 → 확인 대상 */
export function mandayOver(g: { reported: number; crewDays: number }): boolean {
  return g.reported > 0 && g.reported - g.crewDays >= 2 && g.reported > g.crewDays * 1.1;
}

/** since = 대조 시작일 (보통 최근 30일) */
export function crewFlags(db: DemoDB, date: string, since: string): CrewFlag[] {
  const flags: CrewFlag[] = [];
  const site = (id: string) => db.sites.find((s) => s.id === id)?.shortName ?? "";
  const name = (id: string) => db.users.find((u) => u.id === id)?.name ?? "알 수 없음";
  // 가져온 과거 기록은 사진·위치·출근 확인 대상이 아니다
  const today = crew(db).filter((c) => c.workDate === date && !c.imported);
  for (const c of today) {
    if (!c.photoId) flags.push({ kind: "no_photo", siteId: c.siteId, crewId: c.id, text: `${site(c.siteId)} ${c.team} ${c.headcount}명 — 단체 사진 없이 보냄` });
    if (c.geo?.status === "outside") flags.push({ kind: "outside", siteId: c.siteId, crewId: c.id, text: `${site(c.siteId)} ${c.team} — 현장에서 떨어진 곳에서 보냄` });
    const usesAttendance = (db.attendance ?? []).some((a) => a.siteId === c.siteId);
    if (usesAttendance && !(db.attendance ?? []).some((a) => a.siteId === c.siteId && a.workDate === c.workDate && a.userId === c.by))
      flags.push({ kind: "reporter_absent", siteId: c.siteId, crewId: c.id, text: `${site(c.siteId)} ${c.team} — 보낸 ${name(c.by)}의 그날 출근 기록이 없음` });
  }
  // 같은 단체 사진을 다른 날·다른 팀에 다시 쓴 경우 (사진 내용이 바이트까지 같음)
  const byHash = new Map<string, CrewCheck[]>();
  for (const c of crew(db)) if (c.photoHash) byHash.set(c.photoHash, [...(byHash.get(c.photoHash) ?? []), c]);
  for (const c of today) {
    const same = c.photoHash ? (byHash.get(c.photoHash) ?? []).filter((x) => x.id !== c.id) : [];
    if (same.length) flags.push({ kind: "photo_reused", siteId: c.siteId, crewId: c.id, text: `${site(c.siteId)} ${c.team} — ${same.map((x) => `${x.workDate.slice(5).replace("-", "/")} ${x.team}`).join(", ")}에 쓴 사진과 똑같음` });
  }
  // 최근 보고 공수 vs 출력 인원일 (현장별, 작업 인원 보고를 쓰는 현장만)
  for (const s of db.sites) {
    if (!crew(db).some((c) => c.siteId === s.id)) continue;
    const g = mandayGap(db, s.id, since, date);
    if (mandayOver(g)) flags.push({ kind: "manday_over", siteId: s.id, text: `${s.shortName} — ${since.slice(5).replace("-", "/")}부터 노무 공수 ${g.reported} 보고, 출력 인원은 ${g.crewDays}명·일` });
  }
  return flags;
}

export interface CrewSummaryRow {
  siteId: string;
  team: string;
  kind: CrewCheck["kind"];
  days: number;
  personDays: number;
  noPhoto: number;
}

/** 팀별 기간 합계 — 직영은 급여, 외주는 팀 기성 확인 근거 */
export function crewSummary(db: DemoDB, from: string, to: string): CrewSummaryRow[] {
  const rows = new Map<string, CrewSummaryRow>();
  for (const c of crew(db)) {
    if (c.workDate < from || c.workDate > to) continue;
    const key = `${c.siteId}|${c.team.toLowerCase()}`;
    const r = rows.get(key) ?? { siteId: c.siteId, team: c.team, kind: c.kind, days: 0, personDays: 0, noPhoto: 0 };
    r.days += 1;
    r.personDays += c.headcount;
    if (!c.photoId) r.noPhoto += 1;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => a.siteId.localeCompare(b.siteId) || b.personDays - a.personDays);
}

/** 현장에서 최근 쓴 팀 이름 (쉬운 화면 고르기용) */
export function recentTeams(db: DemoDB, siteId: string): { team: string; kind: CrewCheck["kind"]; last: number }[] {
  const seen = new Map<string, { team: string; kind: CrewCheck["kind"]; last: number; at: string }>();
  for (const c of crew(db).filter((x) => x.siteId === siteId)) {
    const k = c.team.toLowerCase();
    const prev = seen.get(k);
    if (!prev || prev.at < c.at) seen.set(k, { team: c.team, kind: c.kind, last: c.headcount, at: c.at });
  }
  return [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8).map(({ team, kind, last }) => ({ team, kind, last }));
}
