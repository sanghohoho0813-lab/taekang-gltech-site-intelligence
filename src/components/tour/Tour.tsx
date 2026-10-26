"use client";

/**
 * Guided Presentation / Tutorial — 실제 Route를 자동 이동하며 대상 요소에 강조선을 표시하는 비차단형 코치 패널.
 * 전체 화면 Backdrop을 쓰지 않으므로 Overlay 잔존·클릭 차단(P0) 위험이 없고, PC+Mobile 시연 중 모바일 조작이 가능하다.
 */
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X, Presentation, Minus, Maximize2, Monitor, Smartphone, CircleCheck, Hourglass } from "lucide-react";
import { getPrefs, setPrefs, useDb, usePrefs, type DeviceView } from "@/lib/data/store";
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
  /** PC+Mobile에서 각 화면이 무엇을 보여주는지 (시연자·참석자 안내용) */
  pc?: string;
  mobile?: string;
  /** 모바일 Frame 화면 명령 (입력 시트 열기/닫기 — 저장은 사람이 직접) */
  frameCmd?: FrameCmd;
  /** 실제 데이터로 계산한 진행 상태를 안내 패널에 표시 */
  live?: "report-status" | "profit-delta" | "action-status";
}

export type TourId = "presentation" | "tutorial";

/** 시연 기준 현장 (DEMO_SCRIPT의 가상 현장 A) */
const DEMO_SITE = "site-a";

export const TOURS: Record<TourId, { name: string; steps: TourStep[] }> = {
  presentation: {
    name: "대표자 시연 (3~4분)",
    steps: [
      {
        route: "/dashboard",
        target: "kpi-strip",
        device: "dual",
        persona: "same",
        role: "ceo",
        pc: "대표 대시보드",
        mobile: "대표 휴대폰 · 같은 대시보드",
        title: "① 대표 대시보드 — PC와 휴대폰, 같은 숫자",
        body: "가상 현장 3곳의 계약·예상이익·미수금·위험을 한 화면에서 봅니다. 오른쪽은 스크린샷이 아니라 같은 앱을 대표님 휴대폰(390px)으로 연 화면입니다.",
      },
      {
        route: `/sites/${DEMO_SITE}`,
        target: "profit-engine",
        device: "dual",
        persona: "same",
        pc: "A현장 손익",
        mobile: "대표 휴대폰 · A현장 손익",
        title: "② A현장 손익 — 끝날 때 얼마 남나",
        body: "계약 10억 · 총예상원가(EAC) 8.5억(발생 5.1억 + 잔여 3.4억) → 예상이익 1.5억 · 15%. 계산식이 그대로 보이고, 휴대폰에서도 손익이 맨 위에 있습니다.",
      },
      {
        route: `/sites/${DEMO_SITE}`,
        target: "device-frame",
        device: "dual",
        persona: "field",
        frameCmd: "open-report",
        live: "report-status",
        pc: "A현장 손익 (입력 전)",
        mobile: "현장소장 휴대폰 · 현장 보고 입력",
        title: "③ 현장소장 휴대폰 — 원가 입력",
        body: "휴대폰이 현장소장 화면으로 바뀌고 입력 창이 열립니다. ‘데모 값 채우기’(자재 3,000만 + 노무 1,000만) → ‘보고 등록’을 직접 누르세요. 현장 화면에는 이익률이 없습니다.",
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
        title: "④ 저장 즉시 — 대표 PC와 휴대폰이 함께 재계산",
        body: "현장에서 저장한 원가가 같은 데이터로 합산되어 대표님 PC와 휴대폰의 손익이 동시에 바뀝니다. 바꿔 넣은 숫자가 아니라 다시 계산한 결과입니다.",
      },
      {
        route: "/insights",
        target: "signal-board",
        device: "dual",
        persona: "field",
        role: "manager",
        live: "action-status",
        pc: "위험 분석·조치 (본사 공무과장)",
        mobile: "현장소장 휴대폰 · 내 조치",
        title: "⑤ 본사 배정 → 현장 처리 → 본사 확인",
        body: "PC는 본사 공무과장 화면입니다. ‘설계변경’ 카드의 ‘조치 생성·배정’ → 현장소장 휴대폰 ‘내 조치’에 바로 표시 → 휴대폰에서 ‘진행 시작’·‘완료 처리’ → PC에서 ‘결과 확인’. 대표님은 결과만 보고서로 받습니다.",
      },
      {
        route: "/report",
        target: "report-summary",
        device: "dual",
        persona: "same",
        role: "ceo",
        pc: "대표자 보고서",
        mobile: "대표 휴대폰 · 같은 보고서",
        title: "⑥ 대표자 보고서 — 자동 요약",
        body: "변경 전후 손익, 원인이 된 현장 보고, 위험, 조치, Proof Event가 자동 정리되고 휴대폰에서도 같은 보고서를 봅니다. 끝나면 상단 ‘데모 초기화’.",
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
      // 시연 종료 시 모바일 화면 역할을 기본값(PC와 동일)으로 되돌린다
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
    [tourId, step, stop],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
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
  const s = tourId ? TOURS[tourId].steps[step] : null;
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
  const nextBtn = (
    <Button size="sm" variant="cta" onClick={next} data-testid="tour-next">
      {step === total - 1 ? "완료" : "다음"} {step < total - 1 && <ChevronRight size={16} />}
    </Button>
  );
  const backBtn = (
    <Button size="sm" onClick={back} disabled={step === 0} icon={<ChevronLeft size={16} />}>
      이전
    </Button>
  );
  const progress = (
    <div className="flex min-w-[6rem] flex-1 gap-1" aria-hidden>
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
  const screens = (s.pc || s.mobile) && (
    <span className="inline-flex flex-wrap gap-1.5 text-[0.72rem] font-semibold" data-testid="tour-screens">
      {s.pc && (
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-ink-2">
          <Monitor size={12} aria-hidden /> PC · {s.pc}
        </span>
      )}
      {s.mobile && (
        <span className="inline-flex items-center gap-1 rounded-full bg-active-soft px-2 py-0.5 text-theme-ink">
          <Smartphone size={12} aria-hidden /> {s.mobile}
        </span>
      )}
    </span>
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
              시연 {step + 1}/{total} · {shortTitle}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(false)} icon={<Maximize2 size={15} />} data-testid="tour-expand">
              펼치기
            </Button>
            {nextBtn}
          </div>
        ) : (
          <div className="px-5 pb-4 pt-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[0.75rem] font-bold text-theme-ink">
                <Presentation size={15} aria-hidden /> 대표자 시연 · {step + 1}/{total}
              </span>
              <span className="max-w-[12rem] flex-1">{progress}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {backBtn}
                {nextBtn}
                {collapseBtn}
                {exitBtn}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-[1.02rem] font-bold text-ink">{s.title}</h2>
              {screens}
            </div>
            <p className="mt-1 text-[0.84rem] leading-relaxed text-ink-2">{s.body}</p>
            {s.live && <LiveStatus kind={s.live} onBack={back} />}
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
        {nextBtn}
      </div>
    );
  }
  return (
    <div {...common} className="no-print fixed bottom-[calc(5.6rem+env(safe-area-inset-bottom))] left-4 z-[90] max-h-[calc(100dvh-11rem)] w-[min(27rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-pop outline-none anim-pop lg:bottom-6 lg:left-[17.5rem]">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[0.75rem] font-bold text-theme-ink">
          <Presentation size={15} aria-hidden /> {TOURS[tourId].name} · {step + 1}/{total}
        </span>
        <span className="flex items-center gap-0.5">
          {collapseBtn}
          {exitBtn}
        </span>
      </div>
      <div className="mt-2">{progress}</div>
      <h2 className="mt-3 text-[1.02rem] font-bold text-ink">{s.title}</h2>
      {!desktop && tourId === "presentation" && (
        <p className="mt-1.5 rounded-lg bg-info-bg px-2.5 py-1.5 text-[0.75rem] font-semibold text-info" data-testid="tour-small-note">
          이 화면 폭에서는 PC 화면만 안내합니다. PC와 휴대폰을 나란히 보려면 노트북(1280px 이상)에서 진행하세요.
        </p>
      )}
      <p className="mt-1.5 text-[0.86rem] leading-relaxed text-ink-2">{s.body}</p>
      {s.live && <LiveStatus kind={s.live} onBack={back} />}
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={stop}>
          건너뛰기
        </Button>
        <div className="flex gap-2">
          {backBtn}
          {nextBtn}
        </div>
      </div>
    </div>
  );
}

/** 안내 패널의 진행 상태 — 고정 문구가 아니라 저장된 데이터로 매번 계산 */
function LiveStatus({ kind, onBack }: { kind: NonNullable<TourStep["live"]>; onBack: () => void }) {
  const db = useDb();
  if (!db || !db.sites.some((x) => x.id === DEMO_SITE)) return null;
  const base = db.baseline[DEMO_SITE];
  const f = siteFinancials(db, DEMO_SITE);
  const added = base ? f.eac - base.eac : 0;
  const changed = Math.abs(added) >= 1;

  if (kind === "report-status") {
    return changed ? (
      <Live ok testId="tour-live">
        등록 완료 — A현장 총예상원가 {added > 0 ? "+" : "−"}
        {fmtMan(Math.abs(added))} 반영. ‘다음’에서 대표 PC·휴대폰 변화를 봅니다.
      </Live>
    ) : (
      <Live testId="tour-live">모바일 입력 대기 중 — 휴대폰에서 ‘보고 등록’을 누르면 여기에 표시됩니다.</Live>
    );
  }

  if (kind === "profit-delta") {
    if (!base) return null;
    if (!changed) {
      return (
        <Live testId="tour-live">
          아직 반영된 입력이 없습니다.{" "}
          <button type="button" onClick={onBack} className="font-bold underline underline-offset-2">
            이전 단계
          </button>
          에서 휴대폰 입력을 먼저 해주세요.
        </Live>
      );
    }
    const items: [string, string, string, string][] = [
      ["총예상원가", fmtEok(base.eac, { unit: false }), fmtEok(f.eac, { unit: false }), `${added > 0 ? "+" : "−"}${fmtMan(Math.abs(added), { unit: false })}`],
      ["예상이익", fmtEok(base.expectedProfit, { unit: false }), fmtEok(f.expectedProfit, { unit: false }), `${f.expectedProfit >= base.expectedProfit ? "+" : "−"}${fmtMan(Math.abs(f.expectedProfit - base.expectedProfit), { unit: false })}`],
      ["이익률", fmtPct(base.marginPct), fmtPct(f.marginPct), fmtPp(f.marginPct - base.marginPct)],
    ];
    return (
      <div className="mt-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2" data-testid="tour-live" data-state="done" role="status">
        <p className="text-[0.7rem] font-bold text-ink-3">A현장 · 시연 시작 대비 (저장된 데이터로 계산)</p>
        <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.82rem]">
          {items.map(([k, b, a, d]) => (
            <span key={k} className="whitespace-nowrap num">
              <span className="text-ink-3">{k}</span> {b} → <b className="text-ink">{a}</b> <b className="text-err">({d})</b>
            </span>
          ))}
        </p>
      </div>
    );
  }

  // action-status — 본사 배정 → 현장 진행 → 현장 완료 → 본사 결과 확인
  const acts = db.actions.filter((a) => a.siteId === DEMO_SITE).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = acts[0];
  if (!latest) return <Live testId="tour-live">대기 — PC의 ‘설계변경’ 카드에서 ‘조치 생성·배정’을 누르세요.</Live>;
  const proof = db.proofEvents.find((p) => p.proof_event_id === latest.proofEventId);
  if (proof?.status === "confirmed") {
    return (
      <Live ok testId="tour-live" stage="confirmed">
        결과 확인 완료 — 조치 증빙 기록(Proof Event) 확정. ‘다음’에서 대표 보고서로 이동합니다.
      </Live>
    );
  }
  if (latest.status === "done") {
    return (
      <>
        <FocusActionCard actionId={latest.id} />
        <Live ok testId="tour-live" stage="done">
          현장 완료 — 이제 PC 조치 카드에서 ‘결과 확인’을 누르세요 (본사 확인).
        </Live>
      </>
    );
  }
  if (latest.status === "in_progress") {
    return (
      <Live ok testId="tour-live" stage="in_progress">
        현장 진행 중 — 휴대폰에서 ‘완료 처리’ → ‘DEMO 결과 채우기’ → ‘완료 처리’.
      </Live>
    );
  }
  return (
    <Live ok testId="tour-live" stage="assigned">
      배정됨 — 현장소장 휴대폰 ‘내 조치’에 표시. 휴대폰에서 ‘진행 시작’을 누르세요.
    </Live>
  );
}

/** 현장 완료 직후: PC 화면을 해당 조치 카드로 옮기고 강조 (결과 확인 버튼을 찾지 않아도 되게) */
function FocusActionCard({ actionId }: { actionId: string }) {
  useEffect(() => {
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

function Live({ ok, children, testId, stage }: { ok?: boolean; children: ReactNode; testId: string; stage?: string }) {
  return (
    <p
      data-stage={stage}
      className={cx("mt-2.5 flex items-start gap-1.5 rounded-xl px-3 py-2 text-[0.8rem] font-semibold", ok ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn")}
      data-testid={testId}
      data-state={ok ? "done" : "waiting"}
      role="status"
    >
      {ok ? <CircleCheck size={16} className="mt-0.5 shrink-0" aria-hidden /> : <Hourglass size={16} className="mt-0.5 shrink-0 motion-safe:animate-pulse" aria-hidden />}
      <span>{children}</span>
    </p>
  );
}
