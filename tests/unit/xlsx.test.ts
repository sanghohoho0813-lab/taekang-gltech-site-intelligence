/**
 * 엑셀(.xlsx) 읽기·쓰기 (D-45) — 실제 엑셀과 같은 구조의 파일(LibreOffice 저장)·openpyxl 파일·예전 형식,
 * 양식 왕복, 압축 폭탄·손상 파일, 날짜 서식 규칙, 가져오기 연결(머리글 찾기·행 번호·예시 줄·탭 붙여넣기)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XlsxError, colIndex, crc32, dateKind, readXlsx, rowsToCsv, serialToDate, sniffSpreadsheet, writeXlsx } from "@/lib/domain/xlsx";
import { IMPORT_SPECS, importTemplateXlsx, normDate, pickImportSheet, planImport, type BillingRow } from "@/lib/domain/importers";
import { tsvToCsv } from "@/lib/domain/csv";
import { createSeed } from "@/lib/data/seed";
import type { ImportKind } from "@/lib/domain/types";

const NOW = new Date("2026-11-04T03:00:00Z");
const TODAY = "2026-11-04";
const fixture = (n: string) => new Uint8Array(readFileSync(`tests/e2e/fixtures/${n}`));

describe("엑셀 읽기", () => {
  it("실제 엑셀 구조(LibreOffice 저장): 시트 2개, 위쪽 제목·빈 줄, 날짜 서식, #,##0, 수식 계산값, 서식 조각 글자, 셀 안 쉼표", async () => {
    const sheets = await readXlsx(fixture("billing_excel.xlsx"));
    expect(sheets.map((s) => s.name)).toEqual(["안내", "기성입금"]);
    const r = sheets[1].rows;
    expect(r[0]).toEqual(["B현장 기성·입금 (2026, 가상)"]);
    expect(r[1]).toEqual([]);
    expect(r[2]).toEqual(["현장", "구분", "날짜", "금액", "메모"]);
    expect(r[3]).toEqual(["B현장", "기성", "2026-03-31", "120000000", "3월 기성, 1차"]);
    expect(r[4]).toEqual(["B현장", "입금", "2026-04-30", "120000000", "입금 확인 (통장)"]); // 수식 =D4 → 계산값, 굵게+보통 글자 이어 붙임
    expect(r[6]).toEqual(["B현장", "기성", "2026. 5. 31.", "1,000,000원", "글자로 적은 날짜·금액"]);
    expect(r).toHaveLength(7);
  });

  it("openpyxl 파일: 인라인 문자열, 한국식 날짜 서식(yyyy\"년\" m\"월\" d\"일\")", async () => {
    const [s] = await readXlsx(fixture("crew_openpyxl.xlsx"));
    expect(s.name).toBe("출력");
    expect(s.rows[1]).toEqual(["A현장", "2026-10-20", "유리 설치팀 (예시)", "외주", "4"]);
    expect(s.rows[2]).toEqual(["B현장", "2026-10-01", "실링팀 (엑셀)", "직영", "3"]);
  });

  it("예전 형식(.xls)·엑셀이 아닌 파일·손상 파일은 이유를 알려주고 거부", async () => {
    const legacy = fixture("legacy.xls");
    expect(sniffSpreadsheet(legacy)).toBe("legacy");
    await expect(readXlsx(legacy)).rejects.toThrow(/\.xls.*Excel 통합 문서\(\.xlsx\)/);
    await expect(readXlsx(new TextEncoder().encode("현장,금액\nA,1"))).rejects.toThrow(XlsxError);
    const good = fixture("billing_excel.xlsx");
    await expect(readXlsx(good.slice(0, 2000))).rejects.toThrow(XlsxError); // 잘린 파일
    // 워드 파일처럼 zip이지만 엑셀이 아님
    const notExcel = writeXlsx([{ name: "x", rows: [["a"]] }]);
    const renamed = new Uint8Array(notExcel);
    const at = new TextDecoder("latin1").decode(renamed).indexOf("xl/workbook.xml");
    renamed.set(new TextEncoder().encode("xl/workbooo.xml"), at); // 첫 번째(로컬) 이름만 바꿔도 중앙 목록은 그대로 → 다른 이름도 바꿈
    const at2 = new TextDecoder("latin1").decode(renamed).lastIndexOf("xl/workbook.xml");
    renamed.set(new TextEncoder().encode("xl/workbooo.xml"), at2);
    await expect(readXlsx(renamed)).rejects.toThrow(/엑셀 통합 문서가 아닙니다/);
  });

  it("압축 폭탄: 풀면 40MB를 넘는 파일은 중간에 멈추고 거부 (적힌 크기를 속여도)", async () => {
    const zeros = new Uint8Array(45_000_000);
    const cs = new CompressionStream("deflate-raw");
    const w = cs.writable.getWriter();
    void w.write(zeros);
    void w.close();
    const comp = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    expect(comp.length).toBeLessThan(200_000);
    const bomb = zipWithDeflated("xl/workbook.xml", comp, 100); // 크기를 100바이트라고 속임
    await expect(readXlsx(bomb)).rejects.toThrow(/너무 큽니다/);
  });

  it("5MB 넘는 파일은 열지 않는다", async () => {
    await expect(readXlsx(new Uint8Array(5_000_001))).rejects.toThrow(/5MB/);
  });
});

describe("엑셀 날짜·열 규칙", () => {
  it("서식으로 날짜·시간 구분 (따옴표 글자·\\- 이스케이프·[색상] 무시)", () => {
    expect(dateKind("yyyy\\-mm\\-dd")).toBe("date");
    expect(dateKind('yyyy"년" m"월" d"일"')).toBe("date");
    expect(dateKind("[$-412]yyyy-mm-dd")).toBe("date");
    expect(dateKind("mmm-yy")).toBe("date");
    expect(dateKind("h:mm")).toBe("time");
    expect(dateKind("[h]:mm:ss")).toBe("time");
    expect(dateKind("yyyy-mm-dd hh:mm")).toBe("datetime");
    for (const n of ["General", "#,##0", '#,##0"원"', "0.00%", "@", "0.00E+00", "[Red]#,##0"]) expect(dateKind(n), n).toBeNull();
  });
  it("일련번호 → 날짜 (1900·1904 방식)", () => {
    expect(serialToDate(46295)).toBe("2026-09-30");
    expect(serialToDate(46295.5, "datetime")).toBe("2026-09-30 12:00");
    expect(serialToDate(0.75, "time")).toBe("18:00");
    expect(serialToDate(44834, "date", true)).toBe("2026-10-01");
  });
  it("열 글자", () => {
    expect([colIndex("A1"), colIndex("Z9"), colIndex("AA10"), colIndex("AZ3")]).toEqual([0, 25, 26, 51]);
  });
  it("CRC32 (zip 검증값)", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
  });
});

describe("엑셀 양식", () => {
  for (const kind of Object.keys(IMPORT_SPECS) as ImportKind[]) {
    it(`${IMPORT_SPECS[kind].title}: 양식을 그대로 다시 읽으면 열 이름·예시가 같고, 그대로 올리면 예시 줄은 넣지 않는다`, async () => {
      const sheets = await readXlsx(importTemplateXlsx(kind));
      expect(sheets.map((s) => s.name)).toEqual(["입력", "작성 안내"]);
      expect(sheets[0].rows).toEqual(IMPORT_SPECS[kind].sample.map((r) => trimEnd(r)));
      expect(sheets[1].rows[0]).toEqual(["열 이름", "꼭 적기", "설명", "예"]);
      expect(pickImportSheet(sheets, kind)).toBe(0);
      const plan = planImport(createSeed(NOW), kind, rowsToCsv(sheets[0].rows), TODAY);
      expect(plan.skippedExamples).toEqual(IMPORT_SPECS[kind].sample.slice(1).map((_, i) => i + 2));
      expect(plan.rows).toHaveLength(0);
      expect(plan.errors[0].message).toContain("예시 줄만 있습니다");
    });
  }
});

describe("가져오기 연결", () => {
  it("엑셀 기성·입금: 자료 시트를 골라, 위쪽 제목을 건너뛰고, 엑셀 행 번호 그대로 확인", async () => {
    const sheets = await readXlsx(fixture("billing_excel.xlsx"));
    const i = pickImportSheet(sheets, "billing");
    expect(i).toBe(1);
    const plan = planImport(createSeed(NOW), "billing", rowsToCsv(sheets[i].rows), TODAY);
    expect(plan.errors).toEqual([]);
    expect(plan.headerLine).toBe(3);
    expect((plan.rows as BillingRow[]).map((r) => [r.line, r.kind, r.date, r.amount])).toEqual([
      [4, "billing", "2026-03-31", 120000000],
      [5, "payment", "2026-04-30", 120000000],
      [7, "billing", "2026-05-31", 1000000],
    ]);
  });

  it("엑셀 작업 인원: 양식 예시 줄(2행)은 건너뛰고 나머지만", async () => {
    const [s] = await readXlsx(fixture("crew_openpyxl.xlsx"));
    const plan = planImport(createSeed(NOW), "crew", rowsToCsv(s.rows), TODAY);
    expect(plan.errors).toEqual([]);
    expect(plan.skippedExamples).toEqual([2]);
    expect(plan.rows.map((r) => r.line)).toEqual([3, 4]);
  });

  it("오류 위치는 파일의 실제 행 번호 (위쪽 제목·중간 빈 줄 포함)", () => {
    const text = "기성 자료\n\n현장,구분,날짜,금액\nB현장,기성,2026-03-31,1000\n\nB현장,선금,2026-04-30,1000";
    const plan = planImport(createSeed(NOW), "billing", text, TODAY);
    expect(plan.headerLine).toBe(3);
    expect(plan.errors.map((e) => e.line)).toEqual([6]);
  });

  it("엑셀에서 복사한 표(탭 구분): 셀 안 쉼표(10,000,000)가 열을 나누지 않는다", () => {
    const pasted = "현장\t구분\t날짜\t금액\nB현장\t기성\t2026-03-31\t10,000,000\nB현장\t입금\t2026. 4. 30.\t\"5,000,000\"";
    const plan = planImport(createSeed(NOW), "billing", tsvToCsv(pasted), TODAY);
    expect(plan.errors).toEqual([]);
    expect((plan.rows as BillingRow[]).map((r) => [r.date, r.amount])).toEqual([
      ["2026-03-31", 10000000],
      ["2026-04-30", 5000000],
    ]);
    expect(tsvToCsv("쉼표,없음")).toBe("쉼표,없음");
  });

  it("한국식 글자 날짜", () => {
    expect(normDate("2026. 5. 31.")).toBe("2026-05-31");
    expect(normDate("2026.05.31")).toBe("2026-05-31");
    expect(normDate("2026/5/1")).toBe("2026-05-01");
  });
});

const trimEnd = (r: string[]) => {
  const c = [...r];
  while (c.length && c[c.length - 1] === "") c.pop();
  return c;
};

/** 테스트용: deflate 항목 하나짜리 zip (적힌 크기를 마음대로) */
function zipWithDeflated(name: string, comp: Uint8Array, claimedSize: number): Uint8Array {
  const n = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + n.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(18, comp.length, true);
  lv.setUint32(22, claimedSize, true);
  lv.setUint16(26, n.length, true);
  local.set(n, 30);
  const cd = new Uint8Array(46 + n.length);
  const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(20, comp.length, true);
  cv.setUint32(24, claimedSize, true);
  cv.setUint16(28, n.length, true);
  cv.setUint32(42, 0, true);
  cd.set(n, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, local.length + comp.length, true);
  const out = new Uint8Array(local.length + comp.length + cd.length + end.length);
  out.set(local, 0);
  out.set(comp, local.length);
  out.set(cd, local.length + comp.length);
  out.set(end, local.length + comp.length + cd.length);
  return out;
}
