"use client";

/**
 * 월 마감 기록 카드 (D-82) — 월 마감 화면 맨 위.
 * 마감 전: ‘이 달 마감’ · 마감 뒤: 누가·언제 닫고 대표가 확인했는지, 마감 때 숫자, 마감 뒤 바뀐 것, 다시 열기.
 * 데이터를 잠그지 않는다 — 마감 뒤 그 달 날짜로 들어오거나 바뀐 것을 여기서 보여 준다.
 */
import { useState } from "react";
import Link from "next/link";
import { CircleCheck, Lock, RotateCcw } from "lucide-react";
import { run } from "@/lib/data/store";
import { CommandError } from "@/lib/data/commands";
import { userLabel } from "@/lib/data/hooks";
import { Badge, Button, Card, CardHeader, Field, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { DemoDB, MonthCloseRecord } from "@/lib/domain/types";
import { monthBounds, type MonthCloseReport } from "@/lib/domain/monthClose";
import { changesAfterClose, currentClose, minutesText, pastCloses, type ChangesAfterClose } from "@/lib/domain/closeRecord";
import { fmtDateTime, fmtMan } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";

const ml = (m: string) => `${Number(m.slice(5))}월`;

export function CloseRecordCard({ db, r, role, today }: { db: DemoDB; r: MonthCloseReport; role: string; today: string }) {
  const [modal, setModal] = useState<"close" | "confirm" | "reopen" | null>(null);
  const rec = currentClose(db, r.month);
  const past = pastCloses(db, r.month);
  const ch = rec ? changesAfterClose(db, rec, today) : null;
  if (!r.ended && !rec) return null;
  const isCeo = role === "ceo";
  return (
    <Card data-testid="close-record" data-state={rec ? (rec.confirmedAt ? "confirmed" : "closed") : "open"} className={cx(!rec && "border-active/40")}>
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
                  <Badge tone="ok" icon={<CircleCheck size={13} />} data-testid="close-confirmed">
                    대표 확인 {fmtDateTime(rec.confirmedAt)}
                  </Badge>
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
                {isCeo && !rec.confirmedAt && (
                  <Button variant="cta" icon={<CircleCheck size={16} />} onClick={() => setModal("confirm")} data-testid="close-confirm-open">
                    확인
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
            {rec.snapshot.openItems.length > 0 && (
              <details className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[0.84rem]" data-testid="close-left-items">
                <summary className="cursor-pointer font-semibold">마감 때 남긴 일 {rec.snapshot.openItems.length}건</summary>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-ink-2">
                  {rec.snapshot.openItems.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </details>
            )}
            {ch && <ChangesList ch={ch} month={r.month} />}
            {rec.confirmedAt && !isCeo && <p className="no-print text-[0.76rem] text-ink-3">대표가 확인한 마감은 대표만 다시 열 수 있습니다.</p>}
          </div>
        </>
      )}
      {past.length > 0 && (
        <p className="border-t border-line px-5 py-2.5 text-[0.78rem] text-ink-3" data-testid="close-history">
          이전 마감 {past.length}번 — {past.map((p) => `${fmtDateTime(p.closedAt)} 마감 → ${fmtDateTime(p.reopenedAt!)} ${userLabel(db, p.reopenedBy)} 다시 엶 (${p.reopenReason})`).join(" / ")}
        </p>
      )}
      {modal === "close" && <CloseMonthModal r={r} onClose={() => setModal(null)} />}
      {modal === "confirm" && rec && ch && <ConfirmModal rec={rec} ch={ch} onClose={() => setModal(null)} />}
      {modal === "reopen" && rec && <ReopenModal rec={rec} onClose={() => setModal(null)} />}
    </Card>
  );
}

/** 마감 때 숫자 — 지금과 다르면 옆에 지금 숫자 */
function SnapshotNumbers({ rec, r }: { rec: MonthCloseRecord; r: MonthCloseReport }) {
  const t = rec.snapshot.totals;
  const rows: [string, number, number][] = [
    ["이달 기성", t.billed, r.totals.billed],
    ["이달 입금", t.received, r.totals.received],
    ["월말 미수", t.outstandingAtEnd, r.totals.outstandingAtEnd],
    ["이달 원가", t.costTotal, r.totals.costTotal],
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-4" data-testid="close-snapshot">
      {rows.map(([label, then, now]) => (
        <div key={label} className="rounded-xl border border-line px-3.5 py-2.5">
          <p className="text-[0.74rem] font-semibold text-ink-3">{label} (마감 때)</p>
          <p className="num text-[1.05rem] font-bold">{fmtMan(then)}</p>
          {then !== now && (
            <p className="num text-[0.76rem] font-semibold text-warn" data-testid="close-snapshot-now">
              지금 {fmtMan(now)} ({now > then ? "+" : "−"}
              {fmtMan(Math.abs(now - then))})
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function ChangesList({ ch, month }: { ch: ChangesAfterClose; month: string }) {
  if (!ch.count && !ch.diffs.length)
    return (
      <p className="text-[0.84rem] text-ink-2" id="close-changes" data-testid="close-changes" data-n={0}>
        마감 뒤 바뀐 것 없음 — 지금 숫자가 마감 때와 같습니다.
      </p>
    );
  return (
    <div id="close-changes" className="space-y-2 rounded-xl border border-warn/40 bg-warn-bg px-3.5 py-3 text-[0.84rem]" data-testid="close-changes" data-n={ch.count}>
      <p className="font-bold">
        마감 뒤 바뀐 것 {ch.count}건 — 그 달 날짜로 들어오거나 바뀐 것입니다. 맞으면 대표가 보고 확인하고, 틀리면 고치거나 다음 달 날짜로 옮기세요. 크게 바뀌면 다시 열어 마감하세요.
      </p>
      {ch.events.length > 0 && (
        <ul className="space-y-1">
          {ch.events.map((e, i) => (
            <li key={i} data-testid="close-change">
              <Link href={e.href} className="underline-offset-2 hover:underline">
                {e.text}
              </Link>
              {e.at && <span className="ml-1 text-[0.74rem] text-ink-3">{fmtDateTime(e.at)}</span>}
            </li>
          ))}
        </ul>
      )}
      {ch.people.length > 0 && (
        <ul className="space-y-1" data-testid="close-change-people">
          {ch.people.map((p) => (
            <li key={p.userId}>
              <Link href={`/attendance?date=${monthBounds(month).to}`} className="hover:underline">
                출퇴근 시간 바뀜 · {p.name} {minutesText(p.before)} → {minutesText(p.after)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {ch.diffs.length > 0 && (
        <details>
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
      await run("closeMonth", { month: r.month, note, ackOpen: left > 0 ? ack : undefined, idempotencyKey: key });
      toast.push({ tone: "ok", title: `${ml(r.month)}을 마감했습니다`, desc: "대표에게 확인 요청이 갔습니다" });
      onClose();
    } catch (e) {
      setError(e instanceof CommandError || e instanceof Error ? e.message : "마감하지 못했습니다");
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
        <div className="grid grid-cols-2 gap-2 text-[0.84rem]">
          {(
            [
              ["이달 기성", r.totals.billed],
              ["이달 입금", r.totals.received],
              ["월말 미수", r.totals.outstandingAtEnd],
              ["이달 원가", r.totals.costTotal],
            ] as const
          ).map(([l, v]) => (
            <div key={l} className="rounded-lg bg-surface-2 px-3 py-2">
              <span className="block text-[0.74rem] text-ink-3">{l}</span>
              <b className="num">{fmtMan(v)}</b>
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
              남은 일을 알고 마감합니다 (다음 달에 이어서 봄)
            </label>
          </div>
        ) : (
          <p className="rounded-lg bg-ok-bg px-3 py-2 text-[0.84rem]">닫기 전에 볼 것이 없습니다.</p>
        )}
        <Field label={left ? "남기는 이유 (마감 기록에 남음)" : "마감 메모 (선택)"} htmlFor="close-month-note" required={left > 0} error={error ?? undefined}>
          <input id="close-month-note" className={inputCls} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={left ? "예) 변경공사 대표 결정 대기 · 판교 청구서 오면 11월에 반영" : "예) 10월 노무비 명세 대조 끝"} data-testid="close-month-note" />
        </Field>
      </div>
    </Modal>
  );
}

function ConfirmModal({ rec, ch, onClose }: { rec: MonthCloseRecord; ch: ChangesAfterClose; onClose: () => void }) {
  const toast = useToast();
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = ch.count === 0 || ack;
  const save = async () => {
    if (busy || !ok) return;
    setBusy(true);
    setError(null);
    try {
      await run("confirmMonthClose", { month: rec.month, note, ackChanges: ch.count > 0 ? ack : undefined });
      toast.push({ tone: "ok", title: `${ml(rec.month)} 마감을 확인했습니다` });
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
      title={`${ml(rec.month)} 마감 확인`}
      description="공무가 마감한 숫자를 보고 확인합니다. 확인한 마감은 대표만 다시 열 수 있습니다."
      size="md"
      testId="close-confirm-form"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={save} loading={busy} disabled={!ok} data-testid="close-confirm-save">
            확인
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.86rem]">
        {rec.snapshot.openItems.length > 0 && <p className="rounded-lg bg-surface-2 px-3 py-2">마감 때 남긴 일 {rec.snapshot.openItems.length}건{rec.note ? ` — ${rec.note}` : ""}</p>}
        {ch.count > 0 && (
          <label className="flex items-start gap-2 rounded-lg bg-warn-bg px-3 py-2 font-semibold">
            <input type="checkbox" className="mt-0.5 size-5" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="close-confirm-ack" />
            마감 뒤 바뀐 것 {ch.count}건을 보고 확인합니다
          </label>
        )}
        <Field label="메모 (선택)" htmlFor="close-confirm-note" error={error ?? undefined}>
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
      description={`고칠 것이 있어 마감을 다시 엽니다. 이전 마감 기록(${fmtDateTime(rec.closedAt)})은 이력으로 남고, 고친 뒤 다시 마감하면 새 숫자가 남습니다.${rec.confirmedAt ? " 대표가 확인한 마감입니다." : ""}`}
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
