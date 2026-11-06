"use client";

/** 본사 요청 (= 본사 화면의 '조치') — 현장 직원용 쉬운 화면 */
import { useState } from "react";
import { Camera, CircleCheck, ClipboardList, MessageSquarePlus, Play, Wand2, X } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { run } from "@/lib/data/store";
import { IS_LIVE } from "@/lib/mode";
import { CommandError, errorMessage } from "@/lib/data/commands";
import type { ActionItem, DemoDB } from "@/lib/domain/types";
import { todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { PageSkeleton, cx } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { Chip, Choice, EasyPageHead, VoiceHint, easyTextareaCls } from "./ui";
import { EASY_ACTION_STATUS, dueText, easyDate, easyWon, resultChips } from "./words";
import { downscalePhoto } from "./photo";
import { EasyWorkOrderCard } from "./EasyWorkOrder";

export function EasyActions() {
  const { db, userId } = useMe();
  const [tab, setTab] = useState<"open" | "done">("open");
  if (!db) return <PageSkeleton />;
  const mine = db.actions.filter((a) => a.assigneeUserId === userId);
  const open = mine.filter((a) => !["done", "dismissed"].includes(a.status)).sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));
  const done = mine.filter((a) => a.status === "done").sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
  const list = tab === "open" ? open : done;
  // 본사 작업지시 (일반 지시) — 위험 신호 조치와 함께 보여준다
  const orders = (db.workOrders ?? []).filter((w) => w.assigneeUserId === userId);
  // 긴급 → 새로 온 지시(확인 전)·보완 요청 → 기한 순 — 새 지시가 하는 중인 일 뒤에 묻히던 문제 (D-68 점검 반영)
  const fresh = (w: { status: string }) => Number(w.status === "sent" || w.status === "returned");
  const ordersOpen = orders.filter((w) => !["done", "confirmed"].includes(w.status)).sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || fresh(b) - fresh(a) || (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));
  // 끝낸 일은 최근에 끝낸 것부터 (오래된 시연 지시가 맨 위에 오던 문제 · D-69 점검 반영)
  const lastAt = (w: (typeof orders)[number]) => w.history.at(-1)?.at ?? w.createdAt;
  const ordersDone = orders.filter((w) => ["done", "confirmed"].includes(w.status)).sort((a, b) => lastAt(b).localeCompare(lastAt(a)));
  const woList = tab === "open" ? ordersOpen : ordersDone;
  return (
    <div className="mx-auto w-full max-w-xl space-y-5 px-4 pb-8 pt-5" data-testid="easy-actions">
      <EasyPageHead title="본사 요청" sub="본사에서 지시하거나 확인을 부탁한 일이에요. 받으면 ‘확인했어요’, 끝나면 ‘다 했어요’를 누르세요." />
      <div className="grid grid-cols-2 gap-2.5" role="tablist" aria-label="요청 보기">
        {(
          [
            ["open", `해야 할 일 ${open.length + ordersOpen.length}`],
            ["done", `끝낸 일 ${done.length + ordersDone.length}`],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={cx("press h-[3.6rem] rounded-2xl border-2 text-[1.12rem] font-extrabold", tab === v ? "border-active bg-active-soft text-ink" : "border-line-strong bg-surface text-ink-2")}>
            {label}
          </button>
        ))}
      </div>
      {woList.length > 0 && (
        <ul className="space-y-3.5" data-testid="wo-list">
          {woList.map((w) => (
            <li key={w.id}>
              <EasyWorkOrderCard db={db} wo={w} />
            </li>
          ))}
        </ul>
      )}
      {list.length === 0 && woList.length > 0 ? null : list.length === 0 ? (
        <div className="rounded-2xl border-2 border-line bg-surface px-5 py-8 text-center">
          <ClipboardList size={36} className="mx-auto text-ink-3" aria-hidden />
          <p className="mt-2 text-[1.2rem] font-bold">{tab === "open" ? "지금 해야 할 요청이 없어요" : "끝낸 요청이 없어요"}</p>
          <p className="mt-1 text-[1.02rem] text-ink-2">본사에서 요청하면 여기에 바로 나타나요.</p>
        </div>
      ) : (
        <ul className="space-y-3.5" data-testid="my-actions-list">
          {list.map((a) => (
            <li key={a.id}>
              <EasyActionCard db={db} action={a} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EasyActionCard({ db, action }: { db: DemoDB; action: ActionItem }) {
  const [complete, setComplete] = useState(false);
  const [note, setNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const site = db.sites.find((s) => s.id === action.siteId);
  const proof = db.proofEvents.find((p) => p.proof_event_id === action.proofEventId);
  const due = action.dueDate && action.status !== "done" ? dueText(action.dueDate, todayIso()) : null;
  const status = action.status === "done" && proof?.status !== "confirmed" ? "본사 확인 기다리는 중" : action.status === "done" ? "끝냄 · 본사 확인함" : EASY_ACTION_STATUS[action.status];
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      await run("setActionStatus", { actionId: action.id, to: "in_progress" });
    } catch (e) {
      setErr(errorMessage(e, "바꾸지 못했어요."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="rounded-3xl border-2 border-line bg-surface p-4 shadow-card" data-testid="action-card" data-status={action.status} data-action-id={action.id}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[1.02rem] font-semibold text-ink-2">
        <b className="text-ink">{site?.shortName}</b>
        <span className={cx("rounded-lg px-2 py-0.5 text-[0.98rem] font-bold", action.status === "in_progress" ? "bg-active-soft text-theme-ink" : action.status === "done" ? "bg-ok-bg text-ok" : "bg-surface-3 text-ink-2")}>{status}</span>
      </p>
      <h2 className="mt-2 text-[1.3rem] font-extrabold leading-snug">{action.title}</h2>
      {action.description && <p className="mt-1.5 text-[1.05rem] leading-relaxed text-ink-2">{action.description}</p>}
      {due && (
        <p className={cx("mt-2 text-[1.08rem] font-bold", due.late ? "text-err" : "text-ink")}>
          {easyDate(action.dueDate!)}까지 · {due.text}
        </p>
      )}
      {action.status === "done" && action.result && (
        <p className="mt-2 rounded-2xl bg-ok-bg px-3.5 py-2.5 text-[1.02rem] leading-relaxed">
          <b>내가 보낸 결과:</b> {action.result}
        </p>
      )}
      {err && <p className="mt-2 text-[1.02rem] font-semibold text-err">{err}</p>}
      {action.status !== "done" && action.status !== "dismissed" && (
        <div className="mt-3.5 space-y-2.5">
          {(action.status === "assigned" || action.status === "recommended" || action.status === "on_hold") && (
            <button type="button" onClick={start} disabled={busy} className="press flex h-[3.9rem] w-full items-center justify-center gap-2 rounded-2xl bg-cta text-[1.2rem] font-extrabold text-cta-text disabled:bg-surface-3 disabled:text-ink-2 disabled:shadow-none" data-testid="action-start">
              <Play size={22} aria-hidden /> 시작했어요
            </button>
          )}
          {action.status === "in_progress" && (
            <button type="button" onClick={() => setComplete(true)} className="press flex h-[3.9rem] w-full items-center justify-center gap-2 rounded-2xl bg-cta text-[1.2rem] font-extrabold text-cta-text" data-testid="action-complete">
              <CircleCheck size={24} aria-hidden /> 다 했어요
            </button>
          )}
          <button type="button" onClick={() => setNote(true)} className="press flex h-[3.4rem] w-full items-center justify-center gap-2 rounded-2xl border-2 border-line-strong bg-surface text-[1.08rem] font-bold">
            <MessageSquarePlus size={20} aria-hidden /> 사진·메모 남기기
          </button>
        </div>
      )}
      {complete && <EasyComplete db={db} action={action} onClose={() => setComplete(false)} />}
      {note && <EasyNote action={action} onClose={() => setNote(false)} />}
    </article>
  );
}

/** 다 했어요 — 결과를 눌러서 고르고, 필요하면 한 줄 더 */
function EasyComplete({ db, action, onClose }: { db: DemoDB; action: ActionItem; onClose: () => void }) {
  const isClaim = action.rule === "UNBILLED_CHANGE";
  const causeSum = db.costEntries.filter((e) => action.causeEntryIds.includes(e.id) && e.status === "active").reduce((s, e) => s + e.amount, 0);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [claim, setClaim] = useState(isClaim);
  const [key] = useState(() => uid("idem"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chips = resultChips(action.rule);
  const result = [...picked, text.trim()].filter(Boolean).join(", ");
  const demoResult = "원청에 서면 작업지시서 요청·수령, 회의록·변경 구간 사진·물량 산출서 정리 → 청구 가능 판단. 본사 공무에 내역단가 기준 변경견적 작성 요청.";
  const save = async () => {
    if (!result || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await run("completeAction", { actionId: action.id, input: { result, claimAmount: isClaim && claim && causeSum > 0 ? causeSum : undefined, registerChangeOrder: isClaim && claim && causeSum > 0, confirm: false, idempotencyKey: key } });
      onClose();
    } catch (e) {
      setErr(errorMessage(e, "보내지 못했어요."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="다 했어요 · 결과 알리기"
      size="md"
      testId="complete-modal"
      footer={
        <div className="grid w-full grid-cols-[1fr_1.8fr] gap-2.5">
          <button type="button" onClick={onClose} className="press h-[3.8rem] rounded-2xl border-2 border-line-strong bg-surface text-[1.1rem] font-bold">
            닫기
          </button>
          <button type="button" onClick={save} disabled={!result || busy} className="press h-[3.8rem] rounded-2xl bg-cta text-[1.15rem] font-extrabold text-cta-text disabled:opacity-40" data-testid="complete-confirm">
            본사로 보내기
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[1.15rem] font-bold leading-snug">{action.title}</p>
        {!IS_LIVE && (
          <button type="button" onClick={() => setText(demoResult)} className="press inline-flex items-center gap-1 rounded-lg bg-[#FFF7D6] px-2.5 py-1.5 text-[0.85rem] font-bold text-[#7A5200]" data-testid="fill-result">
            <Wand2 size={15} aria-hidden /> DEMO 결과 채우기
          </button>
        )}
        <div className="space-y-2.5">
          <p className="text-[1.1rem] font-bold">어떻게 처리했나요? (모두 누르세요)</p>
          <div className="flex flex-wrap gap-2.5">
            {chips.map((c) => (
              <Chip key={c} selected={picked.includes(c)} onClick={() => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))} testId="result-chip">
                {c}
              </Chip>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor="easy-result" className="block text-[1.1rem] font-bold">
            더 적을 내용 <span className="font-semibold text-ink-2">(안 적어도 돼요)</span>
          </label>
          <textarea id="easy-result" rows={3} maxLength={400} value={text} onChange={(e) => setText(e.target.value)} className={easyTextareaCls} />
          <VoiceHint />
        </div>
        {isClaim && causeSum > 0 && (
          <div className="space-y-2.5 rounded-2xl bg-surface-2 p-3.5">
            <p className="text-[1.1rem] font-bold">본사에 추가공사 청구를 요청할까요?</p>
            <p className="text-[1rem] text-ink-2">
              현장에서 넣은 비용 <b className="num">{easyWon(causeSum)}</b> (직접비 기준) — 실제 변경견적은 본사 공무가 만듭니다.
            </p>
            <Choice label="네, 청구 검토를 요청해요" selected={claim} onClick={() => setClaim(true)} testId="claim-yes" />
            <Choice label="아니요" selected={!claim} onClick={() => setClaim(false)} testId="claim-no" />
          </div>
        )}
        {!result && <p className="text-[1rem] font-semibold text-warn">위에서 하나 이상 누르거나 내용을 적어 주세요.</p>}
        {err && <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.05rem] font-semibold text-err">{err}</p>}
      </div>
    </Modal>
  );
}

function EasyNote({ action, onClose }: { action: ActionItem; onClose: () => void }) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (busy || (!text.trim() && !photo)) return;
    setBusy(true);
    try {
      await run("addActionNote", { actionId: action.id, text, photoDataUrl: photo });
      onClose();
    } catch (e) {
      setErr(errorMessage(e, "보내지 못했어요."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="사진·메모 남기기"
      size="sm"
      footer={
        <div className="grid w-full grid-cols-[1fr_1.8fr] gap-2.5">
          <button type="button" onClick={onClose} className="press h-[3.8rem] rounded-2xl border-2 border-line-strong bg-surface text-[1.1rem] font-bold">
            닫기
          </button>
          <button type="button" onClick={save} disabled={busy || (!text.trim() && !photo)} className="press h-[3.8rem] rounded-2xl bg-cta text-[1.15rem] font-extrabold text-cta-text disabled:opacity-40">
            본사에 보내기
          </button>
        </div>
      }
    >
      <div className="space-y-3.5">
        {photo ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="보낼 사진" className="max-h-60 w-full rounded-2xl object-cover" />
            <button type="button" onClick={() => setPhoto(undefined)} className="press absolute right-2 top-2 inline-flex h-11 items-center gap-1 rounded-xl bg-black/65 px-3 text-[1rem] font-bold text-white">
              <X size={18} aria-hidden /> 빼기
            </button>
          </div>
        ) : (
          <label className="press flex min-h-[5.5rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl bg-cta text-[1.15rem] font-extrabold text-cta-text">
            <Camera size={32} aria-hidden /> 사진 찍기
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setPhoto(await downscalePhoto(f, 800));
              }}
            />
          </label>
        )}
        <label htmlFor="easy-note" className="block text-[1.1rem] font-bold">
          메모 <span className="font-semibold text-ink-2">(안 적어도 돼요)</span>
        </label>
        <textarea id="easy-note" rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} className={easyTextareaCls} placeholder="예) 감독관과 변경 범위 확인함" />
        {err && <p className="text-[1.02rem] font-semibold text-err">{err}</p>}
      </div>
    </Modal>
  );
}
