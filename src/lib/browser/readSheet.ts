/**
 * 자료 가져오기 파일 읽기 — 엑셀(.xlsx)은 그대로, CSV는 UTF-8/EUC-KR (D-45)
 * 엑셀은 이 자료 종류의 열 이름이 있는 시트를 골라 CSV 글자로 바꾼다 (이후 검증은 CSV와 같음 · 서버도 같은 검증)
 */
import { MAX_XLSX_BYTES, XlsxError, readXlsx, rowsToCsv, sniffSpreadsheet } from "@/lib/domain/xlsx";
import { pickImportSheet, type ImportKind } from "@/lib/domain/importers";
import { readCsvFile } from "./readCsv";

export async function readImportFile(file: File, kind: ImportKind): Promise<{ text: string; note?: string }> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const type = sniffSpreadsheet(head);
  if (type === "legacy") throw new XlsxError("예전 엑셀 형식(.xls)이거나 암호가 걸린 파일입니다. 엑셀에서 암호를 풀고 ‘다른 이름으로 저장 → Excel 통합 문서(.xlsx)’로 저장해 주세요.");
  if (type === "xlsx" || /\.xlsx$/i.test(file.name)) {
    if (file.size > MAX_XLSX_BYTES) throw new XlsxError("파일이 너무 큽니다 (5MB 이하). 나눠서 올려주세요.");
    const sheets = await readXlsx(await file.arrayBuffer());
    const i = pickImportSheet(sheets, kind);
    const visible = sheets.filter((s) => !s.hidden).length;
    return { text: rowsToCsv(sheets[i].rows), note: visible > 1 ? `‘${sheets[i].name}’ 시트를 읽었습니다 (시트 ${visible}개 중 열 이름이 맞는 시트)` : undefined };
  }
  return { text: await readCsvFile(file) };
}
