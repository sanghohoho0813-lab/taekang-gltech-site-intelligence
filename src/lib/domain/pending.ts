/**
 * 본사 처리 대기 목록 (대시보드 ‘처리 대기’와 아침 알림이 같은 계산을 쓴다 · D-72)
 * 계약 모듈 05: 보고 미처리·근태 예외·작업지시 지연·인건비 불일치·고객 요청
 */
import type { DemoDB } from "./types";
import { laborAttentionCount } from "./labor";
import { shiftDate } from "./attendance";
import { readinessAll } from "./readiness";
import { defectTodoCount } from "./defects";
import { warrantyStatus, WARRANTY_SOON_DAYS } from "./warranty";
import { closeStatuses } from "./closeRecord";
import { coAttentionCount } from "./changeOrders";
import { moneyIntegrity } from "./integrity";

export type PendingKey = "signup" | "fix" | "report" | "wo-done" | "wo-late" | "partner" | "defect" | "warranty" | "labor" | "feedback" | "ready" | "cost" | "close" | "close-confirm" | "close-change" | "co" | "integrity";
export interface PendingItem {
  key: PendingKey;
  label: string;
  n: number;
  href: string;
}

/** role: 대표 확인 대기는 대표 화면에만 (공무 합계를 부풀리지 않게 · D-82 점검). 없으면(아침 알림 등) 모두 */
export function pendingItems(db: DemoDB, today: string, live: boolean, role?: string): PendingItem[] {
  const wos = db.workOrders ?? [];
  // 끝난 최근 석 달 마감 (D-82) — 아직 마감 안 한 달 · 대표 확인 대기 · 마감(확인) 뒤 바뀐 것. 해당 없으면 줄을 보이지 않는다
  const cs = closeStatuses(db, today);
  const ml = (xs: { month: string }[]) => xs.map((x) => `${Number(x.month.slice(5))}월`).reverse().join("·");
  const open = cs.filter((c) => c.state === "open");
  const waiting = cs.filter((c) => c.state === "closed");
  const changed = cs.filter((c) => c.state !== "open" && c.changes > 0);
  const closeRows: PendingItem[] = [
    ...(open.length ? [{ key: "close" as const, label: `${ml(open)} 아직 마감 안 함`, n: open.length, href: `/close?month=${open[open.length - 1].month}` }] : []),
    ...(waiting.length && role !== "manager" && role !== "field" ? [{ key: "close-confirm" as const, label: `${ml(waiting)} 마감 대표 확인 대기`, n: waiting.length, href: `/close?month=${waiting[0].month}` }] : []),
    ...(changed.length ? [{ key: "close-change" as const, label: `${ml(changed)} 마감 뒤 바뀐 것`, n: changed.reduce((a, c) => a + c.changes, 0), href: `/close?month=${changed[0].month}#close-changes` }] : []),
  ];
  // 숫자 맞추기 점검의 빨간 줄 (D-85) — 화면끼리 숫자가 다르면 생기면 안 되는 일이라 맨 위에
  const integrityErr = moneyIntegrity(db, today).filter((c) => c.level === "err").length;
  return [
    ...(integrityErr ? [{ key: "integrity" as const, label: "숫자 맞추기 점검 — 화면끼리 다른 숫자 (개발 담당에게 알림)", n: integrityErr, href: "/data#integrity" }] : []),
    // 회원가입 승인 대기 (D-90) — 서버가 승인 담당에게만 숫자를 준다
    ...(db.signup?.canApprove && db.signup.pending ? [{ key: "signup" as const, label: "가입 신청 — 승인 대기", n: db.signup.pending, href: "/admin?tab=members#signups" }] : []),
    ...closeRows,
    { key: "fix", label: "근태 수정 요청", n: (db.attendanceRequests ?? []).filter((q) => q.status === "pending").length, href: "/orders?tab=fixes" },
    // 엑셀로 옮긴 지난 기록은 이미 확인된 것 (D-71)
    { key: "report", label: "확인 안 한 현장 보고", n: db.reports.filter((r) => r.status !== "voided" && !r.review && !r.importBatchId).length, href: "/orders?tab=reports" },
    // 하자보수 작업지시는 ‘하자보수 — 본사 할 일’에서 센다 (두 번 세던 문제 · D-69 점검 반영)
    // 발주처가 이미 ‘확인 완료’한 하자의 작업지시는 하자보수 할 일에서 빠지므로 여기서 센다 — 어디에도 안 잡히던 문제 (D-78 첫 달 리허설)
    { key: "wo-done", label: "완료 확인할 작업지시", n: wos.filter((w) => w.status === "done" && (!w.sourcePartnerRequestId || !!db.partnerRequests.find((r) => r.id === w.sourcePartnerRequestId)?.confirmedAt)).length, href: "/orders" },
    { key: "wo-late", label: "기한 지난·미접수 작업지시", n: wos.filter((w) => !["done", "confirmed"].includes(w.status) && ((w.dueDate && w.dueDate < today) || w.status === "sent")).length, href: "/orders" },
    // 변경공사 (D-84) — 발주처에 확인할 날이 됐거나 날이 없음 · 청구 검토로 7일 넘게 머묾 · 반려 뒤 다시 청구할지 안 정함
    { key: "co", label: "변경공사 챙길 것 (발주처 확인할 날 · 미발송 7일 넘음 · 반려 뒤 결정)", n: coAttentionCount(db, today), href: "/finance#co-board" },
    { key: "partner", label: "회신 안 한 고객 요청 (견적·주문 등)", n: db.partnerRequests.filter((r) => r.status !== "answered" && r.type !== "defect").length, href: "/insights#requests" },
    // 하자보수: 작업지시·회신·남은 보수 확인 — 메뉴 배지와 같은 수 (D-69 · 점검 12차: ‘남은 보수 확인’이 빠져 배지와 달랐다)
    { key: "defect", label: "하자보수 — 본사 할 일", n: defectTodoCount(db, today), href: "/defects?view=todo" },
    // 하자보증 만료 전 점검 (D-70)
    { key: "warranty", label: `하자보증 만료 ${WARRANTY_SOON_DAYS}일 이내 현장 (최종 점검)`, n: db.sites.filter((s) => warrantyStatus(s, today).state === "soon").length, href: "/defects#warranty" },
    { key: "labor", label: "인건비 확인 필요 현장", n: laborAttentionCount(db, shiftDate(today, -29), today), href: "/labor" },
    { key: "feedback", label: "확인 전 현장 앱 의견", n: (db.feedback ?? []).filter((f) => f.status === "new").length, href: "/quality" },
    { key: "ready", label: "빠진 운영 자료 (현장 위치·담당·기성 이력 등)", n: readinessAll(db, today).missing, href: "/data" },
    ...(live ? [{ key: "cost" as const, label: "공무 확인 대기 원가", n: db.costEntries.filter((e) => e.status === "pending").length, href: "/admin?tab=review" }] : []),
  ];
}
