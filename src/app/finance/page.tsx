"use client";

import { useState } from "react";
import { FilePlus2, FileSignature, BadgeCheck, Ban, Send, TrendingUp, Wallet } from "lucide-react";
import { useMe, useFinancials } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Notice, PageSkeleton, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Freshness, StatCard } from "@/components/domain/Widgets";
import { CommandError } from "@/lib/data/commands";
import { run } from "@/lib/data/store";
import { siteFinancials } from "@/lib/domain/calc";
import { receivableAging } from "@/lib/domain/risk";
import { CO_STATUS_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtEok, fmtMan, fmtPct, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import type { ChangeOrder, DemoDB } from "@/lib/domain/types";
import { IS_LIVE } from "@/lib/mode";

export default function FinancePage() {
  const { db } = useMe();
  const fin = useFinancials(db);
  const [co, setCo] = useState<{ c: ChangeOrder; to: "submitted" | "approved" | "rejected" } | null>(null);
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
        <StatCard testId="fin-total-outstanding" label="미수금" value={fmtEok(sum((f) => f.outstanding))} sub={<>입금 누계 <b className="num text-ink-2">{fmtEok(sum((f) => f.received))}</b> (실제 통장에 들어온 돈). 미수금 = 확정 기성청구 − 입금.</>} icon={<Wallet size={20} />} group="growth" />
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
                  <div className="min-w-0 flex-1 basis-[16rem]">
                    <p className="flex flex-wrap items-center gap-1.5 text-[0.88rem]">
                      <b>{s?.shortName}</b> {c.title}
                      <Badge tone={c.status === "approved" ? "ok" : c.status === "rejected" ? "neutral" : "warn"}>{CO_STATUS_LABEL[c.status]}</Badge>
                      {c.amount < 0 && <Badge tone="neutral">감액</Badge>}
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
  const [amountText, setAmountText] = useState(Math.abs(c.amount).toLocaleString("ko-KR"));
  const [err, setErr] = useState("");
  // 감액 건은 칸에 크기만 적고 계산은 −로 (D-77)
  const minus = c.amount < 0;
  const amount = (minus ? -1 : 1) * Number(amountText.replace(/[^\d]/g, ""));
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
            onClick={async () => {
              try {
                const r = await run("setChangeOrderStatus", { coId: c.id, status: to, approvedAmount: to === "approved" ? amount : undefined });
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
            <Field label={minus ? "승인 감액 (원)" : "승인 금액 (원)"} htmlFor="co-amt" hint={amount ? `= ${minus ? "감액 " : ""}${fmtMan(Math.abs(amount))}` : undefined}>
              <input id="co-amt" inputMode="numeric" className={cx(inputCls, "num text-right")} value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, "") ? Number(e.target.value.replace(/[^\d]/g, "")).toLocaleString("ko-KR") : "")} />
            </Field>
            <Notice tone="info" title="반영 결과 (확정)">
              변경 반영 계약 {fmtEok(f.adjustedContract)} → {fmtEok(afterAdj)} · 예상이익률 {fmtPct(f.marginPct)} → {fmtPct(afterMargin)}
            </Notice>
            <p className="text-[0.76rem] text-ink-3">원청·발주처의 실제 승인(공문·변경계약서)을 확인한 경우에만 승인 반영하세요.{IS_LIVE ? "" : " DEMO 환경입니다."}</p>
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
  // 현장이 하나도 없는 회사에서도 열리게 (빈 회사에서 화면 오류 · D-65 점검 반영)
  const [siteId, setSiteId] = useState(db.sites[0]?.id ?? "");
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
            onClick={async () => {
              try {
                if (kind === "billing") await run("addBilling", { siteId, amount, billedDate: date, idempotencyKey: key });
                else await run("addPayment", { siteId, amount, receivedDate: date, idempotencyKey: key });
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
        <p className="text-[0.74rem] text-ink-3">{IS_LIVE ? "로그인한 사용자 이름으로 활동 이력에 기록됩니다." : "현재 Demo 역할 사용자로 활동 이력에 기록됩니다 (DEMO 저장소)."}</p>
      </div>
    </Modal>
  );
}
