"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, UserPlus, Handshake, BadgeCheck, Send, Eye, Plus, Wrench, CircleCheck, PhoneIncoming, Trash2 } from "lucide-react";
import { useMe, useSignals, userLabel } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Notice, PageSkeleton, SeverityBadge, cx, inputCls } from "@/components/ui/primitives";
import { DiscardIntakeModal, IntakeContact, PhoneDefectModal } from "@/components/admin/IntakeLinks";
import { intakeVia } from "@/lib/domain/intake";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { AiReadyButton, Freshness, MethodChip, StatCard } from "@/components/domain/Widgets";
import { ActionCard, AssignModal } from "@/components/domain/Actions";
import { MyActionsView } from "@/components/domain/MyActionsView";
import { ACTION_STATUS_LABEL, PARTNER_STATUS_LABEL, PARTNER_TYPE_LABEL, RULE_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtDateTime, fmtMan, fmtRelative, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { worksOnSite } from "@/lib/domain/types";
import { partnerRepairView } from "@/lib/domain/partnerFeed";
import { defectRows } from "@/lib/domain/defects";
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
    // 하자보수 현황 등에서 특정 요청으로 오면(?req=) 그 요청으로 내려가 표시 (D-69 점검 반영)
    const req = new URLSearchParams(window.location.search).get("req");
    if (req) setTimeout(() => document.getElementById(`req-${req}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
    else if (window.location.hash === "#requests") setTimeout(() => document.getElementById("requests")?.scrollIntoView({ behavior: "smooth" }), 200);
  }, []);

  if (!db) return <PageSkeleton />;
  const open = db.actions.filter((a) => ["recommended", "assigned", "in_progress", "on_hold"].includes(a.status));
  const done = db.actions.filter((a) => a.status === "done");
  // 처리 대기 화면과 같은 기준 — 하자보수는 ‘하자보수’ 화면에서 따로 센다 (D-69 점검 반영)
  const newReq = db.partnerRequests.filter((r) => r.status !== "answered" && r.type !== "defect");
  const defectTodo = defectRows(db, todayIso()).filter((r) => r.next === "assign" || r.next === "reply").length;
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
        <StatCard label="발주처 요청 (미회신)" value={`${newReq.length}건`} sub={defectTodo ? `하자보수 본사 할 일 ${defectTodo}건 따로` : "견적·주문·일정 등 · 발주처 포털에서 접수"} icon={<Inbox size={21} />} group="growth" href={defectTodo ? "/defects" : undefined} />
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

const WO_STATE: Record<NonNullable<DemoDB["workOrders"]>[number]["status"], string> = { sent: "현장에 보냄", received: "현장이 확인함", in_progress: "보수 중", done: "완료 보고 · 본사 확인 전", confirmed: "완료 확인", returned: "보완 요청" };

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
  const [focus, setFocus] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const [phone, setPhone] = useState(false);
  // 처리할 것만(오래된 것부터) / 전체(최근 것부터) — 건수가 늘어도 손댈 것이 위에 오게 (D-74 점검 10차)
  const [show, setShow] = useState<"todo" | "all" | null>(null);
  useEffect(() => setFocus(new URLSearchParams(window.location.search).get("req")), []);
  const reopened = new Set(db.partnerRequests.map((r) => r.reopenedFrom).filter(Boolean));
  /** 본사가 지금 손댈 요청: 아직 회신 전 · 현장이 끝냈는데 회신 전 (다시 접수된 앞 건은 뺀다) */
  const isTodo = (r: PartnerRequest) => !reopened.has(r.id) && (r.status !== "answered" || (r.type === "defect" && partnerRepairView(db, r)?.stage === "checking"));
  const todo = db.partnerRequests.filter(isTodo).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const focusInTodo = !focus || todo.some((r) => r.id === focus);
  const mode = show ?? (todo.length > 0 && focusInTodo ? "todo" : "all");
  // 방금 처리한 요청이 ‘처리할 것’에서 바로 사라지지 않게 — 이 화면에 머무는 동안은 그대로 둔다 (회신 직후 결과를 확인할 수 있게)
  const kept = useRef(new Set<string>());
  for (const r of todo) kept.current.add(r.id);
  const list = mode === "todo" ? db.partnerRequests.filter((r) => kept.current.has(r.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : db.partnerRequests;
  const junkable = db.partnerRequests.filter((r) => r.intake && !r.confirmedAt && !r.linkedWorkOrderId && !reopened.has(r.id)).length;
  return (
    <Card id="requests" data-testid="partner-inbox">
      <CardHeader
        title="발주처·협력사 요청함"
        sub="발주처 포털·하자 접수 링크·전화 접수 → 본사 검토 → 회신"
        right={
          <span className="flex flex-wrap justify-end gap-1.5">
            <Button size="sm" variant="ghost" icon={<PhoneIncoming size={15} />} onClick={() => setPhone(true)} data-testid="inbox-phone-register">
              전화 받은 하자 등록
            </Button>
            <Link href="/partner">
              <Button size="sm" variant="ghost" icon={<Eye size={15} />}>
                포털 보기
              </Button>
            </Link>
          </span>
        }
      />
      {db.partnerRequests.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3" data-testid="inbox-filter">
          <div className="inline-flex rounded-full bg-surface-2 p-1" role="group" aria-label="요청 보기">
            {(
              [
                ["todo", `처리할 것 ${todo.length}`],
                ["all", `전체 ${db.partnerRequests.length}`],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setShow(k)} aria-pressed={mode === k} className={cx("press min-h-9 rounded-full px-3.5 text-[0.82rem] font-bold", mode === k ? "bg-surface text-ink shadow-card" : "text-ink-2")} data-testid={`inbox-show-${k}`}>
                {label}
              </button>
            ))}
          </div>
          <span className="text-[0.76rem] text-ink-3">{mode === "todo" ? "오래된 것부터" : "최근 것부터"}</span>
          {junkable > 0 && (
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} className="ml-auto" onClick={() => setDiscard(true)} data-testid="inbox-discard">
              장난·중복 접수 버리기
            </Button>
          )}
        </div>
      )}
      {list.length === 0 ? (
        <EmptyState icon={<Handshake size={26} />} title={db.partnerRequests.length ? "지금 처리할 요청이 없습니다." : "요청이 없습니다."} desc={db.partnerRequests.length ? "‘전체’를 누르면 회신한 요청을 볼 수 있습니다." : undefined} />
      ) : (
        <ul className="space-y-2.5 px-4 pb-4">
          {list.map((r) => {
            const site = db.sites.find((s) => s.id === r.siteId);
            const wo = r.linkedWorkOrderId ? (db.workOrders ?? []).find((w) => w.id === r.linkedWorkOrderId) : undefined;
            return (
              <li key={r.id} id={`req-${r.id}`} className={cx("scroll-mt-24 rounded-xl border p-3.5", r.status === "received" ? "border-warn/35 bg-warn-bg/40" : "border-line bg-surface", focus === r.id && "ring-2 ring-active")} data-testid="partner-request" data-status={r.status}>
                <div className="flex flex-wrap items-center gap-1.5 text-[0.74rem] text-ink-3">
                  <Badge tone={r.status === "answered" ? "ok" : r.status === "reviewing" ? "theme" : "warn"}>{PARTNER_STATUS_LABEL[r.status]}</Badge>
                  <Badge tone={r.type === "quote" || r.type === "order" ? "info" : r.type === "defect" ? "warn" : "neutral"}>{PARTNER_TYPE_LABEL[r.type]}</Badge>
                  {/* 줄이 바뀌어도 ‘·’로 시작하지 않게 조각마다 묶는다 (D-69) */}
                  <b className="text-ink-2">{site?.shortName}</b>
                  <span className="whitespace-nowrap">· {r.intake ? intakeVia(r.intake) : userLabel(db, r.partnerUserId)}</span>
                  <span className="whitespace-nowrap">· {fmtRelative(r.createdAt)}</span>
                </div>
                <p className="mt-1 text-[0.9rem] font-bold text-ink">{r.title}</p>
                {(r.item || r.qty || r.desiredDate) && (
                  <p className="text-[0.8rem] font-semibold text-ink" data-testid="request-goods">
                    {[r.item, r.qty, r.desiredDate ? `희망 ${fmtDate(r.desiredDate)}` : ""].filter(Boolean).join(" · ")}
                  </p>
                )}
                {r.location && <p className="text-[0.8rem] font-semibold text-ink" data-testid="request-location">위치: {r.location}</p>}
                {r.reopenedFrom && (
                  <p className="text-[0.78rem] font-semibold text-warn" data-testid="request-reopened">
                    {r.intake ? `다시 접수 (아직 문제가 있음) · 앞 접수 번호 ${db.partnerRequests.find((x) => x.id === r.reopenedFrom)?.intake?.no ?? "—"}` : `다시 요청 · 원래 요청: ${db.partnerRequests.find((x) => x.id === r.reopenedFrom)?.title ?? "—"}`}
                  </p>
                )}
                {/* 링크·전화 접수는 제목이 곧 적은 내용의 앞부분이라, 같은 글이면 한 번만 보여 준다 (D-74 점검 10차) */}
                {r.description.trim() !== r.title && <p className="whitespace-pre-wrap text-[0.8rem] text-ink-2">{r.description}</p>}
                {/* 링크로 들어온 접수: 접수자 이름·연락처 (본사만) · 진행 확인 주소 다시 만들기 (D-74) */}
                <IntakeContact db={db} req={r} />
                <PhotoStrip db={db} ids={r.photoIds} label={r.intake ? "접수 사진" : "발주처 사진"} testId="request-photos" />
                {reopened.has(r.id) && (
                  <p className="mt-1 text-[0.78rem] font-semibold text-ink-3" data-testid="request-superseded">
                    다시 접수되어 새 접수로 이어서 처리합니다.
                  </p>
                )}
                {wo && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.78rem] text-ink-2" data-testid="request-wo" data-wo-status={wo.status}>
                    <Wrench size={14} aria-hidden /> 보수 작업지시 · {userLabel(db, wo.assigneeUserId)}
                    <Badge tone={wo.status === "confirmed" ? "ok" : wo.status === "done" ? "warn" : wo.status === "returned" ? "err" : "theme"}>{WO_STATE[wo.status]}</Badge>
                    {wo.dueDate && <span className="num">기한 {fmtDate(wo.dueDate)}</span>}
                    <Link href={`/orders?wo=${wo.id}`} className="font-bold text-theme-ink underline">작업지시 보기</Link>
                  </p>
                )}
                {r.reply && <p className="mt-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[0.78rem] text-ink-2">회신: {r.reply}</p>}
                <PhotoStrip db={db} ids={r.replyPhotoIds} label="보낸 보수 사진" testId="request-reply-photos" />
                {r.confirmedAt && (
                  <p className="mt-1.5 text-[0.78rem] font-semibold text-ok" data-testid="request-confirmed">
                    <CircleCheck size={14} className="mr-1 inline" aria-hidden />
                    {r.intake ? "접수자" : "발주처"} 확인 완료 · {fmtDateTime(r.confirmedAt)}
                    {r.confirmNote ? ` · ${r.confirmNote}` : ""}
                  </p>
                )}
                {r.status !== "answered" && !reopened.has(r.id) && (
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
                            toast.push({ tone: "ok", title: "검토를 시작했습니다", desc: r.intake ? "접수자의 진행 확인 화면에 ‘검토 중’으로 표시됩니다." : "발주처 포털에 ‘검토 중’으로 표시됩니다." });
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
                {/* 일정 안내로 먼저 회신했고 아직 작업지시가 없는 하자 — 작업지시를 보낼 수 있다 (D-69 점검 반영) */}
                {r.status === "answered" && r.type === "defect" && !wo && !r.closedWithoutRepair && !r.confirmedAt && (
                  <div className="mt-2.5">
                    <Button size="sm" variant="soft" icon={<Wrench size={15} />} onClick={() => setToOrder(r)} data-testid="request-to-order">
                      작업지시로 보내기
                    </Button>
                  </div>
                )}
                {/* 작업지시는 확인했지만 발주처에 아직 회신하지 않은 하자 (D-69 점검 반영) */}
                {r.status !== "answered" && r.type === "defect" && partnerRepairView(db, r)?.stage === "done" && (
                  <p className="mt-2 text-[0.78rem] font-semibold text-warn" data-testid="request-reply-needed">보수는 끝났는데 {r.intake ? "접수자" : "발주처"}에게 아직 회신하지 않았습니다 — ‘회신하기’로 알려 주세요.</p>
                )}
                {/* 일정 안내로 먼저 회신한 하자보수 — 보수가 끝나면 보수 사진을 한 번 더 보낸다 (D-68 점검 반영) */}
                {r.status === "answered" && r.type === "defect" && partnerRepairView(db, r)?.stage === "checking" && (
                  <div className="mt-2.5">
                    <Button size="sm" variant="cta" icon={<Send size={15} />} onClick={() => setReply(r)} data-testid="request-send-photos">
                      보수 완료 회신 보내기
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
      {discard && <DiscardIntakeModal db={db} onClose={() => setDiscard(false)} />}
      {phone && <PhoneDefectModal db={db} onClose={() => setPhone(false)} />}
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
  // 현장 카드에 ‘하자보수’ 표시가 따로 붙으므로 제목에는 붙이지 않는다 (D-68 점검 반영)
  // 링크·전화 접수: ‘위치 — 문제’ (제목만 보고 어디의 무엇인지 알게 · D-74 점검 10차)
  const [title, setTitle] = useState((req.intake && req.location ? `${req.location} — ${req.title}` : req.title).slice(0, 80));
  const who = req.intake ? "접수자" : "발주처";
  const hasContact = !!req.intake && !!(req.intake.name || req.intake.phone);
  // 방문 약속을 잡으려면 보수 담당자가 접수자에게 전화해야 한다 — 기본으로 보여 준다 (접수 화면의 개인정보 안내에 ‘배정된 보수 담당자’가 적혀 있다)
  const [showContact, setShowContact] = useState(hasContact);
  const [memo, setMemo] = useState("");
  const [key] = useState(() => uid("idem"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // 링크·전화 접수는 제목에 ‘위치 — 문제’가 이미 들어 있다 — 제목에 다 담기지 않은 긴 내용만 덧붙인다 (현장 카드에 같은 글이 되풀이되지 않게)
  const base = req.intake ? (req.description.trim() === req.title ? "" : req.description.trim()) : [req.location ? `위치: ${req.location}` : "", req.description].filter(Boolean).join(" — ");
  const detail = [base.slice(0, memo.trim() ? 380 : 500), memo.trim() ? `본사 메모: ${memo.trim()}` : ""].filter(Boolean).join("\n").slice(0, 500);
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
                await run("createWorkOrder", { siteId: req.siteId, title, detail, assigneeUserId: assignee, dueDate: due || undefined, urgent, idempotencyKey: key, partnerRequestId: req.id, ...(hasContact && showContact ? { showContact: true } : {}) });
                toast.push({ tone: "ok", title: "작업지시를 보냈습니다", desc: req.intake ? "접수자의 진행 확인 화면에 ‘보수 배정’으로 표시됩니다 (알림은 가지 않습니다)." : "발주처 포털에 ‘보수 작업 배정’으로 표시됩니다." });
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
        {detail && (
          <p className="whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 text-[0.82rem] text-ink-2" data-testid="defect-order-detail">
            {detail}
          </p>
        )}
        {req.desiredDate && (
          <p className="text-[0.8rem] font-semibold text-ink-2" data-testid="defect-order-desired">
            발주처 보수 희망일: {fmtDate(req.desiredDate)}
            {req.desiredDate < todayIso() ? " (지남)" : ""}
          </p>
        )}
        <PhotoStrip db={db} ids={req.photoIds} label={`함께 가는 ${req.intake ? "접수" : "발주처"} 사진`} testId="defect-order-photos" />
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
          <Field label="기한 (선택)" htmlFor="do-due" error={errors.dueDate} hint={req.intake ? "접수자 화면에 ‘보수 목표일’로 보입니다" : undefined}>
            <input id="do-due" type="date" min={todayIso()} className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2.5 self-end pb-2 text-[0.88rem] font-semibold">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="size-4 accent-[var(--t-active)]" /> 긴급
          </label>
        </div>
        <Field label="현장 전달 메모 (선택)" htmlFor="do-memo" hint={`보수 담당자만 봅니다 — ${who}에게는 보이지 않습니다`}>
          <input id="do-memo" className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={100} placeholder="예: 방문 전 관리사무소에 먼저 들를 것" data-testid="defect-order-memo" />
        </Field>
        {hasContact && (
          <label className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3 text-[0.85rem]">
            <input type="checkbox" checked={showContact} onChange={(e) => setShowContact(e.target.checked)} className="mt-1 size-4 accent-[var(--t-active)]" data-testid="defect-order-contact" />
            <span>
              <b>접수자 연락처를 보수 담당자에게 보여 주기</b>
              <span className="block text-[0.74rem] text-ink-3">방문 약속용입니다. 받을 사람의 작업지시 카드에만 보이고, 본사가 완료를 확인하면 가려집니다. 끄면 본사가 대신 연락해야 합니다.</span>
            </span>
          </label>
        )}
        <p className="text-[0.74rem] text-ink-3">{who}에게는 ‘보수 배정 → 보수 중 → 보수 완료’ 단계와 기한만 보입니다. 담당자 이름·현장 메모는 보이지 않습니다.</p>
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
  const [share, setShare] = useState<string[]>(() => donePhotos.filter((p) => !(req.replyPhotoIds ?? []).includes(p.id)).map((p) => p.id));
  // 현장이 끝냈다고 보낸 작업지시는 회신하면서 완료 확인도 함께 (요청함과 작업지시 화면 상태가 어긋나던 문제 · D-68 점검 반영)
  const partialNote = !!wo && /일부/.test(`${wo.doneNote ?? ""}`);
  // ‘일부만 끝냈어요’면 기본으로 완료 확인하지 않는다 (D-69 점검 반영)
  const [confirmWo, setConfirmWo] = useState(wo?.status === "done" && !partialNote);
  const [closeNoRepair, setCloseNoRepair] = useState(false);
  const partial = !!wo && /일부/.test(`${wo.doneNote ?? ""}`);
  const [busy, setBusy] = useState(false);
  const PH: Partial<Record<PartnerRequest["type"], string>> = {
    quote: "예) 실측 후 사양별 견적서를 별도로 보내드리겠습니다.",
    order: "예) 자재 입고 일정 확인 후 납품·시공일을 안내드리겠습니다.",
    change_review: "예) 변경 범위 확인했습니다. 단가 검토 후 11월 첫 주 변경견적 회신 드리겠습니다.",
    schedule: "예) 11월 12일 오전 점검 가능합니다.",
    defect: woDone ? "예) 보수를 마쳤습니다. 실리콘을 다시 시공하고 물을 뿌려 확인했습니다." : "예) 11월 10일 오전에 보수하러 방문하겠습니다.",
  };
  const [register, setRegister] = useState(req.type === "change_review");
  const [amountText, setAmountText] = useState("");
  const [err, setErr] = useState("");
  const amount = Number(amountText.replace(/[^\d]/g, ""));
  return (
    <Modal
      open
      onClose={onClose}
      title={followUp ? "보수 완료 회신" : req.intake ? "접수자에게 회신" : "발주처 요청 회신"}
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
            disabled={busy}
            onClick={async () => {
              // 보내기 전에 빈칸부터 — 앞선 실패가 ‘검토 중’만 바꿔 두고 다음 보내기가 ‘이미 처리된 단계’로 막히던 문제 (D-68 점검 반영)
              if (!text.trim()) {
                setErr("회신 내용을 입력해주세요.");
                return;
              }
              setBusy(true);
              setErr("");
              try {
                await run("updatePartnerRequest", { requestId: req.id, patch: { status: "answered", reply: text, registerChangeOrder: register && amount > 0 ? { title: req.title, amount } : undefined, ...(share.length ? { sharePhotoIds: share } : {}), ...(closeNoRepair ? { closeWithoutRepair: true } : {}) } });
                if (wo && wo.status === "done" && confirmWo) await run("reviewWorkOrder", { workOrderId: wo.id, decision: "confirm" }).catch(() => {});
                toast.push(
                  req.intake
                    ? { tone: "ok", title: "회신했습니다 — 접수자에게 알려 주세요", desc: "알림이 가지 않는 접수입니다. 요청 카드의 ‘접수자에게 알리기’로 문자를 보내 주세요." }
                    : { tone: "ok", title: "회신했습니다", desc: req.type === "defect" && woDone ? "발주처 포털에 ‘보수 완료’와 회신이 표시됩니다." : "발주처 포털에 ‘회신 완료’와 회신 내용이 표시됩니다." },
                );
                onClose();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "실패");
              } finally {
                setBusy(false);
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
          {req.location ? `${req.location} — ` : ""}
          {req.description}
        </p>
        {wo && woDone && (wo.doneNote || wo.doneQty) && (
          <p className={cx("rounded-lg px-3 py-2 text-[0.82rem]", partial ? "bg-warn-bg text-ink" : "bg-ok-bg text-ink")} data-testid="reply-done-note">
            <b>현장 완료 보고:</b> {[wo.doneQty, wo.doneNote].filter(Boolean).join(" · ")}
            {partial && <span className="mt-0.5 block font-semibold text-warn">‘일부만 끝냈어요’로 보고됐습니다. 남은 작업을 확인한 뒤 회신하세요.</span>}
          </p>
        )}
        {req.type === "defect" && !wo && (
          <div className="rounded-xl border border-line bg-surface-2 p-3 text-[0.85rem]" data-testid="reply-no-wo">
            <p className="text-ink-2">아직 작업지시를 보내지 않았습니다. 보통은 일정 안내로 회신하고, 요청함의 ‘작업지시로 보내기’로 현장에 보냅니다.</p>
            <label className="mt-2 flex items-start gap-2.5">
              <input type="checkbox" checked={closeNoRepair} onChange={(e) => setCloseNoRepair(e.target.checked)} className="mt-1 size-4 accent-[var(--t-active)]" data-testid="reply-close-no-repair" />
              <span>
                <b>작업지시 없이 처리 끝</b>
                <span className="block text-[0.74rem] text-ink-3">
                  {req.intake ? "하자가 아니거나 전화로 해결한 경우만. 접수자 화면에 ‘답변 완료’로 보이고 확인을 받을 수 있습니다. 장난·중복 접수는 회신하지 말고 요청 카드의 ‘버리기’를 쓰세요." : "하자가 아니거나 전화로 해결한 경우만. 발주처에 ‘처리 완료 (보수 없음)’로 보이고 확인을 받을 수 있습니다."}
                </span>
              </span>
            </label>
          </div>
        )}
        {(req.type === "quote" || req.type === "order") && (
          <p className="text-[0.76rem] text-ink-3">회신 내용은 발주처에 그대로 보입니다. 금액·내부 원가는 적지 말고, 견적서는 별도로 보내세요.</p>
        )}
        <Field label={req.intake ? "회신 내용 (접수자의 진행 확인 화면에 그대로 보입니다)" : "회신 내용 (발주처에 표시)"} htmlFor="rp-text" required>
          <textarea id="rp-text" rows={3} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} maxLength={400} placeholder={PH[req.type] ?? "예) 확인했습니다. 담당자가 곧 연락드리겠습니다."} />
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
          <Notice tone="warn">현장 보수가 아직 끝나지 않았습니다 (지금: {WO_STATE[wo.status]}). 지금은 일정 안내로 회신하고, 현장이 ‘다 했어요’로 보내면 요청함의 ‘보수 완료 회신’으로 한 번 더 보내세요.</Notice>
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
            <p className="mt-1.5 text-[0.72rem] text-ink-3">
              {req.intake ? "고른 사진은 진행 확인 주소를 가진 사람이 볼 수 있습니다. 집 안·사람이 찍힌 사진은 빼 주세요." : "고른 사진은 요청한 발주처에게만 보입니다 (다른 발주처의 ‘공정 사진’에는 나오지 않음)."}
            </p>
          </fieldset>
        )}
        {wo && wo.status === "done" && (
          <label className="flex items-start gap-2.5 text-[0.85rem]">
            <input type="checkbox" checked={confirmWo} onChange={(e) => setConfirmWo(e.target.checked)} className="mt-1 size-4 accent-[var(--t-active)]" data-testid="reply-confirm-wo" />
            <span>
              <b>작업지시 완료 확인도 함께</b>
              <span className="block text-[0.74rem] text-ink-3">끄면 작업지시는 ‘완료 보고 · 본사 확인 전’으로 남습니다.</span>
            </span>
          </label>
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
