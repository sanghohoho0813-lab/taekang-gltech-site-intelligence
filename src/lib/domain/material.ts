/**
 * 자재 반입·설치 수량 (D-62) — 수량만 다룬다(단가·금액 없음 → 현장 직원 화면에도 그대로 보여도 됨).
 * 현장 보관 = 반입 누계 − 설치 누계. 설치율 = 설치 누계 ÷ 설계 수량.
 * 계산은 기록 그대로의 합계이며, 예측·AI가 아니다.
 */
import type { DemoDB, MaterialItem, MaterialMove, MaterialMoveKind } from "./types";

export const MOVE_LABEL: Record<MaterialMoveKind, string> = { in: "반입", install: "설치" };

export type MaterialFlag = "install_over_in" | "in_over_plan" | "install_over_plan";
export const MATERIAL_FLAG_LABEL: Record<MaterialFlag, string> = {
  install_over_in: "설치가 반입보다 많음 — 반입 기록이 빠졌는지 확인",
  in_over_plan: "설계 수량보다 많이 들어옴 — 여유분·추가 발주인지 확인",
  install_over_plan: "설계 수량보다 많이 설치됨 — 설계 수량·변경공사 확인",
};

export interface MaterialRow {
  item: MaterialItem;
  inQty: number;
  installQty: number;
  /** 현장 보관 (반입 − 설치, 음수면 0으로 보여 주고 표시를 단다) */
  onSite: number;
  /** 설계 수량이 없으면 null */
  installPct: number | null;
  inPct: number | null;
  flags: MaterialFlag[];
  lastAt?: string;
  moves: number;
}

/** 소수 둘째 자리까지 (m·㎡ 등) — 더하기 오차를 없앤다 */
export const roundQty = (n: number) => Math.round(n * 100) / 100;

export function fmtQty(n: number, unit = ""): string {
  const v = roundQty(n);
  return `${v.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
}

export const liveMoves = (db: DemoDB, siteId?: string): MaterialMove[] => (db.materialMoves ?? []).filter((m) => !m.voided && (!siteId || m.siteId === siteId));

export const activeItems = (db: DemoDB, siteId: string): MaterialItem[] => (db.sites.find((s) => s.id === siteId)?.materials ?? []).filter((i) => !i.archived);

/** 품목별 누계 — 숨긴 품목도 기록이 있으면 포함 (지난 기록이 사라지지 않게) */
export function materialRows(db: DemoDB, siteId: string, opts: { until?: string } = {}): MaterialRow[] {
  const site = db.sites.find((s) => s.id === siteId);
  const moves = liveMoves(db, siteId).filter((m) => !opts.until || m.workDate <= opts.until);
  return (site?.materials ?? [])
    .map((item) => {
      const mine = moves.filter((m) => m.itemId === item.id);
      const sum = (k: MaterialMoveKind) => roundQty(mine.filter((m) => m.kind === k).reduce((a, m) => a + m.qty, 0));
      const inQty = sum("in");
      const installQty = sum("install");
      const flags: MaterialFlag[] = [];
      if (installQty > inQty) flags.push("install_over_in");
      if (item.plannedQty > 0 && inQty > item.plannedQty) flags.push("in_over_plan");
      if (item.plannedQty > 0 && installQty > item.plannedQty) flags.push("install_over_plan");
      const pct = (v: number) => (item.plannedQty > 0 ? (v / item.plannedQty) * 100 : null);
      return {
        item,
        inQty,
        installQty,
        onSite: Math.max(0, roundQty(inQty - installQty)),
        installPct: pct(installQty),
        inPct: pct(inQty),
        flags,
        lastAt: mine.reduce<string | undefined>((a, m) => (!a || m.at > a ? m.at : a), undefined),
        moves: mine.length,
      };
    })
    .filter((r) => !r.item.archived || r.moves > 0);
}

/**
 * 주요 자재 설치율 — 설계 수량이 정해진 품목의 설치율 평균(품목마다 같은 비중, 100% 상한).
 * 단위가 서로 달라(EA·장·m) 수량을 더할 수 없으므로 평균으로 본다. 품목이 없으면 null.
 */
export function siteInstallPct(db: DemoDB, siteId: string): { pct: number; items: number } | null {
  const rows = materialRows(db, siteId).filter((r) => !r.item.archived && r.installPct !== null);
  if (!rows.length) return null;
  const pct = rows.reduce((a, r) => a + Math.min(100, r.installPct!), 0) / rows.length;
  return { pct, items: rows.length };
}

/** 하루 기록 (공사일보용) — 품목 이름·단위를 붙여서 */
export function movesOn(db: DemoDB, siteId: string, date: string): { move: MaterialMove; item?: MaterialItem }[] {
  const items = db.sites.find((s) => s.id === siteId)?.materials ?? [];
  return liveMoves(db, siteId)
    .filter((m) => m.workDate === date)
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((move) => ({ move, item: items.find((i) => i.id === move.itemId) }));
}
