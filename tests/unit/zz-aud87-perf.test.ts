import { expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { COMMANDS } from "@/lib/data/registry";
import { moneyIntegrity } from "@/lib/domain/integrity";
import { monthClose } from "@/lib/domain/monthClose";
import { monthWorkbook } from "./zz-aud87-mw.test";
import { closeSnapshot } from "@/lib/domain/closeRecord";
import type { CostEntry, DemoDB } from "@/lib/domain/types";

function big(withCloses: boolean): DemoDB {
  const now = new Date("2026-11-14T03:00:00Z");
  const db = createSeed(now);
  const cats = ["material", "labor", "subcontract", "equipment", "overhead"] as const;
  for (let i = 0; i < 9000; i++) {
    const d = new Date(now.getTime() - (i % 365) * 86_400_000).toISOString();
    db.costEntries.push({ id: `ce-p-${i}`, siteId: ["site-a", "site-b", "site-c"][i % 3], category: cats[i % 5], amount: 100_000 + (i % 50) * 10_000, date: d.slice(0, 10), forecastImpact: i % 4 ? "within_forecast" : "additional", reason: "planned", note: "x", source: "PC", createdBy: "u-manager", createdAt: d, status: "active" } as CostEntry);
  }
  for (let i = 0; i < 300; i++) {
    const d = new Date(now.getTime() - (i % 365) * 86_400_000).toISOString().slice(0, 10);
    db.billings.push({ id: `b-p-${i}`, siteId: ["site-a", "site-b", "site-c"][i % 3], round: 0, amount: 1_000_000, billedDate: d, status: "confirmed", createdAt: `${d}T03:00:00Z`, createdBy: "u-manager" } as never);
    db.payments.push({ id: `p-p-${i}`, siteId: ["site-a", "site-b", "site-c"][i % 3], amount: 900_000, receivedDate: d, createdAt: `${d}T03:00:00Z`, createdBy: "u-manager" } as never);
  }
  if (withCloses) {
    // every finished month closed (snapshot as of now) — exercises changesAfterClose inside monthWorkbook
    const months: string[] = [];
    for (let m = "2025-11"; m <= "2026-10"; ) {
      months.push(m);
      const [y, mm] = m.split("-").map(Number);
      m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
    }
    db.monthCloses = months.map((m, i) => ({ id: `mcl-${i}`, month: m, closedAt: "2026-11-10T03:00:00Z", closedBy: "u-manager", snapshot: closeSnapshot(db, monthClose(db, m, "2026-11-14")) })) as never;
  }
  return db;
}

it("perf: moneyIntegrity with and without closes", { timeout: 120_000 }, () => {
  for (const withCloses of [false, true]) {
    const db = big(withCloses);
    let t = performance.now();
    const checks = moneyIntegrity(db, "2026-11-14");
    const total = performance.now() - t;
    t = performance.now();
    const months: string[] = [];
    for (const c of checks) void c;
    let wb = 0;
    for (let m = "2025-11"; m <= "2026-11"; ) {
      months.push(m);
      const [y, mm] = m.split("-").map(Number);
      m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
    }
    const reports = months.map((m) => monthClose(db, m, "2026-11-14"));
    const tr = performance.now() - t;
    t = performance.now();
    months.forEach((m, i) => {
      monthWorkbook(db, m, "2026-11-14", { report: reports[i] });
    });
    wb = performance.now() - t;
    require("node:fs").appendFileSync("/tmp/claude-0/-home-user-taekang-gltech-site-intelligence/6fd4606c-beca-578f-9fa6-5ca27764a557/scratchpad/perf.txt", `withCloses=${withCloses} integrity=${total.toFixed(0)}ms monthCloses=${tr.toFixed(0)}ms workbooks=${wb.toFixed(0)}ms xlsxCheck=${checks.find((c) => c.key === "xlsx")?.level}\n`);
    expect(checks.length).toBeGreaterThan(5);
  }
});
