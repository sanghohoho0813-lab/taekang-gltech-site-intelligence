"use client";

/**
 * Guided Presentation / Tutorial — 실제 Route를 자동 이동하며 대상 요소에 강조선을 표시하는 비차단형 코치 패널.
 * 전체 화면 Backdrop을 쓰지 않으므로 Overlay 잔존·클릭 차단(P0) 위험이 없고, PC+Mobile 시연 중 모바일 조작이 가능하다.
 */
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X, Presentation, Minus, Maximize2, CircleCheck, Hourglass, MousePointerClick, Loader2 } from "lucide-react";
import { getPrefs, resetDemo, setPrefs, useDb, usePrefs, type DeviceView } from "@/lib/data/store";
import { useToast } from "@/components/ui/Toast";
import type { RoleId } from "@/lib/domain/types";
import { siteFinancials } from "@/lib/domain/calc";
import { fmtEok, fmtMan, fmtPct, fmtPp } from "@/lib/domain/format";
import { Button, cx } from "@/components/ui/primitives";
import { sendFrameCmd, type FrameCmd } from "@/components/device/frameCommands";

export interface TourStep {
  route: string;
  target?: string; // data-tour 값
  title: string;
  body: ReactNode;
  device?: DeviceView;
  persona?: "same" | RoleId;
  role?: RoleId;
  /** 시연 페이지 목록에 표시: 각 화면이 무엇을 보여주는지 */
  pc?: string;
  mobile?: string;
  /** 모바일 Frame 화면 명령 (입력 시트 열기/닫기) */
  frameCmd?: FrameCmd;
  /** 실제 데이터로 계산한 결과를 안내 바에 한 줄로 표시 */
  live?: "profit-delta";
  /** 안내 바의 원클릭 실행 버튼 흐름 (화면의 실제 버튼을 순서대로 눌러 준다) */
  flow?: "report" | "action";
}

export type TourId = "presentation" | "tutorial";

/** 시연 기준 현장 (DEMO_SCRIPT의 가상 현장 A) */
const DEMO_SITE = "site-a";

export const TOURS: Record<TourId, { name: string; steps: TourStep[] }> = {
  presentation: {
    name: "대표자 시연",
    steps: [
      {
        route: "/dashboard",
        target: "kpi-strip",
        device: "dual",
        persona: "same",
        role: "ceo",
        pc: "대표 대시보드",
        mobile: "대표 휴대폰",
        title: "① 대표 대시보드",
        body: "PC와 대표님 휴대폰에 같은 숫자가 보입니다.",
      },
      {
        route: `/sites/${DEMO_SITE}`,
        target: "profit-engine",
        device: "dual",
        persona: "same",
        pc: "A현장 손익",
        mobile: "대표 휴대폰",
        title: "② A현장 손익",
        body: "계약 10억 · 예상원가 8.5억 → 예상이익 1.5억 (15%)",
      },
      {
        route: `/sites/${DEMO_SITE}`,
        target: "device-frame",
        device: "dual",
        persona: "field",
        frameCmd: "open-report",
        flow: "report",
        pc: "A현장 손익",
        mobile: "현장소장 휴대폰 · 비용 입력",
        title: "③ 현장소장 휴대폰 — 비용 입력",
        body: "설계변경 추가 비용 4,000만 원을 휴대폰으로 보고합니다.",
      },
      {
        route: `/sites/${DEMO_SITE}`,
        target: "profit-engine",
        device: "dual",
        persona: "same",
        frameCmd: "close-report",
        live: "profit-delta",
        pc: "A현장 손익 (재계산)",
        mobile: "대표 휴대폰 · 바뀐 손익",
        title: "④ PC·휴대폰 손익 동시 재계산",
        body: "저장 즉시 같은 데이터로 다시 계산됩니다.",
      },
      {
        route: "/insights",
        target: "signal-board",
        device: "dual",
        persona: "field",
        role: "manager",
        flow: "action",
        pc: "위험·조치 (본사 공무과장)",
        mobile: "현장소장 휴대폰 · 내 조치",
        title: "⑤ 본사 배정 → 현장 처리 → 본사 확인",
        body: "위험이 감지되면 본사가 배정하고, 소장이 휴대폰으로 처리합니다.",
      },
      {
        route: "/report",
        target: "report-summary",
        device: "dual",
        persona: "same",
        role: "ceo",
        pc: "대표자 보고서",
        mobile: "대표 휴대폰",
        title: "⑥ 대표자 보고서",
        body: "변경 전후 손익과 조치 결과가 자동 정리됩니다.",
      },
    ],
  },
  tutorial: {
    name: "처음 사용 안내",
    steps: [
      { route: "/dashboard", target: "sidebar", title: "1. 메뉴는 4개 그룹", body: "운영 · 고객·정산 · AX·성과 · 관리. 같은 그룹은 같은 색 아이콘을 씁니다." },
      { route: "/dashboard", target: "kpi-strip", title: "2. 숫자를 누르면 상세로", body: "KPI와 현장 행을 누르면 현장별 손익·원가·공정 상세로 이동합니다." },
      { route: "/dashboard", target: "device-switch", title: "3. PC · Mobile · PC+Mobile", body: "같은 화면·같은 데이터를 실제 390px 모바일로 보거나 PC와 나란히 비교할 수 있습니다." },
      { route: "/settings", target: "theme-picker", title: "4. 설정", body: "테마 7종, 글자 크기, 역할(권한 프리뷰), 데모 초기화, CSV 가져오기를 여기서 합니다." },
    ],
  },
};

interface TourCtx {
  active: boolean;
  tourId: TourId | null;
  step: number;
  start: (id: TourId) => void;
  stop: () => void;
  next: () => void;
  back: () => void;
}

const Ctx = createContext<TourCtx>({ active: false, tourId: null, step: 0, start: () => {}, stop: () => {}, next: () => {}, back: () => {} });
export const useTour = () => useContext(Ctx);

const SS_KEY = "tk-site-intel:tour";

export function TourProvider({ children }: { children: ReactNode }) {
  const [tourId, setTourId] = useState<TourId | null>(null);
  const [step, setStep] = useState(0);
  const toast = useToast();

  useEffect(() => {
    try {
      const s = sessionStorage.getItem(SS_KEY);
      if (s) {
        const v = JSON.parse(s) as { tourId: TourId; step: number };
        if (v.tourId && TOURS[v.tourId]) {
          setTourId(v.tourId);
          setStep(v.step);
        }
      }
    } catch {
      // 무시
    }
  }, []);
  useEffect(() => {
    try {
      if (tourId) sessionStorage.setItem(SS_KEY, JSON.stringify({ tourId, step }));
      else sessionStorage.removeItem(SS_KEY);
    } catch {
      // 무시
    }
  }, [tourId, step]);

  const stop = useCallback(() => {
    setTourId((id) => {
      if (id === "tutorial") setPrefs({ tutorialDone: true });
      // 시연 종료 시 대표자 화면 · 휴대폰 'PC와 동일'로 되돌린다
      if (id === "presentation") {
        const p = getPrefs();
        if (p.mobilePersona !== "same" || p.role !== "ceo") setPrefs({ mobilePersona: "same", role: "ceo" });
      }
      return null;
    });
    setStep(0);
  }, []);
  const value = useMemo<TourCtx>(
    () => ({
      active: !!tourId,
      tourId,
      step,
      start: (id) => {
        // 시연을 켤 때마다 이전 시연 데이터와 관계없이 처음 상태에서 시작
        if (id === "presentation") {
          resetDemo();
          clearDrafts();
          setPrefs({ role: "ceo", mobilePersona: "same" });
          toast.push({ tone: "ok", title: "처음 상태로 초기화하고 시연을 시작합니다", desc: "A현장 10억 · 8.5억 · 1.5억 · 15%" });
        }
        setTourId(id);
        setStep(0);
      },
      stop,
      next: () => {
        if (!tourId) return;
        if (step >= TOURS[tourId].steps.length - 1) stop();
        else setStep(step + 1);
      },
      back: () => setStep((s) => Math.max(0, s - 1)),
    }),
    [tourId, step, stop, toast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 현장 보고 임시저장도 함께 지운다 (이전 시연에서 남은 입력값이 다시 뜨지 않게) */
function clearDrafts() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("tk-site-intel:draft:")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // 무시
  }
}

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

/* ── 원클릭 실행: 안내 바의 버튼이 화면의 '실제 버튼'을 순서대로 눌러 준다 (같은 데이터 경로 · 직접 눌러도 됨) ── */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frameDoc = () => document.querySelector<HTMLIFrameElement>('[data-testid="device-frame"]')?.contentDocument ?? null;
async function clickWhen(find: () => HTMLElement | null, timeout = 4000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const el = find();
    if (el && !(el as HTMLButtonElement).disabled) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      await sleep(350);
      el.click();
      return true;
    }
    await sleep(120);
  }
  return false;
}
const inFrame = (sel: string) => () => frameDoc()?.querySelector<HTMLElement>(sel) ?? null;
const inPage = (sel: string) => () => document.querySelector<HTMLElement>(sel);

interface FlowAction {
  key: string;
  label: string;
  where: "PC" | "휴대폰";
  run: () => Promise<boolean>;
}
interface FlowState {
  actionId?: string;
  stages?: { label: string; done: boolean }[];
  action?: FlowAction;
  doneText?: string;
}

/** 현재 데이터·화면 상태로 '다음에 누를 버튼' 결정 */
function useFlow(flow: TourStep["flow"]): FlowState {
  const db = useDb();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!flow) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 500);
    return () => window.clearInterval(t);
  }, [flow]);
  void tick;
  if (!flow || !db || !db.sites.some((x) => x.id === DEMO_SITE)) return {};
  const base = db.baseline[DEMO_SITE];
  const added = base ? siteFinancials(db, DEMO_SITE).eac - base.eac : 0;

  if (flow === "report") {
    if (Math.abs(added) >= 1) return { doneText: `휴대폰 보고 저장 완료 — A현장 예상원가 +${fmtMan(added)} 반영` };
    const doc = frameDoc();
    const filled = !!doc?.querySelector<HTMLTextAreaElement>("#f-work")?.value && !!doc?.querySelector("#c-amt-0");
    if (filled) {
      return { action: { key: "submit", label: "보고 등록", where: "휴대폰", run: () => clickWhen(inFrame('[data-testid="submit-report"]')) } };
    }
    return {
      action: {
        key: "fill",
        label: "비용 입력 (데모 값)",
        where: "휴대폰",
        run: async () => {
          if (!frameDoc()?.querySelector('[data-testid="fill-demo"]')) sendFrameCmd("open-report");
          return clickWhen(inFrame('[data-testid="fill-demo"]'));
        },
      },
    };
  }

  // action: 본사 배정 → 현장 진행 → 현장 완료 → 본사 확인
  const a = db.actions.filter((x) => x.siteId === DEMO_SITE).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
  const proof = a ? db.proofEvents.find((p) => p.proof_event_id === a.proofEventId) : undefined;
  const lv = !a ? 0 : proof?.status === "confirmed" ? 4 : a.status === "done" ? 3 : a.status === "in_progress" ? 2 : 1;
  const stages = ["본사 배정", "현장 진행", "현장 완료", "본사 확인"].map((label, i) => ({ label, done: lv > i }));
  if (lv === 0) {
    return {
      stages,
      action: {
        key: "assign",
        label: "조치 배정",
        where: "PC",
        run: async () => {
          if (!(await clickWhen(inPage('[data-testid="signal-board"] [data-rule="UNBILLED_CHANGE"] [data-testid="create-action"]')))) return false;
          await sleep(700);
          return clickWhen(inPage('[data-testid="assign-confirm"]'));
        },
      },
    };
  }
  const card = `[data-action-id="${a.id}"]`;
  const actionId = a.id;
  if (lv === 1) return { actionId, stages, action: { key: "start", label: "진행 시작", where: "휴대폰", run: () => clickWhen(inFrame(`${card} [data-testid="action-start"]`)) } };
  if (lv === 2) {
    return {
      actionId,
      stages,
      action: {
        key: "complete",
        label: "완료 처리",
        where: "휴대폰",
        run: async () => {
          if (!(await clickWhen(inFrame(`${card} [data-testid="action-complete"]`)))) return false;
          if (!(await clickWhen(inFrame('[data-testid="fill-result"]')))) return false;
          await sleep(700);
          return clickWhen(inFrame('[data-testid="complete-confirm"]'));
        },
      },
    };
  }
  if (lv === 3) return { actionId, stages, action: { key: "confirm", label: "결과 확인", where: "PC", run: () => clickWhen(inPage(`[data-testid="action-board"] ${card} [data-testid="proof-confirm"]`)) } };
  return { actionId, stages, doneText: "결과 확인 완료 — 조치 기록이 보고서에 반영됩니다" };
}

/** 부모(최상위) 화면에서만 렌더링 — Frame 안에서는 생성하지 않는다 */
export function TourLayer() {
  const { active, tourId, step, next, back, stop } = useTour();
  const router = useRouter();
  const pathname = usePathname();
  const prefs = usePrefs();
  const desktop = useIsDesktop();
  const highlighted = useRef<Element | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [running, setRunning] = useState(false);
  const s = tourId ? TOURS[tourId].steps[step] : null;
  const flow = useFlow(s?.flow);
  // PC+Mobile: 안내는 PC 영역 하단 자막형 바 — 휴대폰 화면은 절대 가리지 않는다
  const dock = active && desktop && prefs.deviceView === "dual";

  // Step 진입: Device/Role 설정 → Route 이동 → (필요 시) 모바일 화면 명령
  useEffect(() => {
    if (!s) return;
    const p = getPrefs();
    const patch: Parameters<typeof setPrefs>[0] = {};
    if (s.device && window.innerWidth >= 1024 && p.deviceView !== s.device) patch.deviceView = s.device;
    if (s.persona && p.mobilePersona !== s.persona) patch.mobilePersona = s.persona;
    if (s.role && p.role !== s.role) patch.role = s.role;
    if (Object.keys(patch).length) setPrefs(patch);
    if (pathname !== s.route) router.push(s.route);
    const cmd = s.frameCmd;
    // Route 동기화·역할 전환이 Frame에 반영된 뒤 전달 (두 번 보내도 결과는 같음)
    const timers = cmd ? [400, 1200].map((ms) => window.setTimeout(() => sendFrameCmd(cmd), ms)) : [];
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId, step]);

  // 하단 안내 바가 있을 때 PC 화면 끝 여백·알림 위치를 바꾸는 표시
  useEffect(() => {
    const d = document.documentElement;
    if (dock) d.dataset.tour = "dock";
    else delete d.dataset.tour;
    return () => {
      delete d.dataset.tour;
    };
  }, [dock]);

  // 대상 요소 강조 (렌더 대기 후). 이미 다 보이면 스크롤하지 않는다
  useEffect(() => {
    if (!s?.target) return;
    let tries = 0;
    let cancelled = false;
    const clear = () => {
      highlighted.current?.classList.remove("tour-target");
      highlighted.current = null;
    };
    const find = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour="${s.target}"], [data-testid="${s.target}"]`);
      if (el) {
        clear();
        el.classList.add("tour-target");
        highlighted.current = el;
        const r = el.getBoundingClientRect();
        const bottomLimit = window.innerHeight - (panelRef.current?.offsetHeight ?? 0) - 8;
        const visible = r.top >= 0 && r.bottom <= bottomLimit;
        if (!visible) el.scrollIntoView({ block: "center", behavior: document.documentElement.dataset.motion === "reduce" ? "auto" : "smooth" });
      } else if (tries++ < 40) setTimeout(find, 100);
    };
    find();
    return () => {
      cancelled = true;
      clear();
    };
  }, [s, pathname]);

  // 종료 시 강조 완전 제거 + 포커스 복구
  useEffect(() => {
    if (active) {
      panelRef.current?.focus();
      return;
    }
    setCollapsed(false);
    document.querySelectorAll(".tour-target").forEach((el) => el.classList.remove("tour-target"));
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, stop]);

  if (!s || !tourId) return null;
  const total = TOURS[tourId].steps.length;
  const label = `${TOURS[tourId].name} ${step + 1}/${total}`;
  const shortTitle = s.title.replace(/^[①-⑥]\s*/, "");
  const act = flow.action;
  const runAct = async () => {
    if (!act || running) return;
    setRunning(true);
    try {
      await act.run();
    } finally {
      setRunning(false);
    }
  };
  // 실행할 동작이 있으면 그 버튼이 주 버튼, 없으면 '다음'이 주 버튼
  const primary = act ? (
    <Button variant="cta" onClick={runAct} disabled={running} icon={running ? <Loader2 size={17} className="animate-spin" /> : <MousePointerClick size={17} />} data-testid="tour-action" data-action={act.key}>
      <span className="text-[0.72rem] font-semibold opacity-85">{act.where}</span> {act.label}
    </Button>
  ) : (
    <Button variant="cta" onClick={next} data-testid="tour-next">
      {step === total - 1 ? (tourId === "presentation" ? "시연 끝" : "완료") : "다음"} {step < total - 1 && <ChevronRight size={17} />}
    </Button>
  );
  const secondaryNext = act && (
    <Button size="sm" variant="ghost" onClick={next} data-testid="tour-next">
      다음 <ChevronRight size={15} />
    </Button>
  );
  const backBtn = (
    <Button size="sm" variant="ghost" onClick={back} disabled={step === 0} icon={<ChevronLeft size={15} />}>
      이전
    </Button>
  );
  const progress = (
    <div className="flex w-24 shrink-0 gap-1" aria-hidden>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-active" : "bg-surface-3"}`} />
      ))}
    </div>
  );
  const iconBtn = "press grid size-9 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-3";
  const collapseBtn = (
    <button type="button" onClick={() => setCollapsed(true)} className={iconBtn} aria-label="안내 접기" data-testid="tour-collapse">
      <Minus size={18} />
    </button>
  );
  const exitBtn = (
    <button type="button" onClick={stop} className={iconBtn} aria-label="시연 종료" data-testid="tour-exit">
      <X size={18} />
    </button>
  );
  const status = (
    <>
      {flow.stages && (
        <span className="flex flex-wrap items-center gap-1.5 text-[0.75rem] font-semibold" data-testid="tour-stages">
          {flow.stages.map((g, i) => (
            <span key={g.label} className="inline-flex items-center gap-1">
              {i > 0 && <span className="text-ink-3">→</span>}
              <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5", g.done ? "bg-ok-bg text-ok" : "bg-surface-3 text-ink-3")}>
                {g.done && <CircleCheck size={13} aria-hidden />} {g.label}
              </span>
            </span>
          ))}
        </span>
      )}
      {flow.doneText && (
        <span className="inline-flex items-center gap-1 rounded-lg bg-ok-bg px-2 py-0.5 text-[0.78rem] font-semibold text-ok" data-testid="tour-live" data-state="done" role="status">
          <CircleCheck size={14} aria-hidden /> {flow.doneText}
        </span>
      )}
      {s.live && <LiveStatus onBack={back} />}
      {flow.action?.key === "confirm" && flow.actionId && <FocusActionCard actionId={flow.actionId} />}
    </>
  );
  const common = { ref: panelRef, tabIndex: -1, role: "dialog", "aria-modal": false, "aria-label": label, "data-testid": "tour-panel" } as const;

  if (dock) {
    return (
      <div
        {...common}
        data-layout="dock"
        data-collapsed={collapsed ? "1" : undefined}
        className="no-print fixed bottom-0 z-[90] border-t border-line bg-surface shadow-[0_-14px_34px_-18px_rgba(16,24,40,0.4)] outline-none anim-fade-up"
        style={{ left: "4.6rem", right: "max(33vw, 27rem)" }}
      >
        {collapsed ? (
          <div className="flex items-center gap-2 px-5 py-2.5">
            <Presentation size={15} className="shrink-0 text-theme-ink" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-ink">
              {step + 1}/{total} · {shortTitle}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(false)} icon={<Maximize2 size={15} />} data-testid="tour-expand">
              펼치기
            </Button>
            {primary}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
            <div className="min-w-[19rem] flex-1">
              <div className="flex items-center gap-2.5">
                {progress}
                <span className="shrink-0 text-[0.72rem] font-bold text-theme-ink">
                  {step + 1}/{total}
                </span>
                <h2 className="min-w-0 text-[1.02rem] font-bold leading-snug text-ink">{shortTitle}</h2>
              </div>
              <p className="mt-1 text-[0.84rem] text-ink-2">{s.body}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 empty:hidden">{status}</div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {backBtn}
              {secondaryNext}
              {primary}
              {collapseBtn}
              {exitBtn}
            </div>
          </div>
        )}
      </div>
    );
  }

  // PC 단독 / 1024px 미만: 떠 있는 안내 카드
  if (collapsed) {
    return (
      <div {...common} data-collapsed="1" className="no-print fixed bottom-[calc(5.6rem+env(safe-area-inset-bottom))] left-4 z-[90] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-2xl border border-line bg-surface py-2 pl-3 pr-2 shadow-pop outline-none anim-pop lg:bottom-6 lg:left-[17.5rem]">
        <Presentation size={15} className="shrink-0 text-theme-ink" aria-hidden />
        <span className="min-w-0 truncate text-[0.8rem] font-bold text-ink">
          {step + 1}/{total} · {shortTitle}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setCollapsed(false)} icon={<Maximize2 size={15} />} data-testid="tour-expand">
          펼치기
        </Button>
        {primary}
      </div>
    );
  }
  return (
    <div {...common} className="no-print fixed bottom-[calc(5.6rem+env(safe-area-inset-bottom))] left-4 z-[90] max-h-[calc(100dvh-11rem)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-pop outline-none anim-pop lg:bottom-6 lg:left-[17.5rem]">
      <div className="flex items-center gap-2">
        {progress}
        <span className="text-[0.72rem] font-bold text-theme-ink">
          {step + 1}/{total}
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          {collapseBtn}
          {exitBtn}
        </span>
      </div>
      <h2 className="mt-2 text-[1.02rem] font-bold text-ink">{shortTitle}</h2>
      {!desktop && tourId === "presentation" && (
        <p className="mt-1.5 rounded-lg bg-info-bg px-2.5 py-1.5 text-[0.75rem] font-semibold text-info" data-testid="tour-small-note">
          PC와 휴대폰을 나란히 보려면 노트북(1280px 이상)에서 진행하세요.
        </p>
      )}
      <p className="mt-1 text-[0.86rem] text-ink-2">{s.body}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">{status}</div>
      <div className="mt-3 flex items-center justify-between gap-2">
        {backBtn}
        <div className="flex items-center gap-1.5">
          {secondaryNext}
          {primary}
        </div>
      </div>
    </div>
  );
}

/** ④ 시연 시작 대비 변화 — 저장된 데이터로 계산 (입력 전이면 숫자를 보여주지 않음) */
function LiveStatus({ onBack }: { onBack: () => void }) {
  const db = useDb();
  if (!db || !db.sites.some((x) => x.id === DEMO_SITE)) return null;
  const base = db.baseline[DEMO_SITE];
  if (!base) return null;
  const f = siteFinancials(db, DEMO_SITE);
  const added = f.eac - base.eac;
  if (Math.abs(added) < 1) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-warn-bg px-2 py-0.5 text-[0.78rem] font-semibold text-warn" data-testid="tour-live" data-state="waiting" role="status">
        <Hourglass size={14} aria-hidden /> 아직 입력 전입니다 —{" "}
        <button type="button" onClick={onBack} className="font-bold underline underline-offset-2">
          이전 단계
        </button>
      </span>
    );
  }
  const items: [string, string, string, string][] = [
    ["예상원가", fmtEok(base.eac, { unit: false }), fmtEok(f.eac, { unit: false }), `+${fmtMan(added, { unit: false })}`],
    ["예상이익", fmtEok(base.expectedProfit, { unit: false }), fmtEok(f.expectedProfit, { unit: false }), `${f.expectedProfit >= base.expectedProfit ? "+" : "−"}${fmtMan(Math.abs(f.expectedProfit - base.expectedProfit), { unit: false })}`],
    ["이익률", fmtPct(base.marginPct), fmtPct(f.marginPct), fmtPp(f.marginPct - base.marginPct)],
  ];
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-[0.84rem]" data-testid="tour-live" data-state="done" role="status">
      {items.map(([k, b, a, d]) => (
        <span key={k} className="whitespace-nowrap num">
          <span className="text-ink-3">{k}</span> {b} → <b className="text-ink">{a}</b> <b className="text-err">({d})</b>
        </span>
      ))}
    </span>
  );
}

/** 현장 완료 직후: PC 화면을 해당 조치 카드로 옮기고 강조 (결과 확인 버튼을 찾지 않아도 되게) */
function FocusActionCard({ actionId }: { actionId: string }) {
  useEffect(() => {
    if (!actionId) return;
    let el: Element | null = null;
    const t = window.setTimeout(() => {
      el = document.querySelector(`[data-testid="action-board"] [data-action-id="${actionId}"]`);
      if (!el) return;
      el.classList.add("tour-target");
      el.scrollIntoView({ block: "center", behavior: document.documentElement.dataset.motion === "reduce" ? "auto" : "smooth" });
    }, 300);
    return () => {
      window.clearTimeout(t);
      el?.classList.remove("tour-target");
    };
  }, [actionId]);
  return null;
}
