"use client";

import { useState } from "react";
import { FilePlus2, BadgeCheck, Ban, Send, Wallet } from "lucide-react";
import { useMe, useFinancials } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, Field, Notice, PageSkeleton, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Freshness } from "@/components/domain/Widgets";
import { addBilling, addPayment, setChangeOrderStatus, CommandError } from "@/lib/data/commands";
import { dispatch } from "@/lib/data/store";
import { siteFinancials } from "@/lib/domain/calc";
import { receivableAging } from "@/lib/domain/risk";
import { CO_STATUS_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtEok, fmtMan, fmtPct, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import type { ChangeOrder, DemoDB } from "@/lib/domain/types";

export default function FinancePage() {
  const { db } = useMe();
  const fin = useFinancials(db);
  const [co, setCo] = useState<{ c: ChangeOrder; to: "submitted" | "approved" | "rejected" } | null>(null);
  const [form, setForm] = useState<"billing" | "payment" | null>(null);
  if (!db) return <PageSkeleton />;

  return (
    <PageBody>
      <PageHeader
        eyebrow="고객·정산"
        title="기성 · 수금 · 변경공사"
        desc="계약액·예상이익·기성청구액·입금액은 서로 다른 숫자입니다. 모든 금액은 공급가액(부가세 별도) 기준입니다."
        right={
          <>
            <DemoBadge />
            <Button icon={<FilePlus2 size={17} />} onClick={() => setForm("billing")}>기성청구 등록</Button>
            <Button variant="cta" icon={<Wallet size={17} />} onClick={() => setForm("payment")}>입금 등록</Button>
          </>
        }
      />
      <Freshness />

      <div className="grid gap-3 @min-[900px]:grid-cols-4" aria-label="개념 정의">
        {[
          ["계약금액 → 변경 반영 계약금액", "원 계약 + 원청·발주처가 승인한 변경계약. 청구 검토·승인 대기는 제외."],
          ["예상이익", "변경 반영 계약금액 − 총예상원가(EAC). 매출·입금과 다른 ‘준공 시 예상’ 개념."],
          ["기성청구액 (확정)", "공정 진행에 따라 발주처에 청구해 확정된 금액. 받은 돈이 아님."],
          ["입금액 · 미수금", "실제 통장에 들어온 금액. 미수금 = 확정 기성청구 − 입금."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl border border-line bg-surface px-4 py-3">
            <p className="text-[0.85rem] font-bold text-ink">{t}</p>
            <p className="mt-0.5 text-[0.76rem] text-ink-3">{d}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader title="현장별 정산 현황" sub="단위 억 원 · 부가세 별도 · DEMO" />
        <div tabIndex={0} role="region" aria-label="현장별 정산 현황 표 (가로 스크롤)" className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[56rem] text-[0.85rem]" data-testid="finance-table">
            <thead>
              <tr className="border-y border-line bg-surface-2 text-left text-[0.74rem] font-semibold text-ink-3">
                <th className="px-5 py-2.5">현장</th>
                <th className="px-3 py-2.5 text-right">원 계약</th>
                <th className="px-3 py-2.5 text-right">승인 변경</th>
                <th className="px-3 py-2.5 text-right" title="승인된 변경계약 포함">계약금액</th>
                <th className="px-3 py-2.5 text-right">예상이익</th>
                <th className="px-3 py-2.5 text-right">확정 기성(누계)</th>
                <th className="px-3 py-2.5 text-right">기성률</th>
                <th className="px-3 py-2.5 text-right">입금</th>
                <th className="px-5 py-2.5 text-right">미수금 (장기)</th>
              </tr>
            </thead>
            <tbody>
              {db.sites.map((s) => {
                const f = fin[s.id];
                const aging = receivableAging(db, s.id);
                const longOver = aging.filter((a) => a.ageDays > db.thresholds.receivableDays).reduce((x, a) => x + a.unpaid, 0);
                return (
                  <tr key={s.id} className="row-hover border-b border-line">
                    <td className="px-5 py-2.5 font-bold">{s.shortName}</td>
                    <td className="px-3 py-2.5 text-right num">{fmtEok(f.contractAmount, { unit: false })}</td>
                    <td className="px-3 py-2.5 text-right num">{f.approvedChange ? fmtEok(f.approvedChange, { unit: false }) : "—"}</td>
                    <td className="px-3 py-2.5 text-right num font-semibold">{fmtEok(f.adjustedContract, { unit: false })}</td>
                    <td className="px-3 py-2.5 text-right num">{fmtEok(f.expectedProfit, { unit: false })}</td>
                    <td className="px-3 py-2.5 text-right num">{fmtEok(f.billed, { unit: false })}</td>
                    <td className="px-3 py-2.5 text-right num">{fmtPct((f.billed / f.adjustedContract) * 100)}</td>
                    <td className="px-3 py-2.5 text-right num">{fmtEok(f.received, { unit: false })}</td>
                    <td className={cx("px-5 py-2.5 text-right num font-bold", longOver ? "text-err" : "text-ink")}>
                      {fmtEok(f.outstanding, { unit: false })}
                      {longOver > 0 && <span className="block text-[0.7rem]">{db.thresholds.receivableDays}일 초과 {fmtMan(longOver)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="변경공사" sub="‘승인(계약 반영)’만 변경 반영 계약금액에 가산됩니다 — 청구 검토·발주처 청구 단계는 이익 미반영" />
        {db.changeOrders.length === 0 ? (
          <EmptyState title="변경공사가 없습니다." />
        ) : (
          <ul className="divide-y divide-line px-5 pb-3" data-testid="change-orders">
            {db.changeOrders.map((c) => {
              const s = db.sites.find((x) => x.id === c.siteId);
              const decided = c.status === "approved" || c.status === "rejected";
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-3" data-testid="change-order" data-status={c.status}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[0.88rem]">
                      <b>{s?.shortName}</b> {c.title}
                      <Badge tone={c.status === "approved" ? "ok" : c.status === "rejected" ? "neutral" : "warn"}>{CO_STATUS_LABEL[c.status]}</Badge>
                    </p>
                    <p className="text-[0.76rem] text-ink-3 num">
                      {fmtMan(c.amount)} · 요청 {fmtDate(c.requestedAt)} {c.decidedAt && `· 결정 ${fmtDate(c.decidedAt)}`} · {c.note}
                    </p>
                  </div>
                  {!decided && (
                    <div className="flex flex-wrap gap-2">
                      {c.status === "review" && (
                        <Button size="sm" variant="soft" icon={<Send size={15} />} onClick={() => setCo({ c, to: "submitted" })}>
                          발주처 청구
                        </Button>
                      )}
                      <Button size="sm" variant="cta" icon={<BadgeCheck size={15} />} onClick={() => setCo({ c, to: "approved" })} data-testid="co-approve">
                        승인 반영
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Ban size={15} />} onClick={() => setCo({ c, to: "rejected" })}>
                        반려
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 @min-[900px]:grid-cols-2">
        <Card>
          <CardHeader title="기성청구 이력 (확정)" />
          <ul className="divide-y divide-line px-5 pb-3 text-[0.84rem]">
            {[...db.billings].sort((a, b) => b.billedDate.localeCompare(a.billedDate)).map((b) => (
              <li key={b.id} className="flex justify-between py-2">
                <span>
                  <b>{db.sites.find((s) => s.id === b.siteId)?.shortName}</b> {b.round}차 <span className="text-ink-3">{fmtDate(b.billedDate)}</span>
                </span>
                <b className="num">{fmtMan(b.amount)}</b>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="입금 이력" />
          <ul className="divide-y divide-line px-5 pb-3 text-[0.84rem]">
            {[...db.payments].sort((a, b) => b.receivedDate.localeCompare(a.receivedDate)).map((p) => (
              <li key={p.id} className="flex justify-between py-2">
                <span>
                  <b>{db.sites.find((s) => s.id === p.siteId)?.shortName}</b> <span className="text-ink-3">{fmtDate(p.receivedDate)}</span>
                </span>
                <b className="num">{fmtMan(p.amount)}</b>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {co && <ChangeOrderModal db={db} c={co.c} to={co.to} onClose={() => setCo(null)} />}
      {form && <MoneyFormModal db={db} kind={form} onClose={() => setForm(null)} />}
    </PageBody>
  );
}

function ChangeOrderModal({ db, c, to, onClose }: { db: DemoDB; c: ChangeOrder; to: "submitted" | "approved" | "rejected"; onClose: () => void }) {
  const toast = useToast();
  const [amountText, setAmountText] = useState(c.amount.toLocaleString("ko-KR"));
  const [err, setErr] = useState("");
  const amount = Number(amountText.replace(/[^\d]/g, ""));
  const f = siteFinancials(db, c.siteId);
  const afterAdj = f.adjustedContract + (to === "approved" ? amount : 0);
  const afterMargin = afterAdj ? ((afterAdj - f.eac) / afterAdj) * 100 : 0;
  const title = { submitted: "발주처에 청구로 전환", approved: "변경공사 승인 반영", rejected: "변경공사 반려" }[to];
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={c.title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant={to === "rejected" ? "danger" : "cta"}
            onClick={() => {
              try {
                const r = dispatch((d, ctx) => setChangeOrderStatus(d, c.id, to, to === "approved" ? amount : undefined, ctx));
                toast.push({ tone: "ok", title: `${title} 완료`, desc: to === "approved" ? `이익률 ${fmtPct(r.before.marginPct)} → ${fmtPct(r.after.marginPct)}` : undefined });
                onClose();
              } catch (e) {
                setErr(e instanceof CommandError ? e.message : "실패");
              }
            }}
            data-testid="co-confirm"
          >
            확인
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.88rem]">
        {to === "approved" ? (
          <>
            <Field label="승인 금액 (원)" htmlFor="co-amt" hint={amount ? `= ${fmtMan(amount)}` : undefined}>
              <input id="co-amt" inputMode="numeric" className={cx(inputCls, "num text-right")} value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, "") ? Number(e.target.value.replace(/[^\d]/g, "")).toLocaleString("ko-KR") : "")} />
            </Field>
            <Notice tone="info" title="반영 결과 (확정)">
              변경 반영 계약 {fmtEok(f.adjustedContract)} → {fmtEok(afterAdj)} · 예상이익률 {fmtPct(f.marginPct)} → {fmtPct(afterMargin)}
            </Notice>
            <p className="text-[0.76rem] text-ink-3">발주처의 실제 승인(공문·변경계약서)을 확인한 경우에만 승인 반영하세요. DEMO 환경입니다.</p>
          </>
        ) : to === "submitted" ? (
          <p>청구 검토 중 → ‘발주처 청구(승인 대기)’로 바뀝니다. 계약금액·이익에는 아직 반영되지 않습니다.</p>
        ) : (
          <p>반려 처리하면 청구 검토 대상에서 제외됩니다. 기록은 남습니다.</p>
        )}
        {err && <Notice tone="err">{err}</Notice>}
      </div>
    </Modal>
  );
}

function MoneyFormModal({ db, kind, onClose }: { db: DemoDB; kind: "billing" | "payment"; onClose: () => void }) {
  const toast = useToast();
  const [siteId, setSiteId] = useState(db.sites[0].id);
  const [amountText, setAmountText] = useState("");
  const [date, setDate] = useState(todayIso());
  const [key] = useState(() => uid("idem"));
  const [err, setErr] = useState("");
  const amount = Number(amountText.replace(/[^\d]/g, ""));
  const f = siteFinancials(db, siteId);
  return (
    <Modal
      open
      onClose={onClose}
      title={kind === "billing" ? "기성청구 등록 (확정)" : "입금 등록"}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            onClick={() => {
              try {
                if (kind === "billing") dispatch((d, ctx) => addBilling(d, { siteId, amount, billedDate: date, idempotencyKey: key }, ctx));
                else dispatch((d, ctx) => addPayment(d, { siteId, amount, receivedDate: date, idempotencyKey: key }, ctx));
                toast.push({ tone: "ok", title: kind === "billing" ? "기성청구를 등록했습니다" : "입금을 등록했습니다", desc: `${db.sites.find((s) => s.id === siteId)?.shortName} ${fmtMan(amount)}` });
                onClose();
              } catch (e) {
                setErr(e instanceof CommandError ? e.message : "실패");
              }
            }}
          >
            등록
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="현장" htmlFor="m-site">
          <select id="m-site" className={inputCls} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {db.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shortName}
              </option>
            ))}
          </select>
        </Field>
        <Field label={kind === "payment" ? "입금액 (원, 부가세 제외 환산)" : "기성 청구액 (원, 공급가액)"} htmlFor="m-amt" error={err} hint={kind === "payment" ? `현재 미수금 ${fmtMan(f.outstanding)}` : amount ? `= ${fmtMan(amount)}` : undefined}>
          <input id="m-amt" inputMode="numeric" className={cx(inputCls, "num text-right")} value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, "") ? Number(e.target.value.replace(/[^\d]/g, "")).toLocaleString("ko-KR") : "")} />
        </Field>
        <Field label={kind === "billing" ? "청구일" : "입금일"} htmlFor="m-date">
          <input id="m-date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <p className="text-[0.74rem] text-ink-3">현재 Demo 역할 사용자로 활동 이력에 기록됩니다 (DEMO 저장소).</p>
      </div>
    </Modal>
  );
}
