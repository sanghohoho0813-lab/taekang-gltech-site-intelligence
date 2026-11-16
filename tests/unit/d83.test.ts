/** D-83 대표 보고서 달별 보기 · 기성·입금 입력 시각·사람 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { addBilling, addPayment } from "@/lib/data/commands";
import { importData } from "@/lib/data/importCommands";
import { closeMonth } from "@/lib/data/closeCommands";
import { changesAfterClose, currentClose } from "@/lib/domain/closeRecord";
import { monthClose, monthOptions } from "@/lib/domain/monthClose";

const NOW = new Date("2026-11-14T03:00:00Z");
const ctx = (userId: string, now = NOW) => ({ userId, now });

describe("D-83 기성·입금 입력 시각·사람", () => {
  it("기성·입금을 넣으면 넣은 시각·사람이 남는다 (가져오기도)", () => {
    const db = createSeed(NOW);
    const b = addBilling(db, { siteId: "site-a", amount: 1_000_000, billedDate: "2026-11-10" }, ctx("u-manager")).db;
    expect(b.billings.at(-1)).toMatchObject({ createdBy: "u-manager", createdAt: NOW.toISOString() });
    const p = addPayment(b, { siteId: "site-a", amount: 500_000, receivedDate: "2026-11-11" }, ctx("u-ceo")).db;
    expect(p.payments.at(-1)).toMatchObject({ createdBy: "u-ceo", createdAt: NOW.toISOString() });
    const siteName = p.sites.find((s) => s.id === "site-a")!.shortName;
    const imp = importData(p, { kind: "billing", text: `현장,구분,일자,금액,메모\n${siteName},기성,2026-09-30,2000000,이관`, idempotencyKey: "idem-d83-imp-0001" }, ctx("u-manager"));
    const added = imp.db.billings.find((x) => x.importBatchId && x.amount === 2_000_000)!;
    expect(added).toMatchObject({ createdBy: "u-manager", createdAt: NOW.toISOString() });
  });

  it("마감 뒤 들어온 기성은 ‘언제’가 보인다", () => {
    const db = createSeed(NOW);
    const items = monthClose(db, "2026-10", "2026-11-14").items.length;
    const c = closeMonth(db, { month: "2026-10", ackOpen: items || undefined, note: "이유 메모" }, ctx("u-manager")).db;
    const later = new Date("2026-11-14T05:00:00Z");
    const b = addBilling(c, { siteId: "site-a", amount: 1_000_000, billedDate: "2026-10-31" }, ctx("u-manager", later)).db;
    const e = changesAfterClose(b, currentClose(b, "2026-10")!, "2026-11-14").events.find((x) => x.text.startsWith("기성 들어옴"))!;
    expect(e.at).toBe(later.toISOString());
  });
});

describe("D-83 고를 수 있는 달", () => {
  it("이번 달부터 가장 이른 착공 달까지 (최대 24개월) · 현장이 없으면 이번 달만", () => {
    const db = createSeed(NOW);
    const ms = monthOptions(db, "2026-11-14");
    expect(ms[0]).toBe("2026-11");
    expect(ms).toContain("2026-10");
    expect(ms.length).toBeLessThanOrEqual(24);
    expect(monthOptions({ sites: [] }, "2026-11-14")).toEqual(["2026-11"]);
  });
});
