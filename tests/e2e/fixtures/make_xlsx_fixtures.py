"""
엑셀 가져오기 테스트용 파일 만들기 (개발용 — 결과 파일은 저장소에 함께 둔다 · D-45)
  python3 tests/e2e/fixtures/make_xlsx_fixtures.py   (openpyxl, LibreOffice 필요)
- billing_excel.xlsx : LibreOffice로 다시 저장 (실제 엑셀처럼 공유 문자열·서식 조각·수식 계산값)
                       안내 시트 + 자료 시트, 위쪽 제목·빈 줄, 날짜 서식, #,##0, 수식, 셀 안 쉼표, 글자 날짜
- crew_openpyxl.xlsx : openpyxl 그대로 (인라인 문자열), 한국식 날짜 서식, 양식 예시 줄 포함
- legacy.xls         : 예전 엑셀 형식 (거부 확인용)
"""
import datetime, os, shutil, subprocess, tempfile, zipfile
import openpyxl
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont

HERE = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp()

# 1) 기성·입금 (LibreOffice 저장)
wb = openpyxl.Workbook()
info = wb.active
info.title = "안내"
info["A1"] = "태강지엘텍 기성·입금 이관 자료"
info["A2"] = "작성: 공무팀 (가상)"
ws = wb.create_sheet("기성입금")
ws["A1"] = "B현장 기성·입금 (2026, 가상)"
ws.append([])
ws.append(["현장", "구분", "날짜", "금액", "메모"])
ws.append(["B현장", "기성", datetime.date(2026, 3, 31), 120000000, "3월 기성, 1차"])
ws.append(["B현장", "입금", datetime.date(2026, 4, 30), "=D4", ""])
ws["E5"] = CellRichText([TextBlock(InlineFont(b=True), "입금"), " 확인 (통장)"])
ws.append([])
ws.append(["B현장", "기성", "2026. 5. 31.", "1,000,000원", "글자로 적은 날짜·금액"])
for r in (4, 5):
    ws[f"C{r}"].number_format = "yyyy-mm-dd"
    ws[f"D{r}"].number_format = "#,##0"
# LibreOffice는 열려 있는(활성) 시트의 수식만 다시 계산해 값을 저장한다 → 자료 시트를 활성으로 (실제 엑셀은 항상 계산값을 저장)
wb.active = 1
src = os.path.join(tmp, "billing_src.xlsx")
wb.save(src)
# 결과는 다른 폴더로 (입력과 같은 경로면 LibreOffice가 변환하지 않는다)
out = os.path.join(tmp, "lo")
os.makedirs(out)
subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", out, src], check=True, capture_output=True)
subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xls:MS Excel 97", "--outdir", out, src], check=True, capture_output=True)
lo_xlsx = os.path.join(out, "billing_src.xlsx")
with zipfile.ZipFile(lo_xlsx) as z:
    assert "xl/sharedStrings.xml" in z.namelist(), "LibreOffice 변환 결과가 아닙니다"
shutil.copy(lo_xlsx, os.path.join(HERE, "billing_excel.xlsx"))
shutil.copy(os.path.join(out, "billing_src.xls"), os.path.join(HERE, "legacy.xls"))

# 2) 작업 인원 (openpyxl 그대로, 한국식 날짜 서식, 예시 줄 포함)
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "출력"
ws.append(["현장", "날짜", "팀", "구분", "인원"])
ws.append(["A현장", datetime.date(2026, 10, 20), "유리 설치팀 (예시)", "외주", 4])  # 양식 예시 줄 그대로
ws.append(["B현장", datetime.date(2026, 10, 1), "실링팀 (엑셀)", "직영", 3])
ws.append(["B현장", datetime.date(2026, 10, 2), "실링팀 (엑셀)", "직영", 2])
for r in (2, 3, 4):
    ws[f"B{r}"].number_format = 'yyyy"년" m"월" d"일"'
wb.save(os.path.join(HERE, "crew_openpyxl.xlsx"))
print("ok")
