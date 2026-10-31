"use client";

import { useState } from "react";
import { Pencil, Undo2 } from "lucide-react";
import type { CostCategory, CostEntry, DemoDB } from "@/lib/domain/types";
import { CATEGORY_LABEL, COST_CATEGORIES, IMPACT_LABEL, REASON_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtEok, fmtMan, fmtPct, fmtRelative } from "@/lib/domain/format";
import { entryEacImpact } from "@/lib/domain/calc";
import { CommandError } from "@/lib/data/commands";
import { run } from "@/lib/data/store";
import { useMe, userLabel } from "@/lib/data/hooks";
import { Badge, Button, EmptyState, Field, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export function CostEntryList({ db, entries, showSite = false, emptyText = "입력된 원가가 없습니다." }: { db: DemoDB; entries: CostEntry[]; showSite?: boolean; emptyText?: string }) {
  const { canSeeMoney, role, userId } = useMe();
  const toast = useToast();
  const [edit, setEdit] = useState<CostEntry | null>(null);
  const [voiding, setVoiding] = useState<CostEntry | null>(null);
  const [reason, setReason] = useState("");

  if (!entries.length) return <EmptyState title={emptyText} />;

  const canModify = (e: CostEntry) => e.source !== "SEED" && (e.status === "active" || e.status === "pending") && (role === "ceo" || role === "manager" || e.createdBy === userId);

  return (
    <>
      <ul className="divide-y divide-line">
        {entries.map((e) => {
          const impact = entryEacImpact(db, e);
          const site = db.sites.find((s) => s.id === e.siteId);
          return (
            <li key={e.id} className={cx("flex flex-wrap items-start gap-x-3 gap-y-1.5 py-3", (e.status === "voided" || e.status === "rejected") && "opacity-60")} data-testid="cost-entry" data-status={e.status}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[0.88rem]">
                  {showSite && site && <b className="text-ink">{site.shortName}</b>}
                  <span className="font-semibold text-ink">{CATEGORY_LABEL[e.category]}</span>
                  <b className={cx("num", (e.status === "voided" || e.status === "rejected") && "line-through")}>{fmtMan(e.amount)}</b>
                  {e.qty && <span className="num text-[0.75rem] text-ink-3">공수 {e.qty.manDays} × {fmtMan(e.qty.dayRate)}</span>}
                  <Badge tone={e.forecastImpact === "additional" ? "err" : "neutral"}>{IMPACT_LABEL[e.forecastImpact]}</Badge>
                  {e.status === "voided" && <Badge tone="neutral">무효 처리됨</Badge>}
                  {e.status === "pending" && <Badge tone="warn">공무 확인 대기 · 손익 미반영</Badge>}
                  {e.status === "rejected" && <Badge tone="err">공무 반려</Badge>}
                  {e.editedAt && <Badge tone="info">수정됨</Badge>}
                </p>
                <p className="mt-0.5 text-[0.76rem] text-ink-3">
                  {fmtDate(e.date)} · {REASON_LABEL[e.reason]} · {e.source === "FIELD" ? "모바일 현장보고" : e.source === "CSV" ? "CSV 가져오기" : e.source === "PC" ? "PC 입력" : "기준 시드"} · {userLabel(db, e.createdBy)} · {fmtRelative(e.createdAt)}
                </p>
                {e.note && <p className="mt-0.5 text-[0.78rem] text-ink-2">{e.note}</p>}
                {e.status === "voided" && e.voidReason && <p className="mt-0.5 text-[0.74rem] text-ink-3">무효 사유: {e.voidReason}</p>}
                {e.status === "rejected" && e.reviewNote && <p className="mt-0.5 text-[0.74rem] text-err">반려 사유: {e.reviewNote}</p>}
              </div>
              <div className="flex items-center gap-2">
                {e.status === "active" && canSeeMoney && (
                  <span className={cx("rounded-md px-1.5 py-0.5 text-[0.72rem] font-bold num", impact > 0 ? "bg-err-bg text-err" : "bg-surface-3 text-ink-3")} title="이 원가가 총예상원가(EAC)에 준 영향">
                    EAC {impact > 0 ? `+${fmtMan(impact)}` : "변동 없음"}
                  </span>
                )}
                {canModify(e) && (
                  <>
                    <Button size="sm" variant="ghost" icon={<Pencil size={15} />} onClick={() => setEdit(e)} aria-label="원가 수정">
                      수정
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Undo2 size={15} />}
                      onClick={() => {
                        setReason("");
                        setVoiding(e);
                      }}
                      aria-label="원가 되돌리기(무효 처리)"
                    >
                      되돌리기
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {edit && <EditCostModal entry={edit} onClose={() => setEdit(null)} canSeeMoney={canSeeMoney} />}

      <Modal
        open={!!voiding}
        onClose={() => setVoiding(null)}
        title="이 원가를 되돌릴까요? (무효 처리)"
        size="sm"
        footer={
          <>
            <Button onClick={() => setVoiding(null)}>취소</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!voiding) return;
                try {
                  const r = await run("voidCostEntry", { entryId: voiding.id, reason: reason.trim() || "오입력 되돌리기" });
                  toast.push({ tone: "info", title: "원가를 무효 처리했습니다", desc: canSeeMoney ? `EAC ${fmtEok(r.before.eac)} → ${fmtEok(r.after.eac)} · 이익률 ${fmtPct(r.before.marginPct)} → ${fmtPct(r.after.marginPct)}` : "손익 계산에서 제외됩니다." });
                  setVoiding(null);
                } catch (err) {
                  toast.push({ tone: "err", title: err instanceof Error ? err.message : "실패" });
                }
              }}
              data-testid="void-confirm"
            >
              무효 처리
            </Button>
          </>
        }
      >
        {voiding && (
          <div className="space-y-3">
            <p className="text-[0.9rem] text-ink-2">
              {CATEGORY_LABEL[voiding.category]} <b className="num">{fmtMan(voiding.amount)}</b> — 기록은 삭제하지 않고 ‘무효’로 남겨 이력을 보존합니다.
            </p>
            <Field label="사유 (선택)" htmlFor="void-reason">
              <input id="void-reason" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예) 중복 입력" maxLength={80} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}

function EditCostModal({ entry, onClose, canSeeMoney }: { entry: CostEntry; onClose: () => void; canSeeMoney: boolean }) {
  const toast = useToast();
  const [category, setCategory] = useState<CostCategory>(entry.category);
  const [amountText, setAmountText] = useState(entry.amount.toLocaleString("ko-KR"));
  const [note, setNote] = useState(entry.note);
  const [impact, setImpact] = useState(entry.forecastImpact === "baseline" ? "additional" : entry.forecastImpact);
  const [error, setError] = useState("");
  const amount = Number(amountText.replace(/[^\d]/g, ""));
  return (
    <Modal
      open
      onClose={onClose}
      title="원가 수정"
      description="수정 전 값은 이력에 남습니다."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            onClick={async () => {
              try {
                const r = await run("editCostEntry", { entryId: entry.id, patch: { amount, category, note, forecastImpact: impact as "additional" | "within_forecast" } });
                toast.push({ tone: "ok", title: "원가를 수정했습니다", desc: canSeeMoney ? `EAC ${fmtEok(r.before.eac)} → ${fmtEok(r.after.eac)}` : undefined });
                onClose();
              } catch (e) {
                setError(e instanceof CommandError ? e.message : "수정 실패");
              }
            }}
          >
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="항목" htmlFor="e-cat">
          <select id="e-cat" className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as CostCategory)}>
            {COST_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="금액 (원)" htmlFor="e-amt" error={error} hint={amount > 0 ? `= ${fmtMan(amount)}` : undefined}>
          <input id="e-amt" inputMode="numeric" className={cx(inputCls, "num text-right")} value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, "") ? Number(e.target.value.replace(/[^\d]/g, "")).toLocaleString("ko-KR") : "")} />
        </Field>
        <Field label="비용 성격" htmlFor="e-imp">
          <select id="e-imp" className={inputCls} value={impact} onChange={(e) => setImpact(e.target.value as "additional" | "within_forecast")}>
            <option value="additional">{IMPACT_LABEL.additional} (EAC 증가)</option>
            <option value="within_forecast">{IMPACT_LABEL.within_forecast} (EAC 불변)</option>
          </select>
        </Field>
        <Field label="메모" htmlFor="e-note">
          <input id="e-note" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={160} />
        </Field>
      </div>
    </Modal>
  );
}
