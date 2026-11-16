/** D-85 1년치 원가(9,000건)에서 돈 계산이 느려지지 않는지 — 날짜 포맷터를 매번 만들던 문제로 월 마감 0.5초·점검 4~5초 → 고친 뒤 0.03초·0.2초 (여유 있게 잡은 기준) */
import { expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { COMMANDS } from "@/lib/data/registry";
import { moneyIntegrity } from "@/lib/domain/integrity";
import { monthClose } from "@/lib/domain/monthClose";
import type { CostEntry } from "@/lib/domain/types";

it("1년치 원가 9,000건: 원가 고치기(이익 조정 포함) < 0.6초 · 월 마감 < 0.5초 · 숫자 맞추기 점검 13개월 < 3초", { timeout: 60_000 }, () => {
  const now = new Date("2026-11-14T03:00:00Z");
  const db = createSeed(now);
  const cats = ["material", "labor", "subcontract", "equipment", "overhead"] as const;
  for (let i = 0; i < 9000; i++) {
    const d = new Date(now.getTime() - (i % 365) * 86_400_000).toISOString();
    db.costEntries.push({ id: `ce-p-${i}`, siteId: ["site-a", "site-b", "site-c"][i % 3], category: cats[i % 5], amount: 100_000 + (i % 50) * 10_000, date: d.slice(0, 10), forecastImpact: i % 4 ? "within_forecast" : "additional", reason: "planned", note: "x", source: "PC", createdBy: "u-manager", createdAt: d, status: "active" } as CostEntry);
  }
  let t = performance.now();
  COMMANDS.editCostEntry(db, { entryId: "ce-p-100", patch: { amount: 300_000, category: "material", note: "x" } }, { userId: "u-manager", now });
  expect(performance.now() - t).toBeLessThan(600);
  t = performance.now();
  monthClose(db, "2026-10", "2026-11-14");
  expect(performance.now() - t).toBeLessThan(500);
  t = performance.now();
  const checks = moneyIntegrity(db, "2026-11-14");
  expect(performance.now() - t).toBeLessThan(3000);
  // (원가를 명령 없이 기준선 전 날짜로 바로 넣은 시험 자료라 ‘이익을 바꾼 일’ 점검은 여기서 보지 않는다 — 시간만 잰다)
  expect(checks.length).toBeGreaterThan(5);
});
