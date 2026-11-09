"use client";

/**
 * 아침 알림 (D-72) — 매일 아침 7시 30분 점검이 보내는 본사 요약·현장 ‘오늘 할 일’을 켜고 끄고, 오늘 보낼 내용을 미리 본다.
 * 시연판은 실제로 보내지 않는다. 금액은 넣지 않는다.
 */
import { useState } from "react";
import { Sunrise } from "lucide-react";
import { run } from "@/lib/data/store";
import { errorMessage } from "@/lib/data/commands";
import { fmtDate, todayIso } from "@/lib/domain/format";
import { briefRestDay, fieldBriefs, hqBrief } from "@/lib/domain/brief";
import { DEFAULT_SETTINGS, type DemoDB } from "@/lib/domain/types";
import { IS_LIVE } from "@/lib/mode";
import { Badge, Card, CardHeader, cx } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";

export function MorningBriefCard({ db }: { db: DemoDB }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const s = db.settings ?? DEFAULT_SETTINGS;
  const on = s.morningBrief !== false;
  const today = todayIso();
  const hq = hqBrief(db, today, IS_LIVE);
  const field = fieldBriefs(db, today);
  const toggle = async () => {
    setBusy(true);
    try {
      await run("setCompanySettings", { morningBrief: !on });
      toast.push({ tone: "ok", title: on ? "아침 알림을 껐습니다" : "아침 알림을 켰습니다" });
    } catch (e) {
      toast.push({ tone: "err", title: errorMessage(e, "바꾸지 못했습니다.") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-testid="brief-card" data-on={on ? "1" : "0"}>
      <CardHeader
        title="아침 알림 (매일 아침 7시 30분)"
        sub="본사: 지난 근무일 보고 없는 현장 + 매일 손댈 처리 대기 (인건비·앱 의견·운영 자료는 대시보드에서) · 현장 직원: 새 지시·오늘 기한 작업지시·보완 요청 · 할 일이 없으면 보내지 않음 · 일요일 쉼 · 금액 없음"
        right={
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="아침 알림"
            disabled={busy}
            onClick={toggle}
            className={cx("press inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-[0.86rem] font-bold disabled:opacity-60", on ? "border-active bg-active-soft text-theme-ink" : "border-line text-ink-2")}
            data-testid="brief-toggle"
          >
            <span className={cx("relative inline-block h-5 w-9 rounded-full transition-colors", on ? "bg-[var(--t-active)]" : "bg-surface-3")} aria-hidden>
              <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", on ? "left-[1.1rem]" : "left-0.5")} />
            </span>
            {on ? "켜짐" : "꺼짐"}
          </button>
        }
      />
      <div className="space-y-3 px-5 pb-5 text-[0.86rem]">
        <p className="text-[0.8rem] text-ink-3" data-testid="brief-status">
          <Sunrise size={15} aria-hidden className="mr-1 inline-block align-[-2px]" />
          {!on
            ? "꺼져 있습니다 — 하자보증 만료 알림과 평소 알림(작업지시·보고 등)은 그대로 갑니다."
            : IS_LIVE
              ? s.briefSentOn
                ? `마지막으로 확인한 날 ${fmtDate(s.briefSentOn)} (할 일이 있는 사람에게만 보냄)`
                : "아직 보낸 적 없음 (휴대폰 알림을 켠 사람에게만 갑니다)"
              : "시연판은 실제로 보내지 않습니다 — 아래는 지금 기준으로 보낼 내용 미리보기입니다."}
          {on && briefRestDay(today) && (
            <>
              {" "}
              <Badge tone="neutral">오늘은 일요일 — 쉼</Badge>
            </>
          )}
        </p>
        <div className={cx("rounded-xl border border-line bg-surface-2 px-3.5 py-2.5", !on && "opacity-55")} data-testid="brief-preview-hq">
          <p className="text-[0.76rem] font-bold text-ink-3">본사 (대표·공무){!on && " · 보내지 않음"}</p>
          {hq.total ? (
            <>
              {/* 휴대폰 잠금화면에 보이는 그대로 */}
              <div className="mt-1 rounded-lg border border-line bg-surface px-3 py-2" data-testid="brief-push-hq">
                <p className="text-[0.82rem] font-bold">{hq.title}</p>
                <p className="text-[0.78rem] text-ink-2 [overflow-wrap:anywhere]">{hq.body}</p>
              </div>
              <p className="mt-2 text-[0.74rem] font-semibold text-ink-3">자세히</p>
              <ul className="mt-1 space-y-0.5 text-[0.82rem] text-ink-2">
                {hq.lines.map((l) => (
                  <li key={l.key} className="flex gap-2">
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{l.label}</span>
                    <b className="num shrink-0">{l.n}</b>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-0.5 text-ink-3">오늘은 보낼 내용이 없습니다.</p>
          )}
        </div>
        <div className={cx("rounded-xl border border-line bg-surface-2 px-3.5 py-2.5", !on && "opacity-55")} data-testid="brief-preview-field">
          <p className="text-[0.76rem] font-bold text-ink-3">현장 직원 (본인 할 일만){!on && " · 보내지 않음"}</p>
          {field.length ? (
            <ul className="mt-1 space-y-1">
              {field.map((f) => (
                <li key={f.userId} className="text-[0.82rem]" data-testid="brief-field-row">
                  <b>{f.name}</b> · {f.title}
                  <span className="block text-ink-2 [overflow-wrap:anywhere]">{f.body}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-0.5 text-ink-3">오늘 받을 현장 직원이 없습니다 (새 지시·기한 작업지시·보완 요청 없음).</p>
          )}
        </div>
      </div>
    </Card>
  );
}
