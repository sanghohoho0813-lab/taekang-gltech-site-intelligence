/**
 * CSV 파일 읽기 — 한글 엑셀의 ‘CSV(쉼표로 분리)’는 EUC-KR(CP949)로 저장되므로,
 * UTF-8로 먼저 읽어 보고 깨지면 EUC-KR로 다시 읽는다.
 */
export const MAX_CSV_BYTES = 1_000_000;

export async function readCsvFile(file: File): Promise<string> {
  if (file.size > MAX_CSV_BYTES) throw new Error("파일이 너무 큽니다 (1MB 이하). 나눠서 올려주세요.");
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder("euc-kr").decode(buf);
    } catch {
      return new TextDecoder().decode(buf);
    }
  }
}
