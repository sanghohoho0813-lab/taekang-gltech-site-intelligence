"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CircleCheck, Plus, Trash2, Undo2, Wand2, X, CalendarDays } from "lucide-react";
import { useDb, run } from "@/lib/data/store";
import { useMe } from "@/lib/data/hooks";
import { IS_LIVE } from "@/lib/mode";
import { CommandError, submitFieldReport, type CostLineInput, type FieldReportResult } from "@/lib/data/commands";
import { DEMO_SCENARIO } from "@/lib/data/seed";
import { CATEGORY_LABEL, COST_CATEGORIES, IMPACT_HELP, IMPACT_LABEL, REASON_LABEL } from "@/lib/domain/labels";
import type { CostCategory, CostReason } from "@/lib/domain/types";
import { fmtEok, fmtMan, fmtPct, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { Button, Field, Notice, cx, inputCls } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";

interface CostRow {
  key: string;
  category: CostCategory;
  amountText: string;
  impact: "additional" | "within_forecast";
  note: string;
  /** 노무비를 공수 × 일당으로 입력 */
  byQty?: boolean;
  manDays?: string;
  dayRate?: string;
}

/** 공수 × 일당 → 원 (공수는 0.5 단위까지) */
function qtyAmount(c: CostRow): number {
  const md = Number((c.manDays ?? "").replace(/[^\d.]/g, ""));
  const rate = parseAmount(c.dayRate ?? "");
  return md > 0 && rate > 0 ? Math.round(md * rate) : NaN;
}

const REASONS: CostReason[] = ["design_change", "price_increase", "quantity_increase", "rework", "schedule", "planned", "other"];

function parseAmount(t: string): number {
  const c = t.replace(/[^\d]/g, "");
  return c ? Number(c) : NaN;
}
function withCommas(t: string) {
  const c = t.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
  return c ? Number(c).toLocaleString("ko-KR") : "";
}

async function downscale(file: File, max = 960): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("이미지를 읽을 수 없습니다."));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const DRAFT_KEY = "tk-site-intel:draft:";

export function FieldReportForm({ fixedSiteId, onClose, inSheet = false }: { fixedSiteId?: string; onClose?: () => void; inSheet?: boolean }) {
  const db = useDb();
  const { role, userId, canSeeMoney } = useMe();
  const toast = useToast();
  const mySites = useMemo(() => {
    if (!db) return [];
    // LIVE에서는 서버가 이미 담당 현장만 보내므로 그대로 사용
    return role === "field" && !IS_LIVE ? db.sites.filter((s) => s.fieldUserId === userId) : db.sites;
  }, [db, role, userId]);

  const [siteId, setSiteId] = useState(fixedSiteId ?? "");
  const [reportDate, setReportDate] = useState(todayIso());
  const [workDone, setWorkDone] = useState("");
  const [issues, setIssues] = useState("");
  const [tomorrowPlan, setTomorrowPlan] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [reason, setReason] = useState<CostReason | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const [progressText, setProgressText] = useState("");
  const [idemKey, setIdemKey] = useState(() => uid("idem"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  // LIVE에서 현장직원은 서버가 금액(before/after)을 빼고 돌려준다 → 선택 항목으로 다룬다
  const [done, setDone] = useState<(Omit<FieldReportResult, "before" | "after"> & Partial<Pick<FieldReportResult, "before" | "after">> & { siteId: string; siteName: string; costSum: number }) | null>(null);
  const [undone, setUndone] = useState(false);
  const [draftNotice, setDraftNotice] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!siteId && mySites[0]) setSiteId(fixedSiteId ?? mySites[0].id);
  }, [mySites, siteId, fixedSiteId]);

  // 임시저장 불러오기
  useEffect(() => {
    if (!siteId) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY + siteId);
      if (!raw) return;
      const d = JSON.parse(raw);
      setWorkDone(d.workDone ?? "");
      setIssues(d.issues ?? "");
      setTomorrowPlan(d.tomorrowPlan ?? "");
      setCosts(d.costs ?? []);
      setReason(d.reason ?? "");
      setReasonNote(d.reasonNote ?? "");
      setDraftNotice(true);
    } catch {
      // 무시
    }
  }, [siteId]);

  const costLines: CostLineInput[] = costs.map((c) =>
    c.byQty && c.category === "labor"
      ? { category: c.category, amount: qtyAmount(c), forecastImpact: c.impact, note: c.note, qty: { manDays: Number((c.manDays ?? "").replace(/[^\d.]/g, "")), dayRate: parseAmount(c.dayRate ?? "") } }
      : { category: c.category, amount: parseAmount(c.amountText), forecastImpact: c.impact, note: c.note },
  );
  const progressPct = progressText.trim() === "" ? undefined : Math.max(0, Math.min(100, Math.round(Number(progressText))));

  const input = {
    idempotencyKey: idemKey,
    siteId,
    reportDate,
    workDone,
    issues,
    tomorrowPlan,
    photos: photos.map((p) => ({ dataUrl: p })),
    costs: costLines,
    reason: reason || undefined,
    reasonNote,
    source: (inSheet || role === "field" ? "FIELD" : "PC") as "FIELD" | "PC",
    ...(progressPct !== undefined && Number.isFinite(progressPct) ? { progressPct } : {}),
  };

  // 저장 전 영향 미리보기 — 같은 계산 엔진에 가상으로 적용 (저장하지 않음)
  const preview = useMemo(() => {
    if (!db || !siteId || costLines.length === 0) return null;
    if (costLines.some((c) => !Number.isInteger(c.amount) || c.amount <= 0)) return null;
    try {
      const { result } = submitFieldReport(db, { ...input, photos: [], idempotencyKey: "preview", reason: input.reason ?? "other", workDone: workDone || "미리보기" }, { userId });
      return result;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, siteId, JSON.stringify(costLines)]);

  if (!db) return null;
  const site = db.sites.find((s) => s.id === siteId);

  const fillDemo = () => {
    setSiteId(DEMO_SCENARIO.siteId);
    setWorkDone(DEMO_SCENARIO.workDone);
    setIssues(DEMO_SCENARIO.issues);
    setTomorrowPlan(DEMO_SCENARIO.tomorrowPlan);
    setCosts(DEMO_SCENARIO.costs.map((c) => ({ key: uid("row"), category: c.category, amountText: c.amount.toLocaleString("ko-KR"), impact: "additional", note: c.note })));
    setReason(DEMO_SCENARIO.reason);
    setErrors({});
  };

  const resetForm = () => {
    setProgressText("");
    setWorkDone("");
    setIssues("");
    setTomorrowPlan("");
    setPhotos([]);
    setCosts([]);
    setReason("");
    setReasonNote("");
    setErrors({});
    setIdemKey(uid("idem"));
    setDone(null);
    setUndone(false);
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await run("submitFieldReport", input);
      try {
        localStorage.removeItem(DRAFT_KEY + siteId);
      } catch {
        // 무시
      }
      const costSum = costLines.reduce((s, c) => s + c.amount, 0);
      setDone({ ...result, siteId, siteName: site?.shortName ?? "", costSum });
      setErrors({});
      toast.push({
        tone: "ok",
        title: "현장 보고가 등록되었습니다",
        desc: costLines.length ? `원가 ${costLines.length}건 ${fmtMan(costSum)} → 본사 손익에 즉시 반영` : "작업 내용이 저장되었습니다",
        action: { label: "되돌리기", onClick: () => undo(result.reportId) },
      });
    } catch (e) {
      if (e instanceof CommandError) {
        setErrors(e.fieldErrors);
        if (e.code === "DUPLICATE") toast.push({ tone: "info", title: e.message });
        else if (!Object.keys(e.fieldErrors).length) toast.push({ tone: "err", title: e.message });
      } else toast.push({ tone: "err", title: "저장하지 못했습니다", desc: String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const undo = async (reportId: string) => {
    try {
      await run("voidReport", { reportId });
      setUndone(true);
      toast.push({ tone: "info", title: "현장 보고를 되돌렸습니다", desc: "포함된 원가가 무효 처리되어 손익이 원래대로 계산됩니다." });
    } catch (e) {
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "되돌리기 실패" });
    }
  };

  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY + siteId, JSON.stringify({ workDone, issues, tomorrowPlan, costs, reason, reasonNote }));
      toast.push({ tone: "ok", title: "임시저장했습니다", desc: "사진은 임시저장되지 않습니다. 보고 등록 전까지 손익에 반영되지 않습니다." });
    } catch {
      toast.push({ tone: "err", title: "임시저장 실패" });
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const room = 3 - photos.length;
    const list = Array.from(files).slice(0, room);
    try {
      const urls = await Promise.all(list.map((f) => downscale(f)));
      setPhotos((p) => [...p, ...urls].slice(0, 3));
      if (files.length > room) toast.push({ tone: "info", title: "사진은 최대 3장까지 첨부됩니다" });
    } catch (e) {
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "사진 첨부 실패" });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  if (done) {
    return (
      <div className="anim-pop space-y-4" data-testid="report-done">
        <div className="flex flex-col items-center gap-2 pt-2 text-center">
          <span className={cx("grid size-14 place-items-center rounded-full", undone ? "bg-surface-3 text-ink-3" : "bg-ok-bg text-ok")}>
            {undone ? <Undo2 size={28} /> : <CircleCheck size={30} />}
          </span>
          <p className="text-[1.15rem] font-bold">{undone ? "보고를 되돌렸습니다" : "현장 보고 등록 완료"}</p>
          <p className="text-[0.85rem] text-ink-3">{done.siteName} · {reportDate}</p>
        </div>
        {!undone && done.costSum > 0 && done.pendingReview && (
          <div className="rounded-2xl border border-line bg-surface-2 p-4" data-testid="report-impact" data-pending="1">
            <p className="text-[0.82rem] font-bold text-ink">저장 완료 → 본사 공무 확인 대기</p>
            <p className="mt-1.5 text-[0.88rem] text-ink-2">
              입력한 원가 <b className="num">{fmtMan(done.costSum)}</b>은 본사 공무가 견적·세금계산서로 확인한 뒤 손익에 반영됩니다.
            </p>
          </div>
        )}
        {!undone && done.costSum > 0 && !done.pendingReview && (
          <div className="rounded-2xl border border-line bg-surface-2 p-4" data-testid="report-impact">
            <p className="text-[0.82rem] font-bold text-ink">공통 데이터에 저장 → 본사 손익에 즉시 반영</p>
            {canSeeMoney && done.before && done.after ? (
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                {[
                  ["총예상원가", fmtEok(done.before.eac), fmtEok(done.after.eac)],
                  ["예상이익", fmtEok(done.before.expectedProfit), fmtEok(done.after.expectedProfit)],
                  ["이익률", fmtPct(done.before.marginPct), fmtPct(done.after.marginPct)],
                ].map(([k, a, b]) => (
                  <div key={k} className="rounded-xl bg-surface p-2">
                    <dt className="text-[0.7rem] text-ink-3">{k}</dt>
                    <dd className="num text-[0.78rem] text-ink-3 line-through">{a}</dd>
                    <dd className="num text-[0.95rem] font-extrabold text-ink">{b}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-1.5 text-[0.88rem] text-ink-2">
                입력한 원가 <b className="num">{fmtMan(done.costSum)}</b>이 본사 손익 계산에 반영되었습니다. (이익률은 대표·관리자 화면에서 확인{IS_LIVE ? "" : " — 권한 프리뷰"})
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {!undone && (
            <Button onClick={() => undo(done.reportId)} icon={<Undo2 size={17} />} data-testid="report-undo">
              되돌리기
            </Button>
          )}
          <Button variant="cta" onClick={resetForm} className={undone ? "col-span-2" : ""}>
            새 보고 작성
          </Button>
          {onClose && (
            <Button variant="ghost" onClick={onClose} className="col-span-2">
              닫기
            </Button>
          )}
          {!onClose && done && (
            <Link href={`/sites/${done.siteId}`} className="col-span-2">
              <Button variant="ghost" block>
                현장 상세 보기
              </Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  const workCount = `${workDone.length}/500`;

  return (
    <form
      className="@container space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
      data-testid="field-report-form"
    >
      {!IS_LIVE && <div className="flex items-center justify-between gap-2 rounded-xl bg-[#FFF7D6] px-3 py-2 text-[0.78rem] text-[#7A5200]">
        <span>DEMO · 미팅 시나리오 값을 자동으로 채울 수 있습니다</span>
        <button type="button" onClick={fillDemo} className="press inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/70 px-2 py-1 font-bold hover:bg-white" data-testid="fill-demo">
          <Wand2 size={14} aria-hidden /> 데모 값 채우기
        </button>
      </div>}
      {draftNotice && (
        <Notice tone="info" title="임시저장된 보고를 불러왔습니다">
          보고 등록 전까지는 손익에 반영되지 않습니다.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-3 @min-[520px]:grid-cols-2">
        <Field label="현장" htmlFor="f-site" required>
          <select id="f-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputCls} disabled={!!fixedSiteId}>
            {mySites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shortName} · {s.workType}
              </option>
            ))}
          </select>
        </Field>
        <Field label="보고일" htmlFor="f-date" required error={errors.reportDate}>
          <div className="relative">
            <CalendarDays size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
            <input id="f-date" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className={cx(inputCls, "pl-10")} />
          </div>
        </Field>
      </div>

      <Field label="오늘의 작업 내용" htmlFor="f-work" required counter={workCount} error={errors.workDone}>
        <textarea id="f-work" rows={3} maxLength={500} value={workDone} onChange={(e) => setWorkDone(e.target.value)} className={inputCls} placeholder="예) 3층 남측 커튼월 유닛 10개 설치 완료" />
      </Field>

      {site && (
        <Field label="오늘 기준 공정률 (선택)" htmlFor="f-progress" error={errors.progressPct} hint={`현재 ${site.progressPct}% — 바뀌었을 때만 입력`}>
          <div className="flex items-center gap-2">
            <input id="f-progress" type="number" inputMode="numeric" min={0} max={100} value={progressText} onChange={(e) => setProgressText(e.target.value)} className={cx(inputCls, "num w-28 text-right")} placeholder={String(site.progressPct)} />
            <span className="text-ink-3">%</span>
          </div>
        </Field>
      )}

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[0.88rem] font-semibold text-ink">작업 사진</span>
          <span className="text-[0.75rem] text-ink-3 num">{photos.length}/3</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative aspect-square overflow-hidden rounded-xl border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt={`첨부 사진 ${i + 1}`} className="h-full w-full object-cover" />
              <button type="button" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="press absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-black/60 text-white" aria-label={`사진 ${i + 1} 삭제`}>
                <X size={15} />
              </button>
            </div>
          ))}
          {photos.length < 3 && (
            <label className="press flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong bg-surface-2 text-[0.72rem] font-semibold text-ink-3 hover:border-active hover:text-theme-ink">
              <Camera size={22} aria-hidden />
              사진 추가
              <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => onFiles(e.target.files)} />
            </label>
          )}
        </div>
        <p className="text-[0.72rem] text-ink-3">{IS_LIVE ? "사진은 축소해서 회사 서버에 저장되고, 대표·관리자와 담당 현장 직원만 볼 수 있습니다." : "사진은 이 브라우저의 DEMO 저장소에 축소 저장됩니다 (외부 전송 없음)."}</p>
      </div>

      <Field label="이슈 / 위험 사항" htmlFor="f-issue" counter={`${issues.length}/500`}>
        <textarea id="f-issue" rows={2} maxLength={500} value={issues} onChange={(e) => setIssues(e.target.value)} className={cx(inputCls, issues && "border-warn/40 bg-warn-bg/60")} placeholder="예) 강풍으로 타워크레인 작업 일시 중지" />
      </Field>

      {/* 추가 비용 — 공통 원가 데이터로 저장 */}
      <div className="rounded-2xl border border-line bg-surface-2 p-3.5" data-testid="cost-section">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[0.92rem] font-bold text-ink">추가 비용 (개략 금액)</p>
            <p className="text-[0.74rem] text-ink-3">부가세 별도 · 개략이면 충분 — 본사 공무가 견적·세금계산서로 확정</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="soft"
            icon={<Plus size={16} />}
            onClick={() => setCosts((c) => [...c, { key: uid("row"), category: "material", amountText: "", impact: "additional", note: "" }])}
            data-testid="add-cost"
          >
            비용 추가
          </Button>
        </div>
        {costs.length === 0 && <p className="mt-2 text-[0.8rem] text-ink-3">비용이 없으면 작업 보고만 등록됩니다.</p>}
        <div className="mt-3 space-y-3">
          {costs.map((c, i) => {
            const amt = parseAmount(c.amountText);
            return (
              <div key={c.key} className="rounded-xl border border-line bg-surface p-3" data-testid={`cost-row-${i}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[0.78rem] font-bold text-ink-3">비용 {i + 1}</span>
                  <button type="button" onClick={() => setCosts((x) => x.filter((r) => r.key !== c.key))} className="press grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-err-bg hover:text-err" aria-label={`비용 ${i + 1} 삭제`}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="mt-1 grid grid-cols-1 gap-2 @min-[520px]:grid-cols-2">
                  <Field label="항목" htmlFor={`c-cat-${i}`} error={errors[`costs.${i}.category`]}>
                    <select id={`c-cat-${i}`} value={c.category} onChange={(e) => setCosts((x) => x.map((r) => (r.key === c.key ? { ...r, category: e.target.value as CostCategory } : r)))} className={inputCls}>
                      {COST_CATEGORIES.map((k) => (
                        <option key={k} value={k}>
                          {CATEGORY_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {c.byQty && c.category === "labor" ? (
                    <Field label="공수 × 일당" htmlFor={`c-md-${i}`} error={errors[`costs.${i}.amount`]} hint={Number.isFinite(qtyAmount(c)) ? `= ${fmtMan(qtyAmount(c))}` : "예) 30공수 × 300,000원"}>
                      <div className="grid grid-cols-[1fr_auto_1.4fr] items-center gap-1.5">
                        <input
                          id={`c-md-${i}`}
                          inputMode="decimal"
                          aria-label={`비용 ${i + 1} 공수`}
                          value={c.manDays ?? ""}
                          onChange={(e) => setCosts((x) => x.map((r) => (r.key === c.key ? { ...r, manDays: e.target.value.replace(/[^\d.]/g, "") } : r)))}
                          className={cx(inputCls, "num text-right font-semibold")}
                          placeholder="공수"
                        />
                        <span className="text-ink-3">×</span>
                        <input
                          inputMode="numeric"
                          aria-label={`비용 ${i + 1} 일당`}
                          value={c.dayRate ?? ""}
                          onChange={(e) => setCosts((x) => x.map((r) => (r.key === c.key ? { ...r, dayRate: withCommas(e.target.value) } : r)))}
                          className={cx(inputCls, "num text-right")}
                          placeholder="일당"
                        />
                      </div>
                    </Field>
                  ) : (
                    <Field label="금액 (원)" htmlFor={`c-amt-${i}`} error={errors[`costs.${i}.amount`]} hint={Number.isFinite(amt) && amt > 0 ? `= ${fmtMan(amt)}` : "예) 30,000,000"}>
                      <input
                        id={`c-amt-${i}`}
                        inputMode="numeric"
                        autoComplete="off"
                        value={c.amountText}
                        onChange={(e) => setCosts((x) => x.map((r) => (r.key === c.key ? { ...r, amountText: withCommas(e.target.value) } : r)))}
                        className={cx(inputCls, "num text-right font-semibold")}
                        placeholder="0"
                      />
                    </Field>
                  )}
                </div>
                {c.category === "labor" && (
                  <label className="mt-1.5 inline-flex items-center gap-2 text-[0.8rem] font-semibold text-ink-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--t-active)]"
                      checked={!!c.byQty}
                      onChange={(e) =>
                        setCosts((x) => x.map((r) => (r.key === c.key ? { ...r, byQty: e.target.checked, dayRate: r.dayRate || (db.settings?.laborDayRate ?? 300_000).toLocaleString("ko-KR") } : r)))
                      }
                      data-testid={`cost-byqty-${i}`}
                    />
                    공수 × 일당으로 입력
                  </label>
                )}
                <fieldset className="mt-2">
                  <legend className="mb-1 text-[0.8rem] font-semibold text-ink">비용 성격</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(["additional", "within_forecast"] as const).map((imp) => (
                      <label key={imp} className={cx("press cursor-pointer rounded-xl border px-3 py-2 text-[0.8rem]", c.impact === imp ? "border-active bg-active-soft" : "border-line bg-surface hover:bg-surface-2")}>
                        <input type="radio" name={`impact-${c.key}`} className="sr-only" checked={c.impact === imp} onChange={() => setCosts((x) => x.map((r) => (r.key === c.key ? { ...r, impact: imp } : r)))} />
                        <span className="block font-bold text-ink">{IMPACT_LABEL[imp]}</span>
                        <span className="block text-[0.7rem] leading-snug text-ink-3">{imp === "additional" ? "본사 예상원가 증가" : "예상원가 변동 없음"}</span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-[0.7rem] text-ink-3">{IMPACT_HELP[c.impact]}</p>
                </fieldset>
                <div className="mt-2">
                  <label htmlFor={`c-note-${i}`} className="sr-only">
                    비용 {i + 1} 메모
                  </label>
                  <input id={`c-note-${i}`} value={c.note} maxLength={100} onChange={(e) => setCosts((x) => x.map((r) => (r.key === c.key ? { ...r, note: e.target.value } : r)))} className={inputCls} placeholder="메모 (예: 변경 구간 유리 차액)" />
                </div>
              </div>
            );
          })}
        </div>
        {costs.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-2 @min-[520px]:grid-cols-2">
            <Field label="비용 발생 사유" htmlFor="f-reason" required error={errors.reason}>
              <select id="f-reason" value={reason} onChange={(e) => setReason(e.target.value as CostReason)} className={inputCls} data-testid="cost-reason">
                <option value="">선택</option>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {REASON_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="사유 상세" htmlFor="f-reason-note">
              <input id="f-reason-note" value={reasonNote} maxLength={120} onChange={(e) => setReasonNote(e.target.value)} className={inputCls} placeholder="예) 발주처 사양 변경 지시 (공문 접수)" />
            </Field>
          </div>
        )}
        {preview && (
          <div className="mt-3 rounded-xl border border-active/30 bg-active-soft px-3 py-2.5 text-[0.82rem]" data-testid="impact-preview">
            <p className="font-bold text-ink">저장하면 이렇게 반영됩니다 (미리보기 · 아직 저장 전)</p>
            {canSeeMoney ? (
              <p className="mt-0.5 num text-ink-2">
                EAC {fmtEok(preview.before.eac)} → <b>{fmtEok(preview.after.eac)}</b> · 예상이익 {fmtEok(preview.before.expectedProfit)} → <b>{fmtEok(preview.after.expectedProfit)}</b> · 이익률 {fmtPct(preview.before.marginPct)} → <b>{fmtPct(preview.after.marginPct)}</b>
              </p>
            ) : (
              // 현장 화면은 실행예산 정보가 없으므로 입력한 비용 성격 기준으로 안내 (금액 계산은 본사 화면에서)
              <p className="mt-0.5 num text-ink-2">
                실행예산 외 추가비용 <b>{fmtMan(costLines.filter((c) => c.forecastImpact === "additional").reduce((s, c) => s + c.amount, 0))}</b> → 본사 예상원가에 추가
                {costLines.some((c) => c.forecastImpact === "within_forecast") && <> · 실행예산 내 집행 {fmtMan(costLines.filter((c) => c.forecastImpact === "within_forecast").reduce((s, c) => s + c.amount, 0))}</>}
                {(db.settings?.costApproval ?? "immediate") === "review" && <> · 본사 공무 확인 후 반영</>}
              </p>
            )}
          </div>
        )}
      </div>

      <Field label="내일 작업 계획" htmlFor="f-plan" counter={`${tomorrowPlan.length}/500`}>
        <textarea id="f-plan" rows={2} maxLength={500} value={tomorrowPlan} onChange={(e) => setTomorrowPlan(e.target.value)} className={inputCls} placeholder="예) 3층 남측 실링 작업" />
      </Field>

      <div className={cx("grid grid-cols-[1fr_2fr] gap-2", inSheet && "sticky bottom-0 -mx-1 bg-surface px-1 pb-1 pt-2")}>
        <Button type="button" size="lg" onClick={saveDraft}>
          임시저장
        </Button>
        <Button type="submit" variant="cta" size="lg" loading={submitting} data-testid="submit-report">
          보고 등록
        </Button>
      </div>
    </form>
  );
}
