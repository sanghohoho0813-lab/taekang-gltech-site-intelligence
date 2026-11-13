"use client";

/**
 * 쉬운 현장 보고 — 한 화면에 질문 하나, 누르기만 해도 끝나도록.
 * 저장 경로는 기존 현장 보고와 같다 (submitFieldReport 명령) → 본사 손익·위험 분석에 그대로 반영.
 * mode: full = 오늘 보고 / photo = 사진만 보내기 / cost = 추가 비용만 알리기
 */
import { FIELD_COST_MAX } from "@/lib/domain/limits";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CircleCheck,
  Clock3,
  HardHat,
  Images,
  Package,
  Pencil,
  Receipt,
  ThumbsUp,
  Trash2,
  Truck,
  Undo2,
  Users,
  Wand2,
  WifiOff,
  Handshake,
  MapPin,
  Plus,
  X,
} from "lucide-react";
import { run } from "@/lib/data/store";
import { useMe } from "@/lib/data/hooks";
import { IS_LIVE } from "@/lib/mode";
import { outboxAdd } from "@/lib/browser/outbox";
import { CommandError, type CostLineInput, errorMessage } from "@/lib/data/commands";
import { DEMO_SCENARIO } from "@/lib/data/seed";
import type { CostCategory, CostReason, GeoStamp, Site } from "@/lib/domain/types";
import { geoText, judgeGeo, type GeoSample } from "@/lib/domain/geo";
import { locateOnce } from "@/lib/geo/client";
import { todayIso } from "@/lib/domain/format";
import { shiftDate } from "@/lib/domain/attendance";
import { uid } from "@/lib/domain/ids";
import { cx } from "@/components/ui/primitives";
import { BigNumber, Chip, Choice, EasyBar, EasyPageHead, EasyQuestion, SectionBar, Stepper, VoiceHint, easyTextareaCls, AtBottom, NoSite, useWizardActive, useStepHistory } from "./ui";
import { DEFAULT_WORK, EASY_CATEGORY, EASY_CATEGORY_ORDER, EASY_REASON, EASY_REASON_ORDER, ISSUE_CHIPS, NO_WORK, easyDate, easyWon } from "./words";
import { downscalePhoto } from "./photo";
import { hasConsent } from "@/lib/domain/privacy";

export type EasyMode = "full" | "photo" | "cost";

type Impact = "additional" | "within_forecast" | "unknown";
interface EasyCost {
  key: string;
  category: CostCategory;
  /** 금액 (만 원) — 사람 수 × 일 수로 넣지 않을 때 */
  amountMan: number;
  /** 인건비를 사람 수 × 일 수로 계산 */
  byPeople: boolean;
  people: number;
  days: number;
  /** 1인 하루 일당 (원) */
  dayRate: number;
  impact: Impact | "";
}

interface Draft {
  siteId: string;
  reportDate: string;
  work: string[];
  workText: string;
  progress: number | null;
  /** 공정 단계별 새 진척 (단계 id → %) — 오늘 작업한 단계만 */
  stages?: Record<string, number>;
  /** 관련 본사 작업지시 */
  workOrderId?: string;
  issueYes: boolean | null;
  issueChips: string[];
  issueText: string;
  costYes: boolean | null;
  costs: EasyCost[];
  reason: CostReason | "";
}

type StepId = "site" | "work" | "progress" | "photo" | "issue" | "cost" | "cost-cat" | "cost-amt" | "cost-kind" | "cost-list" | "cost-reason" | "confirm";

const SECTION_OF: Record<StepId, string> = {
  site: "현장",
  work: "작업",
  progress: "작업",
  photo: "사진",
  issue: "문제",
  cost: "비용",
  "cost-cat": "비용",
  "cost-amt": "비용",
  "cost-kind": "비용",
  "cost-list": "비용",
  "cost-reason": "비용",
  confirm: "확인",
};

const CAT_ICON: Record<CostCategory, React.ReactNode> = {
  material: <Package size={26} />,
  labor: <Users size={26} />,
  equipment: <Truck size={26} />,
  subcontract: <Handshake size={26} />,
  overhead: <Receipt size={26} />,
};

const DRAFT_KEY = "tk-site-intel:easy-draft:";

function costWon(c: EasyCost): number {
  if (c.category === "labor" && c.byPeople) return Math.round(c.people * c.days * c.dayRate);
  return Math.round(c.amountMan) * 10_000;
}

const emptyDraft = (siteId: string): Draft => ({
  siteId,
  reportDate: todayIso(),
  work: [],
  workText: "",
  progress: null,
  stages: {},
  issueYes: null,
  issueChips: [],
  issueText: "",
  costYes: null,
  costs: [],
  reason: "",
});

function hasContent(d: Draft) {
  return d.work.length > 0 || !!d.workText.trim() || d.issueYes !== null || d.costs.length > 0 || d.progress !== null;
}

export function EasyReport({ siteId: fixedSiteId, mode = "full", embedded = false, onExit }: { siteId?: string; mode?: EasyMode; embedded?: boolean; onExit?: () => void }) {
  const { db, role, userId } = useMe();
  // LIVE에서는 서버가 담당 현장만 보낸다. DEMO 현장직원은 담당 현장만.
  const sites = useMemo<Site[]>(() => (!db ? [] : role === "field" && !IS_LIVE ? db.sites.filter((s) => s.fieldUserId === userId) : db.sites), [db, role, userId]);
  const initialSite = fixedSiteId ?? (sites.length === 1 ? sites[0].id : "");
  // 오늘 출근한 현장 — 두 현장 담당자에게 맨 위에 ‘오늘 출근’으로 보이고, 다른 현장을 고르면 확인 화면에서 한 번 묻는다 (D-68)
  const checkedIn = useMemo(() => {
    const t = todayIso();
    return new Set((db?.attendance ?? []).filter((r) => r.userId === userId && r.workDate === t).map((r) => r.siteId));
  }, [db, userId]);
  const siteList = useMemo(() => [...sites].sort((a, b) => Number(checkedIn.has(b.id)) - Number(checkedIn.has(a.id))), [sites, checkedIn]);
  const [d, setD] = useState<Draft>(() => emptyDraft(initialSite));
  const [photos, setPhotos] = useState<string[]>([]);
  const [memo, setMemo] = useState("");
  const [stack, setStack] = useState<StepId[]>(() => [firstStep(mode, !initialSite)]);
  useWizardActive(stack.length > 1);
  const [discardAsk, setDiscardAsk] = useState(false);
  const [returnToConfirm, setReturnToConfirm] = useState(false);
  const [movedNote, setMovedNote] = useState<string | null>(null);
  const workChips = (st?: Site) => (st && st.stages.length ? [...st.stages].sort((a, b) => rank(a.progressPct) - rank(b.progressPct)).slice(0, 6).map((x) => x.name) : DEFAULT_WORK);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => uid("idem"));
  const [sending, setSending] = useState(false);
  const [netFail, setNetFail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resume, setResume] = useState<Draft | null>(null);
  const [done, setDone] = useState<{ reportId?: string; pendingReview?: boolean; costSum: number; already?: boolean; queued?: boolean; siteName: string } | null>(null);
  // 보낸 뒤(완료 화면)에는 단계 기록을 접는다
  useStepHistory(done ? 1 : stack.length, (d) => setStack((x) => x.slice(0, Math.max(1, d))), !embedded);
  const [undoAsk, setUndoAsk] = useState(false);
  const [undone, setUndone] = useState(false);
  const [dateEdit, setDateEdit] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  /** 1천만 원 넘는 금액을 ‘맞다’고 확인한 비용 (비용 key:금액) */
  const [bigOk, setBigOk] = useState("");
  // 보내는 곳 (위치 기록에 동의한 사람만, 확인 화면에서 1번)
  const consented = !!db && hasConsent(db, userId);
  const [geo, setGeo] = useState<{ sample?: GeoSample; noLocation?: GeoStamp["reason"] } | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const rawStep = stack[stack.length - 1];

  // 담당 현장을 늦게 받는 경우 (LIVE 첫 로딩)
  useEffect(() => {
    if (!d.siteId && !fixedSiteId && sites.length === 1) {
      setD((x) => ({ ...x, siteId: sites[0].id }));
      setStack((s) => (s[0] === "site" && s.length === 1 ? [firstStep(mode, false)] : s));
    }
  }, [sites, d.siteId, fixedSiteId, mode]);

  // 쓰던 보고 이어서 쓰기
  useEffect(() => {
    if (!d.siteId) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY + d.siteId + ":" + mode);
      if (!raw) return;
      const saved = JSON.parse(raw) as Draft;
      if (hasContent(saved)) setResume(saved);
    } catch {
      // 무시
    }
    // 현장이 정해졌을 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.siteId]);

  // 바뀔 때마다 휴대폰에 임시 저장 (사진 제외)
  useEffect(() => {
    if (!d.siteId || done || !hasContent(d)) return;
    try {
      localStorage.setItem(DRAFT_KEY + d.siteId + ":" + mode, JSON.stringify(d));
    } catch {
      // 저장 공간이 없으면 무시
    }
  }, [d, mode, done]);

  // 인터넷이 다시 연결되면 자동으로 한 번 더 보내기
  const retryRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!netFail) return;
    const on = () => retryRef.current();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [netFail]);

  useEffect(() => {
    if (rawStep !== "confirm" || geo || !consented) return;
    let alive = true;
    void locateOnce(10_000).then((r) => alive && setGeo("sample" in r ? { sample: r.sample } : { noLocation: r.error }));
    return () => {
      alive = false;
    };
  }, [rawStep, geo, consented]);

  // 단계가 바뀌면 맨 위로
  useEffect(() => {
    // 머리글(고정) 아래로 — scroll-mt가 머리글 높이만큼 띄운다 (D-65: 단계 표시가 머리글 뒤로 숨던 문제)
    topRef.current?.scrollIntoView({ block: "start" });
  }, [rawStep, done]);

  if (!db) return null;
  if (!sites.length && !fixedSiteId) return <NoSite title={mode === "photo" ? "사진 보내기" : mode === "cost" ? "추가 비용 알리기" : "오늘 보고하기"} />;
  const site = db.sites.find((s) => s.id === d.siteId);
  const settings = db.settings;
  const review = (settings?.costApproval ?? "immediate") === "review";
  const editing = d.costs.find((c) => c.key === editingKey) ?? null;
  // 고치던 비용을 뺀 뒤 '이전'으로 돌아온 경우 → 비용 목록을 보여준다
  const step: StepId = (rawStep === "cost-amt" || rawStep === "cost-kind") && !editing ? "cost-list" : rawStep;
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setCost = (patch: Partial<EasyCost>) => setD((x) => ({ ...x, costs: x.costs.map((c) => (c.key === editingKey ? { ...c, ...patch } : c)) }));

  const go = (next: StepId) => {
    setError(null);
    setStack((s) => [...s, next]);
  };
  const back = () => {
    setError(null);
    if (stack.length <= 1) {
      onExit?.();
      return;
    }
    setStack((s) => s.slice(0, -1));
  };
  /** 확인 화면에서 고치러 왔으면 바로 확인 화면으로 */
  const proceed = (next: StepId) => {
    if (returnToConfirm && next !== "cost-cat" && next !== "cost-amt" && next !== "cost-kind") {
      setReturnToConfirm(false);
      setStack((s) => [...s.slice(0, s.lastIndexOf("confirm") + 1)]);
      return;
    }
    go(next);
  };
  const edit = (target: StepId) => {
    setReturnToConfirm(true);
    go(target);
  };

  // 공정률은 그 현장 담당(현장소장)과 본사만 바꾼다 — 반장·작업자가 누른 +가 발주처 공정률로 바로 나가던 문제 (D-77 리허설)
  const canProgress = !!site && (role !== "field" || site.fieldUserId === userId);
  const order = flowOrder(mode, !fixedSiteId && sites.length > 1, d.costYes === true, canProgress);
  const sections = Array.from(new Set(order.map((s) => SECTION_OF[s])));
  const nextAfter = (s: StepId): StepId => order[Math.min(order.indexOf(s) + 1, order.length - 1)];

  // ───────── 보낼 내용 만들기 ─────────
  // 내 담당 작업지시 (이 현장, 아직 끝나지 않은 것)
  const myOrders = site ? (db.workOrders ?? []).filter((w) => w.siteId === site.id && w.assigneeUserId === userId && !["done", "confirmed"].includes(w.status)) : [];
  const linkedOrder = myOrders.find((w) => w.id === d.workOrderId);
  const workDone =
    mode === "photo"
      ? memo.trim() || "현장 사진 보고"
      : mode === "cost"
        ? "추가 비용 보고"
        : [...(linkedOrder ? [`지시: ${linkedOrder.title}`] : []), ...d.work, d.workText.trim()].filter(Boolean).join(", ");
  const issues = d.issueYes ? [...d.issueChips, d.issueText.trim()].filter(Boolean).join(", ") : "";
  const costLines: CostLineInput[] = d.costs
    .filter((c) => costWon(c) > 0)
    .map((c) => ({
      category: c.category,
      amount: costWon(c),
      forecastImpact: c.impact === "within_forecast" ? "within_forecast" : "additional",
      note: c.category === "labor" && c.byPeople ? `${c.people}명 × ${c.days}일 (현장 보고)` : "현장 보고",
      ...(c.category === "labor" && c.byPeople ? { qty: { manDays: Math.round(c.people * c.days * 100) / 100, dayRate: c.dayRate } } : {}),
    }));
  const costSum = costLines.reduce((s, c) => s + c.amount, 0);
  // 오늘 작업한 공정 단계 (작업 고르기에서 누른 이름과 같은 단계)
  const workedStages = site ? site.stages.filter((st) => d.work.includes(st.name) && st.progressPct < 100) : [];
  const stageChanges = workedStages
    .map((st) => ({ id: st.id, name: st.name, from: st.progressPct, to: (d.stages ?? {})[st.id] ?? st.progressPct }))
    .filter((c) => c.to !== c.from);
  const unknownImpact = d.costs.some((c) => c.impact === "unknown");

  const send = async () => {
    if (sending || !site) return;
    setSending(true);
    setError(null);
    const args = {
        idempotencyKey: idemKey,
        siteId: site.id,
        reportDate: d.reportDate,
        workDone,
        issues,
        photos: photos.map((p) => ({ dataUrl: p })),
        costs: costLines,
        reason: costLines.length ? d.reason || "other" : undefined,
        reasonNote: unknownImpact ? "예산 포함 여부: 현장에서 모름 — 본사 확인 필요" : "",
        source: "FIELD" as const,
        ...(mode === "photo" || mode === "cost" ? { kind: mode } : {}),
        ...(d.workOrderId && linkedOrder ? { workOrderId: d.workOrderId } : {}),
        geo: geo ?? { noLocation: consented ? "timeout" : "skipped" },
        ...(canProgress && d.progress !== null && d.progress !== site.progressPct ? { progressPct: d.progress } : {}),
        ...(canProgress && stageChanges.length ? { stageProgress: stageChanges.map((c) => ({ stageId: c.id, progressPct: c.to })) } : {}),
      };
    try {
      const result = await run("submitFieldReport", args);
      clearDraft();
      setNetFail(false);
      setDone({ reportId: result.reportId, pendingReview: result.pendingReview, costSum, siteName: site.shortName });
    } catch (e) {
      if (e instanceof CommandError && e.code === "NETWORK") {
        // 사진까지 휴대폰에 보관 → 신호가 잡히면 자동으로 보낸다 (앱을 닫아도 남음)
        const saved = IS_LIVE && userId ? await outboxAdd({ id: idemKey, userId, name: "submitFieldReport", args: args as unknown as Record<string, unknown>, label: `${site.shortName} · ${easyDate(d.reportDate)} 보고${photos.length ? ` · 사진 ${photos.length}장` : ""}` }) : false;
        if (saved) {
          clearDraft();
          setNetFail(false);
          setDone({ costSum, queued: true, siteName: site.shortName });
        } else setNetFail(true);
      } else if (e instanceof CommandError && e.code === "DUPLICATE") {
        // 이미 서버에 저장된 보고 (연결이 끊긴 사이 저장된 경우)
        clearDraft();
        setNetFail(false);
        setDone({ costSum, already: true, siteName: site.shortName });
      } else {
        setError(errorMessage(e, "보내지 못했습니다. 다시 눌러 주세요."));
      }
    } finally {
      setSending(false);
    }
  };
  retryRef.current = () => void send();

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY + d.siteId + ":" + mode);
    } catch {
      // 무시
    }
  };

  const restart = () => {
    setD(emptyDraft(fixedSiteId ?? (sites.length === 1 ? sites[0].id : "")));
    setPhotos([]);
    setMemo("");
    setStack([firstStep(mode, !fixedSiteId && sites.length > 1)]);
    setIdemKey(uid("idem"));
    setGeo(null);
    setDone(null);
    setUndone(false);
    setUndoAsk(false);
    setReturnToConfirm(false);
  };

  const fillDemo = () => {
    setD({
      ...emptyDraft(fixedSiteId ?? DEMO_SCENARIO.siteId),
      workText: DEMO_SCENARIO.workDone,
      issueYes: true,
      issueText: DEMO_SCENARIO.issues,
      costYes: true,
      costs: DEMO_SCENARIO.costs.map((c) => ({ key: uid("c"), category: c.category, amountMan: c.amount / 10_000, byPeople: false, people: 1, days: 1, dayRate: settings?.laborDayRate ?? 300_000, impact: "additional" as const })),
      reason: DEMO_SCENARIO.reason,
    });
    setStack(["confirm"]);
    setReturnToConfirm(false);
    setResume(null);
  };

  const onFiles = async (files: FileList | null, input: HTMLInputElement) => {
    if (!files?.length) return;
    const room = 3 - photos.length;
    try {
      const urls = await Promise.all(Array.from(files).slice(0, room).map((f) => downscalePhoto(f)));
      setPhotos((p) => [...p, ...urls].slice(0, 3));
      if (files.length > room) setError("사진은 3장까지만 보낼 수 있어요.");
    } catch {
      setError("사진을 읽지 못했어요. 다시 찍어 주세요.");
    }
    input.value = "";
  };

  const undo = async () => {
    if (!done?.reportId) return;
    try {
      await run("voidReport", { reportId: done.reportId });
      setUndone(true);
      setUndoAsk(false);
    } catch (e) {
      setError(errorMessage(e, "취소하지 못했습니다."));
    }
  };

  const bar = (p: Parameters<typeof EasyBar>[0]) => <EasyBar embedded={embedded} {...p} />;

  // ───────── 보낸 뒤 ─────────
  if (done) {
    return (
      <div ref={topRef} className="anim-pop scroll-mt-24 space-y-5 pb-4" data-testid="report-done">
        <div className="flex flex-col items-center gap-3 pt-4 text-center">
          <span className={cx("grid size-24 place-items-center rounded-full", undone ? "bg-surface-3 text-ink-2" : done.queued ? "bg-warn-bg text-warn" : "bg-ok-bg text-ok")}>
            {undone ? <Undo2 size={46} /> : done.queued ? <WifiOff size={48} /> : <CircleCheck size={52} />}
          </span>
          <p className="text-[1.7rem] font-extrabold leading-tight" data-testid={done.queued ? "report-queued" : undefined}>
            {undone ? "보낸 보고를 취소했어요" : done.queued ? "휴대폰에 보관했어요" : done.already ? "이미 보낸 보고예요" : "본사로 보냈어요"}
          </p>
          {done.queued && <p className="text-[1.12rem] leading-relaxed text-ink-2">인터넷이 약해서 아직 본사에 못 갔어요. 사진까지 그대로 보관했고, 신호가 잡히면 자동으로 보내요. 앱을 닫아도 괜찮아요.</p>}
          <p className="text-[1.1rem] text-ink-2">
            {done.siteName} · {easyDate(d.reportDate)}
          </p>
        </div>
        {!undone && !done.queued && done.costSum > 0 && (
          <div className="rounded-2xl border-2 border-line bg-surface-2 p-4 text-[1.1rem] leading-relaxed" data-testid="report-impact" data-pending={done.pendingReview ? "1" : undefined}>
            추가 비용 <b className="num">{easyWon(done.costSum)}</b>
            {done.pendingReview ? " — 본사가 확인한 뒤 반영돼요." : " — 본사에 바로 전달됐어요."}
          </div>
        )}
        {!undone && !done.queued && (
          <p className="text-center text-[1.05rem] text-ink-2">
            잘못 보냈다면 맨 아래 <b>‘보낸 것 취소하기’</b>를 누르세요.
          </p>
        )}
        {error && <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.05rem] font-semibold text-err">{error}</p>}
        {/* 순서: 처음 화면으로(주 버튼) → 하나 더 → 맨 아래 작은 ‘취소’ (취소가 맨 위에 있어 잘못 누르던 문제 · D-65) */}
        <div className="space-y-2.5">
          {embedded && onExit ? (
            <button type="button" onClick={onExit} className="press flex h-[4rem] w-full items-center justify-center rounded-full bg-cta text-[1.2rem] font-extrabold text-cta-text shadow-card">
              닫기
            </button>
          ) : (
            <Link href="/field" className="press flex h-[4rem] w-full items-center justify-center rounded-full bg-cta text-[1.2rem] font-extrabold text-cta-text shadow-card" data-testid="report-home">
              처음 화면으로
            </Link>
          )}
          <button type="button" onClick={restart} className="press flex h-[3.8rem] w-full items-center justify-center rounded-full border-2 border-line-strong bg-surface text-[1.12rem] font-bold" data-testid="report-again">
            보고 하나 더 하기
          </button>
          {!undone && done.reportId && !undoAsk && (
            <button type="button" onClick={() => setUndoAsk(true)} className="press mx-auto flex min-h-[3.2rem] items-center justify-center gap-2 rounded-full px-5 text-[1.05rem] font-bold text-ink-2 underline underline-offset-4" data-testid="report-undo-ask">
              <Undo2 size={20} aria-hidden /> 보낸 것 취소하기
            </button>
          )}
          {undoAsk && (
            <div className="rounded-2xl border-2 border-err/40 bg-err-bg p-4" role="alertdialog" aria-label="보고 취소 확인">
              <p className="text-[1.15rem] font-bold text-ink">정말 취소할까요? 본사 화면에서도 빠집니다.</p>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <button type="button" onClick={() => setUndoAsk(false)} className="press h-[3.6rem] rounded-full border-2 border-line-strong bg-surface text-[1.1rem] font-bold">
                  아니요
                </button>
                <button type="button" onClick={undo} className="press h-[3.6rem] rounded-full bg-err text-[1.1rem] font-bold text-white" data-testid="report-undo">
                  네, 취소할게요
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const demoFill = !IS_LIVE && (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-[#FFF7D6] px-3 py-2 text-[0.85rem] text-[#7A5200]">
      <span>DEMO · 미팅 시나리오 값</span>
      <button type="button" onClick={fillDemo} className="press inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg bg-white/70 px-3 py-1.5 font-bold hover:bg-white" data-testid="fill-demo">
        <Wand2 size={15} aria-hidden /> 데모 값 채우기
      </button>
    </div>
  );

  // ───────── 쓰던 보고 이어서 ─────────
  if (resume) {
    return (
      <div ref={topRef} className="scroll-mt-24 space-y-5 pb-4">
        {demoFill}
        <EasyQuestion title="쓰다 만 보고가 있어요" help="이어서 쓸까요? (사진은 다시 찍어야 해요)" testId="easy-resume">
          <div className="space-y-2.5">
            <Choice
              icon={<Pencil size={24} />}
              label="이어서 쓰기"
              onClick={() => {
                setD(resume);
                setResume(null);
                setStack([firstStep(mode, false), "confirm"]);
              }}
              testId="resume-yes"
            />
            {!discardAsk ? (
              <Choice icon={<Trash2 size={24} />} label="지우고 새로 쓰기" onClick={() => setDiscardAsk(true)} testId="resume-no" />
            ) : (
              // 쓰던 내용이 한 번에 지워지지 않게 한 번 더 묻는다 (D-65)
              <div className="rounded-2xl border-2 border-err/40 bg-err-bg p-4" role="alertdialog" aria-label="쓰던 보고 지우기 확인">
                <p className="text-[1.12rem] font-bold">쓰던 내용을 지울까요? 되돌릴 수 없어요.</p>
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <button type="button" onClick={() => setDiscardAsk(false)} className="press h-[3.6rem] rounded-full border-2 border-line-strong bg-surface text-[1.1rem] font-bold">
                    아니요
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearDraft();
                      setResume(null);
                      setDiscardAsk(false);
                    }}
                    className="press h-[3.6rem] rounded-full bg-err text-[1.1rem] font-bold text-white"
                    data-testid="resume-no-yes"
                  >
                    네, 지울게요
                  </button>
                </div>
              </div>
            )}
          </div>
        </EasyQuestion>
      </div>
    );
  }

  const header = (
    <div className="space-y-3">
      <EasyPageHead title={mode === "photo" ? "사진 보내기" : mode === "cost" ? "추가 비용 알리기" : "오늘 보고하기"}>
        <SectionBar onBand sections={sections} current={Math.max(0, sections.indexOf(SECTION_OF[step]))} />
        {site && step !== "site" && (
          <p className="flex items-center gap-1.5 text-[1rem] font-semibold text-white">
            <HardHat size={18} aria-hidden /> {site.shortName} · {site.workType}
          </p>
        )}
      </EasyPageHead>
      {/* 시연 값 채우기는 첫 화면에만 — 단계마다 보이면 큰 글씨에서 화면이 좁아진다 (D-65) */}
      {stack.length === 1 && demoFill}
    </div>
  );

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  switch (step) {
    case "site":
      body = (
        <EasyQuestion title="어느 현장 보고인가요?">
          <div className="space-y-2.5">
            {siteList.map((s) => (
              <Choice
                key={s.id}
                icon={<HardHat size={24} />}
                label={
                  <span className="flex flex-wrap items-center gap-2">
                    {s.shortName}
                    {checkedIn.has(s.id) && sites.length > 1 && (
                      <span className="rounded-lg bg-ok-bg px-2 py-0.5 text-[0.92rem] font-bold text-ok" data-testid="site-checked-in">
                        오늘 출근
                      </span>
                    )}
                  </span>
                }
                sub={s.workType}
                selected={d.siteId === s.id}
                onClick={() => {
                  if (s.id !== d.siteId) {
                    // 다른 현장을 고르면 앞 현장에서 고른 작업·공정·문제·비용·사진·지시를 모두 비운다
                    // (앞 현장 답이 새 현장 보고에 섞여 들어가던 문제 · D-65 점검 반영)
                    if (d.siteId) {
                      try {
                        localStorage.removeItem(DRAFT_KEY + d.siteId + ":" + mode);
                      } catch {
                        // 무시
                      }
                    }
                    setD({ ...emptyDraft(s.id), reportDate: d.reportDate });
                    setPhotos([]);
                  }
                  proceed(nextAfter("site"));
                }}
                testId={`easy-site-${s.id}`}
              />
            ))}
          </div>
        </EasyQuestion>
      );
      // 첫 단계는 하단 메뉴로 나갈 수 있어 ‘닫기’ 바를 두지 않는다 (창 안에서만 · D-67 점검 반영)
      footer = onExit && embedded ? bar({ onBack: onExit, backLabel: "닫기" }) : null;
      break;

    case "work": {
      const stageNames = workChips(site);
      // 목록에 없는데 골라져 있는 작업(다른 현장에서 옮겨 온 것 등)도 보여서 뺄 수 있게 (D-69 점검 반영)
      const orphans = d.work.filter((w) => w !== NO_WORK && !stageNames.includes(w));
      const toggle = (w: string) => set({ work: d.work.includes(w) ? d.work.filter((x) => x !== w) : w === NO_WORK ? [NO_WORK] : [...d.work.filter((x) => x !== NO_WORK), w] });
      const ok = d.work.length > 0 || !!d.workText.trim() || !!linkedOrder;
      body = (
        <EasyQuestion title="오늘 무슨 작업을 했나요?" help="해당하는 것을 모두 누르세요." testId="easy-work">
          {movedNote && (
            <p className="rounded-2xl border-2 border-warn/45 bg-warn-bg px-4 py-3 text-[1.05rem] font-bold text-ink" data-testid="moved-site-note">
              {movedNote}
            </p>
          )}
          {myOrders.length > 0 && (
            <div className="space-y-2">
              <p className="text-[1.1rem] font-bold">본사 지시와 관련 있으면 누르세요</p>
              <div className="flex flex-wrap gap-2.5">
                {myOrders.map((w) => (
                  <Chip key={w.id} selected={d.workOrderId === w.id} onClick={() => set({ workOrderId: d.workOrderId === w.id ? undefined : w.id })} testId="work-order-chip">
                    본사 지시: {w.title}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2.5">
            {stageNames.map((name) => (
              <Chip key={name} selected={d.work.includes(name)} onClick={() => toggle(name)} testId="work-chip">
                {name}
              </Chip>
            ))}
            {orphans.map((name) => (
              <Chip key={`o-${name}`} selected onClick={() => toggle(name)} testId="work-chip-orphan">
                {name}
              </Chip>
            ))}
            <Chip selected={d.work.includes(NO_WORK)} onClick={() => toggle(NO_WORK)} testId="work-none">
              {NO_WORK}
            </Chip>
          </div>
          <div className="space-y-2">
            <label htmlFor="easy-work-text" className="block text-[1.1rem] font-bold">
              더 적을 내용 <span className="font-semibold text-ink-2">(안 적어도 돼요)</span>
            </label>
            <textarea id="easy-work-text" rows={3} maxLength={400} value={d.workText} onChange={(e) => set({ workText: e.target.value })} className={easyTextareaCls} placeholder="예) 3층 남측 10개 설치" />
            <VoiceHint />
          </div>
        </EasyQuestion>
      );
      footer = bar({ onBack: stack.length > 1 ? back : onExit, backLabel: stack.length > 1 ? "이전" : "닫기", onNext: () => proceed(nextAfter("work")), nextDisabled: !ok, hint: ok ? undefined : "작업을 하나 이상 눌러 주세요" });
      break;
    }

    case "progress": {
      const cur = site?.progressPct ?? 0;
      const val = d.progress ?? cur;
      if (workedStages.length > 0) {
        body = (
          <EasyQuestion title="오늘 한 공정이 얼마나 됐나요?" help="공정마다 지금 몇 %인지 + − 로 맞춰 주세요. 바뀌지 않았으면 ‘그대로예요’." testId="easy-progress">
            <Choice icon={<ThumbsUp size={24} />} label="그대로예요" sub="진행률을 바꾸지 않습니다" tone="good" selected={stageChanges.length === 0} onClick={() => { set({ stages: {} }); proceed(nextAfter("progress")); }} testId="progress-same" />
            {workedStages.map((st, i) => (
              <Stepper key={st.id} label={`${st.name} (지금 ${st.progressPct}%)`} value={(d.stages ?? {})[st.id] ?? st.progressPct} min={0} max={100} step={5} unit="%" onChange={(v) => set({ stages: { ...(d.stages ?? {}), [st.id]: v } })} testId={`stage-stepper-${i}`} />
            ))}
          </EasyQuestion>
        );
        footer = bar({ onBack: back, onNext: () => proceed(nextAfter("progress")) });
        break;
      }
      body = (
        <EasyQuestion title="현장 진행률이 바뀌었나요?" help={`지금 본사에 ${cur}%로 되어 있어요.`} testId="easy-progress">
          <Choice icon={<ThumbsUp size={24} />} label="그대로예요" sub={`${cur}% 그대로 둡니다`} tone="good" selected={d.progress === null} onClick={() => { set({ progress: null }); proceed(nextAfter("progress")); }} testId="progress-same" />
          <Stepper label="바뀌었으면 눌러서 맞추세요" value={val} min={0} max={100} step={5} unit="%" onChange={(v) => set({ progress: v })} testId="progress-stepper" />
        </EasyQuestion>
      );
      footer = bar({ onBack: back, onNext: () => proceed(nextAfter("progress")) });
      break;
    }

    case "photo":
      body = (
        <EasyQuestion title={mode === "photo" ? "보낼 사진을 찍어 주세요" : "작업 사진을 찍어 주세요"} help={mode === "photo" ? "3장까지 보낼 수 있어요. 한 장 이상 찍어 주세요." : "3장까지 보낼 수 있어요. 없으면 ‘사진 없이 다음’을 누르세요."} testId="easy-photo">
          <div className="grid grid-cols-2 gap-2.5">
            <label className={cx("press flex min-h-[6.5rem] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl bg-cta text-[1.15rem] font-extrabold text-cta-text", photos.length >= 3 && "pointer-events-none opacity-40")}>
              <Camera size={34} aria-hidden />
              사진 찍기
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onFiles(e.target.files, e.currentTarget)} data-testid="photo-camera" />
            </label>
            <label className={cx("press flex min-h-[6.5rem] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-line-strong bg-surface text-[1.15rem] font-extrabold", photos.length >= 3 && "pointer-events-none opacity-40")}>
              <Images size={34} aria-hidden />
              앨범에서 고르기
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => onFiles(e.target.files, e.currentTarget)} data-testid="photo-album" />
            </label>
          </div>
          {photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2.5">
              {photos.map((p, i) => (
                <li key={i} className="space-y-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p} alt={`보낼 사진 ${i + 1}`} className="aspect-square w-full rounded-xl border border-line object-cover" />
                  <button type="button" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="press flex h-11 w-full items-center justify-center gap-1 rounded-xl border-2 border-line-strong text-[1rem] font-bold">
                    <X size={18} aria-hidden /> 빼기
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mode === "photo" && (
            <div className="space-y-2">
              <label htmlFor="easy-memo" className="block text-[1.1rem] font-bold">
                사진 설명 <span className="font-semibold text-ink-2">(안 적어도 돼요)</span>
              </label>
              <textarea id="easy-memo" rows={2} maxLength={300} value={memo} onChange={(e) => setMemo(e.target.value)} className={easyTextareaCls} placeholder="예) 3층 남측 설치 완료" />
            </div>
          )}
          {error && <p className="text-[1.05rem] font-semibold text-err">{error}</p>}
        </EasyQuestion>
      );
      footer = bar({
        onBack: stack.length > 1 ? back : onExit,
        backLabel: stack.length > 1 ? "이전" : "닫기",
        onNext: () => proceed(nextAfter("photo")),
        nextLabel: photos.length ? `사진 ${photos.length}장 · 다음` : mode === "photo" ? "다음" : "사진 없이 다음",
        nextDisabled: mode === "photo" && photos.length === 0,
        hint: mode === "photo" && photos.length === 0 ? "사진을 한 장 이상 찍어 주세요" : undefined,
      });
      break;

    case "issue":
      body = (
        <EasyQuestion title="문제나 위험한 일이 있었나요?" testId="easy-issue">
          <div className="space-y-2.5">
            <Choice icon={<ThumbsUp size={24} />} tone="good" label="없었어요" selected={d.issueYes === false} onClick={() => { set({ issueYes: false }); proceed(nextAfter("issue")); }} testId="issue-no" />
            <Choice icon={<AlertTriangle size={24} />} tone="warn" label="있었어요" selected={d.issueYes === true} onClick={() => set({ issueYes: true })} testId="issue-yes" />
          </div>
          {d.issueYes && (
            <div className="space-y-3">
              <p className="text-[1.1rem] font-bold">어떤 일이었나요? (모두 누르세요)</p>
              <div className="flex flex-wrap gap-2.5">
                {ISSUE_CHIPS.map((c) => (
                  <Chip key={c} selected={d.issueChips.includes(c)} onClick={() => set({ issueChips: d.issueChips.includes(c) ? d.issueChips.filter((x) => x !== c) : [...d.issueChips, c] })} testId="issue-chip">
                    {c}
                  </Chip>
                ))}
              </div>
              <label htmlFor="easy-issue-text" className="block text-[1.1rem] font-bold">
                더 적을 내용 <span className="font-semibold text-ink-2">(안 적어도 돼요)</span>
              </label>
              <textarea id="easy-issue-text" rows={2} maxLength={400} value={d.issueText} onChange={(e) => set({ issueText: e.target.value })} className={easyTextareaCls} />
            </div>
          )}
        </EasyQuestion>
      );
      {
        const empty = d.issueYes === true && d.issueChips.length === 0 && !d.issueText.trim();
        footer = bar({ onBack: back, onNext: d.issueYes ? () => proceed(nextAfter("issue")) : undefined, nextDisabled: empty, hint: empty ? "어떤 문제였는지 하나 이상 눌러 주세요" : undefined });
      }
      break;

    case "cost":
      body = (
        <EasyQuestion title="오늘 돈이 더 든 일이 있었나요?" help="자재를 더 샀거나, 사람·장비를 더 썼으면 ‘있었어요’를 누르세요. 대략적인 금액이면 충분해요." testId="easy-cost">
          <div className="space-y-2.5">
            <Choice
              icon={<ThumbsUp size={24} />}
              tone="good"
              label="없었어요"
              selected={d.costYes === false}
              onClick={() => {
                set({ costYes: false, costs: [] });
                if (returnToConfirm) proceed("confirm");
                else go("confirm");
              }}
              testId="cost-no"
            />
            <Choice
              icon={<Receipt size={24} />}
              tone="warn"
              label="있었어요"
              selected={d.costYes === true}
              onClick={() => {
                set({ costYes: true });
                setReturnToConfirm(false);
                if (d.costs.length) go("cost-list");
                else {
                  setEditingKey(null);
                  go("cost-cat");
                }
              }}
              testId="cost-yes"
            />
          </div>
        </EasyQuestion>
      );
      footer = bar({ onBack: back });
      break;

    case "cost-cat":
      body = (
        <EasyQuestion kicker={d.costs.length ? `비용 ${d.costs.length + (editing ? 0 : 1)}` : undefined} title="무엇에 돈이 들었나요?" testId="easy-cost-cat">
          <div className="space-y-2.5">
            {EASY_CATEGORY_ORDER.map((cat) => (
              <Choice
                key={cat}
                icon={CAT_ICON[cat]}
                label={EASY_CATEGORY[cat].label}
                sub={EASY_CATEGORY[cat].sub}
                selected={editing?.category === cat}
                onClick={() => {
                  if (editing) setCost({ category: cat, byPeople: cat === "labor" ? editing.byPeople : false });
                  else {
                    const c: EasyCost = { key: uid("c"), category: cat, amountMan: 0, byPeople: cat === "labor", people: 1, days: 1, dayRate: settings?.laborDayRate ?? 300_000, impact: "" };
                    setD((x) => ({ ...x, costYes: true, costs: [...x.costs, c] }));
                    setEditingKey(c.key);
                  }
                  go("cost-amt");
                }}
                testId={`cost-cat-${cat}`}
              />
            ))}
          </div>
        </EasyQuestion>
      );
      footer = bar({ onBack: back });
      break;

    case "cost-amt": {
      if (!editing) break;
      const won = costWon(editing);
      const labor = editing.category === "labor";
      const overCap = won > FIELD_COST_MAX;
      const bigAmount = overCap || (!(labor && editing.byPeople) && won >= 10_000_000 && bigOk !== editing.key + ":" + editing.amountMan);
      body = (
        <EasyQuestion kicker={EASY_CATEGORY[editing.category].label} title={labor && editing.byPeople ? "몇 명이 며칠 일했나요?" : "대략 얼마 들었나요?"} help={labor && editing.byPeople ? "추가로 투입된 인원만 넣으세요." : "만 원 단위로 넣어요. 아래 버튼을 눌러 더해도 돼요."} testId="easy-cost-amt">
          {labor && (
            <div className="grid grid-cols-2 gap-2">
              <Chip selected={editing.byPeople} onClick={() => setCost({ byPeople: true })} testId="labor-by-people">
                인원·일수로
              </Chip>
              <Chip selected={!editing.byPeople} onClick={() => setCost({ byPeople: false })} testId="labor-by-amount">
                금액으로
              </Chip>
            </div>
          )}
          {labor && editing.byPeople ? (
            <div className="space-y-3">
              <Stepper label="몇 명" value={editing.people} min={1} max={100} step={1} unit="명" onChange={(v) => setCost({ people: v })} testId="labor-people" />
              <Stepper label="며칠" value={editing.days} min={0.5} max={60} step={0.5} unit="일" onChange={(v) => setCost({ days: v })} testId="labor-days" />
              <BigNumber sub={`${editing.people}명 × ${editing.days}일 = ${Math.round(editing.people * editing.days * 100) / 100}공수 × 일당 ${easyWon(editing.dayRate)}`} testId="cost-readback">
                {easyWon(won)}
              </BigNumber>
              {rateOpen ? (
                <Stepper label="1명 하루 일당" value={editing.dayRate} min={10_000} max={2_000_000} step={10_000} unit="원" format={(v) => `${Math.round(v / 10_000).toLocaleString("ko-KR")}만`} onChange={(v) => setCost({ dayRate: v })} testId="labor-rate" />
              ) : (
                <button type="button" onClick={() => setRateOpen(true)} className="press flex min-h-[3.4rem] w-full items-center justify-between rounded-2xl border-2 border-line-strong bg-surface px-4 text-[1.05rem]" data-testid="labor-rate-open">
                  <span>
                    1명 하루 일당 <b className="num">{easyWon(editing.dayRate)}</b>
                  </span>
                  <span className="font-bold text-theme-ink">바꾸기</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <label htmlFor="easy-amount" className="sr-only">
                금액 (만 원)
              </label>
              <div className="flex items-center gap-2 rounded-2xl border-2 border-line-strong bg-surface px-4 focus-within:border-active focus-within:ring-4 focus-within:ring-active/20">
                <input
                  id="easy-amount"
                  inputMode="numeric"
                  autoComplete="off"
                  value={editing.amountMan ? editing.amountMan.toLocaleString("ko-KR") : ""}
                  onChange={(e) => {
                    // 원 단위로 넣은 큰 숫자도 잘리지 않게 받아서 아래에서 ‘원 단위로 고치기’를 제안한다 (7자리에서 잘려 엉뚱한 금액이 되던 문제 · D-67)
                    const n = Number(e.target.value.replace(/[^\d]/g, "").slice(0, 10));
                    setCost({ amountMan: Number.isFinite(n) ? n : 0 });
                  }}
                  className="num h-[4.2rem] min-w-0 flex-1 bg-transparent text-right text-[2rem] font-extrabold outline-none"
                  placeholder="0"
                  data-testid="cost-amount"
                />
                <span className="shrink-0 text-[1.4rem] font-bold text-ink-2">만 원</span>
              </div>
              {won > 0 && <BigNumber testId="cost-readback">{easyWon(won)}</BigNumber>}
              {/* 원 단위로 넣으면(350000 → 35억) 1만 배가 된다 — 1천만 원 넘으면 한 번 더 확인 (D-66 점검 반영) */}
              {bigAmount && (
                <div
                  ref={(el) => {
                    // 확인 상자가 아래 고정 버튼·키보드 뒤에 숨지 않게 (D-67 점검 반영)
                    if (!el) return;
                    (document.activeElement as HTMLElement | null)?.blur?.();
                    el.scrollIntoView({ block: "center", behavior: "smooth" });
                  }}
                  className="space-y-2.5 rounded-2xl border-2 border-warn/50 bg-warn-bg p-4"
                  role="alert"
                  data-testid="cost-big-ask"
                >
                  <p className="text-[1.12rem] font-bold">{overCap ? `${easyWon(won)} — 현장에서는 1건에 1억 원까지 넣을 수 있어요. 금액을 확인해 주세요.` : `${easyWon(won)}이 맞나요? 이 칸은 ‘만 원’ 단위예요.`}</p>
                  <div className="grid gap-2">
                    {editing.amountMan >= 10_000 && (
                      <button type="button" onClick={() => setCost({ amountMan: Math.max(1, Math.round(editing.amountMan / 10_000)) })} className="press min-h-[3.4rem] rounded-full border-2 border-line-strong bg-surface text-[1.05rem] font-bold" data-testid="cost-big-fix">
                        원 단위로 넣었어요 → {easyWon(Math.max(1, Math.round(editing.amountMan / 10_000)) * 10_000)}으로 고치기
                      </button>
                    )}
                    {!overCap && (
                      <button type="button" onClick={() => setBigOk(editing.key + ":" + editing.amountMan)} className="press min-h-[3.4rem] rounded-full bg-surface text-[1.05rem] font-bold text-ink" data-testid="cost-big-ok">
                        네, {easyWon(won)}이 맞아요
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {[10, 50, 100, 500, 1000].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      // 버튼으로 더한 금액은 단위 실수가 아니므로 다시 묻지 않는다
                      const v = editing.amountMan + m;
                      setCost({ amountMan: v });
                      setBigOk(editing.key + ":" + v);
                    }}
                    className="press h-[3.6rem] rounded-2xl bg-surface-3 text-[1.15rem] font-extrabold text-ink"
                    data-testid={`amt-plus-${m}`}
                  >
                    +{m.toLocaleString("ko-KR")}만
                  </button>
                ))}
                <button type="button" onClick={() => setCost({ amountMan: 0 })} className="press h-[3.6rem] rounded-2xl border-2 border-line-strong text-[1.1rem] font-bold text-ink-2">
                  다시 넣기
                </button>
              </div>
            </div>
          )}
        </EasyQuestion>
      );
      footer = bar({ onBack: back, onNext: () => go("cost-kind"), nextDisabled: won <= 0 || bigAmount, hint: won <= 0 ? "금액을 넣어 주세요" : bigAmount ? "금액이 맞는지 위에서 눌러 주세요" : undefined });
      break;
    }

    case "cost-kind":
      if (!editing) break;
      body = (
        <EasyQuestion kicker={`${EASY_CATEGORY[editing.category].label} ${easyWon(costWon(editing))}`} title="처음 예산에 들어 있던 돈인가요?" help="잘 모르면 ‘모르겠어요’를 누르세요. 본사에서 확인합니다." testId="easy-cost-kind">
          <div className="space-y-2.5">
            {(
              [
                ["additional", "아니요, 예산에 없던 돈이에요", "추가로 더 든 돈"],
                ["within_forecast", "네, 예산 안에서 쓴 돈이에요", "원래 쓰기로 했던 돈"],
                ["unknown", "모르겠어요", "본사가 확인합니다"],
              ] as const
            ).map(([v, label, sub]) => (
              <Choice
                key={v}
                label={label}
                sub={sub}
                selected={editing.impact === v}
                onClick={() => {
                  setCost({ impact: v });
                  // 비용이 하나면 목록 화면을 건너뛴다 — 확인 화면에서 ‘비용 하나 더’를 누를 수 있다 (D-66: 7화면 → 5화면)
                  if (d.costs.length <= 1) {
                    if (d.reason && returnToConfirm) proceed("confirm");
                    else go("cost-reason");
                  } else go("cost-list");
                }}
                testId={`impact-${v}`}
              />
            ))}
          </div>
        </EasyQuestion>
      );
      footer = bar({ onBack: back });
      break;

    case "cost-list":
      body = (
        <EasyQuestion title="넣은 비용을 확인하세요" help="더 있으면 ‘비용 하나 더’를 누르세요." testId="easy-cost-list">
          <ul className="space-y-2.5">
            {d.costs.map((c, i) => (
              <li key={c.key} className="flex items-center gap-3 rounded-2xl border-2 border-line bg-surface p-3.5" data-testid={`easy-cost-row-${i}`}>
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-3 text-ink-2" aria-hidden>
                  {CAT_ICON[c.category]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[1.15rem] font-bold">
                    {EASY_CATEGORY[c.category].label} <span className="num">{easyWon(costWon(c))}</span>
                  </span>
                  <span className="block text-[0.98rem] text-ink-2">{c.impact === "within_forecast" ? "예산 안에서 쓴 돈" : c.impact === "unknown" ? "예산 여부 모름 (본사 확인)" : "예산에 없던 돈"}</span>
                </span>
                <button type="button" onClick={() => set({ costs: d.costs.filter((x) => x.key !== c.key), costYes: d.costs.length > 1 })} className="press grid h-12 shrink-0 place-items-center rounded-xl border-2 border-line-strong px-3 text-[1rem] font-bold" aria-label={`비용 ${i + 1} 빼기`}>
                  빼기
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setEditingKey(null);
              go("cost-cat");
            }}
            className="press flex h-[3.8rem] w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-active bg-active-soft text-[1.15rem] font-extrabold text-theme-ink"
            data-testid="cost-more"
          >
            <Plus size={22} aria-hidden /> 비용 하나 더
          </button>
          <BigNumber sub="합계">{easyWon(d.costs.reduce((s, c) => s + costWon(c), 0))}</BigNumber>
        </EasyQuestion>
      );
      footer = bar({
        onBack: back,
        onNext: () => (d.costs.length === 0 ? (set({ costYes: false }), go("confirm")) : d.reason && returnToConfirm ? proceed("confirm") : go("cost-reason")),
        nextLabel: d.costs.length === 0 ? "비용 없이 다음" : "다음",
      });
      break;

    case "cost-reason":
      body = (
        <EasyQuestion title="왜 돈이 더 들었나요?" help="가장 가까운 것 하나를 누르세요." testId="easy-cost-reason">
          <div className="space-y-2.5">
            {EASY_REASON_ORDER.map((r) => (
              <Choice
                key={r}
                label={EASY_REASON[r]}
                selected={d.reason === r}
                onClick={() => {
                  set({ reason: r });
                  proceed("confirm");
                }}
                testId={`reason-${r}`}
              />
            ))}
          </div>
        </EasyQuestion>
      );
      footer = bar({ onBack: back });
      break;

    case "confirm": {
      const row = (label: string, value: React.ReactNode, target: StepId | null, testId?: string) => (
        <div className="flex items-start gap-3 border-b border-line py-3.5 last:border-b-0" data-testid={testId}>
          <div className="min-w-0 flex-1">
            <p className="text-[0.98rem] font-bold text-ink-2">{label}</p>
            <div className="mt-0.5 text-[1.12rem] leading-relaxed text-ink">{value}</div>
          </div>
          {target && (
            <button type="button" onClick={() => edit(target)} className="press min-h-12 shrink-0 rounded-xl border-2 border-line-strong px-3.5 text-[1rem] font-bold" aria-label={`${label} 고치기`}>
              고치기
            </button>
          )}
        </div>
      );
      const hasWork = mode !== "full" || d.work.length > 0 || !!d.workText.trim() || !!linkedOrder;
      const otherSite = d.reportDate === todayIso() && checkedIn.size > 0 && !checkedIn.has(d.siteId) ? sites.find((x) => checkedIn.has(x.id)) : undefined;
      const otherSiteToday = otherSite ? { id: otherSite.id, name: otherSite.shortName } : null;
      body = (
        <>
        {otherSiteToday && (
          <div className="mb-4 rounded-2xl border-2 border-warn/45 bg-warn-bg px-4 py-3 text-[1.05rem]" data-testid="confirm-other-site">
            <p className="font-bold text-ink">
              오늘 출근한 현장은 {otherSiteToday.name}이에요. {site?.shortName} 보고가 맞나요?
            </p>
            {!fixedSiteId && (
              <button
                type="button"
                onClick={() => {
                  // 적은 내용은 그대로 두고 현장만 옮긴다 — 공정 단계·작업지시처럼 현장마다 다른 답만 비운다 (모두 지워지던 문제 · D-68 점검 반영)
                  try {
                    localStorage.removeItem(DRAFT_KEY + d.siteId + ":" + mode);
                  } catch {
                    // 무시
                  }
                  // 현장마다 다른 작업 버튼(공정 단계 이름)·진행률·작업지시는 비우고, 적은 글·문제·비용·사진은 그대로 (D-69 점검 반영)
                  const target = sites.find((x) => x.id === otherSiteToday.id);
                  const chips = workChips(target);
                  const kept = d.work.filter((w) => w === NO_WORK || chips.includes(w));
                  const dropped = kept.length !== d.work.length || Object.keys(d.stages ?? {}).length > 0 || d.progress !== null || !!d.workOrderId;
                  setD((x) => ({ ...x, siteId: otherSiteToday.id, work: kept, stages: {}, workOrderId: undefined, progress: null }));
                  if (dropped) {
                    setMovedNote(`${otherSiteToday.name}으로 옮겼어요. 작업과 진행률을 ${otherSiteToday.name} 것으로 다시 골라 주세요.`);
                    setReturnToConfirm(false);
                    go("work");
                  }
                }}
                className="press mt-2 inline-flex min-h-12 items-center rounded-xl border-2 border-line-strong bg-surface px-3.5 text-[1rem] font-bold"
                data-testid="confirm-move-site"
              >
                {otherSiteToday.name} 보고로 바꾸기
              </button>
            )}
          </div>
        )}
        <EasyQuestion title="이렇게 보낼까요?" help="맞으면 맨 아래 ‘본사로 보내기’를 누르세요." testId="easy-confirm">
          <div className="rounded-2xl border-2 border-line bg-surface px-4">
            {row(
              "날짜",
              <span className="flex flex-wrap items-center gap-2">
                {d.reportDate === todayIso() ? "오늘 · " : ""}
                {easyDate(d.reportDate)}
                {!dateEdit && (
                  <button type="button" onClick={() => setDateEdit(true)} className="press inline-flex min-h-12 items-center rounded-xl px-2 text-[0.98rem] font-bold text-theme-ink underline underline-offset-4">
                    날짜 바꾸기
                  </button>
                )}
                {dateEdit && <input type="date" aria-label="보고 날짜" value={d.reportDate} max={todayIso()} min={shiftDate(todayIso(), -60)} onChange={(e) => { const v = e.target.value; if (v && v <= todayIso() && v >= shiftDate(todayIso(), -60)) set({ reportDate: v }); }} className="min-h-12 rounded-xl border-2 border-line-strong px-3 text-[1.05rem]" />}
              </span>,
              null,
            )}
            {mode === "full" && row("오늘 한 작업", workDone || <span className="text-err">작업을 넣어 주세요</span>, "work", "confirm-work")}
            {mode === "full" &&
              canProgress &&
              row(
                "진행률",
                stageChanges.length ? (
                  <span className="block" data-testid="confirm-stages">
                    {stageChanges.map((c) => (
                      <span key={c.id} className="block">
                        {c.name} {c.from}% → <b>{c.to}%</b>
                      </span>
                    ))}
                  </span>
                ) : d.progress === null || d.progress === site?.progressPct ? (
                  `그대로 (${site?.progressPct ?? 0}%)`
                ) : (
                  `${site?.progressPct ?? 0}% → ${d.progress}%`
                ),
                "progress",
              )}
            {mode !== "cost" &&
              row(
                "사진",
                photos.length ? (
                  <span className="mt-1 flex gap-2">
                    {photos.map((p, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={p} alt={`사진 ${i + 1}`} className="size-16 rounded-lg object-cover" />
                    ))}
                  </span>
                ) : (
                  "없음"
                ),
                "photo",
              )}
            {mode === "photo" && memo.trim() && row("사진 설명", memo, "photo")}
            {mode === "full" && row("문제·위험", d.issueYes ? issues || "있음" : "없음", "issue")}
            {mode !== "photo" &&
              row(
                "추가 비용",
                costLines.length ? (
                  <span className="block" data-testid="confirm-costs">
                    {d.costs.map((c) => (
                      <span key={c.key} className="block">
                        {EASY_CATEGORY[c.category].label} <b className="num">{easyWon(costWon(c))}</b>
                        <span className="text-[0.98rem] text-ink-2"> · {c.impact === "within_forecast" ? "예산 안" : c.impact === "unknown" ? "예산 여부 모름" : "예산에 없던 돈"}</span>
                      </span>
                    ))}
                    <span className="mt-1 block font-bold">
                      합계 <span className="num">{easyWon(costSum)}</span> · 이유: {d.reason ? EASY_REASON[d.reason] : "기타 (고르지 않음)"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKey(null);
                        setReturnToConfirm(true);
                        go("cost-cat");
                      }}
                      className="press mt-2 inline-flex min-h-12 items-center gap-1.5 rounded-full border-2 border-dashed border-active bg-active-soft px-4 text-[1.02rem] font-bold text-theme-ink"
                      data-testid="confirm-cost-more"
                    >
                      <Plus size={18} aria-hidden /> 비용 하나 더
                    </button>
                  </span>
                ) : (
                  "없음"
                ),
                mode === "cost" ? "cost-list" : "cost",
              )}
            {/* 추가 비용만 보낼 때도 영수증·현장 사진을 붙일 수 있게 — 화면을 늘리지 않고 확인 화면에서 바로 (D-67) */}
            {mode === "cost" && (
              <div className="border-b border-line py-3.5 last:border-b-0" data-testid="confirm-receipt">
                <p className="text-[0.98rem] font-bold text-ink-2">영수증·현장 사진 (선택)</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {photos.map((p, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={p} alt={`사진 ${i + 1}`} className="size-16 rounded-lg object-cover" />
                  ))}
                  {photos.length < 3 && (
                    <label className="press inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border-2 border-line-strong bg-surface px-4 text-[1.02rem] font-bold">
                      <Camera size={20} aria-hidden /> {photos.length ? "한 장 더" : "사진 찍기"}
                      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onFiles(e.target.files, e.currentTarget)} data-testid="receipt-camera" />
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>
          {consented && (
            <p className="flex items-center gap-2 text-[1.02rem] text-ink-2" data-testid="confirm-geo">
              <MapPin size={18} aria-hidden /> 보내는 곳: {geo ? geoText(judgeGeo(site, geo.sample ?? null, geo.noLocation)) : "위치 확인 중…"}
            </p>
          )}
          {costLines.length > 0 && <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[1.02rem] text-ink-2">{review ? "추가 비용은 본사 공무가 확인한 뒤 회사 손익에 반영됩니다." : "보내면 추가 비용이 회사 손익 계산에 바로 들어갑니다."}</p>}
          {netFail && (
            <div className="rounded-2xl border-2 border-warn/50 bg-warn-bg p-4" role="alert" data-testid="net-fail">
              <p className="flex items-center gap-2 text-[1.15rem] font-extrabold text-ink">
                <WifiOff size={22} aria-hidden /> 인터넷이 약해서 아직 못 보냈어요
              </p>
              <p className="mt-1 text-[1.02rem] text-ink-2">내용은 휴대폰에 남아 있어요. 신호가 잡히면 자동으로 다시 보내고, 아래 버튼을 눌러도 됩니다.</p>
            </div>
          )}
          {error && <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.05rem] font-semibold text-err">{error}</p>}
        </EasyQuestion>
        </>
      );
      footer = bar({
        onBack: stack.length > 1 ? back : onExit,
        backLabel: stack.length > 1 ? "이전" : "닫기",
        onNext: send,
        nextLabel: netFail ? "다시 보내기" : "본사로 보내기",
        nextTestId: "submit-report",
        loading: sending,
        // 비용 이유는 고르지 않아도 보낼 수 있다 (안 고르면 ‘기타’) — 이어 쓰기에서 이유 없이 회색 버튼만 보이던 문제 (D-66)
        nextDisabled: !site || !hasWork || (mode === "cost" && costLines.length === 0),
        hint: mode === "cost" && costLines.length === 0 ? "비용을 하나 이상 넣어 주세요" : undefined,
      });
      if (!hasWork) footer = bar({ onBack: stack.length > 1 ? back : onExit, backLabel: stack.length > 1 ? "이전" : "닫기", onNext: send, nextLabel: "본사로 보내기", nextTestId: "submit-report", nextDisabled: true, hint: "‘고치기’를 눌러 작업을 넣어 주세요" });
      break;
    }
  }

  return (
    <div ref={topRef} className={cx("scroll-mt-24", embedded ? "space-y-6" : "flex min-h-[calc(100dvh-12.5rem)] flex-col gap-6 lg:min-h-0")} data-testid="easy-report" data-step={step}>
      {header}
      <div key={step + (editingKey ?? "")} className="anim-fade-up">
        {body}
      </div>
      {step === "confirm" && sending && (
        <p className="flex items-center justify-center gap-2 text-[1.05rem] text-ink-2">
          <Clock3 size={18} aria-hidden /> 보내는 중이에요…
        </p>
      )}
      {embedded ? footer : <AtBottom bar={footer} />}
    </div>
  );
}

/** 진행 중 공정 → 시작 전 → 끝난 공정 순 */
function rank(p: number) {
  return p > 0 && p < 100 ? 0 : p === 0 ? 1 : 2;
}

function firstStep(mode: EasyMode, needSite: boolean): StepId {
  if (needSite) return "site";
  return mode === "photo" ? "photo" : mode === "cost" ? "cost-cat" : "work";
}

function flowOrder(mode: EasyMode, needSite: boolean, withCost: boolean, withProgress = true): StepId[] {
  const head: StepId[] = needSite ? ["site"] : [];
  if (mode === "photo") return [...head, "photo", "confirm"];
  if (mode === "cost") return [...head, "cost-cat", "cost-amt", "cost-kind", "cost-list", "cost-reason", "confirm"];
  return [...head, "work", ...(withProgress ? (["progress"] as StepId[]) : []), "photo", "issue", "cost", ...(withCost ? (["cost-cat", "cost-amt", "cost-kind", "cost-list", "cost-reason"] as StepId[]) : []), "confirm"];
}
