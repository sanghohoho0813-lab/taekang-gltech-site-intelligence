"use client";

/** 휴대폰 알림 켜기 — 현장용(큰 글씨)과 본사용(작게) 두 모양. 상태마다 쉬운 말로 안내한다 (D-37) */
import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { IS_LIVE } from "@/lib/mode";
import { disablePush, enablePush, pushState, testPush, type PushState } from "@/lib/browser/push";
import { cx } from "@/components/ui/primitives";

const WHAT = {
  field: "본사 작업지시, 보고 보완 요청, 근태 수정 승인·반려가 오면 휴대폰에 바로 알려드려요.",
  hq: "현장 문제 보고, 추가 비용 보고, 작업지시 완료, 근태 수정 요청, 고객 요청이 오면 알려드려요.",
  partner: "태강지엘텍 회신이 도착하면 알려드려요.",
};

export function PushCard({ size = "easy", audience = "field" }: { size?: "easy" | "compact"; audience?: keyof typeof WHAT }) {
  const [st, setSt] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    pushState(IS_LIVE)
      .then((s) => alive && setSt(s))
      .catch(() => alive && setSt({ kind: "unsupported" }));
    return () => {
      alive = false;
    };
  }, []);
  const big = size === "easy";
  const act = async (fn: () => Promise<PushState | number>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (typeof r === "number") setMsg(r > 0 ? "시험 알림을 보냈어요. 잠시 뒤 휴대폰 위쪽을 확인하세요." : "보낼 휴대폰이 없어요. 알림을 다시 켜 주세요.");
      else {
        setSt(r);
        if (ok && r.kind === "on") setMsg(ok);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "처리하지 못했어요. 다시 눌러 주세요.");
    } finally {
      setBusy(false);
    }
  };
  const btn = cx("press flex w-full items-center justify-center gap-2 rounded-2xl font-extrabold disabled:opacity-60", big ? "min-h-[4rem] text-[1.2rem]" : "min-h-11 text-[0.95rem]");
  const text = big ? "text-[1.08rem]" : "text-[0.86rem]";
  return (
    <section className={cx("space-y-2.5 rounded-2xl border-2 border-line bg-surface", big ? "p-4" : "p-3.5")} data-testid="push-card" data-state={st?.kind ?? "loading"} id="push">
      <h2 className={cx("flex items-center gap-2 font-extrabold", big ? "text-[1.3rem]" : "text-[1rem]")}>
        {st?.kind === "on" ? <BellRing size={big ? 24 : 18} className="text-ok" aria-hidden /> : <Bell size={big ? 24 : 18} aria-hidden />} 휴대폰 알림
      </h2>
      <p className={cx("text-ink-2", text)}>{WHAT[audience]}</p>
      {!st && <p className={cx("text-ink-3", text)}>확인 중…</p>}
      {st?.kind === "demo" && <p className={cx("rounded-xl bg-surface-2 px-3 py-2 text-ink-2", text)}>시연 화면에서는 알림이 오지 않아요. 실제 운영에서 여기서 켭니다.</p>}
      {st?.kind === "unsupported" && <p className={cx("rounded-xl bg-surface-2 px-3 py-2 text-ink-2", text)}>이 브라우저는 알림을 지원하지 않아요. 갤럭시는 ‘크롬’이나 ‘삼성 인터넷’으로 열어 주세요.</p>}
      {st?.kind === "server-off" && <p className={cx("rounded-xl bg-surface-2 px-3 py-2 text-ink-2", text)}>알림이 아직 준비되지 않았어요. 본사에 알려 주세요.</p>}
      {st?.kind === "ios-install" && (
        <ol className={cx("list-decimal space-y-1 rounded-xl bg-surface-2 py-2 pl-8 pr-3 text-ink-2", text)} data-testid="push-ios">
          <li>아이폰은 먼저 홈 화면에 추가해야 알림을 받을 수 있어요.</li>
          <li>사파리 아래 공유 버튼 → ‘홈 화면에 추가’</li>
          <li>홈 화면의 태강 아이콘으로 다시 열고, 여기서 ‘알림 켜기’를 누르세요.</li>
        </ol>
      )}
      {st?.kind === "denied" && (
        <div className={cx("space-y-1 rounded-xl bg-warn-bg px-3 py-2 text-ink-2", text)} data-testid="push-denied">
          <p className="font-bold">알림이 막혀 있어요.</p>
          <p>갤럭시: 크롬 주소창 왼쪽 표시 → 권한 → 알림 → 허용</p>
          <p>아이폰: 설정 → 알림 → 태강 현장 → 알림 허용</p>
          <p>허용한 뒤 이 화면을 다시 여세요.</p>
        </div>
      )}
      {st?.kind === "off" && (
        <button type="button" disabled={busy} onClick={() => act(enablePush, "알림을 켰어요. ‘시험 알림 보내기’로 확인해 보세요.")} className={cx(btn, "bg-solid text-white")} data-testid="push-on">
          <Bell size={big ? 24 : 18} aria-hidden /> {busy ? "켜는 중…" : "알림 켜기"}
        </button>
      )}
      {st?.kind === "on" && (
        <div className="space-y-2">
          <p className={cx("font-bold text-ok", text)} data-testid="push-active">
            ✓ 이 휴대폰으로 알림을 받고 있어요
          </p>
          <div className={cx("grid gap-2", big ? "grid-cols-1" : "grid-cols-2")}>
            <button type="button" disabled={busy} onClick={() => act(testPush)} className={cx(btn, "border-2 border-line-strong bg-surface")} data-testid="push-test">
              <BellRing size={big ? 22 : 16} aria-hidden /> 시험 알림 보내기
            </button>
            <button type="button" disabled={busy} onClick={() => act(disablePush)} className={cx(btn, "border-2 border-line bg-surface text-ink-2")} data-testid="push-off">
              <BellOff size={big ? 22 : 16} aria-hidden /> 알림 끄기
            </button>
          </div>
        </div>
      )}
      {msg && (
        <p className={cx("rounded-xl bg-surface-2 px-3 py-2 font-semibold", text)} role="status" data-testid="push-msg">
          {msg}
        </p>
      )}
    </section>
  );
}

const NUDGE_KEY = "tk-site-intel:push-nudge-hidden";

/** 현장 첫 화면 — 알림이 꺼져 있으면 한 번 권유 (닫으면 다시 안 보임) */
export function PushNudge() {
  const [st, setSt] = useState<PushState | null>(null);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(NUDGE_KEY) === "1");
    } catch {
      setHidden(false);
    }
    pushState(IS_LIVE)
      .then(setSt)
      .catch(() => setSt(null));
  }, []);
  if (hidden || !st || (st.kind !== "off" && st.kind !== "ios-install")) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl border-2 border-active/40 bg-active-soft px-4 py-3" data-testid="push-nudge">
      <Bell size={26} className="shrink-0 text-theme-ink" aria-hidden />
      <a href="/my#push" className="min-w-0 flex-1 text-[1.08rem] font-bold text-ink">
        본사 지시를 휴대폰 알림으로 받으세요 <span className="block text-[0.95rem] font-semibold text-ink-2">눌러서 ‘알림 켜기’</span>
      </a>
      <button
        type="button"
        className="press shrink-0 rounded-xl px-3 py-2 text-[0.95rem] font-bold text-ink-2"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(NUDGE_KEY, "1");
          } catch {
            /* 저장 안 돼도 이번에는 숨김 */
          }
        }}
        data-testid="push-nudge-close"
      >
        닫기
      </button>
    </div>
  );
}
