/**
 * 예상이익 조정 기록 (D-85) — 돈이 움직이는 명령을 실행한 뒤, 현장마다
 *   (실제 예상이익 변화) − (‘이익을 바꾼 일’ 합의 변화)
 * 가 0이 아니면 그 차이를 그 시각의 ‘이익을 바꾼 일’로 남긴다.
 *
 * ‘이익을 바꾼 일’은 지금 자료로 다시 계산하므로(원가·재추정·변경공사), 재추정 전에 들어온 원가를 나중에 고치거나 취소하면
 * 예상 총원가는 바뀌는데 그 원가의 이벤트는 0이라 합이 어긋났다 (무작위 운영 점검에서 8개 seed 모두 발견).
 * 원 계약금액 수정도 이벤트가 없었다. 이 기록으로 ‘이익을 바꾼 일’ 합 = 현장 등록 기준 대비 예상이익 변화가 언제나 맞는다.
 */
import type { DemoDB } from "@/lib/domain/types";
import { siteFinancials } from "@/lib/domain/calc";
import { profitEvents } from "@/lib/domain/monthClose";
import { uid } from "@/lib/domain/ids";
import { nowIso, type Ctx } from "./commands";

const ALL_FROM = "0000-01-01";
const ALL_TO = "9999-12-31";
const eventSum = (db: DemoDB, siteId: string) => profitEvents(db, siteId, ALL_FROM, ALL_TO).reduce((a, e) => a + e.amount, 0);

export function reconcileProfit<T extends { db: DemoDB }>(db0: DemoDB, res: T, ctx: Ctx, text: string | ((siteId: string) => string), entryId?: string, siteIds?: (string | undefined)[]): T {
  const db = res.db;
  if (db === db0) return res;
  // 명령이 건드린 현장만 (모르면 모든 현장) — 1년치 자료에서 명령마다 모든 현장을 다시 셈하지 않게
  const only = siteIds?.every(Boolean) ? new Set(siteIds as string[]) : null;
  for (const site of db.sites.filter((s) => !only || only.has(s.id))) {
    const before = db0.sites.find((s) => s.id === site.id);
    // 새 현장이거나 기준을 다시 잡은 경우(현장 입력 전 계약·예산 수정)는 기준 자체가 바뀐 것이라 조정하지 않는다
    if (!before || !db.baseline[site.id] || !db0.baseline[site.id] || before.baselineAt !== site.baselineAt) continue;
    let pBefore: number;
    let pAfter: number;
    try {
      pBefore = siteFinancials(db0, site.id).expectedProfit;
      pAfter = siteFinancials(db, site.id).expectedProfit;
    } catch {
      continue;
    }
    // 지켜야 할 것: ‘이익을 바꾼 일’ 합 = 예상이익 − 기준선 예상이익. 기준선이 움직인 만큼(지난 자료 가져오기)은 빼고 본다
    const baseMove = db.baseline[site.id].expectedProfit - db0.baseline[site.id].expectedProfit;
    const residual = pAfter - pBefore - baseMove - (eventSum(db, site.id) - eventSum(db0, site.id));
    if (residual === 0) continue;
    db.profitAdjustments = [
      ...(db.profitAdjustments ?? []),
      { id: uid("pa"), siteId: site.id, at: nowIso(ctx), by: ctx.userId, amount: residual, text: typeof text === "function" ? text(site.id) : text, ...(entryId ? { entryId } : {}) },
    ];
  }
  return res;
}
