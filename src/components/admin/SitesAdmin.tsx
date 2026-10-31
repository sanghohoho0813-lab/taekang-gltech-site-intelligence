"use client";

/** 운영 관리 · 현장 — 등록·수정(계약·실행예산·담당·공정 단계), 잔여예상원가 재추정, 공정률 */
import { useMemo, useState } from "react";
import { Building2, Gauge, Pencil, Plus, Trash2, TrendingUp } from "lucide-react";
import type { CostCategory, DemoDB, Site, SiteStatus } from "@/lib/domain/types";
import { COST_CATEGORIES, CATEGORY_LABEL } from "@/lib/domain/labels";
import { siteFinancials } from "@/lib/domain/calc";
import { fmtEok, fmtMan, fmtPct, fmtPp, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { run } from "@/lib/data/store";
import { CommandError } from "@/lib/data/commands";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Notice, ProgressBar, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { MoneyField, PctInput, toWon, wonText } from "./inputs";

const STATUS_LABEL: Record<SiteStatus, string> = { active: "진행 중", hold: "보류", completed: "준공" };

export function SitesAdmin({ db }: { db: DemoDB }) {
  const [editing, setEditing] = useState<Site | "new" | null>(null);
  const [forecast, setForecast] = useState<Site | null>(null);
  const [progress, setProgress] = useState<Site | null>(null);
  const userName = (id: string) => db.users.find((u) => u.id === id)?.name ?? "—";

  return (
    <Card data-testid="admin-sites">
      <CardHeader
        title={`현장 ${db.sites.length}곳`}
        sub="계약금액·실행예산·담당자를 등록하면 손익·위험 계산이 바로 시작됩니다"
        right={
          <Button variant="cta" icon={<Plus size={17} />} onClick={() => setEditing("new")} data-testid="site-new">
            현장 등록
          </Button>
        }
      />
      {db.sites.length === 0 ? (
        <EmptyState icon={<Building2 size={30} />} title="등록된 현장이 없습니다" desc="‘현장 등록’으로 첫 현장의 계약금액과 실행예산을 입력하세요." />
      ) : (
        <div tabIndex={0} role="region" aria-label="현장 목록 표 (가로 스크롤)" className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[56rem] text-[0.85rem]">
            <thead>
              <tr className="border-y border-line bg-surface-2 text-left text-[0.76rem] text-ink-3">
                <th className="px-5 py-2.5">현장</th>
                <th className="px-3 py-2.5">원청·발주처</th>
                <th className="px-3 py-2.5">상태</th>
                <th className="px-3 py-2.5 text-right">계약금액</th>
                <th className="px-3 py-2.5 text-right">총예상원가</th>
                <th className="px-3 py-2.5 text-right">이익률</th>
                <th className="px-3 py-2.5">공정률</th>
                <th className="px-3 py-2.5">현장 담당</th>
                <th className="px-5 py-2.5 text-right">관리</th>
              </tr>
            </thead>
            <tbody>
              {db.sites.map((s) => {
                const f = siteFinancials(db, s.id);
                return (
                  <tr key={s.id} className="border-b border-line align-middle" data-testid="admin-site-row">
                    <td className="px-5 py-3">
                      <p className="font-bold">{s.shortName}</p>
                      <p className="text-[0.75rem] text-ink-3">
                        {s.code} · {s.name}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-ink-2">{s.clientName}</td>
                    <td className="px-3 py-3">
                      <Badge tone={s.status === "active" ? "ok" : s.status === "hold" ? "warn" : "neutral"}>{STATUS_LABEL[s.status]}</Badge>
                    </td>
                    <td className="px-3 py-3 text-right num">{fmtEok(f.adjustedContract)}</td>
                    <td className="px-3 py-3 text-right num">{fmtEok(f.eac)}</td>
                    <td className={cx("px-3 py-3 text-right num font-bold", f.marginPct < db.thresholds.targetMarginPct ? "text-err" : "text-ink")}>{fmtPct(f.marginPct)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={s.progressPct} className="w-20" />
                        <span className="num text-[0.8rem]">{s.progressPct}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-ink-2">{userName(s.fieldUserId)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setEditing(s)} data-testid="site-edit">
                          수정
                        </Button>
                        <Button size="sm" variant="ghost" icon={<TrendingUp size={14} />} onClick={() => setForecast(s)} data-testid="site-forecast">
                          잔여예상
                        </Button>
                        <Button size="sm" variant="ghost" icon={<Gauge size={14} />} onClick={() => setProgress(s)}>
                          공정률
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <SiteFormModal db={db} site={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {forecast && <ForecastModal db={db} site={forecast} onClose={() => setForecast(null)} />}
      {progress && <ProgressModal site={progress} onClose={() => setProgress(null)} />}
    </Card>
  );
}

type StageRow = { key: string; id?: string; name: string; startDate: string; endDate: string; progressPct: number };

function SiteFormModal({ db, site, onClose }: { db: DemoDB; site: Site | null; onClose: () => void }) {
  const toast = useToast();
  const contract = site ? db.contracts.find((c) => c.siteId === site.id) : undefined;
  const budget = (c: CostCategory) => (site ? db.budgets.find((b) => b.siteId === site.id && b.category === c)?.amount : undefined);
  const [f, setF] = useState({
    name: site?.name ?? "",
    shortName: site?.shortName ?? "",
    workType: site?.workType ?? "커튼월·창호",
    region: site?.region ?? "",
    clientName: site?.clientName ?? "",
    status: site?.status ?? ("active" as SiteStatus),
    startDate: site?.startDate ?? todayIso(),
    endDate: site?.endDate ?? "",
    signedDate: contract?.signedDate ?? "",
    fieldUserId: site?.fieldUserId ?? "",
    managerUserId: site?.managerUserId ?? "",
    contract: wonText(contract?.contractAmount),
  });
  const [budgets, setBudgets] = useState<Record<CostCategory, string>>(() => Object.fromEntries(COST_CATEGORIES.map((c) => [c, wonText(budget(c))])) as Record<CostCategory, string>);
  const [stages, setStages] = useState<StageRow[]>(() => (site?.stages ?? []).map((s) => ({ key: s.id, ...s })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => uid("idem"));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const budgetNums = Object.fromEntries(COST_CATEGORIES.map((c) => [c, toWon(budgets[c]) || 0])) as Record<CostCategory, number>;
  const budgetSum = COST_CATEGORIES.reduce((s, c) => s + budgetNums[c], 0);
  const contractNum = toWon(f.contract);
  const plannedMargin = contractNum > 0 && budgetSum > 0 ? ((contractNum - budgetSum) / contractNum) * 100 : null;
  const fieldUsers = db.users.filter((u) => u.role === "field" && !u.inactive);
  const managers = db.users.filter((u) => (u.role === "manager" || u.role === "ceo") && !u.inactive);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await run("saveSite", {
        id: site?.id,
        name: f.name,
        shortName: f.shortName,
        workType: f.workType,
        region: f.region,
        clientName: f.clientName,
        status: f.status,
        startDate: f.startDate,
        endDate: f.endDate,
        signedDate: f.signedDate || undefined,
        fieldUserId: f.fieldUserId || undefined,
        managerUserId: f.managerUserId || undefined,
        contractAmount: Number.isFinite(contractNum) ? contractNum : 0,
        budgets: budgetNums,
        stages: stages.filter((s) => s.name.trim()).map(({ id, name, startDate, endDate, progressPct }) => ({ id, name, startDate, endDate, progressPct })),
        idempotencyKey: site ? undefined : key,
      });
      toast.push({ tone: "ok", title: r.created ? "현장을 등록했습니다" : "현장 정보를 저장했습니다", desc: f.shortName });
      onClose();
    } catch (e) {
      if (e instanceof CommandError) setErrors(e.fieldErrors);
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "저장 실패" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={site ? `현장 수정 · ${site.shortName}` : "현장 등록"}
      description="원 계약금액과 실행예산(원가 항목 5종)으로 계획 이익률을 잡고, 이후 현장 입력 원가로 손익이 바뀝니다."
      size="lg"
      testId="site-form"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={save} loading={busy} data-testid="site-save">
            {site ? "저장" : "등록"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="현장명" htmlFor="sf-name" required error={errors.name}>
            <input id="sf-name" className={inputCls} value={f.name} onChange={set("name")} placeholder="예) ○○물류센터 신축공사 커튼월·창호" />
          </Field>
          <Field label="약칭" htmlFor="sf-short" required error={errors.shortName} hint="화면에 짧게 표시 (예: A현장)">
            <input id="sf-short" className={inputCls} value={f.shortName} onChange={set("shortName")} />
          </Field>
          <Field label="원청·발주처" htmlFor="sf-client" required error={errors.clientName}>
            <input id="sf-client" className={inputCls} value={f.clientName} onChange={set("clientName")} placeholder="예) ○○건설(주) · 원청" />
          </Field>
          <Field label="공종" htmlFor="sf-work">
            <input id="sf-work" className={inputCls} value={f.workType} onChange={set("workType")} />
          </Field>
          <Field label="지역" htmlFor="sf-region">
            <input id="sf-region" className={inputCls} value={f.region} onChange={set("region")} />
          </Field>
          <Field label="상태" htmlFor="sf-status" error={errors.status}>
            <select id="sf-status" className={inputCls} value={f.status} onChange={set("status")}>
              {(Object.keys(STATUS_LABEL) as SiteStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="착공일" htmlFor="sf-start" required error={errors.startDate}>
            <input id="sf-start" type="date" className={inputCls} value={f.startDate} onChange={set("startDate")} />
          </Field>
          <Field label="준공 예정일" htmlFor="sf-end" required error={errors.endDate}>
            <input id="sf-end" type="date" className={inputCls} value={f.endDate} onChange={set("endDate")} />
          </Field>
          <Field label="현장 담당 (현장소장)" htmlFor="sf-field" error={errors.fieldUserId} hint={fieldUsers.length ? "이 사람이 휴대폰으로 현장 보고를 합니다" : "현장직원 계정을 먼저 만드세요 (사용자 탭)"}>
            <select id="sf-field" className={inputCls} value={f.fieldUserId} onChange={set("fieldUserId")}>
              <option value="">지정 안 함</option>
              {fieldUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="본사 담당" htmlFor="sf-mgr" error={errors.managerUserId}>
            <select id="sf-mgr" className={inputCls} value={f.managerUserId} onChange={set("managerUserId")}>
              <option value="">지정 안 함</option>
              {managers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.title}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="rounded-2xl border border-line bg-surface-2 p-4">
          <p className="text-[0.92rem] font-bold">계약 · 실행예산 (원, 부가세 별도)</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <MoneyField id="sf-contract" label="원 계약금액" required value={f.contract} onChange={(v) => setF({ ...f, contract: v })} error={errors.contractAmount} />
            <Field label="계약일" htmlFor="sf-signed">
              <input id="sf-signed" type="date" className={inputCls} value={f.signedDate} onChange={set("signedDate")} />
            </Field>
            {COST_CATEGORIES.map((c) => (
              <MoneyField key={c} id={`sf-b-${c}`} label={`실행예산 · ${CATEGORY_LABEL[c]}`} value={budgets[c]} onChange={(v) => setBudgets({ ...budgets, [c]: v })} error={errors[`budgets.${c}`]} />
            ))}
          </div>
          <p className="mt-3 text-[0.84rem] text-ink-2 num" data-testid="site-plan-summary">
            실행예산 합계 <b>{fmtEok(budgetSum)}</b>
            {plannedMargin !== null && (
              <>
                {" "}· 계획 이익률 <b className={plannedMargin < db.thresholds.targetMarginPct ? "text-err" : ""}>{fmtPct(plannedMargin)}</b> (계약 − 실행예산)
              </>
            )}
          </p>
          {site && <p className="mt-1 text-[0.75rem] text-ink-3">계약 후 늘어난 금액은 원 계약을 고치지 말고 ‘기성·수금 → 변경공사’로 관리하세요. 잔여예상원가는 ‘잔여예상’에서 따로 다시 잡습니다.</p>}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <p className="text-[0.92rem] font-bold">공정 단계 (선택)</p>
            <Button size="sm" variant="soft" icon={<Plus size={15} />} onClick={() => setStages([...stages, { key: uid("row"), name: "", startDate: f.startDate, endDate: f.endDate || f.startDate, progressPct: 0 }])}>
              단계 추가
            </Button>
          </div>
          {stages.length === 0 && <p className="mt-1 text-[0.8rem] text-ink-3">예) 앵커·브라켓 설치 / 커튼월 유닛 제작 / 유닛 설치 / 실링·마감</p>}
          <div className="mt-2 space-y-2">
            {stages.map((s, i) => (
              <div key={s.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-line p-2.5 sm:grid-cols-[1.4fr_1fr_1fr_auto_auto]">
                <input aria-label={`단계 ${i + 1} 이름`} className={inputCls} value={s.name} placeholder="단계 이름" onChange={(e) => setStages(stages.map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)))} />
                <input aria-label={`단계 ${i + 1} 시작`} type="date" className={inputCls} value={s.startDate} onChange={(e) => setStages(stages.map((x) => (x.key === s.key ? { ...x, startDate: e.target.value } : x)))} />
                <input aria-label={`단계 ${i + 1} 종료`} type="date" className={inputCls} value={s.endDate} onChange={(e) => setStages(stages.map((x) => (x.key === s.key ? { ...x, endDate: e.target.value } : x)))} />
                <PctInput id={`st-${i}`} label={`단계 ${i + 1} 공정률`} value={s.progressPct} onChange={(v) => setStages(stages.map((x) => (x.key === s.key ? { ...x, progressPct: v } : x)))} />
                <button type="button" onClick={() => setStages(stages.filter((x) => x.key !== s.key))} className="press grid size-10 place-items-center rounded-lg text-ink-3 hover:bg-err-bg hover:text-err" aria-label={`단계 ${i + 1} 삭제`}>
                  <Trash2 size={16} />
                </button>
                {errors[`stages.${i}`] && <p className="col-span-full text-[0.78rem] text-err">{errors[`stages.${i}`]}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ForecastModal({ db, site, onClose }: { db: DemoDB; site: Site; onClose: () => void }) {
  const toast = useToast();
  const f = siteFinancials(db, site.id);
  const [vals, setVals] = useState<Record<CostCategory, string>>(() => Object.fromEntries(f.categories.map((c) => [c.category, wonText(c.remaining)])) as Record<CostCategory, string>);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const nums = Object.fromEntries(COST_CATEGORIES.map((c) => [c, Number.isFinite(toWon(vals[c])) ? toWon(vals[c]) : 0])) as Record<CostCategory, number>;
  const newRemaining = COST_CATEGORIES.reduce((s, c) => s + nums[c], 0);
  const newEac = f.incurred + newRemaining;
  const newProfit = f.adjustedContract - newEac;
  const newMargin = f.adjustedContract > 0 ? (newProfit / f.adjustedContract) * 100 : 0;
  const preview = useMemo(() => ({ newEac, newProfit, newMargin }), [newEac, newProfit, newMargin]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await run("updateForecast", { siteId: site.id, remaining: nums, note });
      toast.push({ tone: "ok", title: "잔여예상원가를 다시 잡았습니다", desc: `EAC ${fmtEok(f.eac)} → ${fmtEok(preview.newEac)}` });
      onClose();
    } catch (e) {
      if (e instanceof CommandError) setErrors(e.fieldErrors);
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "저장 실패" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`잔여예상원가 재추정 · ${site.shortName}`}
      description="‘지금부터 준공까지 더 들어갈 돈’을 항목별로 다시 잡습니다. 이미 발생한 원가는 그대로 두고, 이후 ‘실행예산 내 집행’만 여기서 차감됩니다."
      size="lg"
      testId="forecast-form"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={save} loading={busy} data-testid="forecast-save">
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[0.84rem]">
            <thead>
              <tr className="border-b border-line text-left text-[0.75rem] text-ink-3">
                <th className="py-2">항목</th>
                <th className="py-2 text-right">실행예산</th>
                <th className="py-2 text-right">발생</th>
                <th className="py-2 text-right">현재 잔여예상</th>
                <th className="py-2 pl-3">새 잔여예상 (원)</th>
              </tr>
            </thead>
            <tbody>
              {f.categories.map((c) => (
                <tr key={c.category} className="border-b border-line">
                  <td className="py-2 font-semibold">{CATEGORY_LABEL[c.category]}</td>
                  <td className="py-2 text-right num">{fmtMan(c.budget)}</td>
                  <td className="py-2 text-right num">{fmtMan(c.incurred)}</td>
                  <td className="py-2 text-right num">{fmtMan(c.remaining)}</td>
                  <td className="py-2 pl-3">
                    <input
                      aria-label={`${CATEGORY_LABEL[c.category]} 새 잔여예상`}
                      inputMode="numeric"
                      className={cx(inputCls, "num text-right")}
                      value={vals[c.category]}
                      onChange={(e) => {
                        const d = e.target.value.replace(/[^\d]/g, "");
                        setVals({ ...vals, [c.category]: d ? Number(d).toLocaleString("ko-KR") : "" });
                      }}
                    />
                    {errors[`remaining.${c.category}`] && <p className="mt-1 text-[0.75rem] text-err">{errors[`remaining.${c.category}`]}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Notice tone={preview.newMargin < f.marginPct ? "warn" : "info"} title={`저장하면: EAC ${fmtEok(f.eac)} → ${fmtEok(preview.newEac)} · 이익률 ${fmtPct(f.marginPct)} → ${fmtPct(preview.newMargin)} (${fmtPp(preview.newMargin - f.marginPct)})`} />
        <Field label="재추정 사유 (이력에 남음)" htmlFor="fc-note" error={errors.note}>
          <input id="fc-note" className={inputCls} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="예) 11월 공정회의 — 잔여 유리 물량·단가 재확인" />
        </Field>
      </div>
    </Modal>
  );
}

function ProgressModal({ site, onClose }: { site: Site; onClose: () => void }) {
  const toast = useToast();
  const [pct, setPct] = useState(site.progressPct);
  const [stages, setStages] = useState(site.stages.map((s) => ({ id: s.id, name: s.name, progressPct: s.progressPct })));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await run("updateProgress", { siteId: site.id, progressPct: pct, stages: stages.map(({ id, progressPct }) => ({ id, progressPct })) });
      toast.push({ tone: "ok", title: "공정률을 저장했습니다", desc: `${site.shortName} ${site.progressPct}% → ${pct}%` });
      onClose();
    } catch (e) {
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "저장 실패" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`공정률 · ${site.shortName}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={save} loading={busy}>
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3 text-[0.9rem] font-bold">
          전체 공정률 (%)
          <PctInput id="pg-all" label="전체 공정률" value={pct} onChange={setPct} />
        </label>
        {stages.map((s, i) => (
          <label key={s.id} className="flex items-center justify-between gap-3 border-t border-line pt-3 text-[0.86rem]">
            {s.name}
            <PctInput id={`pg-${i}`} label={`${s.name} 공정률`} value={s.progressPct} onChange={(v) => setStages(stages.map((x) => (x.id === s.id ? { ...x, progressPct: v } : x)))} />
          </label>
        ))}
      </div>
    </Modal>
  );
}
