"use client";

import { useState } from "react";
import { FilePlus2, FileSignature, TrendingUp, Wallet } from "lucide-react";
import { useMe, useFinancials, userLabel } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Button, Card, CardHeader, Field, PageSkeleton, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Freshness, StatCard } from "@/components/domain/Widgets";
import { CommandError } from "@/lib/data/commands";
import { run } from "@/lib/data/store";
import { siteFinancials } from "@/lib/domain/calc";
import { receivableAging } from "@/lib/domain/risk";
import { fmtDate, fmtDateTime, fmtEok, fmtMan, fmtPct, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import type { DemoDB } from "@/lib/domain/types";
import { IS_LIVE } from "@/lib/mode";
import { ClosedMonthHint } from "@/components/domain/ClosedMonthHint";
import { ChangeOrderBoard } from "@/components/admin/ChangeOrderBoard";
import { EMPTY_WITHHELD, VoidMoneyButton, VoidedList, WithheldCard, WithheldFields, withheldArgs, type WithheldValue } from "@/components/admin/Withheld";

export default function FinancePage() {
  const { db } = useMe();
  const fin = useFinancials(db);
  const [form, setForm] = useState<"billing" | "payment" | null>(null);
  if (!db) return <PageSkeleton />;
  const sum = (pick: (f: (typeof fin)[string]) => number) => db.sites.reduce((a, s) => a + (fin[s.id] ? pick(fin[s.id]) : 0), 0);

  return (
    <PageBody>
      <PageHeader
        title="기성 · 수금 · 변경공사"
        desc="계약액·예상이익·기성청구액·입금액은 서로 다른 숫자입니다. 모든 금액은 공급가액(부가세 별도) 기준입니다."
        right={
          <>
            <Button icon={<FilePlus2 size={17} />} onClick={() => setForm("billing")} disabled={!db.sites.length} title={db.sites.length ? undefined : "현장을 먼저 등록하세요"}>기성청구 등록</Button>
            <Button variant="cta" icon={<Wallet size={17} />} onClick={() => setForm("payment")} disabled={!db.sites.length} title={db.sites.length ? undefined : "현장을 먼저 등록하세요"}>입금 등록</Button>
          </>
        }
      />
      <Freshness />

      {/* 숫자가 먼저, 뜻은 아래 (D-61) — 네 숫자는 서로 다른 개념이라 정의를 함께 둔다 */}
      <div className="grid grid-cols-2 gap-3 @min-[900px]:grid-cols-4" aria-label="합계와 개념 정의" data-testid="finance-totals">
        <StatCard testId="fin-total-contract" label="변경 반영 계약금액" value={fmtEok(sum((f) => f.adjustedContract))} sub="원 계약 + 원청·발주처가 승인한 변경계약. 청구 검토·승인 대기는 제외." icon={<FileSignature size={20} />} group="growth" />
        <StatCard testId="fin-total-profit" label="예상이익" value={fmtEok(sum((f) => f.expectedProfit))} sub="변경 반영 계약금액 − 예상 총원가. 매출·입금과 다른 ‘준공 시 예상’ 개념." icon={<TrendingUp size={20} />} group="ax" />
        <StatCard testId="fin-total-billed" label="기성청구액 (확정)" value={fmtEok(sum((f) => f.billed))} sub="공정 진행에 따라 발주처에 청구해 확정된 금액. 받은 돈이 아님." icon={<FilePlus2 size={20} />} group="growth" />
        <StatCard
          testId="fin-total-outstanding"
          label="미수금"
          value={fmtEok(sum((f) => f.outstanding))}
          sub={
            <>
              입금 누계 <b className="num text-ink-2">{fmtEok(sum((f) => f.received))}</b> (실제 통장에 들어온 돈). 미수금 = 확정 기성청구 − 입금{sum((f) => f.deducted) ? <> − 발주처 공제 <b className="num text-ink-2">{fmtEok(sum((f) => f.deducted))}</b></> : null}.
              {sum((f) => f.retention) ? <> 그중 유보금 <b className="num text-ink-2">{fmtEok(sum((f) => f.retention))}</b>(나중에 받을 돈).</> : null}
            </>
          }
          icon={<Wallet size={20} />}
          group="growth"
        />
      </div>

      {/* 표/카드 전환은 카드 폭 기준 — 1280px 화면(150% 배율)에서 표 오른쪽 열이 잘리던 문제 (D-67 점검 반영) */}
      <Card className="@container">
        <CardHeader title="현장별 정산 현황" sub={IS_LIVE ? "단위 억 원 · 부가세 별도" : "단위 억 원 · 부가세 별도 · DEMO"} />
        {/* 휴대폰: 현장마다 카드 (넓은 표는 미수금이 화면 밖으로 밀려 안 보였다 · D-65) */}
        <ul className="divide-y divide-line border-t border-line @min-[56rem]:hidden" data-testid="finance-cards">
          {db.sites.map((s) => {
            const f = fin[s.id];
            const aging = receivableAging(db, s.id);
            const longOver = aging.filter((a) => a.ageDays > db.thresholds.receivableDays).reduce((x, a) => x + a.unpaid, 0);
            const kv = (k: string, v: React.ReactNode, strong?: boolean) => (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[0.78rem] text-ink-3">{k}</dt>
                <dd className={cx("num text-[0.88rem]", strong && "font-bold")}>{v}</dd>
              </div>
            );
            return (
              <li key={s.id} className="space-y-2 px-5 py-3.5" data-testid="finance-card">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 font-bold [overflow-wrap:anywhere]">{s.shortName}</p>
                  <p className={cx("num shrink-0 text-[0.95rem] font-extrabold", longOver ? "text-err" : "text-ink")}>
                    미수금 {fmtEok(f.outstanding, { unit: false, fixed: true })}
                  </p>
                </div>
                {longOver > 0 && <p className="text-[0.76rem] font-semibold text-err">{db.thresholds.receivableDays}일 넘은 미수 {fmtMan(longOver)}</p>}
                {(f.retention > 0 || f.deducted > 0) && (
                  <p className="text-[0.76rem] text-ink-3">
                    {f.retention > 0 ? `그중 유보금 ${fmtMan(f.retention)}` : ""}
                    {f.retention > 0 && f.deducted > 0 ? " · " : ""}
                    {f.deducted > 0 ? `발주처 공제 ${fmtMan(f.deducted)}` : ""}
                  </p>
                )}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {kv("계약금액", fmtEok(f.adjustedContract, { unit: false, fixed: true }), true)}
                  {kv("예상이익", <span className={cx(f.expectedProfit < 0 && "font-bold text-err")}>{fmtEok(f.expectedProfit, { unit: false, fixed: true })}</span>)}
                  {kv("확정 기성", fmtEok(f.billed, { unit: false, fixed: true }))}
                  {kv("기성률", fmtPct((f.billed / f.adjustedContract) * 100))}
                  {kv("입금", fmtEok(f.received, { unit: false, fixed: true }))}
                  {kv("승인 변경", f.approvedChange ? fmtEok(f.approvedChange, { unit: false, fixed: true }) : "—")}
                </dl>
              </li>
            );
          })}
        </ul>
        <div tabIndex={0} role="region" aria-label="현장별 정산 현황 표 (가로 스크롤)" className="hidden overflow-x-auto scroll-thin @min-[56rem]:block">
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
                    <td className="px-3 py-2.5 text-right num">{fmtEok(f.contractAmount, { unit: false, fixed: true })}</td>
                    <td className="px-3 py-2.5 text-right num">{f.approvedChange ? fmtEok(f.approvedChange, { unit: false, fixed: true }) : "—"}</td>
                    <td className="px-3 py-2.5 text-right num font-semibold">{fmtEok(f.adjustedContract, { unit: false, fixed: true })}</td>
                    <td className={cx("px-3 py-2.5 text-right num", f.expectedProfit < 0 && "font-bold text-err")}>{fmtEok(f.expectedProfit, { unit: false, fixed: true })}</td>
                    <td className="px-3 py-2.5 text-right num">{fmtEok(f.billed, { unit: false, fixed: true })}</td>
                    <td className="px-3 py-2.5 text-right num">{fmtPct((f.billed / f.adjustedContract) * 100)}</td>
                    <td className="px-3 py-2.5 text-right num">{fmtEok(f.received, { unit: false, fixed: true })}</td>
                    <td className={cx("px-5 py-2.5 text-right num font-bold", longOver ? "text-err" : "text-ink")}>
                      {fmtEok(f.outstanding, { unit: false, fixed: true })}
                      {longOver > 0 && <span className="block text-[0.7rem]">{db.thresholds.receivableDays}일 초과 {fmtMan(longOver)}</span>}
                      {f.retention > 0 && <span className="block text-[0.7rem] font-normal text-ink-3">그중 유보금 {fmtMan(f.retention)}</span>}
                      {f.deducted > 0 && <span className="block text-[0.7rem] font-normal text-ink-3">공제 {fmtMan(f.deducted)} 뺌</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 변경공사 청구·회수 (D-84) — 청구 안 한 추가 원가 · 진행 중(며칠째·다음 확인할 날·기록) · 결정됨(사유·회수율) */}
      <ChangeOrderBoard db={db} />

      <div className="grid gap-5 @min-[900px]:grid-cols-2">
        <Card>
          <CardHeader title="기성청구 이력 (확정)" />
          {db.billings.length === 0 && <p className="px-5 pb-4 text-[0.84rem] text-ink-3">아직 확정 기성이 없습니다. 위 ‘기성청구 등록’으로 넣거나, 지난 기록은 ‘자료 이관·점검’에서 엑셀로 가져옵니다.</p>}
          <ul className="divide-y divide-line px-5 pb-3 text-[0.84rem]">
            {[...db.billings].sort((a, b) => b.billedDate.localeCompare(a.billedDate)).map((b) => (
              <li key={b.id} className="flex items-start justify-between gap-2 py-2" data-testid="billing-row">
                <span>
                  <b>{db.sites.find((s) => s.id === b.siteId)?.shortName}</b> {b.round ? `${b.round}차` : "이관"} <span className="text-ink-3">{fmtDate(b.billedDate)}</span>
                  {b.createdAt && <span className="block text-[0.72rem] text-ink-3">입력 {fmtDateTime(b.createdAt)} {userLabel(db, b.createdBy)}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <b className="num">{fmtMan(b.amount)}</b>
                  <VoidMoneyButton db={db} kind="billing" rec={b} />
                </span>
              </li>
            ))}
          </ul>
          <VoidedList db={db} kind="billing" />
        </Card>
        <Card>
          <CardHeader title="입금 이력" />
          {db.payments.length === 0 && <p className="px-5 pb-4 text-[0.84rem] text-ink-3">아직 입금 기록이 없습니다.</p>}
          <ul className="divide-y divide-line px-5 pb-3 text-[0.84rem]">
            {[...db.payments].sort((a, b) => b.receivedDate.localeCompare(a.receivedDate)).map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-2 py-2" data-testid="payment-row">
                <span>
                  <b>{db.sites.find((s) => s.id === p.siteId)?.shortName}</b> <span className="text-ink-3">{fmtDate(p.receivedDate)}</span>
                  {p.retentionId && <span className="text-ink-3"> · 유보금 받음</span>}
                  {(() => {
                    const w = (db.receivableAdjustments ?? []).find((a) => a.paymentId === p.id && !a.voidedAt);
                    return w ? <span className="text-ink-3"> · {w.kind === "retention" ? "유보금" : "공제"} {fmtMan(w.amount)} 떼고 받음</span> : null;
                  })()}
                  {p.createdAt && <span className="block text-[0.72rem] text-ink-3">입력 {fmtDateTime(p.createdAt)} {userLabel(db, p.createdBy)}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <b className="num">{fmtMan(p.amount)}</b>
                  <VoidMoneyButton db={db} kind="payment" rec={p} />
                </span>
              </li>
            ))}
          </ul>
          <VoidedList db={db} kind="payment" />
        </Card>
      </div>

      {/* 유보금·공제 (D-89) */}
      <WithheldCard db={db} />

      {form && <MoneyFormModal db={db} kind={form} onClose={() => setForm(null)} />}
    </PageBody>
  );
}

function MoneyFormModal({ db, kind, onClose }: { db: DemoDB; kind: "billing" | "payment"; onClose: () => void }) {
  const toast = useToast();
  // 현장이 하나도 없는 회사에서도 열리게 (빈 회사에서 화면 오류 · D-65 점검 반영)
  const [siteId, setSiteId] = useState(db.sites[0]?.id ?? "");
  const [amountText, setAmountText] = useState("");
  const [date, setDate] = useState(todayIso());
  const [key] = useState(() => uid("idem"));
  const [err, setErr] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [withheld, setWithheld] = useState<WithheldValue>(EMPTY_WITHHELD);
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
            onClick={async () => {
              try {
                const w = kind === "payment" ? withheldArgs(withheld) : undefined;
                if (kind === "billing") await run("addBilling", { siteId, amount, billedDate: date, idempotencyKey: key });
                else await run("addPayment", { siteId, amount, receivedDate: date, ...(w ? { withheld: w } : {}), idempotencyKey: key });
                toast.push({ tone: "ok", title: kind === "billing" ? "기성청구를 등록했습니다" : "입금을 등록했습니다", desc: `${db.sites.find((s) => s.id === siteId)?.shortName} ${fmtMan(amount)}${w ? ` · ${w.kind === "retention" ? "유보금" : "공제"} ${fmtMan(w.amount)}` : ""}` });
                onClose();
              } catch (e) {
                setErr(e instanceof CommandError ? e.message : "실패");
                setFields(e instanceof CommandError ? e.fieldErrors : {});
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
        <Field label={kind === "payment" ? "입금액 (원, 부가세 제외 환산)" : "기성 청구액 (원, 공급가액)"} htmlFor="m-amt" error={["withheldAmount", "note", "deductionType", "dueDate"].some((k) => fields[k]) ? undefined : err} hint={kind === "payment" ? `현재 미수금 ${fmtMan(f.outstanding)}${f.retention ? ` (그중 유보금 ${fmtMan(f.retention)})` : ""}` : amount ? `= ${fmtMan(amount)}` : undefined}>
          <input id="m-amt" inputMode="numeric" className={cx(inputCls, "num text-right")} value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, "") ? Number(e.target.value.replace(/[^\d]/g, "")).toLocaleString("ko-KR") : "")} />
        </Field>
        <Field label={kind === "billing" ? "청구일" : "입금일"} htmlFor="m-date">
          <input id="m-date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {/* 누계 기성이 계약(승인 변경 포함)을 넘으면 알린다 — 판교 104%가 아무 표시 없이 들어가던 문제 (D-82 대표 점검) */}
        {kind === "billing" && amount > 0 && (() => {
          const billed = db.billings.filter((b) => b.siteId === siteId && b.status === "confirmed").reduce((a, b) => a + b.amount, 0) + amount;
          return f.adjustedContract > 0 && billed > f.adjustedContract ? (
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-[0.8rem] font-semibold text-ink" data-testid="billing-over">
              이 기성을 넣으면 누계 기성 {fmtMan(billed)} — 계약(승인 변경공사 포함) {fmtMan(f.adjustedContract)}의 {Math.round((billed / f.adjustedContract) * 1000) / 10}%입니다. 변경공사 승인이 먼저인지 확인하세요.
            </p>
          ) : null;
        })()}
        {kind === "payment" && <WithheldFields value={withheld} onChange={setWithheld} outstanding={f.outstanding} pay={amount} errors={fields} />}
        <ClosedMonthHint db={db} date={date} action="넣으면" what={kind === "billing" ? "기성" : "입금"} />
        <p className="text-[0.74rem] text-ink-3">{IS_LIVE ? "로그인한 사용자 이름으로 활동 이력에 기록됩니다." : "현재 Demo 역할 사용자로 활동 이력에 기록됩니다 (DEMO 저장소)."}</p>
      </div>
    </Modal>
  );
}
