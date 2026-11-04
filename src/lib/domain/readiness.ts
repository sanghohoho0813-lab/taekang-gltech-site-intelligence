/**
 * 운영 자료 준비 점검 — 현장별로 ‘실제 운영·검수에 필요한 자료’가 들어왔는지 확인 (결정론적 규칙).
 * 계약 3단계 ‘실제 자료 연결’과 2단계 실사용 준비(위치·담당자)를 한 화면에서 확인하기 위한 목록.
 */
import type { DemoDB, Site } from "./types";
import { COST_CATEGORIES } from "./labels";
import { daysBetween } from "./format";
import { shiftDate } from "./attendance";
import { teamRate } from "./labor";

export type ReadyStatus = "ok" | "warn" | "missing";
export type ReadyFix = "site" | "geo" | "billing" | "change" | "crew" | "rates" | "cost" | "forecast" | "partner" | "settings";

export interface ReadyItem {
  key: string;
  label: string;
  status: ReadyStatus;
  text: string;
  /** 고치는 곳 */
  fix?: ReadyFix;
}

export interface SiteReadiness {
  site: Site;
  items: ReadyItem[];
  ok: number;
  total: number;
}

export function siteReadiness(db: DemoDB, site: Site, today: string): SiteReadiness {
  const items: ReadyItem[] = [];
  const add = (key: string, label: string, status: ReadyStatus, text: string, fix?: ReadyFix) => items.push({ key, label, status, text, fix });
  const started = site.startDate <= today;
  const runningDays = started ? daysBetween(site.startDate, new Date(`${today}T12:00:00+09:00`)) : 0;

  // 1) 기본 정보
  const contract = db.contracts.find((c) => c.siteId === site.id);
  add("contract", "계약금액·실행예산", contract && contract.contractAmount > 0 && (contract.plannedCostTotal ?? 0) > 0 ? "ok" : "missing", contract && contract.contractAmount > 0 ? "입력됨" : "원 계약금액·실행예산이 없습니다", "site");
  const laborBudget = db.budgets.find((b) => b.siteId === site.id && b.category === "labor")?.amount ?? 0;
  const zeroCats = COST_CATEGORIES.filter((c) => (db.budgets.find((b) => b.siteId === site.id && b.category === c)?.amount ?? 0) === 0).length;
  if (laborBudget === 0) add("labor-budget", "노무 실행예산", "warn", "노무 실행예산이 0원 — 인건비 대비 누계를 볼 수 없습니다", "site");
  else if (zeroCats >= 3) add("budgets", "실행예산 항목", "warn", `원가 항목 ${zeroCats}개가 0원 — 항목별 예산 확인`, "site");

  const fieldUser = db.users.find((u) => u.id === site.fieldUserId);
  add("field-user", "현장 담당자", fieldUser && !fieldUser.inactive ? "ok" : "missing", fieldUser ? (fieldUser.inactive ? `${fieldUser.name} — 비활성 계정` : `${fieldUser.name} ${fieldUser.title}`) : "현장 담당자가 지정되지 않았습니다 (현장 보고·출근 불가)", "site");
  add("geo", "현장 위치(출근 기준점)", site.geo ? "ok" : "missing", site.geo ? `반경 ${site.geo.radiusM}m` : "위치가 없어 출근·보고 위치를 ‘현장 안/밖’으로 판정할 수 없습니다", "geo");
  add("stages", "공정 단계", site.stages.length ? "ok" : "warn", site.stages.length ? `${site.stages.length}단계` : "공정 단계가 없어 늦은 공정을 단계별로 볼 수 없습니다", "site");

  // 2) 지난 자료 (진행 중 현장이면 이관 필요)
  const costs = db.costEntries.filter((e) => e.siteId === site.id && e.status !== "voided");
  if (started && runningDays >= 14) add("cost", "원가 이력", costs.length ? "ok" : "missing", costs.length ? `${costs.length}건` : "착공 후 원가가 한 건도 없습니다 — 지난 원가를 가져오세요", "cost");
  const bills = db.billings.filter((b) => b.siteId === site.id);
  if (started && (site.progressPct >= 20 || runningDays >= 60)) add("billing", "기성·입금 이력", bills.length ? "ok" : "missing", bills.length ? `기성 ${bills.length}회 · 입금 ${db.payments.filter((p) => p.siteId === site.id).length}회` : `공정률 ${site.progressPct}%인데 기성 기록이 없습니다 — 지난 기성·입금을 가져오세요`, "billing");
  const cos = db.changeOrders.filter((c) => c.siteId === site.id);
  add("change", "변경공사", "ok", cos.length ? `${cos.length}건 (승인 ${cos.filter((c) => c.status === "approved").length})` : "없음 (있으면 가져오기)", "change");

  // 3) 잔여예상원가 재추정 — 오래되면 예상 손익이 틀어진다
  const fc = db.forecasts.filter((f) => f.siteId === site.id);
  const latest = fc.map((f) => f.basisDate).sort().at(-1);
  if (started && latest) {
    const age = daysBetween(latest, new Date(`${today}T12:00:00+09:00`));
    add("forecast", "잔여예상원가 재추정", age > 30 ? "warn" : "ok", age > 30 ? `마지막 재추정 ${age}일 전 — 예상 손익이 실제와 멀어질 수 있습니다` : `${age}일 전`, "forecast");
  }

  // 4) 투입 인원 — 인건비 추정의 근거
  if (started && site.status === "active") {
    const since = shiftDate(today, -13);
    const crew = (db.crewChecks ?? []).filter((c) => c.siteId === site.id);
    const recent = crew.filter((c) => c.workDate >= since);
    add("crew", "작업 인원 보고 (최근 14일)", recent.length ? "ok" : "warn", recent.length ? `${new Set(recent.map((c) => c.workDate)).size}일 보고` : crew.length ? "최근 14일 보고 없음" : "보고·이력이 없어 인건비를 추정할 수 없습니다", "crew");
    const teams = [...new Set(crew.map((c) => c.team))];
    const noRate = teams.filter((t) => !teamRate(db, t).set);
    if (teams.length) add("rates", "팀 단가", noRate.length ? "warn" : "ok", noRate.length ? `${noRate.slice(0, 3).join(", ")}${noRate.length > 3 ? ` 외 ${noRate.length - 3}팀` : ""} — 기본 일당으로 계산 중` : `${teams.length}팀 모두 설정`, "rates");
  }

  // 5) 발주처 계정 (선택)
  const partner = db.users.some((u) => u.role === "partner" && !u.inactive && u.partnerSiteIds?.includes(site.id));
  add("partner", "발주처 포털 계정 (선택)", partner ? "ok" : "warn", partner ? "연결됨" : "연결된 발주처 계정 없음 — 견적·주문·진행 공유를 쓰려면 추가", "partner");

  return { site, items, ok: items.filter((i) => i.status === "ok").length, total: items.length };
}

/** 화면·명령이 매번 읽는 주요 기록 (활동 이력은 최근 300건만 읽으므로 제외) */
const DATA_COLLECTIONS = ["attendance", "reports", "photos", "crewChecks", "costEntries", "workOrders", "attendanceRequests", "partnerRequests", "billings", "payments", "changeOrders"] as const;
export const DATA_VOLUME_WARN = 45_000;

export function companyReadiness(db: DemoDB): ReadyItem[] {
  const s = db.settings;
  const items: ReadyItem[] = [];
  items.push({ key: "help-phone", label: "본사 전화 (현장 화면 ‘본사 전화’ 버튼)", status: s?.helpPhone ? "ok" : "warn", text: s?.helpPhone ?? "번호 없음 — 현장 직원이 화면에서 바로 전화할 수 없습니다", fix: "settings" });
  const qr = s?.attendanceMode === "qr";
  const sitesNoKiosk = qr ? db.sites.filter((x) => x.status === "active" && !(db.kiosks ?? []).some((k) => k.siteId === x.id && !k.revokedAt && k.pairedAt)) : [];
  items.push({
    key: "attendance-mode",
    label: "출근 방식",
    status: qr && sitesNoKiosk.length ? "warn" : "ok",
    text: qr ? (sitesNoKiosk.length ? `현장 QR — ${sitesNoKiosk.map((x) => x.shortName).join(", ")} 태블릿 미연결` : "현장 QR + GPS") : "GPS (가짜 GPS 대응이 필요하면 현장 QR)",
    fix: "geo",
  });
  // 데이터 규모 — 1년치(약 2만 건)는 여유, 약 2년치(4.5만 건)부터 오래된 기록 보관 정리 시점 (D-34 성능 측정)
  const volume = DATA_COLLECTIONS.reduce((a, k) => a + ((db[k] as unknown[] | undefined)?.length ?? 0), 0);
  items.push({
    key: "data-volume",
    label: "데이터 규모",
    status: volume >= DATA_VOLUME_WARN ? "warn" : "ok",
    text: volume >= DATA_VOLUME_WARN ? `${volume.toLocaleString("ko-KR")}건 — 오래된 기록 보관 정리(아카이브)를 준비할 시점입니다 (처리 속도 유지)` : `${volume.toLocaleString("ko-KR")}건 (여유 — 약 ${DATA_VOLUME_WARN.toLocaleString("ko-KR")}건부터 정리 권장)`,
  });
  const field = db.users.filter((u) => u.role === "field" && !u.inactive);
  items.push({ key: "field-users", label: "현장 직원 계정", status: field.length ? "ok" : "missing", text: field.length ? `${field.length}명` : "현장 직원 계정이 없습니다", fix: "site" });
  return items;
}

export function readinessAll(db: DemoDB, today: string) {
  const sites = db.sites.filter((s) => s.status !== "completed").map((s) => siteReadiness(db, s, today));
  const missing = sites.reduce((a, s) => a + s.items.filter((i) => i.status === "missing").length, 0);
  return { sites, company: companyReadiness(db), missing };
}
