/** D-71 지난 공정 진행 이력 가져오기(검증·앞뒤 맞추기·반영·취소) · 하자보증 만료 알림 · 현장 준공 ↔ 하자보증 준공일 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { voidReport } from "@/lib/data/commands";
import { importData, undoImport } from "@/lib/data/importCommands";
import { parsePctCell, planImport, type ProgressRow } from "@/lib/domain/importers";
import { cellKind, crc32, readXlsx, rowsToCsv } from "@/lib/domain/xlsx";
import { monthRange, partnerMonthly, partnerProgressFeed, progressHistory } from "@/lib/domain/partnerFeed";
import { dailyLog, stageChangeText, weekStart, weeklyLog } from "@/lib/domain/dailylog";
import { acceptanceItems } from "@/lib/domain/acceptance";
import type { DemoDB } from "@/lib/domain/types";
import { saveSite, setSiteWarranty } from "@/lib/data/adminCommands";
import { runDailyChecks } from "@/lib/data/dailyJobs";
import { warrantyEnd, warrantyNextNotice, warrantyNoticeDue } from "@/lib/domain/warranty";
import { viewFor } from "@/server/authz";

const NOW = new Date("2026-11-08T03:00:00Z"); // 12:00 KST
const TODAY = "2026-11-08";
const ctx = (now = NOW) => ({ userId: "u-manager", now });
const HEAD = "현장,날짜,공정 단계,진행률,메모";
const csv = (...rows: string[]) => [HEAD, ...rows].join("\n");
const plan = (db: DemoDB, ...rows: string[]) => planImport(db, "progress", csv(...rows), TODAY);
const imp = (db: DemoDB, ...rows: string[]) => importData(db, { kind: "progress", text: csv(...rows), idempotencyKey: `k-${Math.random()}` }, ctx());

/** 백분율 서식 칸이 있는 아주 작은 엑셀 파일 (압축 없는 zip) — 엑셀이 ‘100%’로 보이는 칸을 값 1로 저장하는 모양 그대로 */
function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(local, f.data);
    central.push(cd);
    offset += local.length + f.data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
/** rows: string cells are inline strings; number cells use style 1 = builtin numFmt 9 ("0%") — what Excel stores for a cell showing "100%" */
function percentXlsx(rows: (string | number)[][]): Uint8Array {
  const enc = new TextEncoder();
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetRows = rows
    .map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => (typeof c === "number" ? `<c r="${col(ci)}${ri + 1}" s="1"><v>${c}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${c}</t></is></c>`)).join("")}</row>`)
    .join("");
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const styles = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="9" applyNumberFormat="1"/></cellXfs></styleSheet>`;
  const wb = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  return zipStore([
    { name: "xl/workbook.xml", data: enc.encode(wb) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(rels) },
    { name: "xl/styles.xml", data: enc.encode(styles) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheet) },
  ]);
}


describe("공정 진행 이력 — 검증", () => {
  it("진행률 칸: 35 · 35% · 엑셀 백분율(0.35) · 35.0은 받고, 소수 %는 받지 않는다", () => {
    expect(parsePctCell("35")).toBe(35);
    expect(parsePctCell("35%")).toBe(35);
    expect(parsePctCell(" 35 % ")).toBe(35);
    expect(parsePctCell("0.35")).toBe(35);
    expect(parsePctCell("35.0")).toBe(35);
    expect(parsePctCell("100%")).toBe(100);
    expect(parsePctCell("1")).toBe(1);
    expect(parsePctCell("1.5")).toBeNaN();
    expect(parsePctCell("0.355")).toBeNaN();
    expect(parsePctCell("-5")).toBeNaN();
    expect(parsePctCell("")).toBeNaN();
  });

  it("엑셀 백분율 서식 칸(100% = 값 1)은 화면에 보이는 대로 ‘100%’로 읽는다 (점검 반영)", async () => {
    expect(cellKind("0%")).toBe("pct");
    expect(cellKind("0.00%")).toBe("pct");
    expect(cellKind('0"%"')).toBeNull();
    expect(cellKind("yyyy-mm-dd")).toBe("date");
    const sheets = await readXlsx(percentXlsx([["현장", "날짜", "공정 단계", "진행률"], ["C현장", "2026-08-01", "철골 하부구조", 0.5], ["C현장", "2026-09-01", "철골 하부구조", 0.9], ["C현장", "2026-09-01", "전체", 0.07]]));
    expect(sheets[0].rows.slice(1).map((r) => r[3])).toEqual(["50%", "90%", "7%"]);
    const p = planImport(createSeed(NOW), "progress", rowsToCsv(sheets[0].rows), TODAY);
    expect(p.errors).toEqual([]);
    expect((p.rows as ProgressRow[]).map((r) => r.pct)).toEqual([50, 90, 7]);
  });

  it("단계마다 첫 줄은 ‘첫 기록’(그날 값 · 0%에서 오른 것이 아님), 그다음부터 앞 기록 값에서 이어 붙인다", () => {
    const db = createSeed(NOW);
    const p = plan(db, "C현장,2026-08-01,철골 하부구조,30,1단 설치", "C현장,2026.9.1,철골 하부구조,60%,", "C현장,2026-10-01,철골 하부구조,90,", "C현장,2026-10-01,전체,35,");
    expect(p.errors).toEqual([]);
    expect((p.rows as ProgressRow[]).map((r) => [r.date, r.stageName, r.from, r.pct, !!r.first])).toEqual([
      ["2026-08-01", "철골 하부구조", 30, 30, true],
      ["2026-09-01", "철골 하부구조", 30, 60, false],
      ["2026-10-01", "철골 하부구조", 60, 90, false],
      ["2026-10-01", "전체 공정률", 35, 35, true],
    ]);
    expect(p.summary[0].label).toContain("3개 날짜");
    expect(p.summary[0]).not.toHaveProperty("amount");
  });

  it("잘못된 줄: 없는 단계·착공일 전·오늘·100 초과·같은 날 다른 값·줄어든 누계·지금보다 높은 값 · 오류 줄은 다음 줄 기준이 아님", () => {
    const db = createSeed(NOW);
    const p = plan(
      db,
      "C현장,2026-08-01,없는 단계,10,", // 2
      "C현장,2026-07-01,철골 하부구조,10,", // 3 착공 2026-07-11 전
      `C현장,${TODAY},철골 하부구조,50,`, // 4 오늘
      "C현장,2026-08-02,유리 설치,101,", // 5
      "C현장,2026-08-10,철골 하부구조,40,", // 6
      "C현장,2026-08-10,철골 하부구조,45,", // 7 같은 날 다른 값
      "C현장,2026-08-20,철골 하부구조,30,", // 8 6행 40%보다 낮음
      "C현장,2026-09-20,아트리움 프레임 제작,50,", // 9 지금 40%보다 높음
      "C현장,2026-10-20,아트리움 프레임 제작,35,", // 10 9행이 오류라 9행 기준으로 따지지 않음 → 통과
    );
    const at = (line: number) => p.errors.filter((e) => e.line === line).map((e) => e.message).join(" / ");
    expect(at(2)).toMatch(/단계가 C현장에 없습니다/);
    expect(at(3)).toMatch(/착공일\(2026-07-11\) 전/);
    expect(at(4)).toMatch(/어제까지/);
    expect(at(5)).toMatch(/0~100/);
    expect(at(7)).toMatch(/6행과 같은 날 같은 단계인데 진행률이 다릅니다/);
    expect(at(8)).toMatch(/엑셀 6행\(2026-08-10 40%\)보다 낮습니다/);
    expect(at(9)).toMatch(/지금 아트리움 프레임 제작\(40%\)보다 높습니다/);
    expect(at(10)).toBe("");
    // 오류가 하나라도 있으면 아무것도 넣지 않는다
    expect(() => imp(db, "C현장,2026-08-01,없는 단계,10,")).toThrow(/오류/);
  });

  it("앱으로 현장 보고를 시작한 날부터는 넣지 않는다 · 그 전 기록은 첫 현장 보고의 시작 값을 넘지 못한다", () => {
    const db = createSeed(NOW);
    // A현장: 2026-10-01부터 현장 보고 (커튼월 유닛 설치 10-01 25→30)
    const ok = plan(db, "A현장,2026-09-15,커튼월 유닛 설치,20,");
    expect(ok.errors).toEqual([]);
    expect((ok.rows as ProgressRow[]).map((r) => [r.date, r.from, r.pct, r.first])).toEqual([["2026-09-15", 20, 20, true]]);
    expect(plan(db, "A현장,2026-10-01,커튼월 유닛 설치,30,").errors[0].message).toMatch(/2026-10-01부터 앱으로 현장 보고를 하고 있습니다/);
    expect(plan(db, "A현장,2026-10-05,커튼월 유닛 설치,32,").errors[0].message).toMatch(/현장 보고를 하고 있습니다/);
    expect(plan(db, "A현장,2026-09-20,커튼월 유닛 설치,28,").errors[0].message).toMatch(/뒤의 현장 보고\(2026-10-01 시작 25%\)보다 높습니다/);
  });

  it("앞 기록과 같은 값(변화 없음)은 넣지 않고 따로 센다", () => {
    const db = createSeed(NOW);
    const p = plan(db, "C현장,2026-08-01,철골 하부구조,30,", "C현장,2026-08-15,철골 하부구조,30,", "C현장,2026-09-01,철골 하부구조,50,", "C현장,2026-09-01,철골 하부구조,50,");
    expect(p.errors).toEqual([]);
    expect((p.rows as ProgressRow[]).map((r) => [r.date, r.from, r.pct])).toEqual([
      ["2026-08-01", 30, 30],
      ["2026-09-01", 30, 50],
    ]);
    expect(p.duplicates.map((d) => d.line)).toEqual([3, 5]);
    expect(p.unchanged).toBe(1);
  });
});

describe("공정 진행 이력 — 반영·취소", () => {
  it("현장·날짜마다 이관 기록 한 건 · 지금 공정률 그대로 · 첫 기록은 월간 보고서 변화에 안 들어감 · 공사일보·공정 진행 이력", () => {
    const db0 = createSeed(NOW);
    const { db, result } = imp(db0, "C현장,2026-08-01,철골 하부구조,30,1단 설치", "C현장,2026-09-01,철골 하부구조,60,", "C현장,2026-09-01,아트리움 프레임 제작,10,제작 착수", "C현장,2026-10-01,전체,35,");
    expect(result).toMatchObject({ added: 4, siteIds: ["site-c"], unchanged: 0 });
    const mine = db.reports.filter((r) => r.importBatchId === result.batchId);
    expect(mine.map((r) => r.reportDate)).toEqual(["2026-10-01", "2026-09-01", "2026-08-01"]);
    const sep = mine.find((r) => r.reportDate === "2026-09-01")!;
    expect(sep).toMatchObject({ workDone: "제작 착수", createdBy: "u-manager", status: "submitted", review: { status: "confirmed" }, photoIds: [], costEntryIds: [] });
    expect(sep.stages).toEqual([
      { stageId: "site-c-stage-1", name: "철골 하부구조", from: 30, to: 60 },
      { stageId: "site-c-stage-2", name: "아트리움 프레임 제작", from: 10, to: 10 },
    ]);
    // 메모 없는 날은 작업 내용을 비워 둔다 (자리 글이 공사일보에 찍히지 않게)
    expect(mine.find((r) => r.reportDate === "2026-10-01")).toMatchObject({ workDone: "", stages: [], progress: { from: 35, to: 35 } });
    expect(db.sites.find((s) => s.id === "site-c")).toEqual(db0.sites.find((s) => s.id === "site-c"));
    // 발주처 월간 보고서 (9월): 실제 변화만 — 첫 기록(프레임 10%)은 ‘+10%p’로 보이지 않는다
    const m = partnerMonthly(db, "site-c", "2026-09", partnerProgressFeed(db, "site-c", TODAY, 120));
    expect(m.from).toBe(monthRange("2026-09").from);
    expect(m.stages).toEqual([{ stage: "철골 하부구조", from: 30, to: 60 }]);
    expect(partnerMonthly(db, "site-c", "2026-08", partnerProgressFeed(db, "site-c", TODAY, 120)).stages).toEqual([]);
    // 공사일보 — 작성자 ‘엑셀 이관’, 본사 확인 없음(이관 기록의 확인은 쓰지 않음), 빠진 자료 따지지 않음
    const site = db.sites.find((s) => s.id === "site-c")!;
    const d = dailyLog(db, site, "2026-09-01");
    expect(d.writers).toEqual(["엑셀 이관"]);
    expect(d).toMatchObject({ importedOnly: true, review: { status: "none" }, gaps: [] });
    expect(d.stages.map((x) => stageChangeText(x))).toEqual(["30% → 60%", "10% (첫 기록)"]);
    expect(dailyLog(db, site, "2026-10-01").stages).toEqual([{ name: "전체 공정률", from: 35, to: 35 }]);
    // 주간: ‘현장 보고 N일’에 넣지 않는다
    expect(weeklyLog(db, site, weekStart("2026-09-01"), TODAY).reportDays).toBe(0);
    // 본사 공정 진행 이력 — 엑셀 이관 표시, 첫 기록 표시
    const h = progressHistory(db, "site-c", TODAY);
    expect(h.map((x) => [x.date, x.imported])).toEqual([
      ["2026-10-01", true],
      ["2026-09-01", true],
      ["2026-08-01", true],
    ]);
    expect(h[0].changes[0]).toMatchObject({ stage: "전체 공정률", first: true });
    expect(h[1].changes.map((c) => [c.stage, c.first])).toEqual([
      ["철골 하부구조", false],
      ["아트리움 프레임 제작", true],
    ]);
    expect(progressHistory(db, "site-a", TODAY).every((x) => !x.imported)).toBe(true);
    expect(db.activityLogs[0].summary).toMatch(/공정 진행 이력 4건 \(C현장\)/);
    expect(db.activityLogs[0].summary).not.toMatch(/합계/);
    // 현장 휴대폰에는 이관 기록을 보내지 않는다
    const fieldView = viewFor({ id: "u-field2", role: "field", companyId: "c", siteIds: ["site-c"] } as never, db);
    expect(fieldView.reports.some((r) => r.importBatchId)).toBe(false);
  });

  it("같은 파일을 다시 올리면 모두 ‘이미 있음’ · 같은 날 다른 값은 오류로 고치는 길 안내 · 7일 안에 통째로 취소", () => {
    const rows = ["C현장,2026-08-01,철골 하부구조,30,", "C현장,2026-09-01,철골 하부구조,60,"];
    const first = imp(createSeed(NOW), ...rows);
    expect(plan(first.db, ...rows).rows).toHaveLength(0);
    expect(() => imp(first.db, ...rows)).toThrow(/새로 넣을 행이 없습니다/);
    expect(plan(first.db, "C현장,2026-09-01,철골 하부구조,65,").errors[0].message).toMatch(/그날 엑셀 이관 기록\(60%\)이 이미 있습니다 — 고치려면/);
    const undone = undoImport(first.db, { batchId: first.result.batchId }, ctx(new Date(NOW.getTime() + 3_600_000)));
    expect(undone.result.removed).toBe(2);
    expect(undone.db.reports.some((r) => r.importBatchId)).toBe(false);
    expect(undone.db.reports).toHaveLength(createSeed(NOW).reports.length);
    expect(() => undoImport(first.db, { batchId: first.result.batchId }, ctx(new Date(NOW.getTime() + 8 * 86_400_000)))).toThrow(/7일/);
  });

  it("나중에 더 이른 날짜·사이 날짜를 넣으면 뒤의 이관 기록을 그 값에서 다시 잇고, 취소하면 되돌린다", () => {
    const stage = (db: DemoDB, date: string) => db.reports.find((r) => r.importBatchId && r.status !== "voided" && r.reportDate === date)!.stages![0];
    const a = imp(createSeed(NOW), "C현장,2026-10-01,철골 하부구조,60,");
    expect(stage(a.db, "2026-10-01")).toMatchObject({ from: 60, to: 60 });
    // 더 이른 날짜: 뒤 기록이 30에서 시작
    const b = imp(a.db, "C현장,2026-08-01,철골 하부구조,30,");
    expect(stage(b.db, "2026-10-01")).toMatchObject({ from: 30, to: 60 });
    expect(stage(b.db, "2026-08-01")).toMatchObject({ from: 30, to: 30 });
    // 사이 날짜: 9월 45 → 10월은 45에서
    const c = imp(b.db, "C현장,2026-09-01,철골 하부구조,45,");
    expect(stage(c.db, "2026-09-01")).toMatchObject({ from: 30, to: 45 });
    expect(stage(c.db, "2026-10-01")).toMatchObject({ from: 45, to: 60 });
    expect(plan(c.db, "C현장,2026-09-15,철골 하부구조,65,").errors[0].message).toMatch(/뒤의 엑셀 이관 기록\(2026-10-01 60%\)보다 높습니다/);
    // 사이 기록 취소 → 10월은 다시 30에서
    const u = undoImport(c.db, { batchId: c.result.batchId }, ctx()).db;
    expect(stage(u, "2026-10-01")).toMatchObject({ from: 30, to: 60 });
    // 그날 이관 기록 지우기(본사) → 뒤 기록이 앞 값에서 이어진다 · 첫 기록을 지우면 뒤가 첫 기록
    const v = voidReport(c.db, c.db.reports.find((r) => r.importBatchId && r.reportDate === "2026-09-01")!.id, ctx()).db;
    expect(stage(v, "2026-10-01")).toMatchObject({ from: 30, to: 60 });
    const v2 = voidReport(v, v.reports.find((r) => r.importBatchId && r.reportDate === "2026-08-01")!.id, ctx()).db;
    expect(stage(v2, "2026-10-01")).toMatchObject({ from: 60, to: 60 });
    // 지운 날은 다시 넣을 수 있다
    expect(plan(v2, "C현장,2026-08-01,철골 하부구조,35,").errors).toEqual([]);
    // 앞선 묶음을 먼저 취소해도 뒤 묶음 기록은 앞 값으로 이어진다
    const ua = undoImport(c.db, { batchId: b.result.batchId }, ctx()).db;
    expect(stage(ua, "2026-09-01")).toMatchObject({ from: 45, to: 45 });
  });

  it("가져온 기록 한 건을 되돌려도 지금 공정률은 바뀌지 않는다 (현장 보고 되돌리기와 다름)", () => {
    const { db } = imp(createSeed(NOW), "C현장,2026-09-01,철골 하부구조,60,", "C현장,2026-10-01,철골 하부구조,90,", "C현장,2026-10-01,전체,35,");
    const r = db.reports.find((x) => x.importBatchId && x.reportDate === "2026-10-01")!;
    const after = voidReport(db, r.id, ctx()).db;
    const c = after.sites.find((s) => s.id === "site-c")!;
    expect(c.progressPct).toBe(35);
    expect(c.stages.find((x) => x.id === "site-c-stage-1")!.progressPct).toBe(90);
    expect(after.reports.find((x) => x.id === r.id)!.status).toBe("voided");
  });

  it("검수 근거·마지막 보고·내 보고 목록에는 넣지 않는다", () => {
    const db0 = createSeed(NOW);
    const { db } = imp(db0, "C현장,2026-10-20,철골 하부구조,80,", "C현장,2026-10-27,철골 하부구조,85,");
    const ev = (x: DemoDB) => JSON.stringify(acceptanceItems(x, 2, "2026-10-01", TODAY, NOW).flatMap((i) => i.evidence.filter((e) => e.label === "현장 보고")));
    expect(ev(db0)).toContain("현장 보고");
    expect(ev(db)).toBe(ev(db0));
  });
});

const kstNoon = (date: string) => new Date(`${date}T03:00:00Z`);
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** B현장: 2026-06-01 준공 · 6개월 → 2026-11-30까지 */
function withWarranty(months = 6, completedDate = "2026-06-01") {
  const db = setSiteWarranty(createSeed(NOW), { siteId: "site-b", months, completedDate }, ctx()).db;
  // 아침 알림(D-72)은 끄고 하자보증 알림만 본다
  return { ...db, settings: { ...db.settings!, morningBrief: false } };
}

describe("하자보증 만료 알림 — 단계", () => {
  it("남은 날이 들어가는 가장 가까운 단계 하나 · 보낸 단계는 다시 없음 · 끝나면 없음", () => {
    const db = withWarranty();
    const site = db.sites.find((s) => s.id === "site-b")!;
    const end = warrantyEnd("2026-06-01", 6);
    expect(end).toBe("2026-11-30");
    expect(warrantyNoticeDue(site, shift(end, -61))).toBeNull();
    expect(warrantyNoticeDue(site, shift(end, -60))).toMatchObject({ days: 60, daysLeft: 60 });
    expect(warrantyNoticeDue(site, shift(end, -45))).toMatchObject({ days: 60 });
    expect(warrantyNoticeDue(site, shift(end, -25))).toMatchObject({ days: 30 });
    expect(warrantyNoticeDue(site, shift(end, -7))).toMatchObject({ days: 7 });
    expect(warrantyNoticeDue(site, end)).toMatchObject({ days: 7, daysLeft: 0 });
    expect(warrantyNoticeDue(site, shift(end, 1))).toBeNull();
    const sent = { ...site, warranty: { ...site.warranty!, notices: [{ days: 60, at: "x" }] } };
    expect(warrantyNoticeDue(sent, shift(end, -45))).toBeNull();
    expect(warrantyNoticeDue(sent, shift(end, -25))).toMatchObject({ days: 30 });
    // 준공 전·보증 미입력은 없음
    expect(warrantyNoticeDue(createSeed(NOW).sites.find((s) => s.id === "site-a")!, TODAY)).toBeNull();
  });

  it("매일 점검: 본사(대표·공무)에게만, 금액 없이, 단계마다 한 번 — 늦게 켜면 지난 단계는 건너뛴다", () => {
    const db0 = withWarranty();
    const end = "2026-11-30";
    const first = runDailyChecks(db0, kstNoon(shift(end, -45)));
    expect(first.changed).toBe(true);
    expect(first.warranty).toEqual([{ siteId: "site-b", days: 60 }]);
    expect(first.notices).toHaveLength(1);
    expect(first.notices[0]).toMatchObject({ title: "하자보증 만료 45일 전", url: "/sites/site-b?tab=requests", tag: "warranty-site-b" });
    expect(first.notices[0].to.sort()).toEqual(["u-ceo", "u-manager"]);
    expect(first.notices[0].body).toContain("B현장");
    expect(JSON.stringify(first.notices)).not.toMatch(/원|만 원|억/);
    expect(first.db.activityLogs[0]).toMatchObject({ by: "system", siteId: "site-b" });
    expect(first.db.rev).toBe(db0.rev + 1);
    // 같은 날 다시 → 없음 (db 그대로)
    const again = runDailyChecks(first.db, kstNoon(shift(end, -44)));
    expect(again).toMatchObject({ changed: false, notices: [] });
    expect(again.db).toBe(first.db);
    const thirty = runDailyChecks(first.db, kstNoon(shift(end, -30)));
    expect(thirty.warranty).toEqual([{ siteId: "site-b", days: 30 }]);
    const seven = runDailyChecks(thirty.db, kstNoon(shift(end, -7)));
    expect(seven.notices[0].title).toBe("하자보증 만료 7일 전");
    expect(runDailyChecks(seven.db, kstNoon(end)).changed).toBe(false);
    // 늦게 켬: 처음 점검이 20일 남았을 때 → 30일 단계 하나만, 60일 단계는 보낸 것으로
    const late = runDailyChecks(db0, kstNoon(shift(end, -20)));
    expect(late.notices).toHaveLength(1);
    expect(late.db.sites.find((s) => s.id === "site-b")!.warranty!.notices!.map((n) => n.days)).toEqual([60, 30]);
    // 끝난 보증 → 없음
    expect(runDailyChecks(db0, kstNoon(shift(end, 3))).changed).toBe(false);
  });

  it("다음 알림 날짜: 지금 보낼 단계면 ‘다음 아침 점검’, 아니면 다음 단계 날짜 · 받을 본사 사람이 없으면 ‘보냄’으로 남기지 않음", () => {
    const db = withWarranty();
    const site = db.sites.find((s) => s.id === "site-b")!;
    // 2026-11-30 만료 · 11-08 기준 22일 남음 → 30일 단계가 지금 보낼 것
    expect(warrantyNextNotice(site, "2026-11-08")).toEqual({ days: 30, date: "2026-11-08", now: true, daysLeft: 22 });
    // 30일 단계를 보냈으면 다음은 7일 전 (11-23)
    const sent = { ...site, warranty: { ...site.warranty!, notices: [{ days: 60, at: "x" }, { days: 30, at: "x" }] } };
    expect(warrantyNextNotice(sent, "2026-11-08")).toEqual({ days: 7, date: "2026-11-23", now: false, daysLeft: 7 });
    // 아직 먼 보증 → 60일 전 날짜
    expect(warrantyNextNotice(site, "2026-08-01")).toEqual({ days: 60, date: "2026-10-01", now: false, daysLeft: 60 });
    expect(warrantyNextNotice(site, "2026-12-01")).toBeNull();
    const noHq = { ...db, users: db.users.map((u) => (u.role === "ceo" || u.role === "manager" ? { ...u, inactive: true } : u)) };
    expect(runDailyChecks(noHq, kstNoon("2026-11-08"))).toMatchObject({ changed: false, notices: [] });
  });

  it("메모만 고치면 보낸 알림 기록 유지, 기간·준공일을 고치면 다시 센다 · 발주처·현장 화면에는 알림 기록 없음", () => {
    const sent = runDailyChecks(withWarranty(), kstNoon("2026-10-20")).db;
    const memo = setSiteWarranty(sent, { siteId: "site-b", months: 6, completedDate: "2026-06-01", note: "계약서 제12조" }, ctx()).db;
    expect(memo.sites.find((s) => s.id === "site-b")!.warranty!.notices).toHaveLength(1);
    const longer = setSiteWarranty(sent, { siteId: "site-b", months: 7, completedDate: "2026-06-01" }, ctx()).db;
    expect(longer.sites.find((s) => s.id === "site-b")!.warranty!.notices).toBeUndefined();
    const partner = viewFor({ id: "u-partner", role: "partner", companyId: "c", siteIds: ["site-b"] } as never, sent);
    expect(JSON.stringify(partner.sites)).not.toContain("notices");
  });
});

describe("현장 ‘준공’ ↔ 하자보증 준공일", () => {
  const base = (db: DemoDB, siteId: string, extra: Record<string, unknown> = {}) => {
    const s = db.sites.find((x) => x.id === siteId)!;
    const c = db.contracts.find((x) => x.siteId === siteId)!;
    const budgets = Object.fromEntries(db.budgets.filter((b) => b.siteId === siteId).map((b) => [b.category, b.amount]));
    return { id: s.id, name: s.name, shortName: s.shortName, workType: s.workType, region: s.region, clientName: s.clientName, status: s.status, startDate: s.startDate, endDate: s.endDate, contractAmount: c.contractAmount, budgets, ...extra } as Parameters<typeof saveSite>[1];
  };
  it("보증 기간이 있고 준공일이 비어 있으면, 준공으로 바꾸며 준공일을 같이 넣는다", () => {
    // A현장: 24개월 · 준공일 없음 (시연 데이터)
    const db0 = createSeed(NOW);
    const out = saveSite(db0, base(db0, "site-a", { status: "completed", warrantyCompletedDate: "2026-11-07" }), ctx()).db;
    const a = out.sites.find((s) => s.id === "site-a")!;
    expect(a.status).toBe("completed");
    expect(a.warranty).toMatchObject({ months: 24, completedDate: "2026-11-07", setBy: "u-manager" });
    expect(out.activityLogs[0].summary).toContain("하자보증 준공 2026.11.07부터");
  });
  it("준공이 아닐 때·보증 기간이 없을 때·이미 준공일이 있을 때·미래·착공 전 날짜는 거부", () => {
    const db0 = createSeed(NOW);
    const err = (db: DemoDB, siteId: string, extra: Record<string, unknown>) => {
      try {
        saveSite(db, base(db, siteId, extra), ctx());
        return "";
      } catch (e) {
        return (e as { fieldErrors?: Record<string, string> }).fieldErrors?.warrantyCompletedDate ?? String(e);
      }
    };
    expect(err(db0, "site-a", { status: "active", warrantyCompletedDate: "2026-11-07" })).toMatch(/‘준공’일 때만/);
    expect(err(db0, "site-c", { status: "completed", warrantyCompletedDate: "2026-11-07" })).toMatch(/하자보증 기간을 먼저/);
    expect(err(withWarranty(), "site-b", { status: "completed", warrantyCompletedDate: "2026-11-07" })).toMatch(/이미 준공일이 있습니다/);
    // 이미 준공 상태인 현장을 고칠 때는 받지 않는다 (고칠 때마다 오늘 날짜가 들어가던 문제 · 점검 반영)
    const done = saveSite(db0, base(db0, "site-a", { status: "completed" }), ctx()).db;
    expect(err(done, "site-a", { status: "completed", warrantyCompletedDate: "2026-11-07" })).toMatch(/이미 준공 상태인 현장/);
    expect(err(db0, "site-a", { status: "completed", warrantyCompletedDate: "2026-11-09" })).toMatch(/오늘이나 그 전/);
    expect(err(db0, "site-a", { status: "completed", warrantyCompletedDate: "2026-02-30" })).toMatch(/없는 날짜/);
    expect(err(db0, "site-a", { status: "completed", warrantyCompletedDate: "2026-01-02" })).toMatch(/착공일보다 빠릅니다/);
    // 비워 두면 상태만 바뀐다
    expect(saveSite(db0, base(db0, "site-a", { status: "completed" }), ctx()).db.sites.find((s) => s.id === "site-a")!.warranty!.completedDate).toBeUndefined();
  });
});
