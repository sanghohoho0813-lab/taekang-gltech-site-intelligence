"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, UserPlus, Handshake, BadgeCheck, Send, Eye } from "lucide-react";
import { useMe, useSignals, userLabel } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, Field, Notice, PageSkeleton, SeverityBadge, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { AiReadyButton, Freshness, MethodChip, StatCard } from "@/components/domain/Widgets";
import { ActionCard, AssignModal } from "@/components/domain/Actions";
import { MyActionsView } from "@/components/domain/MyActionsView";
import { ACTION_STATUS_LABEL, PARTNER_STATUS_LABEL, RULE_LABEL } from "@/lib/domain/labels";
import { fmtDateTime, fmtMan, fmtRelative } from "@/lib/domain/format";
import { updatePartnerRequest } from "@/lib/data/commands";
import { dispatch } from "@/lib/data/store";
import type { DemoDB, PartnerRequest, RiskSignal } from "@/lib/domain/types";
import { ShieldAlert, ListChecks, Inbox } from "lucide-react";

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
        eyebrow="AX·성과"
        title="위험 분석 · 조치"
        desc="데이터에서 위험을 규칙으로 감지 → 사람이 승인해 담당자 배정 → 진행 → 결과 확인 → Proof Event로 기록합니다."
        right={
          <>
            <DemoBadge />
            <AiReadyButton />
          </>
        }
      />
      <Freshness />

      <div className="grid grid-cols-2 gap-3 @min-[900px]:grid-cols-4">
        <StatCard label="열린 위험 신호" value={`${signals.length}건`} sub={`경고 ${signals.filter((s) => s.severity === "high").length} · 주의 ${signals.filter((s) => s.severity === "medium").length} · 확인 ${signals.filter((s) => s.severity === "low").length}`} icon={<ShieldAlert size={21} />} group="ax" />
        <StatCard label="진행 중 조치" value={`${open.length}건`} sub={open.length ? `${ACTION_STATUS_LABEL[open[0].status]} · ${open[0].title}` : "없음"} icon={<ListChecks size={21} />} group="ops" />
        <StatCard label="완료 · Proof Event" value={`${done.length} · ${db.proofEvents.length}건`} sub={`결과 확인 ${db.proofEvents.filter((p) => p.status === "confirmed").length}건`} icon={<BadgeCheck size={21} />} group="ax" href="/evidence" />
        <StatCard label="발주처 요청 (미회신)" value={`${newReq.length}건`} sub="파트너 포털에서 접수" icon={<Inbox size={21} />} group="growth" />
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
    <li id={s.key} className={cx("rounded-xl border bg-surface p-3.5", s.severity === "high" ? "border-err/30" : "border-line")} data-testid="signal-item" data-rule={s.rule}>
      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={s.severity} />
        <span className="text-[0.74rem] font-bold text-ink-3">{RULE_LABEL[s.rule]}</span>
        <span className="text-[0.72rem] text-ink-3">· {fmtRelative(s.detectedAt)}</span>
      </div>
      <p className="mt-1 text-[0.93rem] font-bold leading-snug text-ink">{s.title}</p>
      <p className="text-[0.8rem] text-ink-2">{s.summary}</p>
      <button type="button" onClick={() => setWhy((v) => !v)} className="press mt-1.5 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[0.76rem] font-bold text-theme-ink hover:bg-active-soft" aria-expanded={why}>
        왜? 근거 {why ? "접기" : "보기"} <ChevronDown size={14} className={cx("transition-transform", why && "rotate-180")} />
      </button>
      {why && (
        <div className="mt-1.5 rounded-lg bg-surface-2 px-3 py-2 text-[0.78rem] text-ink-2">
          <ul className="list-disc space-y-0.5 pl-4">
            {s.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-[0.72rem] text-ink-3">기준: {s.threshold} · 사용 데이터: {s.dataUsed.join(", ")}</p>
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
            <Button size="sm" variant="ghost" onClick={onAssign}>
              추가 조치
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}

function PartnerInbox({ db }: { db: DemoDB }) {
  const toast = useToast();
  const [reply, setReply] = useState<PartnerRequest | null>(null);
  const list = db.partnerRequests;
  return (
    <Card id="requests" data-testid="partner-inbox">
      <CardHeader
        title="발주처·협력사 요청함"
        sub="파트너 포털 → 본사 검토 → 회신 → 포털 상태 갱신"
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
            return (
              <li key={r.id} className={cx("rounded-xl border p-3.5", r.status === "received" ? "border-warn/35 bg-warn-bg/40" : "border-line bg-surface")} data-testid="partner-request" data-status={r.status}>
                <div className="flex flex-wrap items-center gap-1.5 text-[0.74rem] text-ink-3">
                  <Badge tone={r.status === "answered" ? "ok" : r.status === "reviewing" ? "theme" : "warn"}>{PARTNER_STATUS_LABEL[r.status]}</Badge>
                  <b className="text-ink-2">{site?.shortName}</b> · {userLabel(db, r.partnerUserId)} · {fmtRelative(r.createdAt)}
                </div>
                <p className="mt-1 text-[0.9rem] font-bold text-ink">{r.title}</p>
                <p className="text-[0.8rem] text-ink-2">{r.description}</p>
                {r.reply && <p className="mt-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[0.78rem] text-ink-2">회신: {r.reply}</p>}
                {r.status !== "answered" && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {r.status === "received" && (
                      <Button
                        size="sm"
                        variant="soft"
                        onClick={() => {
                          try {
                            dispatch((d, ctx) => updatePartnerRequest(d, r.id, { status: "reviewing" }, ctx));
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
              </li>
            );
          })}
        </ul>
      )}
      {reply && <ReplyModal req={reply} onClose={() => setReply(null)} />}
    </Card>
  );
}

function ReplyModal({ req, onClose }: { req: PartnerRequest; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [register, setRegister] = useState(req.type === "change_review");
  const [amountText, setAmountText] = useState("");
  const [err, setErr] = useState("");
  const amount = Number(amountText.replace(/[^\d]/g, ""));
  return (
    <Modal
      open
      onClose={onClose}
      title="발주처 요청 회신"
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
            onClick={() => {
              try {
                if (req.status === "received") dispatch((d, ctx) => updatePartnerRequest(d, req.id, { status: "reviewing" }, ctx));
                dispatch((d, ctx) =>
                  updatePartnerRequest(d, req.id, { status: "answered", reply: text, registerChangeOrder: register && amount > 0 ? { title: req.title, amount } : undefined }, ctx),
                );
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
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[0.82rem] text-ink-2">{req.description}</p>
        <Field label="회신 내용 (발주처에 표시)" htmlFor="rp-text" required>
          <textarea id="rp-text" rows={3} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} maxLength={400} placeholder="예) 변경 범위 확인했습니다. 단가 검토 후 11월 첫 주 견적 회신 드리겠습니다." />
        </Field>
        <button
          type="button"
          onClick={() => setText("요청하신 변경 범위를 현장에서 확인했습니다. 추가 물량·단가 검토 후 변경공사 견적을 회신드리겠습니다. (DEMO 회신)")}
          className="press rounded-lg bg-[#FFF7D6] px-2 py-1 text-[0.75rem] font-bold text-[#7A5200]"
        >
          DEMO 회신 채우기
        </button>
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
