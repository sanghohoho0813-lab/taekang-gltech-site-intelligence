"use client";

/**
 * 메뉴 배지 — 지금 손댈 건수 (사이드바·휴대폰 전체 메뉴가 같은 숫자를 쓴다 · D-75).
 * - 하자보수: 본사가 지금 손댈 하자 (작업지시 보낼 것 + 회신할 것 + 남은 보수 확인)
 * - 위험 분석·조치: 열린 위험 신호 + 회신 안 한 고객 요청 (하자보수는 위 배지로 따로 — 같은 건을 두 번 세지 않게)
 * - 본사 요청 (현장): 나에게 온 조치 + 끝나지 않은 작업지시 (휴대폰 아래 메뉴와 같은 숫자)
 */
import { useMemo } from "react";
import { currentUserId, useDb, useRole } from "@/lib/data/store";
import { computeSignals } from "@/lib/domain/risk";
import { defectTodoCount } from "@/lib/domain/defects";
import { todayIso } from "@/lib/domain/format";

export function useNavBadges(): (href: string) => number {
  const db = useDb();
  const role = useRole();
  const counts = useMemo(() => {
    if (!db) return { insights: 0, defects: 0, myActions: 0 };
    const hq = role === "ceo" || role === "manager";
    const signals = hq ? computeSignals(db).length : 0;
    // 회신 안 한 고객 요청 — 대시보드 ‘처리 대기’와 같은 기준 (검토 중도 셈 · 점검 11차)
    const newRequests = hq ? db.partnerRequests.filter((r) => r.status !== "answered" && r.type !== "defect").length : 0;
    const me = currentUserId();
    return {
      insights: signals + newRequests,
      defects: hq ? defectTodoCount(db, todayIso()) : 0,
      // 현장: 나에게 온 조치 + 끝나지 않은 작업지시 — 휴대폰 아래 메뉴와 같은 숫자 (점검 11차)
      myActions:
        role === "field"
          ? db.actions.filter((a) => a.assigneeUserId === me && !["done", "dismissed"].includes(a.status)).length +
            (db.workOrders ?? []).filter((w) => w.assigneeUserId === me && !["done", "confirmed"].includes(w.status)).length
          : 0,
    };
  }, [db, role]);
  return (href: string) => (href === "/insights" ? counts.insights : href === "/defects" ? counts.defects : href === "/my-actions" ? counts.myActions : 0);
}
