"use client";

/** 마감한 달 날짜로 원가·기성·입금을 넣거나 바꿀 때 알리기 (D-82) — 막지는 않는다(잠금은 대표 결정 D-78). 바꾸면 월 마감 ‘마감 뒤 바뀐 것’에 남는다 */
import type { DemoDB } from "@/lib/domain/types";
import { closedMonthOf } from "@/lib/domain/closeRecord";
import { fmtDate } from "@/lib/domain/format";
import { userLabel } from "@/lib/data/hooks";

export function ClosedMonthHint({ db, date, action, what = "원가" }: { db: DemoDB; date: string; action: string; what?: string }) {
  const rec = closedMonthOf(db, date);
  if (!rec) return null;
  const m = Number(rec.month.slice(5));
  const cost = what === "원가";
  return (
    <p className="rounded-lg bg-warn-bg px-3 py-2 text-[0.8rem] font-semibold text-ink" data-testid="closed-month-hint">
      {m}월은 마감했습니다 ({fmtDate(rec.closedAt)} {userLabel(db, rec.closedBy)}
      {rec.confirmedAt ? " · 대표 확인" : ""}). 이 {what}은 날짜가 {fmtDate(date)}이라 {action} {m}월 숫자가 바뀌고 월 마감 ‘마감 뒤 바뀐 것’에 남습니다
      {rec.confirmedAt ? "(대표에게 알림)" : ""}. 다음 달 몫이면 {cost && action !== "넣으면" ? "발생일을 다음 달로 고치세요(원가 고치기)" : "다음 달 날짜로 넣으세요"}.
    </p>
  );
}
