"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, UserPlus, Handshake, BadgeCheck, Send, Eye, Plus, Wrench, CircleCheck } from "lucide-react";
import { useMe, useSignals, userLabel } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, PageSkeleton, SeverityBadge, cx } from "@/components/ui/primitives";
import { PhotoStrip, ReplyModal } from "@/components/admin/RequestModals";
import { useToast } from "@/components/ui/Toast";
import { AiReadyButton, Freshness, MethodChip, StatCard } from "@/components/domain/Widgets";
import { ActionCard, AssignModal } from "@/components/domain/Actions";
import { MyActionsView } from "@/components/domain/MyActionsView";
import { ACTION_STATUS_LABEL, PARTNER_STATUS_LABEL, PARTNER_TYPE_LABEL, RULE_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtDateTime, fmtRelative, todayIso } from "@/lib/domain/format";
import { defectTodoCount } from "@/lib/domain/defects";
import { run } from "@/lib/data/store";
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
  // 메뉴 배지와 같은 수 (남은 보수 확인 포함 · D-76)
  const defectTodo = defectTodoCount(db, todayIso());
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
        <StatCard label="고객 요청 (미회신)" value={`${newReq.length}건`} sub={defectTodo ? `견적·주문·일정 · 하자보수 본사 할 일 ${defectTodo}건은 따로` : "견적·주문·일정 등 · 발주처 포털에서 접수"} icon={<Inbox size={21} />} group="growth" href="#requests" />
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

function PartnerInbox({ db }: { db: DemoDB }) {
  const toast = useToast();
  const router = useRouter();
  const [reply, setReply] = useState<PartnerRequest | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  // 처리할 것만(오래된 것부터) / 전체(최근 것부터) — 건수가 늘어도 손댈 것이 위에 오게 (D-74 점검 10차)
  const [show, setShow] = useState<"todo" | "all" | null>(null);
  // 하자는 하자보수 화면 한 곳에서 처리한다 (D-76) — 예전 링크(?req=하자)는 그 화면의 그 줄로 넘긴다
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("req");
    if (id && db.partnerRequests.some((r) => r.id === id && r.type === "defect")) router.replace(`/defects?req=${id}`);
    else setFocus(id);
  }, [db, router]);
  const requests = db.partnerRequests.filter((r) => r.type !== "defect");
  const defects = db.partnerRequests.filter((r) => r.type === "defect");
  const defectTodo = defectTodoCount(db, todayIso());
  /** 본사가 지금 손댈 요청: 아직 회신 전 */
  const todo = requests.filter((r) => r.status !== "answered").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const focusInTodo = !focus || todo.some((r) => r.id === focus);
  const mode = show ?? (todo.length > 0 && focusInTodo ? "todo" : "all");
  // 방금 처리한 요청이 ‘처리할 것’에서 바로 사라지지 않게 — 이 화면에 머무는 동안은 그대로 둔다 (회신 직후 결과를 확인할 수 있게)
  const kept = useRef(new Set<string>());
  for (const r of todo) kept.current.add(r.id);
  const list = mode === "todo" ? requests.filter((r) => kept.current.has(r.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <Card id="requests" data-testid="partner-inbox">
      <CardHeader
        title="고객 요청함"
        sub="발주처 포털로 들어온 견적·주문·설계변경·일정 요청 → 검토 → 회신 · 하자보수는 ‘하자보수’ 화면에서"
        right={
          <Link href="/partner">
            <Button size="sm" variant="ghost" icon={<Eye size={15} />}>
              포털 보기
            </Button>
          </Link>
        }
      />
      {/* 하자는 여기서 처리하지 않는다 — 같은 일을 하는 화면이 둘이면 헷갈린다 (D-75 점검 11차 → D-76) */}
      {defects.length > 0 && (
        <Link
          href={defectTodo ? "/defects?view=todo" : "/defects"}
          className={cx("press mx-4 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3.5 py-2.5 text-[0.86rem]", defectTodo ? "border-warn/40 bg-warn-bg/50" : "border-line bg-surface-2")}
          data-testid="inbox-defects-link"
        >
          <Wrench size={16} aria-hidden className="text-theme-ink" />
          <b className="text-ink">하자보수는 ‘하자보수’ 화면에서 처리합니다 · {defectTodo ? `본사 할 일 ${defectTodo}건` : "지금 본사 할 일 없음"}</b>
          <span className="text-ink-2">발주처 포털·접수 링크·전화 접수 모두 {defects.length}건</span>
          <span className="ml-auto font-bold text-theme-ink">하자보수로 →</span>
        </Link>
      )}
      {requests.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3" data-testid="inbox-filter">
          <div className="inline-flex rounded-full bg-surface-2 p-1" role="group" aria-label="요청 보기">
            {(
              [
                ["todo", `처리할 것 ${todo.length}`],
                ["all", `전체 ${requests.length}`],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setShow(k)} aria-pressed={mode === k} className={cx("press min-h-9 rounded-full px-3.5 text-[0.82rem] font-bold", mode === k ? "bg-surface text-ink shadow-card" : "text-ink-2")} data-testid={`inbox-show-${k}`}>
                {label}
              </button>
            ))}
          </div>
          <span className="text-[0.76rem] text-ink-3">{mode === "todo" ? "오래된 것부터" : "최근 것부터"}</span>
        </div>
      )}
      {list.length === 0 ? (
        <EmptyState icon={<Handshake size={26} />} title={requests.length ? "지금 처리할 고객 요청이 없습니다." : "견적·주문·일정 요청이 없습니다."} desc={requests.length ? "‘전체’를 누르면 회신한 요청을 볼 수 있습니다." : "발주처가 포털 ‘요청하기’로 보내면 여기에 들어옵니다."} />
      ) : (
        <ul className="space-y-2.5 px-4 pb-4">
          {list.map((r) => {
            const site = db.sites.find((s) => s.id === r.siteId);
            return (
              <li key={r.id} id={`req-${r.id}`} className={cx("scroll-mt-24 rounded-xl border p-3.5", r.status === "received" ? "border-warn/35 bg-warn-bg/40" : "border-line bg-surface", focus === r.id && "ring-2 ring-active")} data-testid="partner-request" data-status={r.status}>
                <div className="flex flex-wrap items-center gap-1.5 text-[0.74rem] text-ink-3">
                  <Badge tone={r.status === "answered" ? "ok" : r.status === "reviewing" ? "theme" : "warn"}>{PARTNER_STATUS_LABEL[r.status]}</Badge>
                  <Badge tone={r.type === "quote" || r.type === "order" ? "info" : "neutral"}>{PARTNER_TYPE_LABEL[r.type]}</Badge>
                  {/* 줄이 바뀌어도 ‘·’로 시작하지 않게 조각마다 묶는다 (D-69) */}
                  <b className="text-ink-2">{site?.shortName}</b>
                  <span className="whitespace-nowrap">· {userLabel(db, r.partnerUserId)}</span>
                  <span className="whitespace-nowrap">· {fmtRelative(r.createdAt)}</span>
                </div>
                <p className="mt-1 text-[0.9rem] font-bold text-ink">{r.title}</p>
                {(r.item || r.qty || r.desiredDate) && (
                  <p className="text-[0.8rem] font-semibold text-ink" data-testid="request-goods">
                    {[r.item, r.qty, r.desiredDate ? `희망 ${fmtDate(r.desiredDate)}` : ""].filter(Boolean).join(" · ")}
                  </p>
                )}
                {r.location && <p className="text-[0.8rem] font-semibold text-ink" data-testid="request-location">위치: {r.location}</p>}
                {r.description.trim() !== r.title && <p className="whitespace-pre-wrap text-[0.8rem] text-ink-2">{r.description}</p>}
                <PhotoStrip db={db} ids={r.photoIds} label="발주처 사진" testId="request-photos" />
                {r.reply && <p className="mt-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[0.78rem] text-ink-2">회신: {r.reply}</p>}
                {r.confirmedAt && (
                  <p className="mt-1.5 text-[0.78rem] font-semibold text-ok" data-testid="request-confirmed">
                    <CircleCheck size={14} className="mr-1 inline" aria-hidden />
                    발주처 확인 완료 · {fmtDateTime(r.confirmedAt)}
                    {r.confirmNote ? ` · ${r.confirmNote}` : ""}
                  </p>
                )}
                {r.status !== "answered" && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
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
              </li>
            );
          })}
        </ul>
      )}
      {reply && <ReplyModal db={db} req={reply} onClose={() => setReply(null)} />}
    </Card>
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
