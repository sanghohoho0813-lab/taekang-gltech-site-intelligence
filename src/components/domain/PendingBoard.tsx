"use client";

/** 대표·관리자 — 처리 대기 (계약 모듈 05: 보고 미처리·근태 예외·작업지시 지연·인건비 불일치·고객 요청) */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { DemoDB } from "@/lib/domain/types";
import { todayIso } from "@/lib/domain/format";
import { laborAttentionCount } from "@/lib/domain/labor";
import { shiftDate } from "@/lib/domain/attendance";
import { readinessAll } from "@/lib/domain/readiness";
import { defectRows } from "@/lib/domain/defects";
import { IS_LIVE } from "@/lib/mode";
import { Card, CardHeader, cx } from "@/components/ui/primitives";

export function PendingBoard({ db }: { db: DemoDB }) {
  const today = todayIso();
  const wos = db.workOrders ?? [];
  const items = [
    { key: "fix", label: "근태 수정 요청", n: (db.attendanceRequests ?? []).filter((q) => q.status === "pending").length, href: "/orders?tab=fixes" },
    { key: "report", label: "확인 안 한 현장 보고", n: db.reports.filter((r) => r.status !== "voided" && !r.review).length, href: "/orders?tab=reports" },
    { key: "wo-done", label: "완료 확인할 작업지시", n: wos.filter((w) => w.status === "done").length, href: "/orders" },
    { key: "wo-late", label: "기한 지난·미접수 작업지시", n: wos.filter((w) => !["done", "confirmed"].includes(w.status) && ((w.dueDate && w.dueDate < today) || w.status === "sent")).length, href: "/orders" },
    { key: "partner", label: "회신 안 한 고객 요청 (견적·주문 등)", n: db.partnerRequests.filter((r) => r.status !== "answered" && r.type !== "defect").length, href: "/insights#requests" },
    // 하자보수: 작업지시·회신이 필요하거나, 현장이 끝냈는데 본사 확인·회신 전인 것 (D-69)
    { key: "defect", label: "하자보수 — 본사 할 일", n: defectRows(db, today).filter((r) => r.next === "assign" || r.next === "reply").length, href: "/defects" },
    { key: "labor", label: "인건비 확인 필요 현장", n: laborAttentionCount(db, shiftDate(today, -29), today), href: "/labor" },
    { key: "feedback", label: "확인 전 현장 앱 의견", n: (db.feedback ?? []).filter((f) => f.status === "new").length, href: "/quality" },
    { key: "ready", label: "빠진 운영 자료 (현장 위치·담당·기성 이력 등)", n: readinessAll(db, today).missing, href: "/data" },
    ...(IS_LIVE ? [{ key: "cost", label: "공무 확인 대기 원가", n: db.costEntries.filter((e) => e.status === "pending").length, href: "/admin?tab=review" }] : []),
  ];
  const total = items.reduce((a, b) => a + b.n, 0);
  return (
    <Card data-testid="pending-board">
      <CardHeader title={total ? `처리 대기 ${total}건` : "처리 대기 없음"} sub="현장이 보낸 것 중 본사가 확인해야 할 일" />
      <ul className="flex flex-wrap gap-px border-t border-line bg-line">
        {items.map((it) => (
          <li key={it.key} className="min-w-[15rem] flex-1 bg-surface">
            <Link href={it.href} className="row-hover flex items-center gap-2 px-5 py-3" data-testid={`pending-${it.key}`}>
              <span className="min-w-0 flex-1 text-[0.86rem] font-semibold text-ink-2">{it.label}</span>
              <b className={cx("num text-[1.2rem]", it.n ? "text-err" : "text-ink-3")}>{it.n}</b>
              <ChevronRight size={16} className="text-ink-3" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
