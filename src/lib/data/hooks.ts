"use client";

import { useEffect, useMemo, useState } from "react";
import type { DemoDB, RiskSignal, Severity } from "@/lib/domain/types";
import { siteFinancials, portfolioTotals, type SiteFinancials } from "@/lib/domain/calc";
import { computeSignals } from "@/lib/domain/risk";
import { useDb, useRole } from "./store";
import { ROLE_DEFAULT_USER } from "./seed";

/** 1분마다 다시 그려 경과일·상대시간을 갱신 */
export function useMinuteTick() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const h = setInterval(() => setT((x) => x + 1), 60_000);
    return () => clearInterval(h);
  }, []);
  return t;
}

export function useSignals(db: DemoDB | null): RiskSignal[] {
  const tick = useMinuteTick();
  return useMemo(() => (db ? computeSignals(db) : []), [db, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useFinancials(db: DemoDB | null): Record<string, SiteFinancials> {
  return useMemo(() => {
    if (!db) return {};
    return Object.fromEntries(db.sites.map((s) => [s.id, siteFinancials(db, s.id)]));
  }, [db]);
}

export function usePortfolio(db: DemoDB | null) {
  return useMemo(() => (db ? portfolioTotals(db) : null), [db]);
}

export type Health = "ok" | Severity;

export function siteHealth(signals: RiskSignal[], siteId: string): Health {
  const s = signals.filter((x) => x.siteId === siteId);
  if (s.some((x) => x.severity === "high")) return "high";
  if (s.some((x) => x.severity === "medium")) return "medium";
  if (s.some((x) => x.severity === "low")) return "low";
  return "ok";
}

export function useMe() {
  const role = useRole();
  const db = useDb();
  const userId = ROLE_DEFAULT_USER[role];
  const user = db?.users.find((u) => u.id === userId);
  const canSeeMoney = role === "ceo" || role === "manager";
  return { role, userId, user, canSeeMoney, db };
}

export function userLabel(db: DemoDB | null, id?: string) {
  if (!db || !id) return "—";
  const u = db.users.find((x) => x.id === id);
  return u ? `${u.name} ${u.title}` : id;
}
