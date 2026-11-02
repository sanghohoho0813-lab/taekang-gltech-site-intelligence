/** CSV 내려받기 (엑셀 한글 깨짐 방지 BOM). 링크를 문서에 붙였다가 떼고, URL은 잠시 뒤 해제해야 파일 이름이 유지된다. */
export function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
