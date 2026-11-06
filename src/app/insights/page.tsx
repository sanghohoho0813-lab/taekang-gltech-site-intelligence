"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, UserPlus, Handshake, BadgeCheck, Send, Eye, Plus, Wrench, CircleCheck } from "lucide-react";
import { useMe, useSignals, userLabel } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Notice, PageSkeleton, SeverityBadge, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { AiReadyButton, Freshness, MethodChip, StatCard } from "@/components/domain/Widgets";
import { ActionCard, AssignModal } from "@/components/domain/Actions";
import { MyActionsView } from "@/components/domain/MyActionsView";
import { ACTION_STATUS_LABEL, PARTNER_STATUS_LABEL, PARTNER_TYPE_LABEL, RULE_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtDateTime, fmtMan, fmtRelative, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { worksOnSite } from "@/lib/domain/types";
import { errorMessage } from "@/lib/data/commands";
import { run } from "@/lib/data/store";
import type { DemoDB, PartnerRequest, RiskSignal } from "@/lib/domain/types";
import { ShieldAlert, ListChecks, Inbox } from "lucide-react";
import { IS_LIVE } from "@/lib/mode";

export default function InsightsPage() {
  const { role } = useMe();
  if (role === "field") return <MyActionsView />;
  return <Insights />;
}

function Insights() {
  const { db } = useMe();
  const signals = useSignals(db);
  const [assigning, setAssigning] = useState<RiskSignal | null>(null);

  useEffect(() => {
    if (window.location.hash === "#requests") setTimeout(() => document.getElementById("requests")?.scrollIntoView({ behavior: "smooth" }), 200);
  }, []);

  if (!db) return <PageSkeleton />;
  const open = db.actions.filter((a) => ["recommended", "assigned", "in_progress", "on_hold"].includes(a.status));
  const done = db.actions.filter((a) => a.status === "done");
  const newReq = db.partnerRequests.filter((r) => r.status !== "answered");
  const bySite = db.sites.map((s) => ({ site: s, list: signals.filter((x) => x.siteId === s.id) })).filter((g) => g.list.length);

  return (
    <PageBody>
      <PageHeader
        title="위험 분석 · 조치"
        desc="데이터에서 위험을 규칙으로 감지 → 사람이 승인해 담당자 배정 → 진행 → 결과 확인 → 조치 성과 기록으로 남깁니다."
        right={
<AiReadyButton />
        }
      />
      <Freshness />

      <div className="grid grid-cols-2 gap-3 @min-[900px]:grid-cols-4">
        <StatCard label="열린 위험 신호" value={`${signals.length}건`} sub={`경고 ${signals.filter((s) => s.severity === "high").length} · 주의 ${signals.filter((s) => s.severity === "medium").length} · 확인 ${signals.filter((s) => s.severity === "low").length}`} icon={<ShieldAlert size={21} />} group="ax" />
        <StatCard label="진행 중 조치" value={`${open.length}건`} sub={open.length ? `${ACTION_STATUS_LABEL[open[0].status]} · ${open[0].title}` : "없음"} icon={<ListChecks size={21} />} group="ops" />
        <StatCard label="완료 · 성과 기록" value={`${done.length} · ${db.proofEvents.length}건`} sub={`결과 확인 ${db.proofEvents.filter((p) => p.status === "confirmed").length}건`} icon={<BadgeCheck size={21} />} group="ax" href="/evidence" />
        <StatCard label="발주처 요청 (미회신)" value={`${newReq.length}건`} sub="발주처 포털에서 접수" icon={<Inbox size={21} />} group="growth" />
      </div>

      <div className="grid gap-5 @min-[1080px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card data-tour="signal-board" data-testid="signal-board">
          <CardHeader title="위험 신호" sub="현장별 · 심각도순 — 근거와 기준을 함께 표시" right={<MethodChip />} />
          {bySite.length === 0 ? (
            <EmptyState title="감지된 위험이 없습니다." desc="현장 원가가 입력되면 자동으로 다시 계산됩니다." />
          ) : (
            <div className="space-y-4 px-4 pb-4">
              {bySite.map(({ site, list }) => (
                <div key={site.id}>
                  <p className="mb-2 flex items-center gap-2 px-1 text-[0.82rem] font-bold text-ink-2">
                    <Link href={`/sites/${site.id}`} className="hover:text-theme-ink hover:underline">
                      {site.shortName}
                    </Link>
                    <span className="font-medium text-ink-3">{site.workType}</span>
                  </p>
                  <ul className="space-y-2.5">
                    {list.map((s) => (
                      <SignalItem key={s.key} db={db} s={s} onAssign={() => setAssigning(s)} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="조치 보드" sub="상태를 바꾸면 담당자 모바일 화면에 즉시 반영" />
            <div className="space-y-3 px-4 pb-4" data-testid="action-board">
              {open.length === 0 && done.length === 0 && <EmptyState title="아직 조치가 없습니다." desc="왼쪽 위험 신호에서 ‘조치 생성·배정’을 누르세요." />}
              {open.map((a) => (
                <ActionCard key={a.id} db={db} action={a} compact />
              ))}
              {done.slice(0, 3).map((a) => (
                <ActionCard key={a.id} db={db} action={a} compact />
              ))}
            </div>
          </Card>
          <PartnerInbox db={db} />
        </div>
      </div>

      {assigning && <AssignModal db={db} signal={assigning} open onClose={() => setAssigning(null)} />}
    </PageBody>
  );
}

function SignalItem({ db, s, onAssign }: { db: DemoDB; s: RiskSignal; onAssign: () => void }) {
  const [why, setWhy] = useState(s.rule === "UNBILLED_CHANGE" || s.rule === "MARGIN_DROP");
  const actions = db.actions.filter((a) => a.signalKey === s.key && a.status !== "dismissed");
  return (
    <li id={s.key} className={cx("scroll-mt-[calc(var(--demo-bar-h)+5rem)] rounded-xl border bg-surface p-3.5", s.severity === "high" ? "border-err/30" : "border-line")} data-testid="signal-item" data-rule={s.rule} data-site={s.siteId}>
      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={s.severity} />
        <span className="text-[0.74rem] font-bold text-ink-3">{RULE_LABEL[s.rule]}</span>
        <span className="text-[0.72rem] text-ink-3">· {fmtRelative(s.detectedAt)}</span>
      </div>
      <p className="mt-1 text-[0.93rem] font-bold leading-snug text-ink">{s.title}</p>
      <p className="text-[0.8rem] text-ink-2">{s.summary}</p>
      <button type="button" onClick={() => setWhy((v) => !v)} className="press mt-1.5 inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-[0.78rem] font-bold text-theme-ink hover:bg-active-soft" aria-expanded={why}>
        왜? 근거 {why ? "접기" : "보기"} <ChevronDown size={14} className={cx("transition-transform", why && "rotate-180")} />
      </button>
      {why && (
        <div className="mt-1.5 rounded-lg bg-surface-2 px-3 py-2 text-[0.78rem] text-ink-2">
          <ul className="list-disc space-y-0.5 pl-4">
            {s.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-[0.72rem] text-ink-3">기준: {s.threshold} · 사용 데이터: {s.dataUsed.map((k) => DATA_LABEL[k] ?? k).join(", ")}</p>
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2">
        <p className="min-w-0 text-[0.8rem]">
          <span className="text-ink-3">권장 조치 </span>
          <b className="text-ink">{s.recommendation.actionTitle}</b>
        </p>
        {actions.length === 0 ? (
          <Button size="sm" variant="cta" icon={<UserPlus size={15} />} onClick={onAssign} data-testid="create-action">
            조치 생성·배정
          </Button>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            {actions.map((a) => (
              <Badge key={a.id} tone={a.status === "done" ? "ok" : "theme"}>
                {ACTION_STATUS_LABEL[a.status]} · {userLabel(db, a.assigneeUserId)}
              </Badge>
            ))}
            <Button size="sm" variant="soft" icon={<Plus size={14} />} onClick={onAssign}>
              추가 조치
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}

const WO_STATE: Record<NonNullable<DemoDB["workOrders"]>[number]["status"], string> = { sent: "보냄", received: "현장 확인", in_progress: "보수 중", done: "완료 보고", confirmed: "완료 확인", returned: "보완 요청" };

function PhotoStrip({ db, ids, label, testId }: { db: DemoDB; ids?: string[]; label: string; testId: string }) {
  const [big, setBig] = useState<string | null>(null);
  const list = (ids ?? []).map((id) => db.photos.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  if (!list.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid={testId}>
      <span className="text-[0.74rem] font-semibold text-ink-3">{label}</span>
      {list.map((p) => (
        <button key={p.id} type="button" onClick={() => setBig(p.dataUrl)} className="press overflow-hidden rounded-lg border border-line" aria-label={`${label} 크게 보기`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.dataUrl} alt="" loading="lazy" className="size-12 object-cover" />
        </button>
      ))}
      <Modal open={!!big} onClose={() => setBig(null)} title={label} size="lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {big && <img src={big} alt={label} className="w-full rounded-xl" />}
      </Modal>
    </div>
  );
}

function PartnerInbox({ db }: { db: DemoDB }) {
  const toast = useToast();
  const [reply, setReply] = useState<PartnerRequest | null>(null);
  const [toOrder, setToOrder] = useState<PartnerRequest | null>(null);
  const list = db.partnerRequests;
  return (
    <Card id="requests" data-testid="partner-inbox">
      <CardHeader
        title="발주처·협력사 요청함"
        sub="발주처 포털 → 본사 검토 → 회신 → 포털 상태 갱신"
        right={
          <Link href="/partner">
            <Button size="sm" variant="ghost" icon={<Eye size={15} />}>
              포털 보기
            </Button>
          </Link>
        }
      />
      {list.length === 0 ? (
        <EmptyState icon={<Handshake size={26} />} title="요청이 없습니다." />
      ) : (
        <ul className="space-y-2.5 px-4 pb-4">
          {list.map((r) => {
            const site = db.sites.find((s) => s.id === r.siteId);
            const wo = r.linkedWorkOrderId ? (db.workOrders ?? []).find((w) => w.id === r.linkedWorkOrderId) : undefined;
            return (
              <li key={r.id} className={cx("rounded-xl border p-3.5", r.status === "received" ? "border-warn/35 bg-warn-bg/40" : "border-line bg-surface")} data-testid="partner-request" data-status={r.status}>
                <div className="flex flex-wrap items-center gap-1.5 text-[0.74rem] text-ink-3">
                  <Badge tone={r.status === "answered" ? "ok" : r.status === "reviewing" ? "theme" : "warn"}>{PARTNER_STATUS_LABEL[r.status]}</Badge>
                  <Badge tone={r.type === "quote" || r.type === "order" ? "info" : r.type === "defect" ? "warn" : "neutral"}>{PARTNER_TYPE_LABEL[r.type]}</Badge>
                  <b className="text-ink-2">{site?.shortName}</b> · {userLabel(db, r.partnerUserId)} · {fmtRelative(r.createdAt)}
                </div>
                <p className="mt-1 text-[0.9rem] font-bold text-ink">{r.title}</p>
                {(r.item || r.qty || r.desiredDate) && (
                  <p className="text-[0.8rem] font-semibold text-ink" data-testid="request-goods">
                    {[r.item, r.qty, r.desiredDate ? `희망 ${fmtDate(r.desiredDate)}` : ""].filter(Boolean).join(" · ")}
                  </p>
                )}
                {r.location && <p className="text-[0.8rem] font-semibold text-ink" data-testid="request-location">위치: {r.location}</p>}
                <p className="text-[0.8rem] text-ink-2">{r.description}</p>
                <PhotoStrip db={db} ids={r.photoIds} label="발주처 사진" testId="request-photos" />
                {wo && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.78rem] text-ink-2" data-testid="request-wo" data-wo-status={wo.status}>
                    <Wrench size={14} aria-hidden /> 보수 작업지시 · {userLabel(db, wo.assigneeUserId)}
                    <Badge tone={wo.status === "done" || wo.status === "confirmed" ? "ok" : wo.status === "returned" ? "err" : "theme"}>{WO_STATE[wo.status]}</Badge>
                    {wo.dueDate && <span className="num">기한 {fmtDate(wo.dueDate)}</span>}
                    <Link href="/orders" className="font-bold text-theme-ink underline">작업지시 보기</Link>
                  </p>
                )}
                {r.reply && <p className="mt-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[0.78rem] text-ink-2">회신: {r.reply}</p>}
                <PhotoStrip db={db} ids={r.replyPhotoIds} label="보낸 보수 사진" testId="request-reply-photos" />
                {r.confirmedAt && (
                  <p className="mt-1.5 text-[0.78rem] font-semibold text-ok" data-testid="request-confirmed">
                    <CircleCheck size={14} className="mr-1 inline" aria-hidden />발주처 확인 완료 · {fmtDateTime(r.confirmedAt)}
                    {r.confirmNote ? ` · ${r.confirmNote}` : ""}
                  </p>
                )}
                {r.status !== "answered" && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {r.type === "defect" && !wo && (
                      <Button size="sm" variant="soft" icon={<Wrench size={15} />} onClick={() => setToOrder(r)} data-testid="request-to-order">
                        작업지시로 보내기
                      </Button>
                    )}
                    {r.status === "received" && (
                      <Button
                        size="sm"
                        variant="soft"
                        onClick={async () => {
                          try {
                            await run("updatePartnerRequest", { requestId: r.id, patch: { status: "reviewing" } });
                            toast.push({ tone: "ok", title: "검토를 시작했습니다", desc: "발주처 포털에 ‘검토 중’으로 표시됩니다." });
                          } catch (e) {
                            toast.push({ tone: "err", title: e instanceof Error ? e.message : "실패" });
                          }
                        }}
                        data-testid="request-review"
                      >
                        검토 시작
                      </Button>
                    )}
                    <Button size="sm" variant="cta" icon={<Send size={15} />} onClick={() => setReply(r)} data-testid="request-reply">
                      회신하기
                    </Button>
                  </div>
                )}
                {/* 일정 안내로 먼저 회신한 하자보수 — 보수가 끝나면 보수 사진을 한 번 더 보낸다 (D-68 점검 반영) */}
                {r.status === "answered" && r.type === "defect" && wo && (wo.status === "done" || wo.status === "confirmed") && (wo.donePhotoIds?.length ?? 0) > 0 && !(r.replyPhotoIds?.length) && (
                  <div className="mt-2.5">
                    <Button size="sm" variant="cta" icon={<Send size={15} />} onClick={() => setReply(r)} data-testid="request-send-photos">
                      보수 완료 사진 보내기
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {reply && <ReplyModal db={db} req={reply} onClose={() => setReply(null)} />}
      {toOrder && <DefectOrderModal db={db} req={toOrder} onClose={() => setToOrder(null)} />}
    </Card>
  );
}

/** 하자보수 요청 → 현장 작업지시 (발주처 사진이 그대로 현장 휴대폰에 간다 · D-68) */
function DefectOrderModal({ db, req, onClose }: { db: DemoDB; req: PartnerRequest; onClose: () => void }) {
  const toast = useToast();
  const site = db.sites.find((s) => s.id === req.siteId);
  const people = db.users.filter((u) => !u.inactive && u.role !== "partner" && u.role !== "ceo" && !!site && worksOnSite(u, site));
  const [assignee, setAssignee] = useState(site?.fieldUserId && people.some((u) => u.id === site.fieldUserId) ? site.fieldUserId : (people[0]?.id ?? ""));
  const [due, setDue] = useState(req.desiredDate && req.desiredDate >= todayIso() ? req.desiredDate : "");
  const [urgent, setUrgent] = useState(false);
  const [title, setTitle] = useState(`하자보수 · ${req.title}`.slice(0, 80));
  const [key] = useState(() => uid("idem"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const detail = [req.location ? `위치: ${req.location}` : "", req.description].filter(Boolean).join(" — ").slice(0, 500);
  return (
    <Modal
      open
      onClose={onClose}
      title="하자보수 작업지시 보내기"
      description={`${site?.shortName ?? ""} · ${req.title}`}
      size="md"
      testId="defect-order-modal"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            icon={<Send size={16} />}
            disabled={busy || !assignee}
            data-testid="defect-order-send"
            onClick={async () => {
              setBusy(true);
              try {
                await run("createWorkOrder", { siteId: req.siteId, title, detail, assigneeUserId: assignee, dueDate: due || undefined, urgent, idempotencyKey: key, partnerRequestId: req.id });
                toast.push({ tone: "ok", title: "작업지시를 보냈습니다", desc: "발주처 포털에 ‘보수 작업 배정’으로 표시됩니다." });
                onClose();
              } catch (e) {
                const fe = (e as { fieldErrors?: Record<string, string> }).fieldErrors;
                if (fe && Object.keys(fe).length) setErrors(fe);
                else toast.push({ tone: "err", title: errorMessage(e, "보내지 못했습니다.") });
              } finally {
                setBusy(false);
              }
            }}
          >
            작업지시 보내기
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[0.82rem] text-ink-2">{detail}</p>
        <PhotoStrip db={db} ids={req.photoIds} label="함께 가는 발주처 사진" testId="defect-order-photos" />
        <Field label="지시 제목" htmlFor="do-title" required error={errors.title}>
          <input id="do-title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </Field>
        <Field label="받을 사람" htmlFor="do-assignee" required error={errors.assigneeUserId} hint={people.length ? undefined : "이 현장을 맡은 직원이 없습니다. 운영 관리에서 현장을 먼저 배정하세요."}>
          <select id="do-assignee" className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="defect-order-assignee">
            {people.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} {u.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="기한 (선택)" htmlFor="do-due" error={errors.dueDate}>
            <input id="do-due" type="date" min={todayIso()} className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2.5 self-end pb-2 text-[0.88rem] font-semibold">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="size-4 accent-[var(--t-active)]" /> 긴급
          </label>
        </div>
        <p className="text-[0.74rem] text-ink-3">발주처에는 ‘보수 작업 배정 → 보수 중 → 보수 완료’ 단계와 기한만 보입니다. 담당자 이름·현장 메모는 보이지 않습니다.</p>
      </div>
    </Modal>
  );
}

function ReplyModal({ db, req, onClose }: { db: DemoDB; req: PartnerRequest; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  // 하자보수: 작업지시 완료 사진을 회신과 함께 보낼 수 있다 (D-68)
  const wo = req.linkedWorkOrderId ? (db.workOrders ?? []).find((w) => w.id === req.linkedWorkOrderId) : undefined;
  // 끝난 작업지시의 사진만 (보완 요청으로 되돌린 작업지시의 예전 사진은 고르지 않는다 · D-68 점검 반영)
  const woDone = !!wo && (wo.status === "done" || wo.status === "confirmed");
  const donePhotos = woDone ? (wo!.donePhotoIds ?? []).map((id) => db.photos.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p).slice(0, 3) : [];
  const followUp = req.status === "answered";
  const [share, setShare] = useState<string[]>(() => donePhotos.map((p) => p.id));
  const [register, setRegister] = useState(req.type === "change_review");
  const [amountText, setAmountText] = useState("");
  const [err, setErr] = useState("");
  const amount = Number(amountText.replace(/[^\d]/g, ""));
  return (
    <Modal
      open
      onClose={onClose}
      title={followUp ? "보수 완료 사진 보내기" : "발주처 요청 회신"}
      description={req.title}
      size="md"
      testId="reply-modal"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            icon={<Send size={16} />}
            data-testid="reply-confirm"
            onClick={async () => {
              try {
                if (followUp && !share.length) {
                  setErr("보낼 보수 사진을 골라 주세요.");
                  return;
                }
                if (req.status === "received") await run("updatePartnerRequest", { requestId: req.id, patch: { status: "reviewing" } });
                await run("updatePartnerRequest", { requestId: req.id, patch: { status: "answered", reply: text, registerChangeOrder: register && amount > 0 ? { title: req.title, amount } : undefined, ...(share.length ? { sharePhotoIds: share } : {}) } });
                toast.push({ tone: "ok", title: "회신했습니다", desc: "발주처 포털에 ‘회신 완료’와 회신 내용이 표시됩니다." });
                onClose();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "실패");
              }
            }}
          >
            회신 보내기
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[0.82rem] text-ink-2">
          <b className="mr-1">[{PARTNER_TYPE_LABEL[req.type]}]</b>
          {req.item ? `${req.item}${req.qty ? ` · ${req.qty}` : ""} — ` : ""}
          {req.description}
        </p>
        {(req.type === "quote" || req.type === "order") && (
          <p className="text-[0.76rem] text-ink-3">회신 내용은 발주처에 그대로 보입니다. 금액·내부 원가는 적지 말고, 견적서는 별도로 보내세요.</p>
        )}
        <Field label="회신 내용 (발주처에 표시)" htmlFor="rp-text" required>
          <textarea id="rp-text" rows={3} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} maxLength={400} placeholder="예) 변경 범위 확인했습니다. 단가 검토 후 11월 첫 주 견적 회신 드리겠습니다." />
        </Field>
        {!IS_LIVE && (
        <button
          type="button"
          onClick={() =>
            setText(
              req.type === "quote"
                ? "견적 문의 확인했습니다. 현장 실측 후 사양별 견적서를 별도로 보내드리겠습니다. (DEMO 회신)"
                : req.type === "order"
                  ? "주문 요청 확인했습니다. 자재 입고 일정 확인 후 납품·시공일을 확정해 안내드리겠습니다. (DEMO 회신)"
                  : req.type === "defect"
                    ? "보수를 마쳤습니다. 창틀 아래 실리콘을 다시 시공했고, 물을 뿌려 새는 곳이 없는 것을 확인했습니다. (DEMO 회신)"
                  : "서면 작업지시 접수했습니다. 변경 범위를 현장에서 확인했고, 계약 내역단가 기준으로 변경공사 견적을 회신드리겠습니다. (DEMO 회신)",
            )
          }
          className="press rounded-lg bg-[#FFF7D6] px-2 py-1 text-[0.75rem] font-bold text-[#7A5200]"
        >
          DEMO 회신 채우기
        </button>
        )}
        {req.type === "defect" && wo && wo.status !== "done" && wo.status !== "confirmed" && (
          <Notice tone="warn">보수 작업지시가 아직 끝나지 않았습니다 ({WO_STATE[wo.status]}). 지금은 일정 안내로 회신하고, 현장이 ‘다 했어요’로 사진을 보내면 요청함의 ‘보수 완료 사진 보내기’로 한 번 더 보내세요.</Notice>
        )}
        {donePhotos.length > 0 && (
          <fieldset className="rounded-xl border border-line bg-surface-2 p-3" data-testid="reply-share-photos">
            <legend className="px-1 text-[0.82rem] font-bold">보수 완료 사진 함께 보내기</legend>
            <div className="flex flex-wrap gap-2">
              {donePhotos.map((p) => (
                <label key={p.id} className="relative cursor-pointer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.dataUrl} alt="보수 완료 사진" className={cx("size-20 rounded-lg border-2 object-cover", share.includes(p.id) ? "border-active" : "border-line opacity-60")} />
                  <input type="checkbox" className="absolute left-1.5 top-1.5 size-4 accent-[var(--t-active)]" checked={share.includes(p.id)} onChange={(e) => setShare((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))} aria-label="이 사진 보내기" />
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[0.72rem] text-ink-3">고른 사진은 요청한 발주처에게만 보입니다 (다른 발주처의 ‘공정 사진’에는 나오지 않음).</p>
          </fieldset>
        )}
        {req.type === "change_review" && (
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <label className="flex items-start gap-2.5 text-[0.85rem]">
              <input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} className="mt-1 size-4 accent-[var(--t-active)]" />
              <span>
                <b>내부 변경공사 검토 건으로 등록</b>
                <span className="block text-[0.74rem] text-ink-3">금액 입력 시 ‘청구 검토 중’으로 등록 — 승인 전 이익 미반영. 발주처에는 금액이 표시되지 않습니다.</span>
              </span>
            </label>
            {register && (
              <div className="mt-2">
                <Field label="예상 변경 금액 (원, 선택)" htmlFor="rp-amt" hint={amount ? `= ${fmtMan(amount)}` : "비워두면 등록하지 않음"}>
                  <input id="rp-amt" inputMode="numeric" className={cx(inputCls, "num text-right")} value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, "") ? Number(e.target.value.replace(/[^\d]/g, "")).toLocaleString("ko-KR") : "")} />
                </Field>
              </div>
            )}
          </div>
        )}
        {err && <Notice tone="err">{err}</Notice>}
        <p className="text-[0.72rem] text-ink-3">접수 {fmtDateTime(req.createdAt)}</p>
      </div>
    </Modal>
  );
}

/** 근거에 쓴 자료 — 내부 표 이름 대신 업무 말 (D-66) */
const DATA_LABEL: Record<string, string> = {
  change_orders: "변경공사",
  cost_budgets: "실행예산",
  cost_entries: "원가 입력",
  cost_forecasts: "잔여예상원가",
  material_moves: "자재 반입·설치",
  payments_received: "입금",
  progress_billings: "기성청구",
  progress_updates: "공정률",
  site_contracts: "계약",
};
