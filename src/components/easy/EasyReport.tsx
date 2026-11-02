"use client";

/**
 * 쉬운 현장 보고 — 한 화면에 질문 하나, 누르기만 해도 끝나도록.
 * 저장 경로는 기존 현장 보고와 같다 (submitFieldReport 명령) → 본사 손익·위험 분석에 그대로 반영.
 * mode: full = 오늘 보고 / photo = 사진만 보내기 / cost = 추가 비용만 알리기
 */
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
import { CommandError, type CostLineInput } from "@/lib/data/commands";
import { DEMO_SCENARIO } from "@/lib/data/seed";
import type { CostCategory, CostReason, GeoStamp, Site } from "@/lib/domain/types";
import { geoText, judgeGeo, type GeoSample } from "@/lib/domain/geo";
import { locateOnce } from "@/lib/geo/client";
import { todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { cx } from "@/components/ui/primitives";
import { BigNumber, Chip, Choice, EasyBar, EasyQuestion, SectionBar, Stepper, VoiceHint, easyTextareaCls } from "./ui";
import { DEFAULT_WORK, EASY_CATEGORY, EASY_CATEGORY_ORDER, EASY_REASON, EASY_REASON_ORDER, ISSUE_CHIPS, NO_WORK, easyDate, easyWon } from "./words";
import { downscalePhoto } from "./photo";

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
  const [d, setD] = useState<Draft>(() => emptyDraft(initialSite));
  const [photos, setPhotos] = useState<string[]>([]);
  const [memo, setMemo] = useState("");
  const [stack, setStack] = useState<StepId[]>(() => [firstStep(mode, !initialSite)]);
  const [returnToConfirm, setReturnToConfirm] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => uid("idem"));
  const [sending, setSending] = useState(false);
  const [netFail, setNetFail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resume, setResume] = useState<Draft | null>(null);
  const [done, setDone] = useState<{ reportId?: string; pendingReview?: boolean; costSum: number; already?: boolean; siteName: string } | null>(null);
  const [undoAsk, setUndoAsk] = useState(false);
  const [undone, setUndone] = useState(false);
  const [dateEdit, setDateEdit] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  // 보내는 곳 (위치 기록에 동의한 사람만, 확인 화면에서 1번)
  const consented = !!db && (db.consents ?? []).some((c) => c.userId === userId);
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
    topRef.current?.scrollIntoView({ block: "start" });
  }, [rawStep, done]);

  if (!db) return null;
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

  const order = flowOrder(mode, !fixedSiteId && sites.length > 1, d.costYes === true);
  const sections = Array.from(new Set(order.map((s) => SECTION_OF[s])));
  const nextAfter = (s: StepId): StepId => order[Math.min(order.indexOf(s) + 1, order.length - 1)];

  // ───────── 보낼 내용 만들기 ─────────
  const workDone =
    mode === "photo"
      ? memo.trim() || "현장 사진 보고"
      : mode === "cost"
        ? "추가 비용 보고"
        : [...d.work, d.workText.trim()].filter(Boolean).join(", ");
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
  const unknownImpact = d.costs.some((c) => c.impact === "unknown");

  const send = async () => {
    if (sending || !site) return;
    setSending(true);
    setError(null);
    try {
      const result = await run("submitFieldReport", {
        idempotencyKey: idemKey,
        siteId: site.id,
        reportDate: d.reportDate,
        workDone,
        issues,
        photos: photos.map((p) => ({ dataUrl: p })),
        costs: costLines,
        reason: costLines.length ? d.reason || "other" : undefined,
        reasonNote: unknownImpact ? "예산 포함 여부: 현장에서 모름 — 본사 확인 필요" : "",
        source: "FIELD",
        geo: geo ?? { noLocation: consented ? "timeout" : "skipped" },
        ...(d.progress !== null && d.progress !== site.progressPct ? { progressPct: d.progress } : {}),
      });
      clearDraft();
      setNetFail(false);
      setDone({ reportId: result.reportId, pendingReview: result.pendingReview, costSum, siteName: site.shortName });
    } catch (e) {
      if (e instanceof CommandError && e.code === "NETWORK") {
        setNetFail(true);
      } else if (e instanceof CommandError && e.code === "DUPLICATE") {
        // 이미 서버에 저장된 보고 (연결이 끊긴 사이 저장된 경우)
        clearDraft();
        setNetFail(false);
        setDone({ costSum, already: true, siteName: site.shortName });
      } else {
        setError(e instanceof Error ? e.message : "보내지 못했습니다. 다시 눌러 주세요.");
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
      setError(e instanceof Error ? e.message : "취소하지 못했습니다.");
    }
  };

  const bar = (p: Parameters<typeof EasyBar>[0]) => <EasyBar embedded={embedded} {...p} />;

  // ───────── 보낸 뒤 ─────────
  if (done) {
    return (
      <div ref={topRef} className="anim-pop space-y-5 pb-4" data-testid="report-done">
        <div className="flex flex-col items-center gap-3 pt-4 text-center">
          <span className={cx("grid size-24 place-items-center rounded-full", undone ? "bg-surface-3 text-ink-2" : "bg-ok-bg text-ok")}>
            {undone ? <Undo2 size={46} /> : <CircleCheck size={52} />}
          </span>
          <p className="text-[1.7rem] font-extrabold leading-tight">{undone ? "보낸 보고를 취소했어요" : done.already ? "이미 보낸 보고예요" : "본사로 보냈습니다"}</p>
          <p className="text-[1.1rem] text-ink-2">
            {done.siteName} · {easyDate(d.reportDate)}
          </p>
        </div>
        {!undone && done.costSum > 0 && (
          <div className="rounded-2xl border-2 border-line bg-surface-2 p-4 text-[1.1rem] leading-relaxed" data-testid="report-impact" data-pending={done.pendingReview ? "1" : undefined}>
            추가 비용 <b className="num">{easyWon(done.costSum)}</b>
            {done.pendingReview ? " — 본사 공무가 확인한 뒤 회사 손익에 반영돼요." : " — 회사 손익에 바로 반영됐어요."}
          </div>
        )}
        {!undone && (
          <p className="text-center text-[1.05rem] text-ink-2">
            잘못 보냈다면 아래 <b>‘보낸 것 취소하기’</b>를 누르세요.
          </p>
        )}
        {error && <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.05rem] font-semibold text-err">{error}</p>}
        <div className="space-y-2.5">
          {!undone && done.reportId && !undoAsk && (
            <button type="button" onClick={() => setUndoAsk(true)} className="press flex h-[3.8rem] w-full items-center justify-center gap-2 rounded-2xl border-2 border-line-strong bg-surface text-[1.12rem] font-bold" data-testid="report-undo-ask">
              <Undo2 size={22} aria-hidden /> 보낸 것 취소하기
            </button>
          )}
          {undoAsk && (
            <div className="rounded-2xl border-2 border-err/40 bg-err-bg p-4" role="alertdialog" aria-label="보고 취소 확인">
              <p className="text-[1.15rem] font-bold text-ink">정말 취소할까요? 본사 화면에서도 빠집니다.</p>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <button type="button" onClick={() => setUndoAsk(false)} className="press h-[3.6rem] rounded-2xl border-2 border-line-strong bg-surface text-[1.1rem] font-bold">
                  아니요
                </button>
                <button type="button" onClick={undo} className="press h-[3.6rem] rounded-2xl bg-err text-[1.1rem] font-bold text-white" data-testid="report-undo">
                  네, 취소할게요
                </button>
              </div>
            </div>
          )}
          <button type="button" onClick={restart} className="press flex h-[4rem] w-full items-center justify-center rounded-2xl bg-cta text-[1.2rem] font-extrabold text-cta-text" data-testid="report-again">
            보고 하나 더 하기
          </button>
          {embedded && onExit ? (
            <button type="button" onClick={onExit} className="press flex h-[3.8rem] w-full items-center justify-center rounded-2xl border-2 border-line-strong bg-surface text-[1.12rem] font-bold">
              닫기
            </button>
          ) : (
            <Link href="/field" className="press flex h-[3.8rem] w-full items-center justify-center rounded-2xl border-2 border-line-strong bg-surface text-[1.12rem] font-bold" data-testid="report-home">
              처음 화면으로
            </Link>
          )}
        </div>
      </div>
    );
  }

  const demoFill = !IS_LIVE && (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-[#FFF7D6] px-3 py-2 text-[0.85rem] text-[#7A5200]">
      <span>DEMO · 미팅 시나리오 값</span>
      <button type="button" onClick={fillDemo} className="press inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/70 px-2.5 py-1.5 font-bold hover:bg-white" data-testid="fill-demo">
        <Wand2 size={15} aria-hidden /> 데모 값 채우기
      </button>
    </div>
  );

  // ───────── 쓰던 보고 이어서 ─────────
  if (resume) {
    return (
      <div ref={topRef} className="space-y-5 pb-4">
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
            <Choice
              icon={<Trash2 size={24} />}
              label="지우고 새로 쓰기"
              onClick={() => {
                clearDraft();
                setResume(null);
              }}
              testId="resume-no"
            />
          </div>
        </EasyQuestion>
      </div>
    );
  }

  const header = (
    <div className="space-y-3">
      {demoFill}
      <SectionBar sections={sections} current={Math.max(0, sections.indexOf(SECTION_OF[step]))} />
      {site && step !== "site" && (
        <p className="flex items-center gap-1.5 text-[1rem] font-semibold text-ink-2">
          <HardHat size={18} aria-hidden /> {site.shortName} · {site.workType}
        </p>
      )}
    </div>
  );

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  switch (step) {
    case "site":
      body = (
        <EasyQuestion title="어느 현장 보고인가요?">
          <div className="space-y-2.5">
            {sites.map((s) => (
              <Choice
                key={s.id}
                icon={<HardHat size={24} />}
                label={s.shortName}
                sub={s.workType}
                selected={d.siteId === s.id}
                onClick={() => {
                  set({ siteId: s.id });
                  proceed(nextAfter("site"));
                }}
                testId={`easy-site-${s.id}`}
              />
            ))}
          </div>
        </EasyQuestion>
      );
      footer = onExit ? bar({ onBack: onExit, backLabel: "닫기" }) : null;
      break;

    case "work": {
      const stageNames = site && site.stages.length ? [...site.stages].sort((a, b) => rank(a.progressPct) - rank(b.progressPct)).slice(0, 6).map((st) => st.name) : DEFAULT_WORK;
      const toggle = (w: string) => set({ work: d.work.includes(w) ? d.work.filter((x) => x !== w) : w === NO_WORK ? [NO_WORK] : [...d.work.filter((x) => x !== NO_WORK), w] });
      const ok = d.work.length > 0 || !!d.workText.trim();
      body = (
        <EasyQuestion title="오늘 무슨 작업을 했나요?" help="해당하는 것을 모두 누르세요." testId="easy-work">
          <div className="flex flex-wrap gap-2.5">
            {stageNames.map((name) => (
              <Chip key={name} selected={d.work.includes(name)} onClick={() => toggle(name)} testId="work-chip">
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
        <EasyQuestion title={mode === "photo" ? "보낼 사진을 찍어 주세요" : "작업 사진을 찍어 주세요"} help="3장까지 보낼 수 있어요. 없으면 ‘사진 없이 다음’을 누르세요." testId="easy-photo">
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
      footer = bar({ onBack: back, onNext: d.issueYes ? () => proceed(nextAfter("issue")) : undefined, nextDisabled: d.issueYes === true && d.issueChips.length === 0 && !d.issueText.trim() });
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
                    const n = Number(e.target.value.replace(/[^\d]/g, "").slice(0, 7));
                    setCost({ amountMan: Number.isFinite(n) ? n : 0 });
                  }}
                  className="num h-[4.2rem] min-w-0 flex-1 bg-transparent text-right text-[2rem] font-extrabold outline-none"
                  placeholder="0"
                  data-testid="cost-amount"
                />
                <span className="shrink-0 text-[1.4rem] font-bold text-ink-2">만 원</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[10, 50, 100, 500, 1000].map((m) => (
                  <button key={m} type="button" onClick={() => setCost({ amountMan: editing.amountMan + m })} className="press h-[3.6rem] rounded-2xl bg-surface-3 text-[1.15rem] font-extrabold text-ink" data-testid={`amt-plus-${m}`}>
                    +{m.toLocaleString("ko-KR")}만
                  </button>
                ))}
                <button type="button" onClick={() => setCost({ amountMan: 0 })} className="press h-[3.6rem] rounded-2xl border-2 border-line-strong text-[1.1rem] font-bold text-ink-2">
                  다시 넣기
                </button>
              </div>
              {editing.amountMan >= 10_000 && <BigNumber testId="cost-readback">{easyWon(won)}</BigNumber>}
            </div>
          )}
        </EasyQuestion>
      );
      footer = bar({ onBack: back, onNext: () => go("cost-kind"), nextDisabled: won <= 0, hint: won <= 0 ? "금액을 넣어 주세요" : undefined });
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
                  go("cost-list");
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
      const hasWork = mode !== "full" || d.work.length > 0 || !!d.workText.trim();
      body = (
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
                {dateEdit && <input type="date" aria-label="보고 날짜" value={d.reportDate} max={todayIso()} onChange={(e) => e.target.value && set({ reportDate: e.target.value })} className="min-h-12 rounded-xl border-2 border-line-strong px-3 text-[1.05rem]" />}
              </span>,
              null,
            )}
            {mode === "full" && row("오늘 한 작업", workDone || <span className="text-err">작업을 넣어 주세요</span>, "work", "confirm-work")}
            {mode === "full" && row("진행률", d.progress === null || d.progress === site?.progressPct ? `그대로 (${site?.progressPct ?? 0}%)` : `${site?.progressPct ?? 0}% → ${d.progress}%`, "progress")}
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
                      합계 <span className="num">{easyWon(costSum)}</span> · 이유: {d.reason ? EASY_REASON[d.reason] : "선택 안 함"}
                    </span>
                  </span>
                ) : (
                  "없음"
                ),
                mode === "cost" ? "cost-list" : "cost",
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
      );
      footer = bar({
        onBack: stack.length > 1 ? back : onExit,
        backLabel: stack.length > 1 ? "이전" : "닫기",
        onNext: send,
        nextLabel: netFail ? "다시 보내기" : "본사로 보내기",
        nextTestId: "submit-report",
        loading: sending,
        nextDisabled: !site || !hasWork || (costLines.length > 0 && !d.reason),
        hint: !hasWork ? "‘고치기’를 눌러 작업을 넣어 주세요" : undefined,
      });
      break;
    }
  }

  return (
    <div ref={topRef} className="space-y-6" data-testid="easy-report" data-step={step}>
      {header}
      <div key={step + (editingKey ?? "")} className="anim-fade-up">
        {body}
      </div>
      {step === "confirm" && sending && (
        <p className="flex items-center justify-center gap-2 text-[1.05rem] text-ink-2">
          <Clock3 size={18} aria-hidden /> 보내는 중이에요…
        </p>
      )}
      {footer}
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

function flowOrder(mode: EasyMode, needSite: boolean, withCost: boolean): StepId[] {
  const head: StepId[] = needSite ? ["site"] : [];
  if (mode === "photo") return [...head, "photo", "confirm"];
  if (mode === "cost") return [...head, "cost-cat", "cost-amt", "cost-kind", "cost-list", "cost-reason", "confirm"];
  return [...head, "work", "progress", "photo", "issue", "cost", ...(withCost ? (["cost-cat", "cost-amt", "cost-kind", "cost-list", "cost-reason"] as StepId[]) : []), "confirm"];
}
