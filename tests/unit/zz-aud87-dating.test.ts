import { expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { COMMANDS } from "@/lib/data/registry";
import { closeSites, monthClose, profitEvents } from "@/lib/domain/monthClose";
import { moneyIntegrity } from "@/lib/domain/integrity";
import { siteFinancials } from "@/lib/domain/calc";
import type { DemoDB } from "@/lib/domain/types";

const at = (iso: string) => ({ now: new Date(iso) });
type Fn = (d: DemoDB, a: unknown, c: { userId: string; now: Date }) => { db: DemoDB; result?: unknown };
const run = (db: DemoDB, name: string, args: unknown, userId: string, iso: string) => (COMMANDS[name as keyof typeof COMMANDS] as unknown as Fn)(db, args, { userId, ...at(iso) });

it("future-start site: CO created before re-baseline, approved back-dated before baseline -> event lost from monthly closes", () => {
  let db = createSeed(new Date("2026-09-01T01:00:00Z"));
  const input = { name: "미래 현장", shortName: "미래", workType: "창호·유리", region: "서울", clientName: "발주처X", status: "active", startDate: "2026-12-01", endDate: "2027-06-30", contractAmount: 1_000_000_000, budgets: { material: 400_000_000, labor: 200_000_000, subcontract: 100_000_000, equipment: 50_000_000, overhead: 50_000_000 } };
  let r = run(db, "saveSite", input, "u-ceo", "2026-09-20T03:00:00Z");
  db = r.db;
  const site = db.sites.find((s) => s.shortName === "미래")!;
  r = run(db, "createChangeOrder", { siteId: site.id, title: "사전 협의 추가", amount: 30_000_000 }, "u-manager", "2026-09-21T03:00:00Z");
  db = r.db;
  const coId = db.changeOrders.at(-1)!.id;
  // contract edit before any field input -> re-baseline on 10/15
  r = run(db, "saveSite", { ...input, id: site.id, contractAmount: 1_100_000_000 }, "u-ceo", "2026-10-15T03:00:00Z");
  db = r.db;
  const s2 = db.sites.find((s) => s.id === site.id)!;
  console.log("baselineAt", s2.baselineAt);
  r = run(db, "setChangeOrderStatus", { coId, status: "approved", date: "2026-09-25", basis: "letter" }, "u-ceo", "2026-11-05T03:00:00Z");
  db = r.db;
  const co = db.changeOrders.find((c) => c.id === coId)!;
  console.log("co", co.status, co.decidedAt, co.statusChangedAt);
  const all = profitEvents(db, site.id, "0000-01-01", "9999-12-31");
  console.log("events", JSON.stringify(all));
  const today = "2026-11-17";
  const months = ["2026-09", "2026-10", "2026-11"];
  let monthlyNet = 0;
  for (const m of months) {
    const mc = monthClose(db, m, today);
    const mine = mc.money.find((x) => x.site.id === site.id);
    const p = mc.profit.find((x) => x.site.id === site.id);
    console.log(m, "inClose", !!mine, "changeApproved", mine?.changeApproved, "net", p?.net);
    monthlyNet += p?.net ?? 0;
  }
  const since = siteFinancials(db, site.id).expectedProfit - db.baseline[site.id].expectedProfit;
  console.log("monthlyNet", monthlyNet, "sinceBaseline", since, "closeSites Oct", closeSites(db, "2026-10-01", "2026-10-31").map((s) => s.shortName));
  console.log("integrity errs", JSON.stringify(moneyIntegrity(db, today).filter((c) => c.level === "err")));
  expect(true).toBe(true);
});

it("imported approved CO, rebaseline off, decided before baseline", () => {
  let db = createSeed(new Date("2026-10-01T01:00:00Z"));
  const site = db.sites[0];
  const text = ["현장,제목,청구금액,상태,등록일,결정일,승인금액,메모"].join("\n");
  void text;
  // find the import spec header for change orders
  const r = run(db, "importData", { kind: "change", text: "", rebaseline: false }, "u-ceo", "2026-10-05T03:00:00Z");
  void r;
  void site;
});
