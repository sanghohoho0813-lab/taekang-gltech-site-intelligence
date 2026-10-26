/**
 * 규칙 기반 위험 진단 (RULE v1) — 실제 AI 모델이 아니다.
 * 데이터가 바뀔 때마다 결정론적으로 다시 계산되는 파생값이며, 근거(why)와 기준(threshold)을 함께 반환한다.
 */
import type { CostEntry, DemoDB, RiskSignal, Severity } from "./types";
import { siteFinancials } from "./calc";
import { CATEGORY_LABEL, RULE_VERSION } from "./labels";
import { daysBetween, fmtEok, fmtMan, fmtPct, fmtPp } from "./format";

const SEV_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function latest(entries: CostEntry[], fallback: string): string {
  return entries.reduce((m, e) => (e.createdAt > m ? e.createdAt : m), fallback);
}

export interface ReceivableAging {
  billingId: string;
  round: number;
  billedDate: string;
  unpaid: number;
  ageDays: number;
}

/** 수금액을 오래된 기성부터 차감(FIFO)해 미수 잔액별 경과일 계산 */
export function receivableAging(db: DemoDB, siteId: string, now = new Date()): ReceivableAging[] {
  const bills = db.billings
    .filter((b) => b.siteId === siteId && b.status === "confirmed")
    .sort((a, b) => a.billedDate.localeCompare(b.billedDate));
  let paid = db.payments.filter((p) => p.siteId === siteId).reduce((s, p) => s + p.amount, 0);
  const out: ReceivableAging[] = [];
  for (const b of bills) {
    const applied = Math.min(paid, b.amount);
    paid -= applied;
    const unpaid = b.amount - applied;
    if (unpaid > 0) out.push({ billingId: b.id, round: b.round, billedDate: b.billedDate, unpaid, ageDays: daysBetween(b.billedDate, now) });
  }
  return out;
}

export function computeSignals(db: DemoDB, now = new Date()): RiskSignal[] {
  const t = db.thresholds;
  const signals: RiskSignal[] = [];

  for (const site of db.sites) {
    if (site.status !== "active") continue;
    const f = siteFinancials(db, site.id);
    const entries = db.costEntries.filter((e) => e.siteId === site.id && e.status === "active");
    const additional = entries.filter((e) => e.forecastImpact === "additional");
    const additionalSum = additional.reduce((s, e) => s + e.amount, 0);
    const name = site.shortName;

    // 1) 이익률 하락 (계획 대비)
    const drop = f.plannedMarginPct - f.marginPct;
    if (drop >= t.marginDropPp) {
      const plannedProfit = f.contractAmount - f.plannedCost;
      const recent = [...additional].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
      signals.push({
        key: `MARGIN_DROP:${site.id}`,
        rule: "MARGIN_DROP",
        siteId: site.id,
        severity: "high",
        title: `${name} 예상이익률 ${fmtPct(f.plannedMarginPct)} → ${fmtPct(f.marginPct)} (${fmtPp(-drop)})`,
        summary: `계획 대비 예상이익이 ${fmtMan(plannedProfit - f.expectedProfit)} 줄었습니다.`,
        why: [
          `계획 이익률 ${fmtPct(f.plannedMarginPct)} = (계약 ${fmtEok(f.contractAmount)} − 실행예산 ${fmtEok(f.plannedCost)}) ÷ 계약`,
          `현재 총예상원가(EAC) ${fmtEok(f.eac)} = 발생 ${fmtEok(f.incurred)} + 잔여예상 ${fmtEok(f.remaining)}`,
          additionalSum > 0
            ? `예상 외 추가원가 ${fmtMan(additionalSum)} — ${recent.map((e) => `${CATEGORY_LABEL[e.category]} ${fmtMan(e.amount)}`).join(", ")}`
            : `잔여예상원가 상향 또는 변경공사 미반영`,
          `하락 폭 ${fmtPp(-drop)} ≥ 기준 ${t.marginDropPp}%p`,
        ],
        dataUsed: ["site_contracts", "cost_budgets", "cost_entries", "cost_forecasts", "change_orders(approved)"],
        threshold: `계획 대비 이익률 ${t.marginDropPp}%p 이상 하락`,
        metric: { label: "예상이익률", before: fmtPct(f.plannedMarginPct), current: fmtPct(f.marginPct) },
        recommendation: {
          actionTitle: "원가 상승 원인 확인 및 현장 손익 재검토",
          description: "추가원가 발생 원인·잔여 공정 원가를 현장소장과 확인하고 손익 회복 방안을 정리합니다.",
        },
        detectedAt: latest(additional, db.seededAt),
        causeEntryIds: additional.map((e) => e.id),
        amountAtRisk: plannedProfit - f.expectedProfit,
      });
    } else if (f.marginPct < t.targetMarginPct) {
      // 2) 목표 이익률 미달 (하락 신호가 없을 때만)
      signals.push({
        key: `BELOW_TARGET_MARGIN:${site.id}`,
        rule: "BELOW_TARGET_MARGIN",
        siteId: site.id,
        severity: "low",
        title: `${name} 예상이익률 ${fmtPct(f.marginPct)} — 목표 ${t.targetMarginPct}% 미달`,
        summary: `목표 대비 ${fmtPp(f.marginPct - t.targetMarginPct)} 낮습니다.`,
        why: [
          `예상이익 ${fmtEok(f.expectedProfit)} ÷ 변경 반영 계약 ${fmtEok(f.adjustedContract)} = ${fmtPct(f.marginPct)}`,
          `회사 목표 이익률 기준 ${t.targetMarginPct}% (DEMO 설정값)`,
          f.pendingChangeAmount > 0 ? `승인 대기 변경공사 ${fmtMan(f.pendingChangeAmount)}는 이익에 미반영` : `승인 대기 변경공사 없음`,
        ],
        dataUsed: ["site_contracts", "cost_entries", "cost_forecasts", "change_orders"],
        threshold: `예상이익률 < 목표 ${t.targetMarginPct}%`,
        metric: { label: "예상이익률", current: fmtPct(f.marginPct) },
        recommendation: {
          actionTitle: "잔여 공정 원가 절감안 검토",
          description: "잔여 자재 발주 단가·외주 범위를 재검토해 목표 이익률과의 차이를 줄입니다.",
        },
        detectedAt: db.seededAt,
        causeEntryIds: [],
      });
    }

    // 3) 원가항목 예산 초과
    for (const c of f.categories) {
      if (c.budget > 0 && c.variancePct > t.overrunPct) {
        const causes = additional.filter((e) => e.category === c.category);
        signals.push({
          key: `COST_OVERRUN:${site.id}:${c.category}`,
          rule: "COST_OVERRUN",
          siteId: site.id,
          severity: c.variancePct > t.overrunPct * 3 ? "high" : "medium",
          title: `${name} ${CATEGORY_LABEL[c.category]} 예산 ${fmtPct(c.variancePct)} 초과`,
          summary: `${CATEGORY_LABEL[c.category]} 예상원가가 실행예산보다 ${fmtMan(c.variance)} 많습니다.`,
          why: [
            `실행예산 ${fmtEok(c.budget)} vs 항목 EAC ${fmtEok(c.eac)} (발생 ${fmtEok(c.incurred)} + 잔여 ${fmtEok(c.remaining)})`,
            causes.length ? `최근 추가원가: ${causes.map((e) => fmtMan(e.amount)).join(", ")}` : `잔여예상원가 상향`,
            `초과율 ${fmtPct(c.variancePct)} > 기준 ${t.overrunPct}%`,
          ],
          dataUsed: ["cost_budgets", "cost_entries", "cost_forecasts"],
          threshold: `항목 EAC가 실행예산 대비 ${t.overrunPct}% 초과`,
          metric: { label: `${CATEGORY_LABEL[c.category]} 초과`, current: fmtMan(c.variance) },
          recommendation: {
            actionTitle: `${CATEGORY_LABEL[c.category]} 잔여 발주 단가·물량 재검토`,
            description: "설계변경분은 변경공사 청구로 분리하고, 그 외 초과분은 잔여 발주 단가·물량을 재확인합니다.",
          },
          detectedAt: latest(causes, db.seededAt),
          causeEntryIds: causes.map((e) => e.id),
          amountAtRisk: c.variance,
        });
      }
    }

    // 4) 공정 대비 원가 과다
    const gap = f.costProgressPct - f.physicalProgressPct;
    if (gap > t.costProgressGapPp) {
      signals.push({
        key: `COST_VS_PROGRESS:${site.id}`,
        rule: "COST_VS_PROGRESS",
        siteId: site.id,
        severity: "medium",
        title: `${name} 원가 진척 ${fmtPct(f.costProgressPct)} > 공정률 ${fmtPct(f.physicalProgressPct)}`,
        summary: `공정보다 원가가 ${fmtPp(gap)} 앞서 나가고 있습니다.`,
        why: [
          `원가 진척률 = 발생 ${fmtEok(f.incurred)} ÷ EAC ${fmtEok(f.eac)}`,
          `현장 보고 공정률 ${fmtPct(f.physicalProgressPct)}`,
          `차이 ${fmtPp(gap)} > 기준 ${t.costProgressGapPp}%p`,
        ],
        dataUsed: ["cost_entries", "cost_forecasts", "progress_updates"],
        threshold: `원가 진척률 − 공정률 > ${t.costProgressGapPp}%p`,
        metric: { label: "원가·공정 차이", current: fmtPp(gap) },
        recommendation: { actionTitle: "공정률·기성 산정 재확인", description: "공정률 산정과 선투입 자재를 확인합니다." },
        detectedAt: latest(entries, db.seededAt),
        causeEntryIds: [],
      });
    }

    // 5) 설계변경 추가원가 — 변경공사 미등록
    const linked = new Set(db.changeOrders.filter((co) => co.siteId === site.id).flatMap((co) => co.sourceEntryIds));
    const unbilled = additional.filter((e) => e.reason === "design_change" && !linked.has(e.id));
    if (unbilled.length) {
      const sum = unbilled.reduce((s, e) => s + e.amount, 0);
      const first = [...unbilled].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      signals.push({
        key: `UNBILLED_CHANGE:${site.id}:${first.id}`,
        rule: "UNBILLED_CHANGE",
        siteId: site.id,
        severity: "high",
        title: `${name} 설계변경 추가원가 ${fmtMan(sum)} — 변경공사 청구 미검토`,
        summary: "사유가 '설계변경·원청(발주처) 요청'인 추가원가가 변경공사로 등록되지 않았습니다.",
        why: [
          `사유=설계변경·원청(발주처) 요청 원가 ${unbilled.length}건 / 합계 ${fmtMan(sum)}`,
          `연결된 변경공사(청구 검토) 없음`,
          `청구하지 않으면 이 금액은 그대로 현장 이익 감소로 남습니다`,
        ],
        dataUsed: ["cost_entries(reason)", "change_orders"],
        threshold: "설계변경 사유 추가원가가 변경공사와 미연결",
        metric: { label: "청구 검토 대상", current: fmtMan(sum) },
        recommendation: {
          actionTitle: "추가공사 청구가능성 검토",
          description: "현장: 원청 서면 작업지시서·회의록·사진·추가 물량 정리 → 본사 공무: 내역단가 기준 변경견적 작성. 청구 가능 여부와 금액을 검토합니다.",
        },
        detectedAt: latest(unbilled, db.seededAt),
        causeEntryIds: unbilled.map((e) => e.id),
        amountAtRisk: sum,
      });
    }

    // 6) 미수금 장기화
    const aging = receivableAging(db, site.id, now).filter((a) => a.ageDays > t.receivableDays);
    if (aging.length) {
      const sum = aging.reduce((s, a) => s + a.unpaid, 0);
      const oldest = aging[0];
      signals.push({
        key: `RECEIVABLE_OVERDUE:${site.id}`,
        rule: "RECEIVABLE_OVERDUE",
        siteId: site.id,
        severity: oldest.ageDays > t.receivableDays * 1.5 ? "high" : "medium",
        title: `${name} ${oldest.round}차 기성 미수 ${fmtMan(sum)} · ${oldest.ageDays}일 경과`,
        summary: "확정된 기성청구액 중 기준일을 넘긴 미수 잔액이 있습니다.",
        why: [
          `확정 기성 ${fmtEok(f.billed)} − 수금 ${fmtEok(f.received)} = 미수 ${fmtEok(f.outstanding)}`,
          `수금은 오래된 기성부터 차감(FIFO)해 경과일 계산`,
          `${oldest.round}차 잔액 ${fmtMan(oldest.unpaid)} · ${oldest.ageDays}일 > 기준 ${t.receivableDays}일`,
        ],
        dataUsed: ["progress_billings", "payments_received"],
        threshold: `미수 경과 ${t.receivableDays}일 초과`,
        metric: { label: "장기 미수", current: fmtMan(sum) },
        recommendation: { actionTitle: "기성 잔금 수금 요청", description: "원청·발주처 지급 일정 확인 및 공문 발송" },
        detectedAt: new Date(new Date(oldest.billedDate).getTime() + t.receivableDays * 86_400_000).toISOString(),
        causeEntryIds: [],
        amountAtRisk: sum,
      });
    }

    // 7) 미승인 변경공사 장기 대기
    for (const co of db.changeOrders.filter((c) => c.siteId === site.id && c.status === "submitted")) {
      const days = daysBetween(co.requestedAt, now);
      if (days > t.changeOrderPendingDays) {
        signals.push({
          key: `PENDING_CHANGE_ORDER:${site.id}:${co.id}`,
          rule: "PENDING_CHANGE_ORDER",
          siteId: site.id,
          severity: "medium",
          title: `${name} 변경공사 ${fmtMan(co.amount)} 승인 대기 ${days}일`,
          summary: `「${co.title}」 승인 전까지 계약금액·이익에 반영되지 않습니다.`,
          why: [
            `청구일로부터 ${days}일 경과 > 기준 ${t.changeOrderPendingDays}일`,
            `승인 전 금액은 예상이익 계산에서 제외(보수적 계산)`,
            `승인 시 변경 반영 계약금액 +${fmtMan(co.amount)}`,
          ],
          dataUsed: ["change_orders"],
          threshold: `변경공사 승인 대기 ${t.changeOrderPendingDays}일 초과`,
          metric: { label: "승인 대기", current: fmtMan(co.amount) },
          recommendation: { actionTitle: "변경공사 승인 진행 상황 확인", description: "원청·발주처 담당자에게 검토 일정·보완자료를 확인합니다." },
          detectedAt: new Date(new Date(co.requestedAt).getTime() + t.changeOrderPendingDays * 86_400_000).toISOString(),
          causeEntryIds: [],
          amountAtRisk: co.amount,
        });
      }
    }
  }

  return signals.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (b.amountAtRisk ?? 0) - (a.amountAtRisk ?? 0));
}

export const DECISION_METHOD = `규칙 기반 진단 (${RULE_VERSION}) — 실제 AI 모델 아님`;
