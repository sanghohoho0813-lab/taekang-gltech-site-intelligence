import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { CommandError } from "@/lib/data/commands";
import { importData, undoImport } from "@/lib/data/importCommands";
import { normDate, planImport } from "@/lib/domain/importers";
import { siteFinancials } from "@/lib/domain/calc";
import { readinessAll } from "@/lib/domain/readiness";
import { laborEstimate } from "@/lib/domain/labor";
import { crewFlags } from "@/lib/domain/crew";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-02T03:00:00Z"); // 12:00 KST
const TODAY = "2026-11-02";
const ctx = (now = NOW) => ({ userId: "u-manager", now });
const imp = (db: DemoDB, kind: Parameters<typeof importData>[1]["kind"], text: string, extra: Record<string, unknown> = {}) => importData(db, { kind, text, idempotencyKey: `k-${Math.random()}`, ...extra }, ctx());

describe("자료 가져오기 — 검증", () => {
  it("한글·영문 열 이름, 현장코드·약칭·현장명, 날짜 2026.10.20 형식, 쉼표 금액을 받는다", () => {
    const db = createSeed(NOW);
    const site = db.sites.find((s) => s.id === "site-b")!;
    const text = ["현장,구분,날짜,금액,메모", `${site.code},기성,2026.9.30,"120,000,000",`, `${site.name},입금,2026/10/15,50000000원,`, "B현장,기성,2026-10-31,10000000,추가"].join("\n");
    const p = planImport(db, "billing", text, TODAY);
    expect(p.errors).toEqual([]);
    expect(p.rows).toHaveLength(3);
    expect(p.rows.every((r) => (r as { siteId: string }).siteId === "site-b")).toBe(true);
    expect(p.rows[0]).toMatchObject({ kind: "billing", date: "2026-09-30", amount: 120_000_000 });
    expect(normDate("2026.1.5")).toBe("2026-01-05");
    const en = planImport(db, "billing", "site,kind,date,amount\nB현장,payment,2026-10-16,1000000", TODAY);
    expect(en.errors).toEqual([]);
  });

  it("행 번호와 함께 오류 — 없는 현장·잘못된 구분·없는 날짜·0원·필수 열 누락", () => {
    const db = createSeed(NOW);
    const p = planImport(db, "billing", ["현장,구분,날짜,금액", "Z현장,기성,2026-10-01,100", "A현장,선금,2026-10-01,100", "A현장,기성,2026-02-30,100", "A현장,기성,2026-10-01,0"].join("\n"), TODAY);
    expect(p.errors.map((e) => [e.line, e.field])).toEqual([
      [2, "현장"],
      [3, "구분"],
      [4, "날짜"],
      [5, "금액"],
    ]);
    expect(p.rows).toHaveLength(0);
    expect(planImport(db, "billing", "현장,날짜,금액\nA현장,2026-10-01,100", TODAY).errors[0].message).toContain("구분");
    expect(planImport(db, "billing", "현장,구분,날짜,금액", TODAY).errors[0].message).toContain("데이터 행이 없습니다");
  });

  it("입금 합계가 기성 합계를 넘으면 거부 (선급금은 기성으로 먼저)", () => {
    const db = createSeed(NOW);
    const billed = db.billings.filter((b) => b.siteId === "site-a").reduce((a, b) => a + b.amount, 0);
    const paid = db.payments.filter((b) => b.siteId === "site-a").reduce((a, b) => a + b.amount, 0);
    const p = planImport(db, "billing", `현장,구분,날짜,금액\nA현장,입금,2026-10-20,${billed - paid + 1}`, TODAY);
    expect(p.errors[0].message).toContain("입금 합계");
  });

  it("작업 인원: 미래 날짜·인원 범위·구분 확인, 비우면 외주", () => {
    const db = createSeed(NOW);
    const p = planImport(db, "crew", ["현장,날짜,팀,구분,인원", "A현장,2026-11-03,철근팀,,3", "A현장,2026-10-20,철근팀,반장,3", "A현장,2026-10-20,철근팀,직영,0", "A현장,2026-10-21,철근팀,,4명"].join("\n"), TODAY);
    expect(p.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(p.rows).toEqual([expect.objectContaining({ line: 5, kind: "subcontract", headcount: 4 })]);
  });

  it("변경공사: 상태 한글, 승인금액은 승인일 때만, 결정일은 요청일 이후", () => {
    const db = createSeed(NOW);
    const p = planImport(
      db,
      "change",
      ["현장,제목,금액,상태,요청일,승인금액,결정일", "A현장,유리 변경,25000000,승인,2026-07-15,,2026-08-01", "A현장,추가창,8000000,청구,2026-10-10,7000000,", "A현장,철거,1000000,반려,2026-10-10,,2026-10-01", "A현장,기타,1000000,보류,2026-10-10,,"].join("\n"),
      TODAY,
    );
    expect(p.errors.map((e) => [e.line, e.field])).toEqual([
      [3, "승인금액"],
      [4, "결정일"],
      [5, "상태"],
    ]);
    expect(p.rows[0]).toMatchObject({ status: "approved", approvedAmount: 25_000_000, decidedDate: "2026-08-01" });
  });

  it("팀 단가: 범위·같은 팀 두 번 거부, 기존 단가는 ‘변경’으로 요약", () => {
    let db = createSeed(NOW);
    db = { ...db, settings: { ...db.settings!, teamRates: [{ team: "실링팀", dayRate: 250_000 }] } };
    const bad = planImport(db, "rates", "팀,단가\n철근팀,5000\n철근팀,300000\n철근팀,310000", TODAY);
    expect(bad.errors.map((e) => e.line)).toEqual([2, 4]);
    const ok = planImport(db, "rates", "팀,단가\n실링팀,280000\n철근팀,300000", TODAY);
    expect(ok.errors).toEqual([]);
    expect(ok.summary.map((s) => s.label)).toEqual(["실링팀: 25만 원 → 28만 원", "철근팀: 새로 30만 원"]);
  });
});

describe("자료 가져오기 — 반영·중복·취소", () => {
  it("기성·입금을 넣으면 차수가 날짜 순서로 다시 매겨지고, 같은 파일을 다시 올리면 중복으로 건너뛴다", () => {
    const db0 = createSeed(NOW);
    const before = db0.billings.filter((b) => b.siteId === "site-a").sort((a, b) => a.billedDate.localeCompare(b.billedDate));
    const early = shift(before[0].billedDate, -20);
    const text = `현장,구분,날짜,금액\nA현장,기성,${early},50000000\nA현장,입금,${early},50000000`;
    const r = imp(db0, "billing", text);
    expect(r.result).toMatchObject({ added: 2, skipped: 0 });
    const bills = r.db.billings.filter((b) => b.siteId === "site-a").sort((a, b) => a.round - b.round);
    expect(bills[0]).toMatchObject({ billedDate: early, round: 1, amount: 50_000_000 });
    expect(bills.map((b) => b.round)).toEqual(bills.map((_, i) => i + 1));
    // 미수금은 그대로 (기성 = 입금)
    expect(siteFinancials(r.db, "site-a").outstanding).toBe(siteFinancials(db0, "site-a").outstanding);
    // 다시 올리면 모두 중복 → 거부
    const p = planImport(r.db, "billing", text, TODAY);
    expect(p.duplicates).toHaveLength(2);
    expect(() => imp(r.db, "billing", text)).toThrow("새로 넣을 행이 없습니다");
    // 활동 이력·묶음 기록
    expect(r.db.activityLogs[0].summary).toContain("기성·입금 이력 2건");
    expect(r.db.importBatches?.[0]).toMatchObject({ kind: "billing", count: 2, siteIds: ["site-a"] });
  });

  it("오류가 한 줄이라도 있으면 아무것도 넣지 않는다 (서버 재검증)", () => {
    const db0 = createSeed(NOW);
    expect(() => imp(db0, "billing", "현장,구분,날짜,금액\nA현장,기성,2026-10-01,1000\nZ현장,기성,2026-10-01,1000")).toThrow(CommandError);
    expect(() => importData(db0, { kind: "bogus" as never, text: "", idempotencyKey: "x" }, ctx())).toThrow(CommandError);
  });

  it("승인된 변경공사는 계약금액에 더해지고, 기준선을 다시 잡으면 ‘운영 중 변화’로 보이지 않는다", () => {
    const db0 = createSeed(NOW);
    const f0 = siteFinancials(db0, "site-a");
    const text = "현장,제목,금액,상태,요청일,승인금액,결정일\nA현장,3층 유리 사양 변경,25000000,승인,2026-07-15,23000000,2026-08-01\nA현장,로비 고정창,8000000,청구,2026-10-10,,";
    const r = imp(db0, "change", text);
    const f1 = siteFinancials(r.db, "site-a");
    expect(f1.adjustedContract).toBe(f0.adjustedContract + 23_000_000);
    expect(f1.pendingChangeAmount).toBe(f0.pendingChangeAmount + 8_000_000);
    expect(r.db.baseline["site-a"].adjustedContract ?? r.db.baseline["site-a"].contractAmount + r.db.baseline["site-a"].approvedChange).toBe(f1.adjustedContract);
    const co = r.db.changeOrders.find((c) => c.title === "3층 유리 사양 변경")!;
    expect(co).toMatchObject({ status: "approved", approvedAmount: 23_000_000, decidedAt: "2026-08-01T00:00:00.000Z" });
    // 기준선을 다시 잡지 않으면 기준은 그대로
    const r2 = imp(db0, "change", text, { rebaseline: false });
    expect(r2.db.baseline["site-a"]).toEqual(db0.baseline["site-a"]);
  });

  it("작업 인원 이력은 인건비 추정에 들어가고, 사진·출근 확인 표시는 붙지 않는다", () => {
    const db0 = createSeed(NOW);
    const r = imp(db0, "crew", "현장,날짜,팀,구분,인원\nA현장,2026-11-02,철근팀,직영,5\nA현장,2026-10-30,철근팀,직영,5");
    const site = r.db.sites.find((s) => s.id === "site-a")!;
    const row = laborEstimate(r.db, site, "2026-10-04", TODAY).teams.find((t) => t.team === "철근팀")!;
    expect(row).toMatchObject({ days: 2, personDays: 10 });
    expect(crewFlags(r.db, TODAY, "2026-10-04").filter((f) => f.text.includes("철근팀"))).toEqual([]);
    expect(r.db.crewChecks!.filter((c) => c.team === "철근팀").every((c) => c.imported && c.importBatchId)).toBe(true);
  });

  it("가져오기 취소: 기성·입금 삭제 + 기준선 복구 / 팀 단가 원래대로 / 원가는 무효 처리 / 두 번은 안 됨 / 7일 지나면 안 됨", () => {
    const db0 = createSeed(NOW);
    const r = imp(db0, "billing", "현장,구분,날짜,금액\nA현장,기성,2026-03-01,50000000");
    const u = undoImport(r.db, { batchId: r.result.batchId }, ctx());
    expect(u.db.billings).toHaveLength(db0.billings.length);
    expect(u.db.billings.filter((b) => b.siteId === "site-a").map((b) => b.round).sort()).toEqual(db0.billings.filter((b) => b.siteId === "site-a").map((b) => b.round).sort());
    expect(u.db.baseline["site-a"]).toEqual(db0.baseline["site-a"]);
    expect(() => undoImport(u.db, { batchId: r.result.batchId }, ctx())).toThrow("이미 취소한");
    expect(() => undoImport(r.db, { batchId: r.result.batchId }, ctx(new Date(NOW.getTime() + 8 * 86_400_000)))).toThrow("7일");

    const db1: DemoDB = { ...db0, settings: { ...db0.settings!, teamRates: [{ team: "실링팀", dayRate: 250_000 }] } };
    const rr = imp(db1, "rates", "팀,단가\n실링팀,280000\n철근팀,300000");
    expect(rr.db.settings?.teamRates).toEqual([{ team: "실링팀", dayRate: 280_000 }, { team: "철근팀", dayRate: 300_000 }]);
    expect(undoImport(rr.db, { batchId: rr.result.batchId }, ctx()).db.settings?.teamRates).toEqual([{ team: "실링팀", dayRate: 250_000 }]);

    const rc = imp(db0, "cost", "현장,날짜,항목,금액,성격,사유,메모\nA현장,2026-10-20,자재,12000000,추가,설계변경,프레임");
    expect(siteFinancials(rc.db, "site-a").eac).toBe(siteFinancials(db0, "site-a").eac + 12_000_000);
    const uc = undoImport(rc.db, { batchId: rc.result.batchId }, ctx());
    expect(siteFinancials(uc.db, "site-a").eac).toBe(siteFinancials(db0, "site-a").eac);
    expect(uc.db.costEntries.find((e) => e.importBatchId === rc.result.batchId)?.voidReason).toBe("자료 가져오기 취소");
  });

  it("변경공사를 가져온 뒤 승인·반려가 바뀌었으면 통째로 취소하지 않는다", () => {
    const db0 = createSeed(NOW);
    const r = imp(db0, "change", "현장,제목,금액,상태,요청일\nA현장,추가창,8000000,청구,2026-10-10");
    const co = r.db.changeOrders.find((c) => c.title === "추가창")!;
    const changed: DemoDB = { ...r.db, changeOrders: r.db.changeOrders.map((c) => (c.id === co.id ? { ...c, status: "approved", decidedAt: new Date(NOW.getTime() + 1000).toISOString() } : c)) };
    expect(() => undoImport(changed, { batchId: r.result.batchId }, ctx(new Date(NOW.getTime() + 2000)))).toThrow("승인·반려가 바뀐");
  });
});

describe("자료 준비 점검", () => {
  it("현장 위치·담당자·공정 단계·기성 이력·작업 인원·팀 단가를 현장별로 확인", () => {
    const db = createSeed(NOW);
    const r = readinessAll(db, TODAY);
    const a = r.sites.find((s) => s.site.id === "site-a")!;
    const st = (k: string) => a.items.find((i) => i.key === k)?.status;
    expect(st("contract")).toBe("ok");
    expect(st("field-user")).toBe("ok");
    expect(st("rates")).toBe("warn"); // 시드 팀은 단가 미설정
    expect(st("crew")).toBe("ok");
    const b = r.sites.find((s) => s.site.id === "site-b")!;
    expect(b.items.find((i) => i.key === "crew")?.status).toBe("warn"); // 작업 인원 보고 없음
    // 위치를 지우면 ‘빠짐’
    const noGeo: DemoDB = { ...db, sites: db.sites.map((s) => (s.id === "site-a" ? { ...s, geo: undefined } : s)) };
    expect(readinessAll(noGeo, TODAY).sites.find((s) => s.site.id === "site-a")!.items.find((i) => i.key === "geo")?.status).toBe("missing");
    // 진행 중인데 기성이 없으면 ‘빠짐’
    const noBill: DemoDB = { ...db, billings: db.billings.filter((x) => x.siteId !== "site-a"), payments: db.payments.filter((x) => x.siteId !== "site-a") };
    expect(readinessAll(noBill, TODAY).sites.find((s) => s.site.id === "site-a")!.items.find((i) => i.key === "billing")?.status).toBe("missing");
    expect(r.company.find((i) => i.key === "field-users")?.status).toBe("ok");
  });
});

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
