/**
 * CSV 내려받기 (D-64) — 쉼표·줄바꿈이 있어도 칸이 밀리지 않고, 엑셀이 수식으로 실행하지 않는다.
 * 새 CSV 내려받기를 만들면서 toCsv를 쓰지 않으면 아래 소스 검사에서 실패한다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvCell, parseCsvRecords, toCsv } from "@/lib/domain/csv";

describe("CSV 한 칸", () => {
  it("쉼표·따옴표·줄바꿈 → 따옴표로 감싸서 다시 읽으면 그대로", () => {
    const rows = [["이름", "정정 사유"], ["최성민", "배터리 꺼짐, 17:30 퇴근"], ["정우진", '현장 "B동"\n2층']];
    const back = parseCsvRecords(toCsv(rows)).map((r) => r.cells);
    expect(back).toEqual(rows);
  });

  it("=·+·-·@·탭으로 시작하는 글자는 앞에 ' (엑셀 수식 실행 방지) · 숫자는 음수도 그대로", () => {
    expect(csvCell("=HYPERLINK(\"http://x\",\"클릭\")")).toBe(`"'=HYPERLINK(""http://x"",""클릭"")"`);
    expect(csvCell("+82 10")).toBe("'+82 10");
    expect(csvCell("-3 EA")).toBe("'-3 EA");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\t=1")).toBe("'\t=1");
    expect(csvCell(-1500000)).toBe("-1500000");
    expect(csvCell("2026-11-04")).toBe("2026-11-04");
    expect(csvCell("—")).toBe("—");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });
});

describe("모든 CSV 내려받기는 toCsv를 쓴다 (소스 검사)", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));
  it("downloadCsv(…)에 넘기는 내용이 toCsv(…) 또는 가져오기 양식(importTemplate)이다", () => {
    const bad: string[] = [];
    for (const f of files(join(process.cwd(), "src"))) {
      if (f.endsWith("lib/browser/download.ts")) continue;
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/downloadCsv\(/g)) {
        // 여러 줄에 걸친 호출도 있으므로 문장 끝(;)까지
        const call = src.slice(m.index! + m[0].length, m.index! + 600).split(";")[0].trim();
        // 내용 인자가 변수면(마지막 인자) 그 변수가 같은 파일에서 toCsv로 만들어졌는지 확인
        const v = /,\s*(\w+)\s*\)\s*$/.exec(call)?.[1];
        const ok = /toCsv\(|importTemplate\(/.test(call) || (v && new RegExp(`const ${v} = toCsv\\(`).test(src));
        if (!ok) bad.push(`${f.replace(process.cwd() + "/", "")}: downloadCsv(${call.slice(0, 70)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
