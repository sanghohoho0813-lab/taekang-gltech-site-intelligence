/**
 * 실제 자료 이관 (계약 3단계 ‘실제 자료 연결’) — 엑셀에서 저장한 CSV를 검증·미리보기·반영하는 순수 함수.
 * 브라우저(미리보기)와 서버(반영 직전 재검증)가 같은 함수를 쓴다. 서버는 브라우저가 보낸 행을 믿지 않고 원문을 다시 검사한다.
 *
 * 종류: 기성·입금 / 변경공사 / 작업 인원(출력) 이력 / 팀 단가 / 원가 / 자재 반입·설치 이력(D-63 · 수량만) / 공정 진행 이력(D-71 · 금액 없음)
 * - 열 이름은 한글·영문 모두 받는다 (예: 현장 = site = site_code)
 * - 현장은 현장코드·약칭·현장명 중 하나로 찾는다
 * - DB에 이미 같은 기록이 있으면 ‘중복’으로 건너뛴다 (같은 파일을 두 번 올려도 두 번 들어가지 않게)
 */
import type { ChangeOrderStatus, CostCategory, CostReason, CrewCheck, DemoDB, ForecastImpact, ImportKind, MaterialMoveKind, Site } from "./types";
import { COST_CATEGORIES } from "./labels";
import { parseCsvRecords } from "./csv";
import { writeXlsx } from "./xlsx";

export type { ImportKind };

export interface ImportIssue {
  line: number;
  field: string;
  message: string;
}

export interface BillingRow { line: number; siteId: string; kind: "billing" | "payment"; date: string; amount: number; note: string }
export interface ChangeRow { line: number; siteId: string; title: string; amount: number; status: ChangeOrderStatus; requestedDate: string; approvedAmount?: number; decidedDate?: string; note: string }
export interface CrewRow { line: number; siteId: string; date: string; team: string; kind: CrewCheck["kind"]; headcount: number }
export interface RateRow { line: number; team: string; dayRate: number; before?: number }
export interface MaterialRow { line: number; siteId: string; date: string; kind: MaterialMoveKind; itemId: string; itemName: string; unit: string; qty: number; note: string }
/** 공정 진행 이력 한 줄 — 그날까지의 누계 진행률. stageId가 없으면 현장 전체 공정률. from은 바로 앞 기록 값 (D-71) */
export interface ProgressRow { line: number; siteId: string; date: string; stageId: string | null; stageName: string; pct: number; from: number; note: string }
export interface CostRow { line: number; siteId: string; date: string; category: CostCategory; amount: number; impact: Exclude<ForecastImpact, "baseline">; reason: CostReason; note: string }

export type ImportRow = BillingRow | ChangeRow | CrewRow | RateRow | CostRow | MaterialRow | ProgressRow;

export interface ImportPlan {
  kind: ImportKind;
  rows: ImportRow[];
  errors: ImportIssue[];
  /** DB에 이미 같은 기록이 있어 건너뛸 행 */
  duplicates: { line: number; text: string }[];
  /** 현장별 요약 (미리보기용) */
  summary: { siteId?: string; label: string; count: number; amount?: number; amount2?: number }[];
  /** 양식의 예시 줄을 지우지 않고 올려 건너뛴 행 번호 (D-45) */
  skippedExamples?: number[];
  /** 머리글(열 이름) 행 번호 — 위쪽 제목·빈 줄이 있으면 1이 아님 */
  headerLine?: number;
}

/** 머리글을 찾는 범위 (엑셀 위쪽 제목·날짜·빈 줄 허용) */
const HEADER_SCAN_ROWS = 10;

export const MAX_IMPORT_ROWS = 500;
const MAX_AMOUNT = 5_000_000_000; // 1건 50억 원 (현장 보고·기성 입력과 같은 상한)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ColumnSpec {
  key: string;
  label: string;
  aliases: string[];
  required: boolean;
  desc: string;
  example: string;
}

const SITE_COL: ColumnSpec = { key: "site", label: "현장", aliases: ["현장", "현장코드", "현장명", "site", "site_code"], required: true, desc: "현장코드·약칭·현장명 중 하나 (예: A현장)", example: "A현장" };

export const IMPORT_SPECS: Record<ImportKind, { title: string; desc: string; columns: ColumnSpec[]; sample: string[][] }> = {
  billing: {
    title: "기성·입금 이력",
    desc: "진행 중 현장의 지난 기성청구(확정)와 입금. 차수는 날짜 순서로 자동으로 매깁니다.",
    columns: [
      SITE_COL,
      { key: "kind", label: "구분", aliases: ["구분", "종류", "kind", "type"], required: true, desc: "기성 또는 입금", example: "기성" },
      { key: "date", label: "날짜", aliases: ["날짜", "일자", "청구일", "입금일", "date"], required: true, desc: "YYYY-MM-DD (청구일·입금일)", example: "2026-08-31" },
      { key: "amount", label: "금액", aliases: ["금액", "금액(원)", "amount"], required: true, desc: "원 단위, 공급가액(부가세 별도), 쉼표 허용", example: "150000000" },
      { key: "note", label: "메모", aliases: ["메모", "비고", "note"], required: false, desc: "200자 이내", example: "1차 기성" },
    ],
    sample: [
      ["현장", "구분", "날짜", "금액", "메모"],
      ["A현장", "기성", "2026-08-31", "150000000", "1차 기성 (예시)"],
      ["A현장", "입금", "2026-09-30", "150000000", "1차 입금 (예시)"],
    ],
  },
  change: {
    title: "변경공사",
    desc: "설계변경·추가공사 이력. ‘승인’만 계약금액에 더해지고, 나머지는 검토·청구 중으로 표시됩니다.",
    columns: [
      SITE_COL,
      { key: "title", label: "제목", aliases: ["제목", "공사명", "내용", "title"], required: true, desc: "80자 이내", example: "3층 유리 사양 변경" },
      { key: "amount", label: "금액", aliases: ["금액", "청구금액", "요청금액", "amount"], required: true, desc: "청구(요청) 금액, 원 단위", example: "25000000" },
      { key: "status", label: "상태", aliases: ["상태", "status"], required: true, desc: "검토 · 청구 · 승인 · 반려", example: "승인" },
      { key: "requested", label: "요청일", aliases: ["요청일", "청구일", "날짜", "requested_date", "date"], required: true, desc: "YYYY-MM-DD", example: "2026-07-15" },
      { key: "approved", label: "승인금액", aliases: ["승인금액", "approved_amount"], required: false, desc: "승인일 때만. 비우면 청구 금액과 같게", example: "23000000" },
      { key: "decided", label: "결정일", aliases: ["결정일", "승인일", "decided_date"], required: false, desc: "승인·반려일 (비우면 요청일)", example: "2026-08-01" },
      { key: "note", label: "메모", aliases: ["메모", "비고", "note"], required: false, desc: "200자 이내", example: "" },
    ],
    sample: [
      ["현장", "제목", "금액", "상태", "요청일", "승인금액", "결정일", "메모"],
      ["A현장", "3층 남측 유리 사양 변경 (예시)", "25000000", "승인", "2026-07-15", "23000000", "2026-08-01", ""],
      ["A현장", "로비 고정창 추가 (예시)", "8000000", "청구", "2026-10-10", "", "", "발주처 검토 중"],
    ],
  },
  crew: {
    title: "작업 인원(출력) 이력",
    desc: "출력일보의 날짜·팀·인원. 인건비 추정(투입·인건비 화면)의 근거가 됩니다. 사진·위치 확인 표시는 붙지 않습니다.",
    columns: [
      SITE_COL,
      { key: "date", label: "날짜", aliases: ["날짜", "일자", "작업일", "date"], required: true, desc: "YYYY-MM-DD (오늘 이전)", example: "2026-10-20" },
      { key: "team", label: "팀", aliases: ["팀", "팀명", "업체", "team"], required: true, desc: "팀·업체 이름 30자 이내", example: "유리 설치팀" },
      { key: "kind", label: "구분", aliases: ["구분", "직영외주", "kind"], required: false, desc: "직영 또는 외주 (비우면 외주)", example: "외주" },
      { key: "headcount", label: "인원", aliases: ["인원", "인원수", "명", "headcount"], required: true, desc: "1~300명", example: "4" },
    ],
    sample: [
      ["현장", "날짜", "팀", "구분", "인원"],
      ["A현장", "2026-10-20", "유리 설치팀 (예시)", "외주", "4"],
      ["A현장", "2026-10-20", "실링팀 (예시)", "직영", "2"],
    ],
  },
  rates: {
    title: "팀 단가",
    desc: "팀별 1인 1일 기준 단가. 투입·인건비 추정에 쓰입니다. 같은 팀이 있으면 새 단가로 바뀝니다.",
    columns: [
      { key: "team", label: "팀", aliases: ["팀", "팀명", "업체", "team"], required: true, desc: "팀·업체 이름 30자 이내", example: "유리 설치팀" },
      { key: "rate", label: "단가", aliases: ["단가", "1일 단가", "일당", "단가(원)", "day_rate"], required: true, desc: "원 단위 1만~200만 (예: 300000)", example: "300000" },
    ],
    sample: [
      ["팀", "단가"],
      ["유리 설치팀 (예시)", "320000"],
      ["실링팀 (예시)", "280000"],
    ],
  },
  cost: {
    title: "원가",
    desc: "자재·노무·외주·장비·경비 집행 내역. 손익이 바로 다시 계산됩니다.",
    columns: [
      SITE_COL,
      { key: "date", label: "날짜", aliases: ["날짜", "발생일", "date"], required: true, desc: "YYYY-MM-DD", example: "2026-10-20" },
      { key: "category", label: "항목", aliases: ["항목", "원가항목", "category"], required: true, desc: "자재 · 노무 · 외주 · 장비 · 경비", example: "자재" },
      { key: "amount", label: "금액", aliases: ["금액", "amount"], required: true, desc: "원 단위, 공급가액", example: "12000000" },
      { key: "impact", label: "성격", aliases: ["성격", "forecast_impact"], required: false, desc: "계획 내(기본) 또는 추가 — 추가는 예상 총원가가 늘어남", example: "계획 내" },
      { key: "reason", label: "사유", aliases: ["사유", "reason"], required: false, desc: "계획 · 설계변경 · 단가인상 · 물량증가 · 재시공 · 공기 · 기타 (기본 계획)", example: "계획" },
      { key: "note", label: "메모", aliases: ["메모", "비고", "note"], required: false, desc: "200자 이내", example: "알루미늄 프레임 입고" },
    ],
    sample: [
      ["현장", "날짜", "항목", "금액", "성격", "사유", "메모"],
      ["A현장", "2026-10-20", "자재", "12000000", "계획 내", "계획", "알루미늄 프레임 2차 입고 (예시)"],
      ["A현장", "2026-10-21", "노무", "3500000", "계획 내", "계획", "유리 시공 인력 (예시)"],
    ],
  },
  material: {
    title: "자재 반입·설치 이력",
    desc: "자재 수불부의 날짜·반입/설치·품목·수량 (금액 없음). 품목은 먼저 현장 상세 ‘자재’ → ‘품목 정하기’에서 넣어 두세요.",
    columns: [
      SITE_COL,
      { key: "date", label: "날짜", aliases: ["날짜", "일자", "반입일", "설치일", "date"], required: true, desc: "YYYY-MM-DD (오늘 이전)", example: "2026-10-20" },
      { key: "kind", label: "구분", aliases: ["구분", "종류", "입출", "kind", "type"], required: true, desc: "반입 또는 설치 (입고·시공도 받음)", example: "반입" },
      { key: "item", label: "품목", aliases: ["품목", "자재", "자재명", "품명", "item"], required: true, desc: "현장에 정해 둔 품목 이름 그대로", example: "커튼월 유닛" },
      { key: "qty", label: "수량", aliases: ["수량", "qty", "quantity"], required: true, desc: "0보다 큰 수 (소수 둘째 자리까지, 쉼표 허용)", example: "24" },
      { key: "note", label: "메모", aliases: ["메모", "비고", "note"], required: false, desc: "200자 이내", example: "송장 대조" },
    ],
    sample: [
      ["현장", "날짜", "구분", "품목", "수량", "메모"],
      ["A현장", "2026-10-20", "반입", "커튼월 유닛 (예시)", "24", "송장 대조 (예시)"],
      ["A현장", "2026-10-21", "설치", "커튼월 유닛 (예시)", "12", ""],
    ],
  },
  progress: {
    title: "공정 진행 이력",
    desc: "지난 날짜별 공정 단계 진행률(누계 %). 공사일보·발주처 월간 보고서의 ‘공정 변화’로 이어집니다. 지금 공정률은 바꾸지 않습니다 (금액 없음).",
    columns: [
      SITE_COL,
      { key: "date", label: "날짜", aliases: ["날짜", "일자", "기준일", "작업일", "date"], required: true, desc: "YYYY-MM-DD (착공일부터 어제까지)", example: "2026-09-30" },
      { key: "stage", label: "공정 단계", aliases: ["공정 단계", "공정단계", "단계", "공정", "공종", "stage"], required: true, desc: "현장에 정해 둔 공정 단계 이름 그대로 · 현장 전체 공정률은 ‘전체’", example: "커튼월 유닛 설치" },
      { key: "pct", label: "진행률", aliases: ["진행률", "진행률(%)", "누계", "누계(%)", "누계진행률", "공정률", "공정률(%)", "pct", "progress"], required: true, desc: "그날까지의 누계 0~100 (정수 %, 35% · 0.35도 받음)", example: "35" },
      { key: "note", label: "메모", aliases: ["메모", "비고", "작업내용", "작업 내용", "note"], required: false, desc: "200자 이내 · 공사일보 ‘작업 내용’으로 들어감", example: "3층 서측 유닛 설치" },
    ],
    sample: [
      ["현장", "날짜", "공정 단계", "진행률", "메모"],
      ["A현장", "2026-09-15", "커튼월 유닛 설치 (예시)", "20", "2층 유닛 설치 (예시)"],
      ["A현장", "2026-09-30", "커튼월 유닛 설치 (예시)", "35", ""],
    ],
  },
};
/** 현장 전체 공정률을 뜻하는 단계 이름 */
const OVERALL_STAGE = new Set(["전체", "전체공정률", "현장전체", "전체공정", "공정률", "total", "overall"]);
const MATERIAL_KIND_IN: Record<string, MaterialMoveKind> = { 반입: "in", 입고: "in", 들어옴: "in", in: "in", 설치: "install", 시공: "install", 사용: "install", install: "install" };

const norm = (s: string) => s.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, "");

/** 원 단위 금액: 쉼표·공백·‘원’ 허용 */
export function parseWonCell(v: string): number {
  const t = v.replace(/[\s원₩]/g, "");
  // 쉼표는 천 단위 자리에만 (12,00 → 1200으로 잘못 읽던 문제 · D-66)
  if (t.includes(",") && !/^\d{1,3}(,\d{3})+$/.test(t)) return NaN;
  const raw = t.replace(/,/g, "");
  return /^\d+$/.test(raw) ? Number(raw) : NaN;
}

/**
 * 진행률(%): 35 · 35% · 엑셀 백분율 서식(0.35 → 35). 정수 %만 — 그 외는 NaN (D-71)
 * 0과 1 사이 소수는 백분율 서식으로 보고 100을 곱한다 (1은 1%)
 */
export function parsePctCell(v: string): number {
  const t = v.replace(/\s/g, "");
  const pctMark = t.endsWith("%");
  const raw = pctMark ? t.slice(0, -1) : t;
  if (!/^\d+(\.\d+)?$/.test(raw)) return NaN;
  let n = Number(raw);
  if (!pctMark && raw.includes(".") && n > 0 && n < 1) n = Math.round(n * 10_000) / 100;
  return Number.isInteger(n) ? n : NaN;
}

/** 수량: 천 단위 쉼표와 소수점(.)만 — ‘1,5’(유럽식 소수)를 15로 읽지 않게 (D-66) */
export function parseQtyCell(v: string): number {
  const t = v.replace(/\s/g, "");
  if (t.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) return NaN;
  const raw = t.replace(/,/g, "");
  return /^\d+(\.\d{1,2})?$/.test(raw) ? Number(raw) : NaN;
}

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 엑셀에서 2026.10.20 / 2026/10/20 / 2026-10-20 / 2026. 10. 20. 으로 저장된 날짜를 받아준다 */
export function normDate(v: string): string {
  // 은행 내역처럼 시각이 붙은 날짜(2026-10-20 14:30)는 날짜만 쓴다 (D-66)
  const m = v.trim().match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?(?:\s+(?:오전|오후)?\s*\d{1,2}:\d{2}(?::\d{2})?)?$/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : v.trim();
}

export function findSite(db: DemoDB, ref: string): Site | undefined {
  const r = norm(ref);
  if (!r) return undefined;
  return db.sites.find((s) => norm(s.code) === r) ?? db.sites.find((s) => norm(s.shortName) === r) ?? db.sites.find((s) => norm(s.name) === r);
}

const CHANGE_STATUS: Record<string, ChangeOrderStatus> = { 검토: "review", 검토중: "review", review: "review", 청구: "submitted", 청구중: "submitted", 승인대기: "submitted", submitted: "submitted", 승인: "approved", approved: "approved", 반려: "rejected", rejected: "rejected" };
const CATEGORY_IN: Record<string, CostCategory> = { 자재: "material", 자재비: "material", material: "material", 노무: "labor", 노무비: "labor", 인건비: "labor", labor: "labor", 외주: "subcontract", 외주비: "subcontract", subcontract: "subcontract", 장비: "equipment", 장비비: "equipment", equipment: "equipment", 경비: "overhead", 현장경비: "overhead", overhead: "overhead" };
const REASON_IN: Record<string, CostReason> = { 계획: "planned", planned: "planned", 설계변경: "design_change", design_change: "design_change", 단가인상: "price_increase", price_increase: "price_increase", 물량증가: "quantity_increase", quantity_increase: "quantity_increase", 재시공: "rework", rework: "rework", 공기: "schedule", 공기지연: "schedule", schedule: "schedule", 기타: "other", other: "other" };

export const CSV_ENCODING_HINT = "엑셀 파일(.xlsx)은 CSV로 바꿀 필요 없이 그대로 올리면 됩니다. CSV는 ‘CSV UTF-8’·‘CSV(쉼표로 분리)’ 모두 읽습니다.";

/** CSV 원문 → 검증·중복 확인·요약. today는 서버 기준 날짜 (작업 인원 미래 날짜 거부) */
export function planImport(db: DemoDB, kind: ImportKind, text: string, today: string): ImportPlan {
  const spec = IMPORT_SPECS[kind];
  const plan: ImportPlan = { kind, rows: [], errors: [], duplicates: [], summary: [] };
  if (!spec) {
    plan.errors.push({ line: 1, field: "kind", message: "알 수 없는 자료 종류" });
    return plan;
  }
  if (typeof text !== "string" || text.length > 1_000_000) {
    plan.errors.push({ line: 1, field: "file", message: "파일이 너무 큽니다 (1MB 이하)." });
    return plan;
  }
  const table = parseCsvRecords(text);
  if (!table.length) {
    plan.errors.push({ line: 1, field: "file", message: "빈 파일입니다." });
    return plan;
  }
  // 열 이름 미리 정리 · 한 행에서 앞쪽 100칸까지만 본다 (아주 넓은 행으로 서버가 오래 붙잡히지 않게 · D-49)
  const aliasSets = spec.columns.map((c) => new Set(c.aliases.map(norm)));
  const colsOf = (cells: string[]) => {
    const header = cells.slice(0, 100).map(norm);
    const col: Record<string, number> = {};
    spec.columns.forEach((c, i) => (col[c.key] = header.findIndex((h) => aliasSets[i].has(h))));
    return col;
  };
  // 머리글: 처음 몇 행 안에서 필요한 열 이름이 모두 있는 첫 행 (엑셀 위쪽 제목·빈 줄 허용)
  const found = table.slice(0, HEADER_SCAN_ROWS).findIndex((r) => {
    const c = colsOf(r.cells);
    return spec.columns.every((s) => !s.required || c[s.key] >= 0);
  });
  const hi = Math.max(0, found);
  const col = colsOf(table[hi].cells);
  plan.headerLine = table[hi].line;
  const missing = spec.columns.filter((c) => c.required && col[c.key] < 0).map((c) => c.label);
  if (missing.length) {
    plan.errors.push({ line: table[hi].line, field: "header", message: `첫 줄에 필요한 열이 없습니다: ${missing.join(", ")} (양식을 내려받아 첫 줄을 그대로 쓰세요)` });
    return plan;
  }
  // 양식에 들어 있던 예시 줄은 지우지 않고 올려도 넣지 않는다 (예시 데이터가 실제 자료로 들어가는 사고 방지)
  const cmp = (v: string) => normDate(v).replace(/[,\s원₩]/g, "");
  const sampleHead = spec.sample[0].map(norm);
  const sampleKey = (get: (k: string) => string) => spec.columns.map((c) => cmp(get(c.key))).join("\u0001");
  const examples = new Set(
    spec.sample.slice(1).map((r) =>
      sampleKey((k) => {
        const i = sampleHead.findIndex((h) => spec.columns.find((c) => c.key === k)!.aliases.some((a) => norm(a) === h));
        return i >= 0 ? (r[i] ?? "") : "";
      }),
    ),
  );
  const allBody = table.slice(hi + 1);
  const body = allBody.filter((r) => {
    const isExample = examples.has(sampleKey((k) => (col[k] >= 0 ? String(r.cells[col[k]] ?? "").trim() : "")));
    if (isExample) (plan.skippedExamples ??= []).push(r.line);
    return !isExample;
  });
  if (!body.length) {
    plan.errors.push({ line: table[hi].line + 1, field: "file", message: plan.skippedExamples?.length ? "양식의 예시 줄만 있습니다. 예시 줄을 지우고 실제 자료를 적어 주세요." : "데이터 행이 없습니다." });
    return plan;
  }
  if (body.length > MAX_IMPORT_ROWS) plan.errors.push({ line: table[hi].line, field: "file", message: `한 번에 최대 ${MAX_IMPORT_ROWS}행까지 가져올 수 있습니다 (${body.length}행).` });

  body.slice(0, MAX_IMPORT_ROWS).forEach(({ line, cells }) => {
    const get = (k: string) => (col[k] >= 0 ? String(cells[col[k]] ?? "").trim() : "");
    const err = (field: string, message: string) => plan.errors.push({ line, field, message });
    const before = plan.errors.length;
    const siteOf = (): Site | undefined => {
      const ref = get("site");
      const s = findSite(db, ref);
      if (!s) err("현장", ref ? `‘${ref}’ 현장을 찾을 수 없습니다 (현장코드·약칭·현장명)` : "현장을 적어주세요");
      return s;
    };
    const amountOf = (k: string, label: string, required = true): number | undefined => {
      const v = get(k);
      if (!v && !required) return undefined;
      const n = parseWonCell(v);
      if (!Number.isInteger(n) || n <= 0) err(label, `${label}은 0보다 큰 원 단위 숫자`);
      else if (n > MAX_AMOUNT) err(label, `${label}이 너무 큽니다 (1건 50억 원 이하)`);
      return n;
    };
    const dateOf = (k: string, label: string, required = true): string | undefined => {
      const v = normDate(get(k));
      if (!v && !required) return undefined;
      if (!validDate(v)) err(label, `${label} 형식 YYYY-MM-DD (예: 2026-10-20)`);
      return v;
    };
    const noteOf = () => {
      const n = get("note");
      if (n.length > 200) err("메모", "메모는 200자 이내");
      return n.slice(0, 200);
    };

    if (kind === "billing") {
      const site = siteOf();
      const k = norm(get("kind"));
      const bk = k === "기성" || k === "기성청구" || k === "billing" ? "billing" : k === "입금" || k === "수금" || k === "payment" ? "payment" : null;
      if (!bk) err("구분", "구분은 ‘기성’ 또는 ‘입금’");
      const date = dateOf("date", "날짜");
      if (date && validDate(date) && date > today) err("날짜", "오늘 이후 날짜는 넣을 수 없습니다");
      const amount = amountOf("amount", "금액");
      const note = noteOf();
      if (plan.errors.length === before && site && bk && date && amount) plan.rows.push({ line, siteId: site.id, kind: bk, date, amount, note });
    } else if (kind === "change") {
      const site = siteOf();
      const title = get("title");
      if (!title) err("제목", "제목을 적어주세요");
      else if (title.length > 80) err("제목", "제목은 80자 이내");
      const amount = amountOf("amount", "금액");
      const status = CHANGE_STATUS[norm(get("status"))];
      if (!status) err("상태", "상태는 검토 · 청구 · 승인 · 반려 중 하나");
      const requestedDate = dateOf("requested", "요청일");
      const approvedAmount = amountOf("approved", "승인금액", false);
      if (approvedAmount !== undefined && status && status !== "approved") err("승인금액", "승인금액은 ‘승인’일 때만 적습니다");
      if (requestedDate && validDate(requestedDate) && requestedDate > today) err("요청일", "오늘 이후 날짜는 넣을 수 없습니다");
      const decidedDate = dateOf("decided", "결정일", false);
      if (decidedDate && validDate(decidedDate) && decidedDate > today) err("결정일", "오늘 이후 날짜는 넣을 수 없습니다");
      if (decidedDate && requestedDate && decidedDate < requestedDate) err("결정일", "결정일이 요청일보다 빠릅니다");
      const note = noteOf();
      if (plan.errors.length === before && site && status && requestedDate && amount)
        plan.rows.push({ line, siteId: site.id, title, amount, status, requestedDate, ...(status === "approved" ? { approvedAmount: approvedAmount ?? amount } : {}), ...(decidedDate ? { decidedDate } : {}), note });
    } else if (kind === "crew") {
      const site = siteOf();
      const date = dateOf("date", "날짜");
      if (date && validDate(date) && date > today) err("날짜", "오늘 이후 날짜는 넣을 수 없습니다");
      const team = get("team").replace(/\s+/g, " ");
      if (!team) err("팀", "팀 이름을 적어주세요");
      else if (team.length > 30) err("팀", "팀 이름은 30자 이내");
      const kRaw = norm(get("kind"));
      const ck = !kRaw || kRaw === "외주" || kRaw === "subcontract" ? "subcontract" : kRaw === "직영" || kRaw === "direct" ? "direct" : null;
      if (!ck) err("구분", "구분은 ‘직영’ 또는 ‘외주’");
      const hcRaw = get("headcount").replace(/[명\s]/g, "");
      const hc = /^\d+$/.test(hcRaw) ? Number(hcRaw) : NaN;
      if (!Number.isInteger(hc) || hc < 1 || hc > 300) err("인원", "인원은 1~300 사이 정수");
      if (plan.errors.length === before && site && date && ck) plan.rows.push({ line, siteId: site.id, date, team, kind: ck, headcount: hc });
    } else if (kind === "rates") {
      const team = get("team").replace(/\s+/g, " ");
      if (!team) err("팀", "팀 이름을 적어주세요");
      else if (team.length > 30) err("팀", "팀 이름은 30자 이내");
      const rate = parseWonCell(get("rate"));
      if (!Number.isInteger(rate) || rate < 10_000 || rate > 2_000_000) err("단가", "단가는 원 단위 1만~200만 (예: 300000)");
      if (plan.errors.length === before) {
        const prev = (db.settings?.teamRates ?? []).find((t) => t.team.toLowerCase() === team.toLowerCase());
        plan.rows.push({ line, team, dayRate: rate, ...(prev ? { before: prev.dayRate } : {}) });
      }
    } else if (kind === "material") {
      const site = siteOf();
      const date = dateOf("date", "날짜");
      if (date && validDate(date) && date > today) err("날짜", "오늘 이후 날짜는 넣을 수 없습니다");
      const mk = MATERIAL_KIND_IN[norm(get("kind"))];
      if (!mk) err("구분", "구분은 ‘반입’ 또는 ‘설치’");
      const itemRef = get("item");
      const item = site ? (site.materials ?? []).find((i) => !i.archived && norm(i.name) === norm(itemRef)) : undefined;
      if (!itemRef) err("품목", "품목을 적어주세요");
      else if (site && !item) err("품목", `‘${itemRef}’ 품목이 ${site.shortName}에 없습니다 — 현장 상세 ‘자재’ → ‘품목 정하기’에서 먼저 넣어 주세요`);
      const qty = parseQtyCell(get("qty"));
      if (!(qty > 0) || qty > 1_000_000) err("수량", "수량은 0보다 큰 숫자 (소수 둘째 자리까지 · 100만 이하)");
      const note = noteOf();
      if (plan.errors.length === before && site && date && mk && item) plan.rows.push({ line, siteId: site.id, date, kind: mk, itemId: item.id, itemName: item.name, unit: item.unit, qty, note });
    } else if (kind === "progress") {
      const site = siteOf();
      const date = dateOf("date", "날짜");
      // 오늘 진행은 현장 보고로 — 오늘 날짜를 넣으면 현장 홈에 ‘오늘 보고 보냄’으로 잘못 보인다
      if (date && validDate(date) && date >= today) err("날짜", "어제까지의 기록만 넣을 수 있습니다 (오늘 진행은 현장 보고로 남기세요)");
      if (site && date && validDate(date) && date < site.startDate) err("날짜", `${site.shortName} 착공일(${site.startDate}) 전 날짜입니다`);
      const stageRef = get("stage").replace(/\s+/g, " ");
      const overall = OVERALL_STAGE.has(norm(stageRef));
      const stage = site && !overall ? site.stages.find((x) => norm(x.name) === norm(stageRef)) : undefined;
      if (!stageRef) err("공정 단계", "공정 단계를 적어주세요 (현장 전체는 ‘전체’)");
      else if (site && !overall && !stage) err("공정 단계", `‘${stageRef}’ 단계가 ${site.shortName}에 없습니다 — 현장 관리의 공정 단계 이름 그대로 적어 주세요 (현장 전체는 ‘전체’)`);
      const pct = parsePctCell(get("pct"));
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) err("진행률", "진행률은 0~100 정수 (%)");
      const note = noteOf();
      if (plan.errors.length === before && site && date && (overall || stage))
        plan.rows.push({ line, siteId: site.id, date, stageId: overall ? null : stage!.id, stageName: overall ? "전체 공정률" : stage!.name, pct, from: 0, note });
    } else if (kind === "cost") {
      const site = siteOf();
      const date = dateOf("date", "날짜");
      if (date && validDate(date) && date > today) err("날짜", "오늘 이후 날짜는 넣을 수 없습니다");
      const category = CATEGORY_IN[norm(get("category"))];
      if (!category || !COST_CATEGORIES.includes(category)) err("항목", "항목은 자재 · 노무 · 외주 · 장비 · 경비 중 하나");
      const amount = amountOf("amount", "금액");
      const iRaw = norm(get("impact"));
      const impact = !iRaw || iRaw === "계획내" || iRaw === "within_forecast" ? "within_forecast" : iRaw === "추가" || iRaw === "additional" ? "additional" : null;
      if (!impact) err("성격", "성격은 ‘계획 내’ 또는 ‘추가’");
      const rRaw = norm(get("reason"));
      const reason = rRaw ? REASON_IN[rRaw] : "planned";
      if (!reason) err("사유", "사유는 계획 · 설계변경 · 단가인상 · 물량증가 · 재시공 · 공기 · 기타 중 하나");
      const note = noteOf();
      if (plan.errors.length === before && site && date && category && amount && impact && reason) plan.rows.push({ line, siteId: site.id, date, category, amount, impact, reason, note });
    }
  });

  // 같은 파일 안 팀 단가 중복
  if (kind === "rates") {
    const seen = new Map<string, number>();
    for (const r of plan.rows as RateRow[]) {
      const k = r.team.toLowerCase();
      if (seen.has(k)) plan.errors.push({ line: r.line, field: "팀", message: `${seen.get(k)}행과 같은 팀이 두 번 있습니다` });
      seen.set(k, r.line);
    }
    const total = new Set([...(db.settings?.teamRates ?? []).map((t) => t.team.toLowerCase()), ...seen.keys()]).size;
    if (total > 60) plan.errors.push({ line: 1, field: "file", message: `팀 단가는 최대 60팀까지 (합치면 ${total}팀)` });
  }

  // DB에 이미 있는 기록 → 중복으로 건너뜀. 같은 파일 안에서 같은 줄이 또 나와도 건너뛴다
  // (예전에는 DB와만 비교해 같은 파일의 같은 출력 2줄이 모두 들어가 인건비 추정이 2배가 됐다 · D-66 점검 반영)
  const keep: ImportRow[] = [];
  const seenRow = new Map<string, number>();
  for (const r of plan.rows) {
    const dup = duplicateOf(db, kind, r);
    if (dup) {
      plan.duplicates.push({ line: r.line, text: dup });
      continue;
    }
    const k = rowKey(kind, r);
    if (k && seenRow.has(k)) {
      plan.duplicates.push({ line: r.line, text: `${seenRow.get(k)}행과 같은 내용 — 한 번만 넣음` });
      continue;
    }
    if (k) seenRow.set(k, r.line);
    keep.push(r);
  }
  plan.rows = keep;

  if (kind === "progress") checkProgressChain(db, plan);

  // 기성·입금: 현장별 입금 합계가 기성 합계를 넘으면 미수금이 음수가 된다
  if (kind === "billing") {
    for (const s of db.sites) {
      const rows = (plan.rows as BillingRow[]).filter((r) => r.siteId === s.id);
      if (!rows.length) continue;
      const billed = db.billings.filter((b) => b.siteId === s.id && b.status === "confirmed").reduce((a, b) => a + b.amount, 0) + rows.filter((r) => r.kind === "billing").reduce((a, r) => a + r.amount, 0);
      const paid = db.payments.filter((p) => p.siteId === s.id).reduce((a, p) => a + p.amount, 0) + rows.filter((r) => r.kind === "payment").reduce((a, r) => a + r.amount, 0);
      if (paid > billed) {
        const last = rows.filter((r) => r.kind === "payment").at(-1);
        plan.errors.push({ line: last?.line ?? 1, field: "금액", message: `${s.shortName}: 입금 합계(${won(paid)})가 기성 합계(${won(billed)})보다 많습니다 — 선급금은 기성으로 먼저 넣어주세요` });
      }
    }
  }

  plan.errors.sort((a, b) => a.line - b.line);
  plan.summary = summarize(db, kind, plan.rows);
  return plan;
}

const won = (n: number) => `${Math.round(n / 10_000).toLocaleString("ko-KR")}만 원`;

/** 공정 진행 기록 한 점 (이미 있는 현장 보고) — 그날 시작 값(from)과 끝 값(to) */
interface ProgressPoint { date: string; at: string; from: number; to: number }

/** 이미 있는 현장 보고에서 이 단계(없으면 현장 전체)의 진척 기록 — 날짜·보낸 순서대로 */
export function progressPoints(db: Pick<DemoDB, "reports">, siteId: string, stageId: string | null): ProgressPoint[] {
  const out: ProgressPoint[] = [];
  for (const r of db.reports) {
    if (r.siteId !== siteId || r.status === "voided") continue;
    const c = stageId ? r.stages?.find((x) => x.stageId === stageId) : r.progress;
    if (c) out.push({ date: r.reportDate, at: r.createdAt, from: c.from, to: c.to });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
}

/**
 * 공정 진행 이력 앞뒤 맞추기 (D-71): 누계는 날짜가 지나며 줄지 않아야 하고, 뒤에 있는 현장 보고의 시작 값·지금 공정률보다 높을 수 없다.
 * 앞 기록과 같은 값(변화 없음)은 넣지 않는다. from은 바로 앞 기록 값 (처음이면 0).
 */
function checkProgressChain(db: DemoDB, plan: ImportPlan) {
  const rows = plan.rows as ProgressRow[];
  // 같은 날 같은 단계에 다른 값 두 개 → 어느 쪽인지 알 수 없다
  const firstOf = new Map<string, ProgressRow>();
  for (const r of rows) {
    const k = `${r.siteId}|${r.date}|${r.stageId ?? "*"}`;
    const f = firstOf.get(k);
    if (f && f.pct !== r.pct) plan.errors.push({ line: r.line, field: "진행률", message: `${f.line}행과 같은 날 같은 단계인데 진행률이 다릅니다 (${f.pct}% / ${r.pct}%)` });
    else if (!f) firstOf.set(k, r);
  }
  const groups = new Map<string, ProgressRow[]>();
  for (const r of rows) {
    const k = `${r.siteId}|${r.stageId ?? "*"}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const unchanged = new Set<ProgressRow>();
  for (const list of groups.values()) {
    const { siteId, stageId } = list[0];
    const site = db.sites.find((s) => s.id === siteId)!;
    const current = stageId ? (site.stages.find((x) => x.id === stageId)?.progressPct ?? 0) : site.progressPct;
    const existing = progressPoints(db, siteId, stageId);
    let prevRow: ProgressRow | undefined;
    for (const r of [...list].sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line)) {
      if (prevRow && prevRow.date === r.date) continue; // 같은 날 두 번 (위에서 오류 또는 중복)
      const prevE = existing.filter((p) => p.date < r.date).at(-1);
      const nextE = existing.find((p) => p.date > r.date);
      const prev = prevRow && (!prevE || prevRow.date > prevE.date) ? { date: prevRow.date, pct: prevRow.pct } : prevE ? { date: prevE.date, pct: prevE.to } : undefined;
      const fromPct = prev?.pct ?? 0;
      if (r.pct < fromPct) plan.errors.push({ line: r.line, field: "진행률", message: `앞선 기록(${prev!.date} ${fromPct}%)보다 낮습니다 — 진행률은 그날까지의 누계로 적어 주세요` });
      else if (nextE && r.pct > nextE.from) plan.errors.push({ line: r.line, field: "진행률", message: `뒤의 현장 보고(${nextE.date} 시작 ${nextE.from}%)보다 높습니다` });
      else if (!nextE && r.pct > current) plan.errors.push({ line: r.line, field: "진행률", message: `지금 ${r.stageName}(${current}%)보다 높습니다 — 현장 관리에서 지금 공정률을 먼저 맞춰 주세요` });
      r.from = fromPct;
      if (r.pct === fromPct) unchanged.add(r);
      prevRow = r;
    }
  }
  if (unchanged.size) {
    for (const r of unchanged) plan.duplicates.push({ line: r.line, text: `${r.date} ${r.stageName} ${r.pct}% — 앞 기록과 같아 변화 없음` });
    plan.rows = rows.filter((r) => !unchanged.has(r));
    plan.duplicates.sort((a, b) => a.line - b.line);
  }
}

/** 같은 파일 안 중복 판단 열쇠 — DB 중복 판단(duplicateOf)과 같은 기준 */
function rowKey(kind: ImportKind, r: ImportRow): string | null {
  if (kind === "billing") { const b = r as BillingRow; return `${b.siteId}|${b.kind}|${b.date}|${b.amount}`; }
  if (kind === "change") { const c = r as ChangeRow; return `${c.siteId}|${c.title}|${c.amount}`; }
  if (kind === "crew") { const c = r as CrewRow; return `${c.siteId}|${c.date}|${c.team.toLowerCase()}`; }
  if (kind === "material") { const m = r as MaterialRow; return `${m.siteId}|${m.itemId}|${m.kind}|${m.date}|${m.qty}`; }
  if (kind === "cost") { const c = r as CostRow; return `${c.siteId}|${c.date}|${c.category}|${c.amount}|${c.note}`; }
  if (kind === "progress") { const p = r as ProgressRow; return `${p.siteId}|${p.date}|${p.stageId ?? "*"}|${p.pct}`; }
  return null;
}

function duplicateOf(db: DemoDB, kind: ImportKind, r: ImportRow): string | null {
  if (kind === "billing") {
    const b = r as BillingRow;
    if (b.kind === "billing" && db.billings.some((x) => x.siteId === b.siteId && x.billedDate === b.date && x.amount === b.amount)) return `${b.date} 기성 ${won(b.amount)} — 이미 있음`;
    if (b.kind === "payment" && db.payments.some((x) => x.siteId === b.siteId && x.receivedDate === b.date && x.amount === b.amount)) return `${b.date} 입금 ${won(b.amount)} — 이미 있음`;
  }
  if (kind === "change") {
    const c = r as ChangeRow;
    if (db.changeOrders.some((x) => x.siteId === c.siteId && x.title.trim() === c.title && x.amount === c.amount)) return `‘${c.title}’ ${won(c.amount)} — 이미 있음`;
  }
  if (kind === "crew") {
    const c = r as CrewRow;
    if ((db.crewChecks ?? []).some((x) => x.siteId === c.siteId && x.workDate === c.date && x.team.toLowerCase() === c.team.toLowerCase())) return `${c.date} ${c.team} — 이미 있음 (현장에서 보낸 기록 유지)`;
  }
  if (kind === "material") {
    const m = r as MaterialRow;
    if ((db.materialMoves ?? []).some((x) => !x.voided && x.siteId === m.siteId && x.itemId === m.itemId && x.kind === m.kind && x.workDate === m.date && x.qty === m.qty))
      return `${m.date} ${m.itemName} ${m.kind === "in" ? "반입" : "설치"} ${m.qty} ${m.unit} — 이미 있음`;
  }
  if (kind === "progress") {
    const p = r as ProgressRow;
    // 그날 이 단계 기록이 이미 있으면 (현장 보고·앞서 가져온 기록) 그대로 둔다
    const same = progressPoints(db, p.siteId, p.stageId).find((x) => x.date === p.date);
    if (same) return `${p.date} ${p.stageName} — 그날 기록이 이미 있음 (${same.from}% → ${same.to}% 유지)`;
  }
  if (kind === "cost") {
    const c = r as CostRow;
    if (db.costEntries.some((x) => x.siteId === c.siteId && x.date === c.date && x.category === c.category && x.amount === c.amount && x.status !== "voided" && (x.note ?? "") === (c.note || "자료 가져오기"))) return `${c.date} ${won(c.amount)} — 이미 있음`;
  }
  return null;
}

function summarize(db: DemoDB, kind: ImportKind, rows: ImportRow[]): ImportPlan["summary"] {
  if (kind === "rates") return (rows as RateRow[]).map((r) => ({ label: `${r.team}: ${r.before ? `${won(r.before)} → ` : "새로 "}${won(r.dayRate)}`, count: 1 }));
  const bySite = new Map<string, ImportRow[]>();
  for (const r of rows) {
    const id = (r as { siteId: string }).siteId;
    bySite.set(id, [...(bySite.get(id) ?? []), r]);
  }
  return [...bySite.entries()].map(([siteId, list]) => {
    const name = db.sites.find((s) => s.id === siteId)?.shortName ?? siteId;
    if (kind === "billing") {
      const b = list as BillingRow[];
      const bill = b.filter((x) => x.kind === "billing");
      const pay = b.filter((x) => x.kind === "payment");
      return { siteId, label: `${name} — 기성 ${bill.length}건 · 입금 ${pay.length}건`, count: b.length, amount: bill.reduce((a, x) => a + x.amount, 0), amount2: pay.reduce((a, x) => a + x.amount, 0) };
    }
    if (kind === "change") {
      const c = list as ChangeRow[];
      const ap = c.filter((x) => x.status === "approved");
      return { siteId, label: `${name} — 변경공사 ${c.length}건 (승인 ${ap.length}건)`, count: c.length, amount: c.reduce((a, x) => a + x.amount, 0), amount2: ap.reduce((a, x) => a + (x.approvedAmount ?? 0), 0) };
    }
    if (kind === "crew") {
      const c = list as CrewRow[];
      return { siteId, label: `${name} — ${new Set(c.map((x) => x.date)).size}일 · ${new Set(c.map((x) => x.team.toLowerCase())).size}팀`, count: c.length, amount: c.reduce((a, x) => a + x.headcount, 0) };
    }
    if (kind === "material") {
      const m = list as MaterialRow[];
      // 수량만 — 금액(amount)은 넣지 않는다
      return { siteId, label: `${name} — 반입 ${m.filter((x) => x.kind === "in").length}건 · 설치 ${m.filter((x) => x.kind === "install").length}건 (품목 ${new Set(m.map((x) => x.itemId)).size}개)`, count: m.length };
    }
    if (kind === "progress") {
      const p = list as ProgressRow[];
      const dates = [...new Set(p.map((x) => x.date))].sort();
      // 금액 없음 — 날짜 수·단계 수·기간만
      return { siteId, label: `${name} — ${dates.length}개 날짜 · 단계 ${new Set(p.map((x) => x.stageId ?? "*")).size}개 (${dates[0]} ~ ${dates.at(-1)})`, count: p.length };
    }
    const c = list as CostRow[];
    return { siteId, label: `${name} — 원가 ${c.length}건`, count: c.length, amount: c.reduce((a, x) => a + x.amount, 0) };
  });
}

/** 양식(CSV 원문) */
export function importTemplate(kind: ImportKind): string {
  return IMPORT_SPECS[kind].sample.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
}

/** 엑셀 파일의 시트 중 이 자료 종류의 열 이름이 있는 첫 시트 (숨긴 시트 제외) — 없으면 첫 시트 */
export function pickImportSheet(sheets: { hidden: boolean; rows: string[][] }[], kind: ImportKind): number {
  const spec = IMPORT_SPECS[kind];
  const ok = (rows: string[][]) =>
    rows.slice(0, HEADER_SCAN_ROWS + 5).some((r) => {
      const h = r.map(norm);
      return spec.columns.every((c) => !c.required || h.some((x) => c.aliases.some((a) => norm(a) === x)));
    });
  const visible = sheets.map((s, i) => ({ s, i })).filter((x) => !x.s.hidden);
  return (visible.find((x) => ok(x.s.rows)) ?? visible[0] ?? { i: 0 }).i;
}

/** 엑셀 양식 (.xlsx): ‘입력’ 시트(열 이름 + 예시 줄) + ‘작성 안내’ 시트 */
export function importTemplateXlsx(kind: ImportKind): Uint8Array {
  const spec = IMPORT_SPECS[kind];
  const guide: string[][] = [
    ["열 이름", "꼭 적기", "설명", "예"],
    ...spec.columns.map((c) => [c.label, c.required ? "필수" : "선택", c.desc, c.example]),
    [],
    ["작성 방법"],
    ["1. ‘입력’ 시트의 첫 줄(열 이름)은 바꾸지 마세요."],
    ["2. 예시 줄은 지우고 실제 자료를 적으세요. 지우지 않아도 예시 줄은 넣지 않습니다."],
    ["3. 날짜는 2026-10-20처럼 적거나 엑셀 날짜로 적으세요."],
    ["4. 금액은 원 단위 숫자로 적으세요. 쉼표가 있어도 됩니다."],
    [`5. 한 번에 ${MAX_IMPORT_ROWS}행까지 넣을 수 있습니다.`],
    ["6. 저장한 엑셀 파일(.xlsx)을 그대로 올리면 됩니다. CSV로 바꿀 필요가 없습니다."],
  ];
  return writeXlsx([
    { name: "입력", rows: spec.sample, header: true, widths: spec.sample[0].map((h, i) => Math.max(12, Math.min(40, Math.max(h.length * 2, ...spec.sample.slice(1).map((r) => (r[i] ?? "").length * 1.6)) + 4))) },
    { name: "작성 안내", rows: guide, header: true, wrap: true, typed: false, widths: [16, 10, 60, 24] },
  ]);
}
