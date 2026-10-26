"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleCheck, Play, Pause, UserPlus, MessageSquarePlus, BadgeCheck, Camera, Wand2, ChevronDown } from "lucide-react";
import type { ActionItem, ActionStatus, DemoDB, RiskSignal } from "@/lib/domain/types";
import { ACTION_STATUS_LABEL, RULE_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtDateTime, fmtEok, fmtMan, fmtPct, fmtRelative, todayIso } from "@/lib/domain/format";
import { siteFinancials } from "@/lib/domain/calc";
import { addActionNote, assignAction, completeAction, confirmProofEvent, createAction, setActionStatus, CommandError } from "@/lib/data/commands";
import { dispatch } from "@/lib/data/store";
import { useMe, userLabel } from "@/lib/data/hooks";
import { uid } from "@/lib/domain/ids";
import { Badge, Button, Field, Notice, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { MethodChip } from "./Widgets";

const STEPS: ActionStatus[] = ["recommended", "assigned", "in_progress", "done"];

export function StatusStepper({ status }: { status: ActionStatus }) {
  const idx = STEPS.indexOf(status);
  return (
    <ol className="flex items-center gap-1" aria-label={`진행 상태: ${ACTION_STATUS_LABEL[status]}`}>
      {STEPS.map((s, i) => {
        const on = idx >= i;
        return (
          <li key={s} className="flex items-center gap-1">
            <span className={cx("rounded-full px-2 py-0.5 text-[0.68rem] font-bold whitespace-nowrap", on ? (s === "done" ? "bg-ok text-white" : "bg-solid text-white") : "bg-surface-3 text-ink-3", status === s && "ring-2 ring-offset-1 ring-active/40")}>
              {ACTION_STATUS_LABEL[s]}
            </span>
            {i < STEPS.length - 1 && <span className={cx("h-0.5 w-3 rounded-full", idx > i ? "bg-active" : "bg-line")} aria-hidden />}
          </li>
        );
      })}
      {(status === "on_hold" || status === "dismissed") && <Badge tone="neutral">{ACTION_STATUS_LABEL[status]}</Badge>}
    </ol>
  );
}

function plusDays(n: number) {
  const d = new Date(Date.now() + n * 86_400_000);
  return todayIso(d);
}

export function AssignModal({ db, signal, open, onClose }: { db: DemoDB; signal: RiskSignal; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const site = db.sites.find((s) => s.id === signal.siteId)!;
  const assignees = db.users.filter((u) => u.role === "field" || u.role === "manager");
  const [title, setTitle] = useState(signal.recommendation.actionTitle);
  const [desc, setDesc] = useState(signal.recommendation.description);
  const [assignee, setAssignee] = useState(signal.rule === "UNBILLED_CHANGE" || signal.rule === "COST_OVERRUN" ? site.fieldUserId : site.managerUserId);
  const [due, setDue] = useState(plusDays(3));
  const [key] = useState(() => uid("idem"));
  const [err, setErr] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="조치 생성 · 담당자 배정"
      description="규칙 기반 추천을 사람이 확인·승인해 조치로 만듭니다."
      size="md"
      testId="assign-modal"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            icon={<UserPlus size={17} />}
            data-testid="assign-confirm"
            onClick={() => {
              try {
                dispatch((d, ctx) => createAction(d, { signal, title, description: desc, assigneeUserId: assignee, dueDate: due, idempotencyKey: key }, ctx));
                toast.push({ tone: "ok", title: "조치를 생성하고 담당자에게 배정했습니다", desc: `${userLabel(db, assignee)} · 기한 ${fmtDate(due)}` });
                onClose();
              } catch (e) {
                setErr(e instanceof CommandError ? e.message : "생성 실패");
              }
            }}
          >
            승인·배정
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="rounded-xl bg-surface-2 p-3 text-[0.82rem]">
          <p className="flex items-center gap-2">
            <b>{RULE_LABEL[signal.rule]}</b> <MethodChip />
          </p>
          <p className="mt-1 font-semibold text-ink">{signal.title}</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-ink-2">
            {signal.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
        <Field label="조치" htmlFor="a-title" required>
          <input id="a-title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
        </Field>
        <Field label="내용" htmlFor="a-desc">
          <textarea id="a-desc" rows={2} className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="담당자" htmlFor="a-assignee" required>
            <select id="a-assignee" className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="assignee-select">
              {assignees.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="기한" htmlFor="a-due">
            <input id="a-due" type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        {err && <Notice tone="err">{err}</Notice>}
      </div>
    </Modal>
  );
}

export function CompleteModal({ db, action, open, onClose }: { db: DemoDB; action: ActionItem; open: boolean; onClose: () => void }) {
  const { role } = useMe();
  const toast = useToast();
  const causeSum = db.costEntries.filter((e) => action.causeEntryIds.includes(e.id) && e.status === "active").reduce((s, e) => s + e.amount, 0);
  const isClaim = action.rule === "UNBILLED_CHANGE";
  const [result, setResult] = useState("");
  const [register, setRegister] = useState(isClaim);
  const [amountText, setAmountText] = useState(causeSum ? causeSum.toLocaleString("ko-KR") : "");
  const [confirm, setConfirm] = useState(role === "ceo" || role === "manager");
  const [key] = useState(() => uid("idem"));
  const [err, setErr] = useState("");
  const amount = Number(amountText.replace(/[^\d]/g, ""));
  const f = siteFinancials(db, action.siteId);
  const demoResult = isClaim
    ? "원청에 서면 작업지시서 요청·수령, 회의록·변경 구간 사진·물량 산출서 정리 → 청구 가능 판단. 본사 공무에 내역단가 기준 변경견적 작성 요청."
    : "원인 확인 완료. 설계변경분은 변경공사 청구로 분리하고, 잔여 발주 단가·물량 재확인.";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="조치 완료 · 결과 입력"
      description="완료하면 조치 결과와 전·후 지표가 조치 증빙 기록(Proof Event)으로 남습니다."
      size="md"
      testId="complete-modal"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            icon={<CircleCheck size={17} />}
            data-testid="complete-confirm"
            onClick={() => {
              try {
                const r = dispatch((d, ctx) => completeAction(d, action.id, { result, claimAmount: register ? amount : undefined, registerChangeOrder: register, confirm, idempotencyKey: key }, ctx));
                toast.push({ tone: "ok", title: "조치 완료 · Proof Event 기록", desc: r.changeOrderId ? `변경공사 청구 검토 ${fmtMan(amount)} 등록 (원청 승인 전 · 이익 미반영)` : "실증 Evidence에서 확인할 수 있습니다." });
                onClose();
              } catch (e) {
                setErr(e instanceof CommandError ? e.message : "완료 처리 실패");
              }
            }}
          >
            완료 처리
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <p className="text-[0.86rem]">
          <b>{action.title}</b> · {db.sites.find((s) => s.id === action.siteId)?.shortName}
        </p>
        <Field label="조치 결과" htmlFor="c-result" required>
          <textarea id="c-result" rows={3} className={inputCls} value={result} onChange={(e) => setResult(e.target.value)} maxLength={400} placeholder="무엇을 확인했고 어떤 결과가 나왔는지" />
        </Field>
        <button type="button" onClick={() => setResult(demoResult)} className="press inline-flex items-center gap-1 rounded-lg bg-[#FFF7D6] px-2 py-1 text-[0.75rem] font-bold text-[#7A5200]" data-testid="fill-result">
          <Wand2 size={14} aria-hidden /> DEMO 결과 채우기
        </button>
        {isClaim && (
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <label className="flex items-start gap-2.5 text-[0.86rem]">
              <input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} className="mt-1 size-4 accent-[var(--t-active)]" />
              <span>
                <b>변경공사 청구 검토 건으로 등록</b>
                <span className="block text-[0.75rem] text-ink-3">본사 공무가 변경견적을 작성하는 ‘청구 검토 중’ 건으로 등록됩니다. 원청(발주처) 승인 전까지 계약금액·예상이익에 반영되지 않습니다.</span>
              </span>
            </label>
            {register && (
              <div className="mt-2.5">
                <Field label="청구 검토 금액 — 직접비 기준 (원)" htmlFor="c-amt" hint={amount ? `= ${fmtMan(amount)} · 원인 원가 합계 ${fmtMan(causeSum)} · 실제 변경견적은 계약 내역단가 + 제경비·이윤으로 공무가 작성` : undefined}>
                  <input id="c-amt" inputMode="numeric" className={cx(inputCls, "num text-right")} value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, "") ? Number(e.target.value.replace(/[^\d]/g, "")).toLocaleString("ko-KR") : "")} />
                </Field>
                {amount > 0 && (
                  <p className="mt-1.5 text-[0.75rem] text-ink-3 num">
                    참고: 승인되면 이익률 {fmtPct(f.marginPct)} → {fmtPct(((f.adjustedContract + f.pendingChangeAmount + amount - f.eac) / (f.adjustedContract + f.pendingChangeAmount + amount)) * 100)} (시뮬레이션 · 미반영)
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {(role === "ceo" || role === "manager") && (
          <label className="flex items-start gap-2.5 text-[0.86rem]">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1 size-4 accent-[var(--t-active)]" />
            <span>
              <b>결과 확인 (관리자 승인)</b>
              <span className="block text-[0.75rem] text-ink-3">체크 해제 시 Proof Event가 ‘확인 대기’로 남습니다.</span>
            </span>
          </label>
        )}
        {err && <Notice tone="err">{err}</Notice>}
      </div>
    </Modal>
  );
}

export function ActionCard({ db, action, compact = false }: { db: DemoDB; action: ActionItem; compact?: boolean }) {
  const { role, userId } = useMe();
  const toast = useToast();
  const [complete, setComplete] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const [reassign, setReassign] = useState(false);
  const site = db.sites.find((s) => s.id === action.siteId);
  const proof = db.proofEvents.find((p) => p.proof_event_id === action.proofEventId);
  const isManager = role === "ceo" || role === "manager";
  const mine = action.assigneeUserId === userId;
  const canWork = isManager || mine;

  const move = (to: ActionStatus, note?: string) => {
    try {
      dispatch((d, ctx) => setActionStatus(d, action.id, to, note, ctx));
      toast.push({ tone: "ok", title: `상태 변경: ${ACTION_STATUS_LABEL[to]}`, desc: action.title });
    } catch (e) {
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "변경 실패" });
    }
  };

  return (
    <article className="rounded-2xl border border-line bg-surface p-4 shadow-card" data-testid="action-card" data-status={action.status} data-action-id={action.id}>
      <div className="flex flex-wrap items-center gap-1.5 text-[0.74rem] text-ink-3">
        <b className="text-ink-2">{site?.shortName}</b>
        <span>{RULE_LABEL[action.rule]}</span>
        <span>· {fmtRelative(action.createdAt)}</span>
        {action.dueDate && action.status !== "done" && <span>· 기한 {fmtDate(action.dueDate)}</span>}
      </div>
      <h3 className="mt-1 text-[0.98rem] font-bold leading-snug text-ink">{action.title}</h3>
      {!compact && <p className="mt-0.5 text-[0.8rem] text-ink-3">{action.description}</p>}
      <div tabIndex={0} role="region" aria-label="조치 진행 단계 (가로 스크롤)" className="mt-2.5 overflow-x-auto no-scrollbar">
        <StatusStepper status={action.status} />
      </div>
      <p className="mt-2 text-[0.78rem] text-ink-2">
        담당 <b>{userLabel(db, action.assigneeUserId)}</b> · 승인 {userLabel(db, action.approvedBy)}
      </p>
      {action.notes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {action.notes.slice(-2).map((n, i) => {
            const ph = n.photoId ? db.photos.find((p) => p.id === n.photoId) : null;
            return (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[0.76rem] text-ink-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {ph && <img src={ph.dataUrl} alt="조치 확인 사진" className="size-10 rounded-md object-cover" />}
                <span>
                  {n.text} <span className="text-ink-3">— {userLabel(db, n.by)} {fmtRelative(n.at)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {action.status === "done" && (
        <div className="mt-2.5 rounded-xl border border-ok/25 bg-ok-bg px-3 py-2 text-[0.8rem]">
          <p className="font-bold text-ok">결과</p>
          <p className="text-ink-2">{action.result}</p>
          {action.claimAmount ? <p className="mt-0.5 font-semibold text-ink num">변경공사 청구 검토 {fmtMan(action.claimAmount)} 등록 · 승인 전 이익 미반영</p> : null}
          {proof && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={proof.status === "confirmed" ? "ok" : "warn"} icon={<BadgeCheck size={13} />}>
                Proof Event {proof.status === "confirmed" ? "결과 확인" : "확인 대기"}
              </Badge>
              <Link href="/evidence" className="text-[0.74rem] font-bold text-theme-ink underline-offset-2 hover:underline">
                기록 보기
              </Link>
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canWork && (action.status === "assigned" || action.status === "recommended" || action.status === "on_hold") && (
          <Button size="sm" variant="soft" icon={<Play size={15} />} onClick={() => move("in_progress")} data-testid="action-start">
            진행 시작
          </Button>
        )}
        {canWork && action.status === "in_progress" && (
          <Button size="sm" variant="cta" icon={<CircleCheck size={15} />} onClick={() => setComplete(true)} data-testid="action-complete">
            완료 처리
          </Button>
        )}
        {canWork && (action.status === "assigned" || action.status === "recommended") && (
          <Button size="sm" variant="ghost" icon={<CircleCheck size={15} />} onClick={() => setComplete(true)}>
            바로 완료
          </Button>
        )}
        {canWork && !["done", "dismissed"].includes(action.status) && (
          <Button size="sm" variant="ghost" icon={<MessageSquarePlus size={15} />} onClick={() => setNoteOpen(true)}>
            메모·사진
          </Button>
        )}
        {isManager && action.status === "in_progress" && (
          <Button size="sm" variant="ghost" icon={<Pause size={15} />} onClick={() => move("on_hold", "보류")}>
            보류
          </Button>
        )}
        {isManager && !["done", "dismissed"].includes(action.status) && (
          <Button size="sm" variant="ghost" icon={<UserPlus size={15} />} onClick={() => setReassign(true)}>
            재배정
          </Button>
        )}
        {proof && proof.status === "recorded" && isManager && (
          <Button
            size="sm"
            variant="soft"
            icon={<BadgeCheck size={15} />}
            onClick={() => {
              try {
                dispatch((d, ctx) => confirmProofEvent(d, proof.proof_event_id, ctx));
                toast.push({ tone: "ok", title: "결과를 확인했습니다 (Proof Event 확정)" });
              } catch (e) {
                toast.push({ tone: "err", title: e instanceof Error ? e.message : "실패" });
              }
            }}
            data-testid="proof-confirm"
          >
            결과 확인
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setDetail((v) => !v)} aria-expanded={detail} icon={<ChevronDown size={15} className={cx("transition-transform", detail && "rotate-180")} />}>
          이력
        </Button>
      </div>

      {detail && (
        <div className="mt-3 space-y-2 border-t border-line pt-3 text-[0.78rem]">
          <p className="text-ink-3">
            근거: {action.signalTitle} <MethodChip className="ml-1" />
          </p>
          <p className="num text-ink-3">
            조치 시점 지표 — 이익률 {fmtPct(action.kpiBefore.marginPct)} · 예상이익 {fmtEok(action.kpiBefore.expectedProfit)} · EAC {fmtEok(action.kpiBefore.eac)}
          </p>
          <ol className="space-y-1">
            {action.history.map((h, i) => (
              <li key={i} className="text-ink-2">
                <span className="num text-ink-3">{fmtDateTime(h.at)}</span> · {userLabel(db, h.by)} · {h.from ? `${ACTION_STATUS_LABEL[h.from]} → ` : ""}
                <b>{ACTION_STATUS_LABEL[h.to]}</b>
                {h.note ? ` · ${h.note}` : ""}
              </li>
            ))}
          </ol>
        </div>
      )}

      {complete && <CompleteModal db={db} action={action} open={complete} onClose={() => setComplete(false)} />}
      {noteOpen && <NoteModal action={action} onClose={() => setNoteOpen(false)} />}
      {reassign && <ReassignModal db={db} action={action} onClose={() => setReassign(false)} />}
    </article>
  );
}

function NoteModal({ action, onClose }: { action: ActionItem; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | undefined>();
  return (
    <Modal
      open
      onClose={onClose}
      title="메모·확인 사진 추가"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            onClick={() => {
              try {
                dispatch((d, ctx) => addActionNote(d, action.id, text, photo, ctx));
                toast.push({ tone: "ok", title: "메모를 추가했습니다" });
                onClose();
              } catch (e) {
                toast.push({ tone: "err", title: e instanceof Error ? e.message : "실패" });
              }
            }}
          >
            추가
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="메모" htmlFor="n-text">
          <textarea id="n-text" rows={3} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="예) 발주처 감독관과 변경 범위 구두 확인" />
        </Field>
        <label className="press flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-[0.85rem] font-semibold text-ink-2 hover:border-active">
          <Camera size={18} aria-hidden /> {photo ? "사진 선택됨 (다시 선택)" : "확인 사진 선택"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const url = URL.createObjectURL(file);
              const img = new Image();
              img.onload = () => {
                const s = Math.min(1, 800 / Math.max(img.width, img.height));
                const c = document.createElement("canvas");
                c.width = Math.round(img.width * s);
                c.height = Math.round(img.height * s);
                c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
                setPhoto(c.toDataURL("image/jpeg", 0.7));
                URL.revokeObjectURL(url);
              };
              img.src = url;
            }}
          />
        </label>
      </div>
    </Modal>
  );
}

function ReassignModal({ db, action, onClose }: { db: DemoDB; action: ActionItem; onClose: () => void }) {
  const toast = useToast();
  const [u, setU] = useState(action.assigneeUserId ?? "u-field");
  const [due, setDue] = useState(action.dueDate ?? plusDays(3));
  return (
    <Modal
      open
      onClose={onClose}
      title="담당자 재배정"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            onClick={() => {
              try {
                dispatch((d, ctx) => assignAction(d, action.id, u, due, ctx));
                toast.push({ tone: "ok", title: "담당자를 배정했습니다", desc: userLabel(db, u) });
                onClose();
              } catch (e) {
                toast.push({ tone: "err", title: e instanceof Error ? e.message : "실패" });
              }
            }}
          >
            배정
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="담당자" htmlFor="r-u">
          <select id="r-u" className={inputCls} value={u} onChange={(e) => setU(e.target.value)}>
            {db.users
              .filter((x) => x.role === "field" || x.role === "manager")
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} {x.title}
                </option>
              ))}
          </select>
        </Field>
        <Field label="기한" htmlFor="r-due">
          <input id="r-due" type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
