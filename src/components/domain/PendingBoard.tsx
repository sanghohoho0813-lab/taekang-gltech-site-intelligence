"use client";

/** 대표·관리자 — 처리 대기 (계약 모듈 05: 보고 미처리·근태 예외·작업지시 지연·인건비 불일치·고객 요청) */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { DemoDB } from "@/lib/domain/types";
import { todayIso } from "@/lib/domain/format";
import { pendingItems } from "@/lib/domain/pending";
import { IS_LIVE } from "@/lib/mode";
import { Card, CardHeader, cx } from "@/components/ui/primitives";

export function PendingBoard({ db }: { db: DemoDB }) {
  // 목록 계산은 lib/domain/pending.ts — 아침 알림도 같은 계산을 쓴다 (D-72)
  const items = pendingItems(db, todayIso(), IS_LIVE);
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
