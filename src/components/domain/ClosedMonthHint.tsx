"use client";

/** 마감한 달의 원가를 바꿀 때 알리기 (D-82) — 막지는 않는다(잠금은 대표 결정 D-78). 바꾸면 월 마감 ‘마감 뒤 바뀐 것’에 남는다 */
import type { DemoDB } from "@/lib/domain/types";
import { closedMonthOf } from "@/lib/domain/closeRecord";
import { fmtDate } from "@/lib/domain/format";
import { userLabel } from "@/lib/data/hooks";

export function ClosedMonthHint({ db, date, action }: { db: DemoDB; date: string; action: string }) {
  const rec = closedMonthOf(db, date);
  if (!rec) return null;
  const m = Number(rec.month.slice(5));
  return (
    <p className="rounded-lg bg-warn-bg px-3 py-2 text-[0.8rem] font-semibold text-ink" data-testid="closed-month-hint">
      {m}월은 마감했습니다 ({fmtDate(rec.closedAt)} {userLabel(db, rec.closedBy)}{rec.confirmedAt ? " · 대표 확인" : ""}). 이 원가는 발생일이 {fmtDate(date)}이라 {action}하면 {m}월 숫자가 바뀌고 월 마감 ‘마감 뒤 바뀐 것’에 남습니다. 다음 달 몫이면 다음 달 날짜로 넣으세요.
    </p>
  );
}
