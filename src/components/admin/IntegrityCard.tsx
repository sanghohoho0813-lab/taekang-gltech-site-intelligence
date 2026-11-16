"use client";

/**
 * 숫자 맞추기 점검 (D-85) — 같은 기준의 돈 숫자가 화면마다 같은지(월 마감 합 = 누계, 이익을 바꾼 일 합 = 이익 변화, 대시보드 = 현장 합),
 * 중복 입력 의심·날짜 이상 줄이 없는지. 월 마감 전에 공무가, 이관 뒤에 본사가 본다.
 * 빨강(숫자가 화면마다 다름)은 생기면 안 되는 일이라 개발 담당에게 알린다. 노랑은 장부를 보고 사람이 판단한다.
 */
import Link from "next/link";
import { useMemo } from "react";
import { CircleAlert, CircleCheck, OctagonAlert } from "lucide-react";
import { Card, CardHeader, cx } from "@/components/ui/primitives";
import { moneyIntegrity } from "@/lib/domain/integrity";
import { todayIso } from "@/lib/domain/format";
import type { DemoDB } from "@/lib/domain/types";

export function IntegrityCard({ db }: { db: DemoDB }) {
  const today = todayIso();
  const checks = useMemo(() => moneyIntegrity(db, today), [db, today]);
  const err = checks.filter((c) => c.level === "err").length;
  const warn = checks.filter((c) => c.level === "warn").length;
  return (
    <Card id="integrity" className="scroll-mt-24" data-testid="integrity" data-err={err} data-warn={warn}>
      <CardHeader
        title={err ? `숫자 맞추기 점검 — 화면끼리 다른 숫자 ${err}건` : warn ? `숫자 맞추기 점검 — 확인할 줄 ${warn}건` : "숫자 맞추기 점검 — 모두 맞습니다"}
        sub="월 마감을 모두 더한 숫자 = 현장 누계 · ‘이익을 바꾼 일’ 합 = 예상이익 변화 · 대시보드 = 현장 합 · 중복 입력 의심 · 날짜 이상. 월 마감 전과 자료 이관 뒤에 봅니다."
      />
      {err > 0 && (
        <p className="mx-5 mb-2 rounded-xl bg-err-bg px-3.5 py-2.5 text-[0.84rem] font-semibold text-err">
          빨간 줄은 계산이 화면마다 다르다는 뜻이라 생기면 안 되는 일입니다. 이 화면을 캡처해 개발 담당에게 보내 주세요(장부를 고칠 일이 아닐 수 있습니다).
        </p>
      )}
      <ul className="divide-y divide-line border-t border-line text-[0.86rem]">
        {checks.map((c) => (
          <li key={c.key} className="flex gap-2.5 px-5 py-2.5" data-testid="integrity-row" data-level={c.level} data-key={c.key}>
            <span className="mt-0.5 shrink-0" aria-hidden>
              {c.level === "ok" ? <CircleCheck size={16} className="text-ok" /> : c.level === "warn" ? <CircleAlert size={16} className="text-warn" /> : <OctagonAlert size={16} className="text-err" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cx("block", c.level === "err" ? "font-semibold text-err" : c.level === "warn" ? "font-semibold" : "text-ink-2")}>{c.title}</span>
              {c.detail && <span className="block text-[0.8rem] text-ink-2">{c.detail}</span>}
            </span>
            {c.href && c.level !== "ok" && (
              <Link href={c.href} className="shrink-0 self-center text-[0.8rem] font-bold text-theme-ink">
                보기
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
