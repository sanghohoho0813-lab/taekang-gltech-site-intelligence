"use client";

/** 운영 관리 · 공무 확인 — 현장 입력 원가(확인 대기)를 견적·세금계산서 기준으로 승인(금액 확정) 또는 반려 */
import { useState } from "react";
import { CircleCheck, ClipboardCheck, XCircle } from "lucide-react";
import type { CostEntry, DemoDB } from "@/lib/domain/types";
import { CATEGORY_LABEL, IMPACT_LABEL, REASON_LABEL } from "@/lib/domain/labels";
import { fmtDateTime, fmtMan } from "@/lib/domain/format";
import { run } from "@/lib/data/store";
import { userLabel } from "@/lib/data/hooks";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Notice, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { MoneyField, toWon, wonText } from "./inputs";

export function ReviewAdmin({ db }: { db: DemoDB }) {
  const pending = db.costEntries.filter((e) => e.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const recent = db.costEntries.filter((e) => e.reviewedAt).sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? "")).slice(0, 8);
  const [target, setTarget] = useState<{ e: CostEntry; decision: "approve" | "reject" } | null>(null);
  const review = db.settings?.costApproval === "review";
  return (
    <div className="space-y-5">
      {!review && (
        <Notice tone="info" title="지금은 ‘저장 즉시 반영’ 설정입니다">
          현장 입력 원가가 바로 손익에 들어갑니다. 본사 공무 확인 후 반영하려면 ‘운영 설정’에서 바꾸세요.
        </Notice>
      )}
      <Card data-testid="admin-review">
        <CardHeader title={`확인 대기 ${pending.length}건`} sub="승인하면 손익에 반영되고, 반려하면 사유와 함께 현장에 남습니다" />
        {pending.length === 0 ? (
          <EmptyState icon={<ClipboardCheck size={30} />} title="확인할 원가가 없습니다" />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {pending.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3" data-testid="review-row">
                <div className="min-w-[16rem] flex-1">
                  <p className="font-bold">
                    {db.sites.find((s) => s.id === e.siteId)?.shortName} · {CATEGORY_LABEL[e.category]} <span className="num">{fmtMan(e.amount)}</span>
                    {e.qty && <span className="ml-1.5 text-[0.78rem] font-medium text-ink-3 num">(공수 {e.qty.manDays} × 일당 {fmtMan(e.qty.dayRate)})</span>}
                  </p>
                  <p className="text-[0.8rem] text-ink-2">
                    {REASON_LABEL[e.reason]} · {IMPACT_LABEL[e.forecastImpact]} · {e.note}
                  </p>
                  <p className="text-[0.74rem] text-ink-3">
                    {userLabel(db, e.createdBy)} · {fmtDateTime(e.createdAt)}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="cta" icon={<CircleCheck size={15} />} onClick={() => setTarget({ e, decision: "approve" })} data-testid="review-approve">
                    승인
                  </Button>
                  <Button size="sm" variant="danger" icon={<XCircle size={15} />} onClick={() => setTarget({ e, decision: "reject" })}>
                    반려
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {recent.length > 0 && (
        <Card>
          <CardHeader title="최근 처리" />
          <ul className="divide-y divide-line border-t border-line text-[0.84rem]">
            {recent.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                <Badge tone={e.status === "rejected" ? "err" : "ok"}>{e.status === "rejected" ? "반려" : "승인"}</Badge>
                <span className="font-semibold">
                  {db.sites.find((s) => s.id === e.siteId)?.shortName} · {CATEGORY_LABEL[e.category]} {fmtMan(e.amount)}
                </span>
                <span className="text-ink-3">
                  {userLabel(db, e.reviewedBy)} · {e.reviewedAt ? fmtDateTime(e.reviewedAt) : ""}
                  {e.reviewNote ? ` · ${e.reviewNote}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {target && <ReviewModal db={db} entry={target.e} decision={target.decision} onClose={() => setTarget(null)} />}
    </div>
  );
}

function ReviewModal({ db, entry, decision, onClose }: { db: DemoDB; entry: CostEntry; decision: "approve" | "reject"; onClose: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(wonText(entry.amount));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const site = db.sites.find((s) => s.id === entry.siteId);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const n = toWon(amount);
      await run("reviewCostEntry", { entryId: entry.id, decision, amount: decision === "approve" && Number.isFinite(n) ? n : undefined, note });
      toast.push({ tone: "ok", title: decision === "approve" ? "승인 — 손익에 반영했습니다" : "반려했습니다", desc: `${site?.shortName} ${CATEGORY_LABEL[entry.category]}` });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={decision === "approve" ? "원가 승인 · 금액 확정" : "원가 반려"}
      description={`${site?.shortName} · ${CATEGORY_LABEL[entry.category]} · 현장 입력 ${fmtMan(entry.amount)}`}
      size="sm"
      testId="review-form"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant={decision === "approve" ? "cta" : "danger"} onClick={save} loading={busy} data-testid="review-confirm">
            {decision === "approve" ? "승인" : "반려"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {decision === "approve" && <MoneyField id="rv-amt" label="확정 금액 (견적·세금계산서 기준, 원)" value={amount} onChange={setAmount} hint="현장 입력 금액과 다르면 고쳐서 승인 — 수정 이력이 남습니다" />}
        <Field label={decision === "approve" ? "메모 (선택)" : "반려 사유"} htmlFor="rv-note" required={decision === "reject"} error={error ?? undefined}>
          <input id="rv-note" className={inputCls} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={decision === "reject" ? "예) 원청 부담분 — 우리 원가 아님" : "예) ○○유리 견적서 기준"} />
        </Field>
      </div>
    </Modal>
  );
}
