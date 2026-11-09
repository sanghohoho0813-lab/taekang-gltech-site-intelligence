/**
 * 준공 보고서 (발주처 제출용 · D-72) — 한 현장의 공사 기간 전체를 한 문서로: 개요, 공정 단계별 완료일, 월별 공정률,
 * 발주처에 공개한 공정 사진, 하자 처리 요약, 하자보증(계약서 기준). 금액·사람 이름·현장 메모는 넣지 않는다.
 * 기록에 없는 값은 지어내지 않고 ‘기록 없음’으로 둔다.
 */
import type { DemoDB, Site, SitePhoto } from "./types";
import { sharedPhotos } from "./partnerFeed";
import { defectRows, defectStats } from "./defects";
import { warrantyClientLine } from "./warranty";

export interface CompletionStage {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  progressPct: number;
  /** 기록상 100%가 된 날 (현장 보고·엑셀 이관) — 100%인데 기록이 없으면 없음 */
  doneDate?: string;
  /** 계획 종료일보다 늦게 끝남 (끝나지 않았으면 없음) */
  late?: boolean;
}

export interface CompletionReport {
  site: Site;
  /** 준공(인도)일 — 하자보증에 넣은 날. 없으면 아직 준공 전 */
  completedDate?: string;
  /** 보고서가 다루는 기간 */
  from: string;
  to: string;
  stages: CompletionStage[];
  /** 월말 기준 전체 공정률 (기록이 없으면 null) — 마지막 줄은 작성일 기준 지금 공정률 */
  months: { month: string; pct: number | null }[];
  /** 앱으로 현장 보고를 한 날 수 (엑셀로 옮긴 기록 제외) */
  reportDays: number;
  /** 발주처에 공개한 공정 사진 — 기간에 고르게 최대 12장 */
  photos: SitePhoto[];
  photoTotal: number;
  defects: { total: number; repaired: number; confirmed: number; open: number; avgDays: number | null };
  /** 하자 외 발주처 요청 (견적·주문 등) */
  requests: { total: number; answered: number };
  warranty: string | null;
}

const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** 고르게 n장 고르기 (처음·끝 포함) */
function spread<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
}

export function completionReport(db: DemoDB, siteId: string, today: string): CompletionReport | null {
  const site = db.sites.find((s) => s.id === siteId);
  if (!site) return null;
  const completedDate = site.warranty?.completedDate;
  const to = completedDate && completedDate < today ? completedDate : today;
  const reports = db.reports
    .filter((r) => r.siteId === siteId && r.status !== "voided" && r.reportDate <= to)
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.createdAt.localeCompare(b.createdAt));

  const stages: CompletionStage[] = site.stages.map((st) => {
    const hit = reports.find((r) => r.stages?.some((c) => c.stageId === st.id && c.to >= 100));
    const doneDate = st.progressPct >= 100 ? hit?.reportDate : undefined;
    return { id: st.id, name: st.name, startDate: st.startDate, endDate: st.endDate, progressPct: st.progressPct, ...(doneDate ? { doneDate, late: doneDate > st.endDate } : {}) };
  });

  // 월말 전체 공정률 — 그 달까지의 마지막 기록 (현장 보고·엑셀 이관의 전체 공정률)
  const overall = reports.filter((r) => r.progress).map((r) => ({ date: r.reportDate, pct: r.progress!.to }));
  const months: CompletionReport["months"] = [];
  for (let m = site.startDate.slice(0, 7); m <= to.slice(0, 7) && months.length < 36; m = nextMonth(m)) {
    const end = monthEnd(m);
    const last = overall.filter((o) => o.date <= end).at(-1);
    // 마지막 달: 준공 전이면 지금 공정률, 준공 뒤면 기록이 없을 때만 지금 공정률
    const final = m === to.slice(0, 7);
    months.push({ month: m, pct: final ? (completedDate ? (last?.pct ?? site.progressPct) : site.progressPct) : (last?.pct ?? null) });
  }

  const photosAll = sharedPhotos(db, siteId)
    .filter((p) => p.createdAt.slice(0, 10) <= to)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rows = defectRows(db, today).filter((r) => r.req.siteId === siteId);
  const st = defectStats(rows);
  const others = db.partnerRequests.filter((r) => r.siteId === siteId && r.type !== "defect");
  return {
    site,
    ...(completedDate ? { completedDate } : {}),
    from: site.startDate,
    to,
    stages,
    months,
    reportDays: new Set(reports.filter((r) => !r.importBatchId).map((r) => r.reportDate)).size,
    photos: spread(photosAll, 12),
    photoTotal: photosAll.length,
    defects: { total: st.total, repaired: st.repaired, confirmed: st.confirmed, open: st.open, avgDays: st.avgDays },
    requests: { total: others.length, answered: others.filter((r) => r.status === "answered").length },
    warranty: warrantyClientLine(site),
  };
}
