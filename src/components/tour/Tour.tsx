"use client";

/**
 * Guided Presentation / Tutorial — 실제 Route를 자동 이동하며 대상 요소에 강조선을 표시하는 비차단형 코치 패널.
 * 전체 화면 Backdrop을 쓰지 않으므로 Overlay 잔존·클릭 차단(P0) 위험이 없고, PC+Mobile 시연 중 모바일 조작이 가능하다.
 */
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X, Presentation } from "lucide-react";
import { getPrefs, setPrefs, type DeviceView } from "@/lib/data/store";
import type { RoleId } from "@/lib/domain/types";
import { Button } from "@/components/ui/primitives";

export interface TourStep {
  route: string;
  target?: string; // data-tour 값
  title: string;
  body: ReactNode;
  device?: DeviceView;
  persona?: "same" | RoleId;
  role?: RoleId;
}

export type TourId = "presentation" | "tutorial";

export const TOURS: Record<TourId, { name: string; steps: TourStep[] }> = {
  presentation: {
    name: "대표자 시연 (3~4분)",
    steps: [
      {
        route: "/dashboard",
        target: "kpi-strip",
        device: "pc",
        role: "ceo",
        title: "① 대표 대시보드 — 5초 판단",
        body: "가상 현장 3곳의 계약 규모·예상이익·미수금·위험 알림을 한 화면에서 봅니다. 모든 숫자는 DEMO 데이터이며 원가 데이터로부터 계산됩니다.",
      },
      {
        route: "/sites/site-a",
        target: "profit-engine",
        device: "pc",
        title: "② A현장 손익 엔진",
        body: "계약 10억 · 총예상원가(EAC) 8.5억 = 발생원가 5.1억 + 잔여예상원가 3.4억 → 예상이익 1.5억 · 이익률 15%. 계산식이 화면에 그대로 드러납니다.",
      },
      {
        route: "/sites/site-a",
        target: "device-frame",
        device: "dual",
        persona: "field",
        title: "③ 모바일 현장 원가 입력 (현장직원)",
        body: "오른쪽 모바일 화면 하단의 ‘현장 보고 · 비용 입력’ → ‘데모 값 채우기’ → 자재비 3,000만 + 노무비 1,000만(설계변경) 확인 → ‘보고 등록’을 누르세요. 현장직원 화면에는 이익률이 보이지 않습니다.",
      },
      {
        route: "/sites/site-a",
        target: "profit-engine",
        device: "dual",
        persona: "field",
        title: "④ PC 손익 즉시 재계산",
        body: "저장과 동시에 같은 데이터로 EAC 8.9억 · 예상이익 1.1억 · 이익률 11% · 이익 감소 4,000만 원이 다시 계산됩니다. 숫자 교체 애니메이션이 아니라 합산 결과입니다.",
      },
      {
        route: "/insights",
        target: "signal-board",
        device: "dual",
        persona: "field",
        title: "⑤ 규칙 기반 위험 → 조치 → Proof Event",
        body: "‘이익률 15%→11%’, ‘자재비 예산 초과’, ‘설계변경 청구 검토’가 감지됩니다. ‘추가공사 청구가능성 검토’ 조치를 최현장 소장에게 배정 → 모바일에 즉시 표시 → 진행 중 → 완료하면 Proof Event가 남습니다.",
      },
      {
        route: "/report",
        target: "report-summary",
        device: "pc",
        title: "⑥ 대표자 보고서 (실시간)",
        body: "변경 전후 손익, 관련 현장보고, 위험 분석, 조치 상태, Proof Event가 자동 요약됩니다. 미팅 직전 상단 ‘데모 초기화’로 처음 상태로 되돌릴 수 있습니다.",
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

/** 부모(최상위) 화면에서만 렌더링 — Frame 안에서는 생성하지 않는다 */
export function TourLayer() {
  const { active, tourId, step, next, back, stop } = useTour();
  const router = useRouter();
  const pathname = usePathname();
  const highlighted = useRef<Element | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const s = tourId ? TOURS[tourId].steps[step] : null;

  // Step 진입: Device/Role 설정 → Route 이동
  useEffect(() => {
    if (!s) return;
    const p = getPrefs();
    const patch: Parameters<typeof setPrefs>[0] = {};
    if (s.device && window.innerWidth >= 1024 && p.deviceView !== s.device) patch.deviceView = s.device;
    if (s.persona && p.mobilePersona !== s.persona) patch.mobilePersona = s.persona;
    if (s.role && p.role !== s.role) patch.role = s.role;
    if (Object.keys(patch).length) setPrefs(patch);
    if (pathname !== s.route) router.push(s.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId, step]);

  // 대상 요소 강조 (렌더 대기 후)
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
        el.scrollIntoView({ block: "center", behavior: document.documentElement.dataset.motion === "reduce" ? "auto" : "smooth" });
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
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="no-print fixed bottom-4 left-4 z-[90] w-[min(27rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-4 shadow-pop outline-none anim-pop lg:bottom-6 lg:left-[17.5rem]"
      role="dialog"
      aria-modal="false"
      aria-label={`${TOURS[tourId].name} ${step + 1}/${total}`}
      data-testid="tour-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[0.75rem] font-bold text-theme-ink">
          <Presentation size={15} aria-hidden /> {TOURS[tourId].name} · {step + 1}/{total}
        </span>
        <button type="button" onClick={stop} className="press grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-surface-3" aria-label="시연 종료" data-testid="tour-exit">
          <X size={18} />
        </button>
      </div>
      <div className="mt-2 flex gap-1" aria-hidden>
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-active" : "bg-surface-3"}`} />
        ))}
      </div>
      <h2 className="mt-3 text-[1.02rem] font-bold text-ink">{s.title}</h2>
      <p className="mt-1.5 text-[0.86rem] leading-relaxed text-ink-2">{s.body}</p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={stop}>
          건너뛰기
        </Button>
        <div className="flex gap-2">
          <Button size="sm" onClick={back} disabled={step === 0} icon={<ChevronLeft size={16} />}>
            이전
          </Button>
          <Button size="sm" variant="cta" onClick={next} data-testid="tour-next">
            {step === total - 1 ? "완료" : "다음"} {step < total - 1 && <ChevronRight size={16} />}
          </Button>
        </div>
      </div>
    </div>
  );
}
