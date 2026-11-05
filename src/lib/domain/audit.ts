/** 활동 이력 (계약 검수 S6 ‘변경이력’) — 종류 이름과 필터 (DEMO는 브라우저에서, LIVE는 서버가 같은 조건으로 조회) */
import type { ActivityLog } from "./types";

export const LOG_TYPE_LABEL: Record<string, string> = {
  report: "현장 보고",
  report_void: "보고 취소",
  cost_void: "원가 무효",
  cost_edit: "원가 수정",
  cost_review: "공무 확인",
  csv: "원가 CSV",
  import: "자료 가져오기",
  progress: "공정",
  attendance: "출퇴근·근태",
  crew: "작업 인원",
  material: "자재 반입·설치",
  order: "작업지시",
  action: "위험 조치",
  action_note: "조치 메모",
  proof: "실증 기록",
  partner: "고객 요청",
  billing: "기성",
  payment: "입금",
  change_order: "변경공사",
  forecast: "잔여예상원가",
  site: "현장 정보",
  settings: "설정",
  privacy: "개인위치정보",
  device: "휴대폰 점검",
  feedback: "앱 의견",
  member: "사용자 관리",
};

export interface AuditFilter {
  from: string; // YYYY-MM-DD (한국 날짜)
  to: string;
  siteId?: string;
  userId?: string;
  type?: string;
  q?: string;
}

export const AUDIT_LIMIT = 1000;

/** 한국 날짜 → ISO 시각 범위 */
export function auditRange(f: Pick<AuditFilter, "from" | "to">): { fromIso: string; toIso: string } {
  return { fromIso: new Date(`${f.from}T00:00:00+09:00`).toISOString(), toIso: new Date(`${f.to}T23:59:59.999+09:00`).toISOString() };
}

export function filterLogs(logs: ActivityLog[], f: AuditFilter): { logs: ActivityLog[]; truncated: boolean } {
  const { fromIso, toIso } = auditRange(f);
  const q = f.q?.trim().toLowerCase();
  const out = logs
    .filter((l) => l.at >= fromIso && l.at <= toIso && (!f.siteId || l.siteId === f.siteId) && (!f.userId || l.by === f.userId) && (!f.type || l.type === f.type) && (!q || l.summary.toLowerCase().includes(q)))
    .sort((a, b) => b.at.localeCompare(a.at));
  return { logs: out.slice(0, AUDIT_LIMIT), truncated: out.length > AUDIT_LIMIT };
}
