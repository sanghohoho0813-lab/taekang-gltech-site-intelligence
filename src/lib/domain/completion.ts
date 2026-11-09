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
  /** 준공일이 있고 공정률·모든 단계가 100% — 이때만 ‘준공 보고서’ 제목 (D-72 점검 반영) */
  finished: boolean;
  /** 공사 기간 (착공일부터 준공일·작성일까지 일수) */
  days: number;
  /** 보고서가 다루는 기간 */
  from: string;
  to: string;
  stages: CompletionStage[];
  /** 월말 기준 전체 공정률 (기록이 없으면 null) — 마지막 줄은 지금 공정률. 앞쪽 기록 없는 달은 emptyLead로 묶는다 */
  months: { month: string; pct: number | null }[];
  /** 착공 뒤 처음 기록 전까지 기록 없는 달 (한 칸으로 묶어 보여 준다) */
  emptyLead?: { from: string; to: string };
  /** 앱으로 현장 보고를 한 날 수 (엑셀로 옮긴 기록 제외) */
  reportDays: number;
  /** 발주처에 공개한 공정 사진 — 기간에 고르게 최대 12장 */
  photos: SitePhoto[];
  photoTotal: number;
  /** 준공일 뒤에 공개한 사진 (보고서에 넣지 않음) */
  photosAfter: number;
  defects: { total: number; repaired: number; confirmed: number; open: number; avgDays: number | null };
  /** 하자 외 발주처 요청 (견적·주문 등) */
  requests: { total: number; answered: number };
  warranty: string | null;
}

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
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
    // 완료일: 기록(현장 보고·엑셀 이관)에서 마지막으로 100%가 된 날 (중간에 고쳐 내린 기록이 있으면 그 뒤) → 없으면 본사가 공정률을 고쳐 100%가 된 날 (D-72 점검 반영)
    let hit: string | undefined;
    for (const r of reports) {
      const c = r.stages?.find((x) => x.stageId === st.id);
      if (!c) continue;
      if (c.to < 100) hit = undefined;
      else if (!hit) hit = r.reportDate;
    }
    const doneDate = st.progressPct >= 100 ? (hit ?? st.doneOn) : undefined;
    return { id: st.id, name: st.name, startDate: st.startDate, endDate: st.endDate, progressPct: st.progressPct, ...(doneDate ? { doneDate, late: doneDate > st.endDate } : {}) };
  });

  // 월말 전체 공정률 — 그 달까지의 마지막 기록 (현장 보고·엑셀 이관의 전체 공정률)
  const overall = reports.filter((r) => r.progress).map((r) => ({ date: r.reportDate, pct: r.progress!.to }));
  const months: CompletionReport["months"] = [];
  for (let m = site.startDate.slice(0, 7); m <= to.slice(0, 7); m = nextMonth(m)) {
    const end = monthEnd(m);
    const last = overall.filter((o) => o.date <= end).at(-1);
    // 마지막 달은 지금 공정률 (본사가 공정률을 마감한 값이 날짜 기록 없이 들어오는 경우가 있어 · D-72 점검 반영)
    months.push({ month: m, pct: m === to.slice(0, 7) ? site.progressPct : (last?.pct ?? null) });
  }
  // 아주 긴 공사는 최근 36개월만 (예전에는 앞 36개월만 남아 이번 달이 빠졌다 · D-72 점검 반영)
  if (months.length > 36) months.splice(0, months.length - 36);
  // 앞쪽 기록 없는 달은 한 칸으로 (앱을 공사 중간부터 쓴 현장이 ‘기록 없음’으로 줄줄이 보이지 않게)
  const lead = months.findIndex((m) => m.pct !== null);
  const emptyLead = lead > 1 ? { from: months[0].month, to: months[lead - 1].month } : undefined;
  if (emptyLead) months.splice(0, lead);

  // 날짜는 한국 시간으로 (준공일 다음 날 아침 사진이 들어가던 문제 · D-72 점검 반영)
  const shared = sharedPhotos(db, siteId);
  const photosAll = shared.filter((p) => kst(p.createdAt) <= to).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rows = defectRows(db, today).filter((r) => r.req.siteId === siteId);
  const st = defectStats(rows);
  const others = db.partnerRequests.filter((r) => r.siteId === siteId && r.type !== "defect");
  const finished = !!completedDate && site.progressPct >= 100 && site.stages.every((x) => x.progressPct >= 100);
  return {
    site,
    ...(completedDate ? { completedDate } : {}),
    finished,
    days: Math.max(0, dayDiff(site.startDate, to)) + 1,
    ...(emptyLead ? { emptyLead } : {}),
    photosAfter: shared.length - photosAll.length,
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
