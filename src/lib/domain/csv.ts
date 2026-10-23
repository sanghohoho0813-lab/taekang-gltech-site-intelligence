/** 원가 CSV 가져오기 — 파싱·검증 (순수 함수). 오류는 행 번호와 함께 반환한다. */
import type { CostCategory, CostReason, ForecastImpact } from "./types";
import { COST_CATEGORIES } from "./labels";
import type { CsvCostRow } from "@/lib/data/commands";

export const CSV_COLUMNS = ["site_code", "date", "category", "amount", "forecast_impact", "reason", "note"] as const;

export const CSV_FIELD_GUIDE: { name: string; required: boolean; desc: string; example: string }[] = [
  { name: "site_code", required: true, desc: "현장코드 (설정 화면의 현장 목록 참고)", example: "TK-DEMO-A" },
  { name: "date", required: true, desc: "발생일 YYYY-MM-DD", example: "2026-10-20" },
  { name: "category", required: true, desc: "material(자재) · labor(노무) · subcontract(외주) · equipment(장비) · overhead(경비)", example: "material" },
  { name: "amount", required: true, desc: "원 단위 정수, 공급가액(부가세 별도), 쉼표 허용", example: "12000000" },
  { name: "forecast_impact", required: true, desc: "additional(예상 외 추가원가, EAC 증가) · within_forecast(계획 내 집행, EAC 불변)", example: "within_forecast" },
  { name: "reason", required: true, desc: "design_change · price_increase · quantity_increase · rework · schedule · planned · other", example: "planned" },
  { name: "note", required: false, desc: "메모 (200자 이내)", example: "알루미늄 프레임 2차 입고" },
];

const REASONS: CostReason[] = ["design_change", "price_increase", "quantity_increase", "rework", "schedule", "planned", "other"];
const IMPACTS: Exclude<ForecastImpact, "baseline">[] = ["additional", "within_forecast"];

export function sampleCsv(siteCode = "TK-DEMO-A"): string {
  return [
    CSV_COLUMNS.join(","),
    `${siteCode},2026-10-20,material,12000000,within_forecast,planned,알루미늄 프레임 2차 입고 (샘플)`,
    `${siteCode},2026-10-21,labor,3500000,within_forecast,planned,유리 시공 인력 (샘플)`,
  ].join("\n");
}

/** RFC4180 수준의 간단한 CSV 파서 (따옴표·쉼표 포함 필드 지원) */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface CsvValidation {
  rows: CsvCostRow[];
  errors: { line: number; field: string; message: string }[];
  headerOk: boolean;
}

export function validateCostCsv(text: string, siteCodes: string[]): CsvValidation {
  const table = parseCsvText(text);
  const errors: CsvValidation["errors"] = [];
  if (!table.length) return { rows: [], errors: [{ line: 1, field: "file", message: "빈 파일입니다." }], headerOk: false };
  const header = table[0].map((h) => h.trim());
  const missing = CSV_COLUMNS.filter((c) => c !== "note" && !header.includes(c));
  if (missing.length) {
    return { rows: [], errors: [{ line: 1, field: "header", message: `필수 열 누락: ${missing.join(", ")}` }], headerOk: false };
  }
  const idx = (c: string) => header.indexOf(c);
  if (table.length - 1 > 500) errors.push({ line: 1, field: "file", message: "한 번에 최대 500행까지 가져올 수 있습니다." });
  const rows: CsvCostRow[] = [];
  table.slice(1, 501).forEach((cells, i) => {
    const line = i + 2;
    const get = (c: string) => (idx(c) >= 0 ? (cells[idx(c)] ?? "").trim() : "");
    const rowErrors: CsvValidation["errors"] = [];
    const site_code = get("site_code");
    if (!siteCodes.includes(site_code)) rowErrors.push({ line, field: "site_code", message: `알 수 없는 현장코드 '${site_code}'` });
    const date = get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) rowErrors.push({ line, field: "date", message: "날짜 형식 YYYY-MM-DD" });
    const category = get("category") as CostCategory;
    if (!COST_CATEGORIES.includes(category)) rowErrors.push({ line, field: "category", message: `알 수 없는 항목 '${category}'` });
    const rawAmount = get("amount").replace(/[,\s원]/g, "");
    const amount = /^\d+$/.test(rawAmount) ? Number(rawAmount) : NaN;
    if (!Number.isInteger(amount) || amount <= 0) rowErrors.push({ line, field: "amount", message: "0보다 큰 원 단위 정수" });
    else if (amount > 5_000_000_000) rowErrors.push({ line, field: "amount", message: "1건 50억 원 이하" });
    const impact = get("forecast_impact") as Exclude<ForecastImpact, "baseline">;
    if (!IMPACTS.includes(impact)) rowErrors.push({ line, field: "forecast_impact", message: "additional 또는 within_forecast" });
    const reason = get("reason") as CostReason;
    if (!REASONS.includes(reason)) rowErrors.push({ line, field: "reason", message: `알 수 없는 사유 '${reason}'` });
    const note = get("note");
    if (note.length > 200) rowErrors.push({ line, field: "note", message: "메모 200자 이내" });
    if (rowErrors.length) errors.push(...rowErrors);
    else rows.push({ line, site_code, date, category, amount, forecast_impact: impact, reason, note });
  });
  if (table.length === 1) errors.push({ line: 2, field: "file", message: "데이터 행이 없습니다." });
  return { rows, errors, headerOk: true };
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}
