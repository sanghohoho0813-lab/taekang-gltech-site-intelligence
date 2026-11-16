"use client";

/**
 * 월 마감 기록 카드 (D-82) — 월 마감 화면 맨 위.
 * 마감 전: ‘이 달 마감’ · 마감 뒤: 누가·언제 닫고 대표가 확인했는지, 마감·확인 때 숫자, 마감(확인) 뒤 바뀐 것, 다시 확인·다시 열기.
 * 데이터를 잠그지 않는다 — 마감 뒤 그 달 날짜로 들어오거나 바뀐 것을 여기서 보여 준다.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, Lock, RotateCcw } from "lucide-react";
import { run } from "@/lib/data/store";
import { useMe, userLabel } from "@/lib/data/hooks";
import { Badge, Button, Card, CardHeader, Field, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { DemoDB, MonthCloseRecord, MonthCloseSnapshot } from "@/lib/domain/types";
import { monthBounds, type MonthCloseReport } from "@/lib/domain/monthClose";
import { changesAfterClose, currentClose, minutesText, pastCloses, type ChangesAfterClose } from "@/lib/domain/closeRecord";
import { fmtDateTime, fmtMan } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";

const ml = (m: string) => `${Number(m.slice(5))}월`;

/** 인쇄할 때 접힌 목록을 펼친다 (D-82 점검 — 남긴 일·현장별 숫자가 종이에서 빠짐) */
function usePrinting() {
  const [p, setP] = useState(false);
  useEffect(() => {
    const on = () => setP(true);
    const off = () => setP(false);
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
    };
  }, []);
  return p;
}

export function CloseRecordCard({ db, r, role, today }: { db: DemoDB; r: MonthCloseReport; role: string; today: string }) {
  const [modal, setModal] = useState<"close" | "confirm" | "reopen" | null>(null);
  const printing = usePrinting();
  const { user } = useMe();
  const rec = currentClose(db, r.month);
  const past = pastCloses(db, r.month);
  const ch = rec ? changesAfterClose(db, rec, today) : null;
  if (!r.ended && !rec) return null;
  const isCeo = role === "ceo";
  const changedAfterConfirm = !!rec?.confirmedAt && !!ch && ch.count > 0;
  return (
    <Card data-testid="close-record" data-state={rec ? (rec.confirmedAt ? "confirmed" : "closed") : "open"} className={cx(!rec && "border-active/40")}>
      <p className="hidden px-5 pt-3 text-[0.74rem] text-ink-3 print:block">
        인쇄 {fmtDateTime(new Date().toISOString())} · {user ? `${user.name} ${user.title}` : ""}
      </p>
      {!rec ? (
        <CardHeader
          title={<span className="inline-flex items-center gap-2">{ml(r.month)} 마감 전</span>}
          sub={`닫기 전에 볼 것을 처리한 뒤 ‘${ml(r.month)} 마감’을 누르세요. 마감하면 지금 숫자가 남고 대표에게 확인 요청이 갑니다. 데이터는 잠기지 않습니다 — 마감 뒤에 그 달 날짜로 들어오거나 바뀐 것은 여기에 보입니다.`}
          right={
            <Button variant="cta" icon={<Lock size={16} />} onClick={() => setModal("close")} className="no-print" data-testid="close-month-open">
              {ml(r.month)} 마감
            </Button>
          }
        />
      ) : (
        <>
          <CardHeader
            title={
              <span className="inline-flex flex-wrap items-center gap-2">
                <Lock size={17} aria-hidden /> {ml(r.month)} 마감 · {fmtDateTime(rec.closedAt)} {userLabel(db, rec.closedBy)}
                {rec.confirmedAt ? (
                  changedAfterConfirm ? (
                    <Badge tone="warn" data-testid="close-changed-after-confirm">
                      대표 확인 {fmtDateTime(rec.confirmedAt)} · 확인 뒤 바뀜 {ch!.count}건
                    </Badge>
                  ) : (
                    <Badge tone="ok" icon={<CircleCheck size={13} />} data-testid="close-confirmed">
                      대표 확인 {fmtDateTime(rec.confirmedAt)}
                    </Badge>
                  )
                ) : (
                  <Badge tone="warn" data-testid="close-awaiting">
                    대표 확인 대기
                  </Badge>
                )}
              </span>
            }
            sub={[rec.note ? `마감 메모: ${rec.note}` : "", rec.confirmNote ? `대표 메모: ${rec.confirmNote}` : ""].filter(Boolean).join(" · ") || "마감할 때 숫자를 아래에 남겼습니다. 데이터는 잠기지 않습니다."}
            right={
              <div className="no-print flex flex-wrap gap-2">
                {isCeo && (!rec.confirmedAt || changedAfterConfirm) && (
                  <Button variant="cta" icon={<CircleCheck size={16} />} onClick={() => setModal("confirm")} data-testid="close-confirm-open">
                    {rec.confirmedAt ? "바뀐 것 보고 다시 확인" : "마감 확인"}
                  </Button>
                )}
                <Button icon={<RotateCcw size={16} />} onClick={() => setModal("reopen")} disabled={!!rec.confirmedAt && !isCeo} title={rec.confirmedAt && !isCeo ? "대표가 확인한 마감은 대표만 다시 열 수 있습니다" : undefined} data-testid="close-reopen-open">
                  다시 열기
                </Button>
              </div>
            }
          />
          <div className="space-y-3 border-t border-line px-5 py-4">
            <SnapshotNumbers rec={rec} r={r} />
            <SiteTable rec={rec} open={printing} />
            {rec.snapshot.openItems.length > 0 && <LeftItems rec={rec} r={r} open={printing} />}
            {ch && <ChangesList ch={ch} month={r.month} open={printing} />}
            {(rec.confirmations?.length ?? 0) > 0 && <ConfirmHistory db={db} rec={rec} open={printing} />}
            {rec.confirmedAt && !isCeo && <p className="no-print text-[0.76rem] text-ink-3">대표가 확인한 마감은 대표만 다시 열 수 있습니다. 확인 뒤 바뀐 것은 대표에게 알림이 가고, 대표가 보고 다시 확인합니다.</p>}
          </div>
        </>
      )}
      {past.length > 0 && (
        <details className="border-t border-line px-5 py-2.5 text-[0.78rem] text-ink-3" open={printing} data-testid="close-history">
          <summary className="cursor-pointer">이전 마감 {past.length}번 (다시 연 기록)</summary>
          <ul className="mt-1 space-y-0.5">
            {past.map((p) => (
              <li key={p.id}>
                {fmtDateTime(p.closedAt)} {userLabel(db, p.closedBy)} 마감
                {p.confirmedAt ? ` → ${fmtDateTime(p.confirmedAt)} 대표 확인${p.confirmNote ? ` (${p.confirmNote})` : ""}` : ""} → {fmtDateTime(p.reopenedAt!)} {userLabel(db, p.reopenedBy)} 다시 엶{p.confirmedAt ? " (확인 뒤)" : ""} — {p.reopenReason} · 그때 이달 원가 {fmtMan(p.snapshot.totals.costTotal)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {modal === "close" && <CloseMonthModal r={r} onClose={() => setModal(null)} />}
      {modal === "confirm" && rec && ch && <ConfirmModal rec={rec} ch={ch} r={r} onClose={() => setModal(null)} />}
      {modal === "reopen" && rec && <ReopenModal rec={rec} onClose={() => setModal(null)} />}
    </Card>
  );
}

const TOTALS: [keyof MonthCloseSnapshot["totals"], string][] = [
  ["billed", "이달 기성"],
  ["received", "이달 입금"],
  ["outstandingAtEnd", "월말 미수"],
  ["costTotal", "이달 원가"],
];

/** 마감 때 숫자 — 대표가 확인했으면 확인 때 숫자도, 지금과 다르면 옆에 지금 숫자 */
function SnapshotNumbers({ rec, r }: { rec: MonthCloseRecord; r: MonthCloseReport }) {
  const base = rec.confirmSnapshot ?? rec.snapshot;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="close-snapshot">
      {TOTALS.map(([k, label]) => {
        const then = rec.snapshot.totals[k];
        const conf = rec.confirmSnapshot?.totals[k];
        const now = r.totals[k];
        return (
          <div key={k} className="rounded-xl border border-line px-3 py-2.5">
            <p className="text-[0.74rem] font-semibold text-ink-3">{label} (마감 때)</p>
            <p className="num text-[1.02rem] font-bold">{fmtMan(then)}</p>
            {conf !== undefined && conf !== then && <p className="num text-[0.76rem] text-ink-2">대표 확인 때 {fmtMan(conf)}</p>}
            {base.totals[k] !== now && (
              <p className="num text-[0.76rem] font-semibold text-warn" data-testid="close-snapshot-now">
                지금 {fmtMan(now)} ({now > base.totals[k] ? "+" : "−"}
                {fmtMan(Math.abs(now - base.totals[k]))})
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 현장별 마감 숫자 (D-82 점검 — 저장만 되고 화면에 없었음) */
function SiteTable({ rec, open }: { rec: MonthCloseRecord; open: boolean }) {
  const s = rec.snapshot;
  return (
    <details className="rounded-xl border border-line px-3.5 py-2.5 text-[0.82rem]" open={open} data-testid="close-site-table">
      <summary className="cursor-pointer font-semibold">현장별 마감 숫자 ({s.sites.length}곳)</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[34rem]">
          <thead>
            <tr className="text-left text-[0.72rem] text-ink-3">
              {["현장", "기성", "입금", "월말 미수", "원가", "노무 추정", "입력 노무", "예상이익"].map((h, i) => (
                <th key={h} className={cx("py-1 pr-2 font-semibold", i > 0 && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="num">
            {s.sites.map((x) => (
              <tr key={x.siteId} className="border-t border-line">
                <td className="py-1 pr-2 font-sans font-semibold">{x.name}</td>
                {[x.billed, x.received, x.outstandingAtEnd, x.costTotal, x.laborEstimate, x.laborCompared, x.expectedProfit].map((v, i) => (
                  <td key={i} className="py-1 pr-2 text-right">
                    {v ? fmtMan(v) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.people.length > 0 && <p className="mt-1.5 text-[0.76rem] text-ink-3">근무시간 (마감 때): {s.people.map((p) => `${p.name} ${p.days}일 ${minutesText(p.minutes)}`).join(" · ")}</p>}
    </details>
  );
}

/** 마감 때 남긴 일 — 지금은 해결됐는지, 새로 생긴 일 (D-82 대표 점검) */
function LeftItems({ rec, r, open }: { rec: MonthCloseRecord; r: MonthCloseReport; open: boolean }) {
  const now = new Set(r.items.map((i) => i.text));
  const left = rec.snapshot.openItems;
  const done = left.filter((t) => !now.has(t)).length;
  const fresh = r.items.filter((i) => !left.includes(i.text)).length;
  return (
    <details className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[0.84rem]" open={open} data-testid="close-left-items">
      <summary className="cursor-pointer font-semibold">
        마감 때 남긴 일 {left.length}건{done ? ` · 그 뒤 해결·바뀜 ${done}건` : ""}
        {fresh ? ` · 새로 생긴 일 ${fresh}건 (아래 ‘남은 일’)` : ""}
      </summary>
      <ul className="mt-1.5 space-y-0.5 text-ink-2">
        {left.map((t, i) => (
          <li key={i} className={cx("flex gap-1.5", !now.has(t) && "text-ink-3")}>
            <span aria-hidden>{now.has(t) ? "•" : "✓"}</span>
            <span className={cx(!now.has(t) && "line-through")}>{t}</span>
            {!now.has(t) && <span className="shrink-0 text-[0.74rem] font-semibold text-ok">해결·바뀜</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ChangesList({ ch, month, open }: { ch: ChangesAfterClose; month: string; open: boolean }) {
  const word = ch.basis === "confirm" ? "대표 확인 뒤" : "마감 뒤";
  if (!ch.count)
    return (
      <p className="text-[0.84rem] text-ink-2" id="close-changes" data-testid="close-changes" data-n={0}>
        {word} 바뀐 것 없음 — 지금 숫자가 {ch.basis === "confirm" ? "대표가 확인한" : "마감 때"} 숫자와 같습니다.
      </p>
    );
  return (
    <div id="close-changes" className="space-y-2 rounded-xl border border-warn/40 bg-warn-bg px-3.5 py-3 text-[0.84rem]" data-testid="close-changes" data-n={ch.count}>
      <p className="font-bold">
        {word} 바뀐 것 {ch.count}건 — 그 달 날짜로 들어오거나 바뀐 것입니다. 맞으면 대표가 보고 {ch.basis === "confirm" ? "다시 " : ""}확인하고, 틀리면 고치거나 발생일을 다음 달로 고치세요. 크게 바뀌면 다시 열어 마감하세요.
      </p>
      <ul className="space-y-1">
        {ch.events.map((e, i) => (
          <li key={i} data-testid="close-change">
            <Link href={e.href} className="underline-offset-2 hover:underline">
              {e.text}
            </Link>
            {e.at && <span className="ml-1 text-[0.74rem] text-ink-3">{fmtDateTime(e.at)}</span>}
          </li>
        ))}
        {ch.people.map((p) => (
          <li key={p.userId} data-testid="close-change-person">
            <Link href={`/attendance?date=${monthBounds(month).to}`} className="hover:underline">
              출퇴근 시간 바뀜 · {p.name} {minutesText(p.before)} → {minutesText(p.after)}
            </Link>
          </li>
        ))}
      </ul>
      {ch.diffs.length > 0 && (
        <details open={open}>
          <summary className="cursor-pointer text-[0.8rem] font-semibold text-ink-2">현장별 숫자 전 → 후 ({ch.diffs.length})</summary>
          <ul className="mt-1 space-y-0.5 text-[0.8rem] text-ink-2">
            {ch.diffs.map((d, i) => (
              <li key={i} className="num">
                {d.name} {d.label}: {fmtMan(d.before)} → {fmtMan(d.after)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ConfirmHistory({ db, rec, open }: { db: DemoDB; rec: MonthCloseRecord; open: boolean }) {
  const list = rec.confirmations ?? [];
  return (
    <details className="text-[0.8rem] text-ink-2" open={open} data-testid="close-confirm-history">
      <summary className="cursor-pointer font-semibold">대표 확인 {list.length}번</summary>
      <ul className="mt-1 space-y-1">
        {list.map((c, i) => (
          <li key={i}>
            {fmtDateTime(c.at)} {userLabel(db, c.by)}
            {c.note ? ` — ${c.note}` : ""}
            {c.changes.length > 0 && <span className="block pl-3 text-[0.76rem] text-ink-3">보고 확인한 것: {c.changes.join(" / ")}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function CloseMonthModal({ r, onClose }: { r: MonthCloseReport; onClose: () => void }) {
  const toast = useToast();
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => uid("idem"));
  const left = r.items.length;
  const ok = left === 0 || (ack && note.trim().length >= 2);
  const save = async () => {
    if (busy || !ok) return;
    setBusy(true);
    setError(null);
    try {
      // 본 건수를 보낸다 — 그 사이 남은 일이 바뀌었으면 서버가 다시 보게 한다
      await run("closeMonth", { month: r.month, note, ...(left > 0 ? { ackOpen: left } : {}), idempotencyKey: key });
      toast.push({ tone: "ok", title: `${ml(r.month)}을 마감했습니다`, desc: "대표에게 확인 요청이 갔습니다 (휴대폰 알림·대시보드 처리 대기)" });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "마감하지 못했습니다");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${ml(r.month)} 마감`}
      description="지금 숫자를 마감 기록으로 남기고 대표에게 확인을 요청합니다. 데이터는 잠기지 않습니다 — 마감 뒤에 그 달 날짜로 들어오거나 바뀐 것은 월 마감 화면과 처리 대기에 ‘마감 뒤 바뀐 것’으로 보입니다."
      size="md"
      testId="close-month-form"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={save} loading={busy} disabled={!ok} data-testid="close-month-save">
            {left ? `남은 ${left}건을 알고 마감` : "마감"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <p className="rounded-lg bg-err-bg px-3 py-2 text-[0.84rem] font-semibold text-err" role="alert">{error}</p>}
        <div className="grid grid-cols-2 gap-2 text-[0.84rem]">
          {TOTALS.map(([k, l]) => (
            <div key={k} className="rounded-lg bg-surface-2 px-3 py-2">
              <span className="block text-[0.74rem] text-ink-3">{l}</span>
              <b className="num">{fmtMan(r.totals[k])}</b>
            </div>
          ))}
        </div>
        {left > 0 ? (
          <div className="space-y-2 rounded-xl border border-warn/40 bg-warn-bg px-3.5 py-3 text-[0.84rem]" data-testid="close-month-left">
            <p className="font-bold">닫기 전에 볼 것 {left}건이 남아 있습니다</p>
            <ul className="list-disc space-y-0.5 pl-5 text-ink-2">
              {r.items.slice(0, 8).map((it, i) => (
                <li key={i}>{it.text}</li>
              ))}
              {left > 8 && <li>… 외 {left - 8}건</li>}
            </ul>
            <label className="flex items-start gap-2 font-semibold">
              <input type="checkbox" className="mt-0.5 size-5" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="close-month-ack" />
              남은 {left}건을 알고 마감합니다 (다음 달에 이어서 봄)
            </label>
          </div>
        ) : (
          <p className="rounded-lg bg-ok-bg px-3 py-2 text-[0.84rem]">닫기 전에 볼 것이 없습니다.</p>
        )}
        <Field label={left ? "남기는 이유 (마감 기록에 남음)" : "마감 메모 (선택)"} htmlFor="close-month-note" required={left > 0}>
          <input id="close-month-note" className={inputCls} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={left ? "예) 변경공사 발주처 승인 대기 · 판교 청구서 오면 11월에 반영" : "예) 10월 노무비 명세 대조 끝"} data-testid="close-month-note" />
        </Field>
      </div>
    </Modal>
  );
}

function ConfirmModal({ rec, ch, r, onClose }: { rec: MonthCloseRecord; ch: ChangesAfterClose; r: MonthCloseReport; onClose: () => void }) {
  const toast = useToast();
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const again = !!rec.confirmedAt;
  const ok = ch.count === 0 || ack;
  const save = async () => {
    if (busy || !ok) return;
    setBusy(true);
    setError(null);
    try {
      // 본 건수를 보낸다 — 그 사이 늘었으면 서버가 다시 보게 한다
      await run("confirmMonthClose", { month: rec.month, note, ...(ch.count > 0 ? { ackChanges: ch.count } : {}) });
      toast.push({ tone: "ok", title: `${ml(rec.month)} 마감을 ${again ? "다시 " : ""}확인했습니다` });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "확인하지 못했습니다");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={again ? `${ml(rec.month)} 마감 — 바뀐 것 보고 다시 확인` : `${ml(rec.month)} 마감 확인`}
      description={again ? "대표가 확인한 뒤에 바뀐 것을 보고 다시 확인합니다. 확인한 숫자가 이 시점 숫자로 바뀌고, 확인 이력에 남습니다." : "공무가 마감한 숫자를 보고 확인합니다. 확인한 마감은 대표만 다시 열 수 있습니다."}
      size="md"
      testId="close-confirm-form"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={save} loading={busy} disabled={!ok} data-testid="close-confirm-save">
            {again ? "다시 확인" : "마감 확인"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.86rem]">
        {error && <p className="rounded-lg bg-err-bg px-3 py-2 font-semibold text-err" role="alert">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          {TOTALS.map(([k, l]) => (
            <div key={k} className="rounded-lg bg-surface-2 px-3 py-2">
              <span className="block text-[0.74rem] text-ink-3">{l} (지금 · 확인할 숫자)</span>
              <b className="num">{fmtMan(r.totals[k])}</b>
            </div>
          ))}
        </div>
        {rec.snapshot.openItems.length > 0 && <p className="rounded-lg bg-surface-2 px-3 py-2">마감 때 남긴 일 {rec.snapshot.openItems.length}건{rec.note ? ` — ${rec.note}` : ""}</p>}
        {ch.count > 0 && (
          <div className="space-y-1.5 rounded-lg bg-warn-bg px-3 py-2">
            <p className="font-bold">{again ? "확인 뒤" : "마감 뒤"} 바뀐 것 {ch.count}건</p>
            <ul className="list-disc space-y-0.5 pl-5 text-[0.82rem]">
              {[...ch.events.map((e) => e.text), ...ch.people.map((p) => `출퇴근 시간 바뀜 · ${p.name} ${minutesText(p.before)} → ${minutesText(p.after)}`)].slice(0, 12).map((t, i) => (
                <li key={i}>{t}</li>
              ))}
              {ch.count > 12 && <li>… 외 {ch.count - 12}건 (월 마감 화면)</li>}
            </ul>
            <label className="flex items-start gap-2 font-semibold">
              <input type="checkbox" className="mt-0.5 size-5" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="close-confirm-ack" />
              바뀐 것 {ch.count}건을 보고 확인합니다
            </label>
          </div>
        )}
        <Field label="메모 (선택 · 공무에게)" htmlFor="close-confirm-note">
          <input id="close-confirm-note" className={inputCls} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="예) 동탄 노무 명세 오면 11월에 맞춤" />
        </Field>
      </div>
    </Modal>
  );
}

function ReopenModal({ rec, onClose }: { rec: MonthCloseRecord; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (busy || reason.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      await run("reopenMonthClose", { month: rec.month, reason });
      toast.push({ tone: "ok", title: `${ml(rec.month)} 마감을 다시 열었습니다`, desc: "고친 뒤 다시 마감하세요 — 이전 마감 기록은 남습니다" });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "다시 열지 못했습니다");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${ml(rec.month)} 마감 다시 열기`}
      description={`고칠 것이 있어 마감을 다시 엽니다. 이전 마감 기록(${fmtDateTime(rec.closedAt)})은 이력으로 남고, 고친 뒤 다시 마감하면 새 숫자가 남습니다.${rec.confirmedAt ? " 대표가 확인한 마감입니다 — 확인 뒤 바뀐 것만이라면 다시 열지 않고 ‘바뀐 것 보고 다시 확인’으로 충분합니다." : ""}`}
      size="sm"
      testId="close-reopen-form"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="danger" onClick={save} loading={busy} disabled={reason.trim().length < 2} data-testid="close-reopen-save">
            다시 열기
          </Button>
        </>
      }
    >
      <Field label="다시 여는 이유" htmlFor="close-reopen-reason" required error={error ?? undefined}>
        <input id="close-reopen-reason" className={inputCls} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="예) 10월 노무비 명세가 늦게 와서 다시 정산" data-testid="close-reopen-reason" />
      </Field>
    </Modal>
  );
}
