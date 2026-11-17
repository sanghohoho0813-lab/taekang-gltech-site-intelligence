/**
 * D-87 월 마감 엑셀(세무·회계용) — 실제 명령으로 45일 운영한 자료에서
 * 1) 엑셀 파일을 만들고 다시 읽어 합계가 월 마감 화면 숫자와 같은지
 * 2) 합계가 다르면(만든 뒤 숫자를 바꾼 경우) 대조가 잡는지
 * 3) 지난 날짜로 받은 변경공사 승인이 ‘이익을 바꾼 일’에서 빠지지 않는지 (D-87 무작위 점검에서 찾은 문제)
 */
import { describe, expect, it } from "vitest";
import { simulate } from "./moneySim";
import { createSeed } from "@/lib/data/seed";
import { COMMANDS } from "@/lib/data/registry";
import { monthBounds, monthClose, profitEvents } from "@/lib/domain/monthClose";
import { monthWorkbook, verifyWorkbookFile } from "@/lib/domain/monthWorkbook";
import { moneyIntegrity } from "@/lib/domain/integrity";
import { readXlsx, writeXlsx } from "@/lib/domain/xlsx";
import { readZip } from "@/lib/domain/zip";
import { siteFinancials } from "@/lib/domain/calc";

const num = (v: string | undefined) => Number(v ?? "") || 0;

describe("D-87 월 마감 엑셀", () => {
  const { db } = simulate(31, 45, { close: true });
  const today = "2026-11-14";

  for (const month of ["2026-10", "2026-11"]) {
    it(`${month}: 엑셀 파일을 다시 읽은 합계 = 월 마감 화면 (기성·입금·미수·원가·변경공사·이익 변화)`, async () => {
      const r = monthClose(db, month, today);
      const w = monthWorkbook(db, month, today, { by: "u-manager", now: new Date("2026-11-14T03:00:00Z") });
      expect(w.ok, JSON.stringify(w.checks.filter((c) => !c.ok))).toBe(true);
      expect(w.checks.length).toBe(13);
      const bytes = writeXlsx(w.sheets);
      const file = await verifyWorkbookFile(bytes, w);
      expect(file.filter((c) => !c.ok), JSON.stringify(file)).toEqual([]);
      const sheets = await readXlsx(bytes);
      const by = (name: string) => sheets.find((s) => s.name === name)!.rows;
      const ended = monthBounds(month).to < today;
      expect(sheets.map((s) => s.name)).toEqual(["안내", "현장별 요약", "기성", "입금", ended ? "월말 미수" : "미수(오늘)", "원가", "원가 항목별", "변경공사", "노무", "이익을 바꾼 일"]);
      const lastRow = (rows: string[][]) => rows[rows.length - 1];
      // 요약 합계 줄
      const sum = lastRow(by("현장별 요약"));
      expect(sum[0]).toBe("합계");
      expect(num(sum[5])).toBe(r.totals.billed);
      expect(num(sum[6])).toBe(r.totals.received);
      expect(num(sum[7])).toBe(r.totals.outstandingAtEnd);
      expect(num(sum[8])).toBe(r.totals.costTotal);
      expect(num(sum[10])).toBe(r.totals.changeApproved);
      expect(num(sum[12])).toBe(r.profit.reduce((a, p) => a + p.net, 0));
      // 시트별 합계 줄 · 현장별 예상이익 = 현장 상세(대시보드) 숫자
      expect(num(lastRow(by("기성"))[3])).toBe(r.totals.billed);
      expect(num(lastRow(by("입금"))[3])).toBe(r.totals.received);
      expect(num(lastRow(by(ended ? "월말 미수" : "미수(오늘)"))[3])).toBe(r.totals.outstandingAtEnd);
      // 원가: 확정 줄 바로 아래 ‘확정 합계’ — 대기·반려·취소는 그 아래 따로
      const costRows = by("원가");
      const totalAt = costRows.findIndex((x) => x[0] === "확정 합계");
      expect(num(costRows[totalAt][5])).toBe(r.totals.costTotal);
      expect(costRows.slice(1, totalAt).every((x) => x[11] === "확정")).toBe(true);
      expect(costRows.slice(totalAt + 1).filter((x) => /^\d{4}-/.test(x[0] ?? "")).every((x) => x[11] !== "확정")).toBe(true);
      expect(num(lastRow(by("원가 항목별")).at(-1))).toBe(r.totals.costTotal);
      expect(num(lastRow(by("변경공사"))[11])).toBe(r.totals.changeApproved);
      // 현장별: ‘지금’은 현장 상세 숫자, 끝난 달의 ‘월말’은 대표 보고서 달별 보기와 같은 계산(지금 − 그 뒤 이익을 바꾼 일)
      const next = new Date(Date.parse(`${r.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      for (const row of by("현장별 요약").slice(1, -1)) {
        const site = db.sites.find((s) => s.shortName === row[0])!;
        const now = siteFinancials(db, site.id).expectedProfit;
        const after = ended ? profitEvents(db, site.id, next, today).reduce((a, e) => a + e.amount, 0) : 0;
        expect(num(row[13]), site.shortName).toBe(now);
        expect(num(row[11]), site.shortName).toBe(now - after);
      }
      // 기성: 공급가액 + 부가세 10% = 공급대가 (계산값)
      const bl = lastRow(by("기성"));
      expect(num(bl[5])).toBe(num(bl[3]) + num(bl[4]));
      // 금액은 엑셀 숫자 칸(더하기 가능) · 날짜는 날짜 칸으로 다시 읽힌다
      const bill = by("기성")[1];
      if (bill) expect(bill[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const info = by("안내").map((x) => x.join(" ")).join("\n");
      expect(info).toContain("모두 같음");
      expect(info).toContain("공급가액(부가세 별도)");
      expect(info).toContain("급여·원천세·지급명세서에 쓰지 마세요");
      expect(info).toMatch(month === "2026-11" ? /진행 중/ : /공무 마감|마감 전/);
      expect(w.filename).toMatch(month === "2026-11" ? /_진행중_/ : /_(마감전|대표확인전|확인뒤변경|대표확인)_/);
    });
  }

  it("만든 뒤 숫자가 화면과 달라지면 대조가 잡고, 숫자 맞추기 점검에 빨강으로 뜬다", () => {
    const r = monthClose(db, "2026-10", today);
    const w = monthWorkbook(db, "2026-10", today, { report: { ...r, totals: { ...r.totals, billed: r.totals.billed + 10_000 } } });
    expect(w.ok).toBe(false);
    // 기성 시트는 자료에서 바로 만들었으므로 ‘화면’ 숫자와 1만 원 다르다
    expect(w.checks.filter((c) => !c.ok).map((c) => c.label)).toEqual(["이달 기성: 기성 시트 = 화면"]);
    expect(moneyIntegrity(db, today).find((c) => c.key === "xlsx")?.level).toBe("ok");
  });

  it("빈 회사·진행 중인 달도 오류 없이 (빈 시트 + 합계 0)", () => {
    const empty = createSeed(new Date("2026-11-14T03:00:00Z"));
    empty.billings = [];
    empty.payments = [];
    const w = monthWorkbook(empty, "2026-11", today);
    expect(w.ok).toBe(true);
    expect(w.filename).toMatch(/^월마감_2026-11_진행중_.+\.xlsx$/);
  });
});

describe("D-87 무작위 점검에서 찾아 고친 것", () => {
  it("변경공사 승인의 받은 날을 현장 등록(기준) 전 날짜로 넣어도 ‘이익을 바꾼 일’에 등록한 날로 잡혀 합이 맞는다 (등록 뒤 날짜는 D-84대로 받은 날)", () => {
    const now = new Date("2026-10-02T03:00:00Z");
    let db = createSeed(new Date("2026-10-01T01:00:00Z"));
    const co = db.changeOrders.find((c) => c.status === "review" || c.status === "submitted")!;
    const p0 = siteFinancials(db, co.siteId).expectedProfit;
    db = COMMANDS.setChangeOrderStatus(db, { coId: co.id, status: "approved", note: "공문 받음", date: "2026-09-30", basis: "letter" }, { userId: "u-ceo", now }).db;
    const gained = siteFinancials(db, co.siteId).expectedProfit - p0;
    expect(gained).not.toBe(0);
    const ev = profitEvents(db, co.siteId, "2026-10-01", "2026-10-31").find((e) => e.text.startsWith("변경공사 승인"));
    // 시드 현장은 등록 시각이 없어 자료 시작(10/1) — 그날로 잡힌다
    expect(ev?.date).toBe("2026-10-01");
    expect(ev?.text).toContain("받은 날 9/30 · 현장 등록 전");
    expect(moneyIntegrity(db, "2026-10-02").filter((c) => c.level === "err")).toEqual([]);
  });
});

describe("D-87 점검 반영 — 엑셀 칸", () => {
  it("메모의 제어 글자는 지우고, 전화번호·날짜 모양 메모는 글자 그대로 (숫자·날짜로 바꾸지 않음)", async () => {
    const db = createSeed(new Date("2026-11-14T03:00:00Z"));
    const e = db.costEntries.find((x) => x.status === "active")!;
    e.note = "01012345678";
    const month = e.date.slice(0, 7);
    const co = db.changeOrders.find((c) => c.siteId === e.siteId) ?? db.changeOrders[0];
    co.title = "벨\u0007소리\u000b변경";
    const w = monthWorkbook(db, month, "2026-11-14");
    const bytes = writeXlsx(w.sheets);
    // 시트 XML에 XML이 받지 않는 제어 글자가 없어야 한다 (zip 머리 바이트는 빼고 XML만)
    for (const f of readZip(bytes).filter((x) => x.name.endsWith(".xml"))) expect(new TextDecoder().decode(f.raw), f.name).not.toMatch(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/);
    const sheets = await readXlsx(bytes);
    const cost = sheets.find((s) => s.name === "원가")!.rows;
    expect(cost.some((r) => r[8] === "01012345678")).toBe(true);
    expect((await verifyWorkbookFile(bytes, w)).every((c) => c.ok)).toBe(true);
  });

  it("기준선을 다시 잡지 않고 가져온 ‘승인된 변경공사’(결정일이 등록 전)도 가져온 날로 잡혀 합이 맞는다", () => {
    const now = new Date("2026-11-05T03:00:00Z");
    let db = createSeed(new Date("2026-10-01T01:00:00Z"));
    const site = db.sites[0];
    const p0 = siteFinancials(db, site.id).expectedProfit;
    db = COMMANDS.importData(db, { kind: "change", text: `현장,제목,금액,상태,요청일,승인금액,결정일,메모\n${site.shortName},지난 변경,20000000,승인,2026-08-10,,2026-08-20,`, idempotencyKey: "idem-d87-imp-0001", rebaseline: false } as never, { userId: "u-manager", now }).db;
    expect(siteFinancials(db, site.id).expectedProfit - p0).toBe(20_000_000);
    const checks = moneyIntegrity(db, "2026-11-05");
    expect(checks.find((c) => c.key === "profit-events")?.level, JSON.stringify(checks.find((c) => c.key === "profit-events"))).toBe("ok");
  });

  it("현장 등록 전 날짜로 받은 승인도 그 달 월 마감에 현장이 들어가 달마다 더한 이익 변화 = 기준 대비 변화", () => {
    const now = new Date("2026-11-05T03:00:00Z");
    let db = createSeed(new Date("2026-10-01T01:00:00Z"));
    const co = db.changeOrders.find((c) => c.status === "review" || c.status === "submitted")!;
    db = COMMANDS.setChangeOrderStatus(db, { coId: co.id, status: "approved", note: "공문", date: "2026-09-30", basis: "letter" }, { userId: "u-ceo", now }).db;
    const checks = moneyIntegrity(db, "2026-11-05");
    expect(checks.find((c) => c.key === "profit-events")?.level, JSON.stringify(checks.find((c) => c.key === "profit-events"))).toBe("ok");
    expect(monthClose(db, "2026-10", "2026-11-05").profit.some((p) => p.site.id === co.siteId && p.events.some((e) => e.text.includes("받은 날 9/30")))).toBe(true);
  });
});
