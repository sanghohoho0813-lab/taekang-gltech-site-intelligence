"use client";

/**
 * v4.1 Device View — [PC] [Mobile] [PC+Mobile]
 * - Mobile/PC+Mobile: 같은 앱·같은 Route를 실제 390px iframe으로 렌더 (?frame=mobile)
 * - Parent ↔ Frame Route 양방향 동기화 (postMessage, origin·source 검증, echo·loop 방지)
 * - Frame 안에서는 Device View/Demo Bar/Tour를 만들지 않는다 (재귀 Preview 금지)
 * - 데이터·Theme·Role은 같은 Origin localStorage + BroadcastChannel로 공유
 */
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Smartphone, Link2 } from "lucide-react";
import { isFrameContext, setPrefs, usePrefs } from "@/lib/data/store";
import { ROLE_LABEL } from "@/lib/domain/labels";
import type { RoleId } from "@/lib/domain/types";
import { AppShell } from "@/components/shell/AppShell";
import { DemoBar } from "./DemoBar";
import { cx } from "@/components/ui/primitives";
import { TourLayer } from "@/components/tour/Tour";
import { IS_LIVE } from "@/lib/mode";
import { CMD_MSG, FRAME_CMDS, deliverFrameCmd, type FrameCmd } from "./frameCommands";

const MSG = "tk:route";
const AT_MSG = "tk:at";

function useIsDesktop() {
  const [v, setV] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    // 인쇄 중에는 용지 폭 때문에 화면 모드를 바꾸지 않는다 (재마운트되면 보고서가 빈 페이지로 인쇄됨)
    const on = () => {
      if (!window.matchMedia("print").matches) setV(mq.matches);
    };
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return v;
}

export function DeviceStage({ children }: { children: ReactNode }) {
  // 실제 운영(LIVE): 시연용 화면 모드·데모 바·시연 안내 없이 앱만
  if (IS_LIVE) return <AppShell compactSidebar={false}>{children}</AppShell>;
  return <DemoStage>{children}</DemoStage>;
}

function DemoStage({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [frame, setFrame] = useState(false);
  const isDesktop = useIsDesktop();
  const prefs = usePrefs();
  useEffect(() => {
    setFrame(isFrameContext());
    setMounted(true);
  }, []);

  if (mounted && frame) {
    return (
      <>
        <FrameBridge />
        <AppShell compactSidebar={false}>{children}</AppShell>
      </>
    );
  }

  const mode = mounted && isDesktop ? prefs.deviceView : "pc";
  return (
    <>
      <DemoBar active={mounted && isDesktop} />
      {mode === "pc" && <AppShell compactSidebar={false}>{children}</AppShell>}
      {mode === "mobile" && <PhoneStage mode="mobile" />}
      {mode === "dual" && (
        <div className="flex w-full min-w-0" data-testid="dual-view">
          <div className="pc-pane min-w-0 flex-1 overflow-x-clip" style={{ contain: "layout paint" }}>
            <AppShell compactSidebar>{children}</AppShell>
          </div>
          <PhoneStage mode="dual" />
        </div>
      )}
      {mounted && <TourLayer />}
    </>
  );
}

/** iframe 안: 자신의 Route 변화를 부모에 알리고, 부모가 보낸 Route로 이동 */
function FrameBridge() {
  const pathname = usePathname();
  const router = useRouter();
  const fromParent = useRef<string | null>(null);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    if (fromParent.current === pathname) {
      fromParent.current = null;
      // 부모가 보낸 이동 완료를 알림 (부모는 다시 이동하지 않고 표시만 갱신)
      window.parent.postMessage({ type: AT_MSG, path: pathname }, window.location.origin);
      return;
    }
    window.parent.postMessage({ type: MSG, path: pathname }, window.location.origin);
  }, [pathname]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const d = e.data as { type?: string; path?: string; cmd?: string };
      if (d?.type === CMD_MSG) {
        if (FRAME_CMDS.includes(d.cmd as FrameCmd)) deliverFrameCmd(d.cmd as FrameCmd);
        return;
      }
      if (d?.type !== MSG || typeof d.path !== "string" || !d.path.startsWith("/")) return;
      if (d.path === pathRef.current) return;
      fromParent.current = d.path;
      router.push(d.path);
    };
    window.addEventListener("message", onMsg);
    window.parent.postMessage({ type: "tk:ready", path: pathRef.current }, window.location.origin);
    return () => window.removeEventListener("message", onMsg);
  }, [router]);
  return null;
}

const PERSONAS: ("same" | RoleId)[] = ["same", "field", "manager", "ceo", "partner"];

function PhoneStage({ mode }: { mode: "mobile" | "dual" }) {
  const pathname = usePathname();
  const router = useRouter();
  const prefs = usePrefs();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const framePath = useRef<string | null>(null);
  const fromFrame = useRef<string | null>(null);
  // iframe src는 최초 1회만 결정 (이후 Route 이동은 postMessage로 — 새로고침 없이 상태 유지)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const src = useMemo(() => `${pathname}?frame=mobile`, [mode]);
  const [shownPath, setShownPath] = useState(pathname);

  const postToFrame = useCallback((path: string) => {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    w.postMessage({ type: MSG, path }, window.location.origin);
  }, []);

  // 부모(PC) Route 변화 → Frame
  useEffect(() => {
    if (fromFrame.current === pathname) {
      fromFrame.current = null;
      return;
    }
    if (framePath.current && framePath.current !== pathname) postToFrame(pathname);
  }, [pathname, postToFrame]);

  // Frame Route 변화 → 부모(PC)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const d = e.data as { type?: string; path?: string };
      if (typeof d?.path !== "string" || !d.path.startsWith("/")) return;
      if (d.type === AT_MSG) {
        framePath.current = d.path;
        setShownPath(d.path);
        return;
      }
      if (d.type === "tk:ready") {
        framePath.current = d.path;
        setShownPath(d.path);
        if (d.path !== window.location.pathname) postToFrame(window.location.pathname);
        return;
      }
      if (d.type !== MSG) return;
      framePath.current = d.path;
      setShownPath(d.path);
      if (d.path !== window.location.pathname) {
        fromFrame.current = d.path;
        router.push(d.path);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [router, postToFrame]);

  return (
    <aside
      className={cx(
        "only-top no-print flex flex-col items-center",
        mode === "dual"
          ? "sticky top-[var(--demo-bar-h)] h-[calc(100dvh-var(--demo-bar-h))] w-[max(33%,27rem)] shrink-0 border-l border-line bg-[#E9EBEF] px-3 pt-3"
          : "h-[calc(100dvh-var(--demo-bar-h))] w-full bg-[radial-gradient(ellipse_at_top,#F7F8FA,#E3E6EB)] px-4 pt-4",
      )}
      aria-label="모바일 화면 미리보기 (실제 390px)"
    >
      <div className="mb-2 flex w-[410px] max-w-full shrink-0 items-center justify-between gap-2 text-[0.72rem] text-ink-2">
        <span className="inline-flex items-center gap-1.5 font-bold">
          <Smartphone size={15} aria-hidden /> <span className="whitespace-nowrap">Mobile 390</span>
        </span>
        <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-surface px-2 py-0.5 font-semibold text-ink-3" title="PC와 같은 Route·같은 데이터">
          <Link2 size={13} aria-hidden /> <span className="num truncate max-w-[8rem]">{shownPath}</span>
        </span>
        {mode === "dual" && (
          <label className="inline-flex items-center gap-1">
            <span className="whitespace-nowrap font-semibold">역할</span>
            <select
              value={prefs.mobilePersona}
              onChange={(e) => setPrefs({ mobilePersona: e.target.value as "same" | RoleId })}
              className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[0.75rem] font-semibold"
              data-testid="mobile-persona"
            >
              {PERSONAS.map((p) => (
                <option key={p} value={p}>
                  {p === "same" ? "PC와 동일" : ROLE_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex min-h-0 w-full flex-1 justify-center pb-3">
        <PhoneFrame>
          <iframe ref={iframeRef} key={mode} src={src} title="모바일 화면 (같은 앱·같은 데이터)" className="device-frame-iframe min-h-0 flex-1" data-testid="device-frame" />
        </PhoneFrame>
      </div>
      {mode === "mobile" && (
        <p className="mb-3 max-w-[410px] shrink-0 text-center text-[0.74rem] text-ink-3">
          스크린샷이 아닌 실제 앱입니다. 모바일에서 이동한 화면은 PC 주소와 동기화되며, 데이터는 같은 저장소를 사용합니다.
        </p>
      )}
    </aside>
  );
}

function PhoneFrame({ children }: { children: ReactNode }) {
  const [time, setTime] = useState("");
  useEffect(() => {
    const f = () => setTime(new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()));
    f();
    const t = setInterval(f, 15000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex h-full max-h-[892px] flex-col rounded-[46px] bg-[#101216] p-[10px] shadow-[0_24px_60px_-20px_rgba(16,24,40,0.45)] ring-1 ring-black/40">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[36px] bg-white">
        <div className="flex h-7 shrink-0 items-center justify-between bg-white px-6 text-[11px] font-semibold text-[#111]" aria-hidden>
          <span className="num">{time}</span>
          <span className="h-[18px] w-[86px] rounded-full bg-[#101216]" />
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-4 rounded-sm border border-[#111]" />
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
