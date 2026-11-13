"use client";

/** 본사 — 지시·확인: 작업지시(지시→접수→진행→완료→확인/보완) · 현장 보고 확인/보완 요청 · 근태 수정 요청 승인/반려 */
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { useSearchParams } from "next/navigation";
import { Send } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { run } from "@/lib/data/store";
import { CommandError } from "@/lib/data/commands";
import { FIX_KIND_LABEL } from "@/lib/data/opsCommands";
import type { AttendanceRecord, DemoDB, FieldReport, WorkOrder } from "@/lib/domain/types";
import { worksOnSite } from "@/lib/domain/types";
import { repliedAfterDone } from "@/lib/domain/partnerFeed";
import { defectRows, type DefectNext } from "@/lib/domain/defects";
import { intakeVia } from "@/lib/domain/intake";
import { fmtDate, fmtMan, todayIso } from "@/lib/domain/format";
import { backdatedDays, hhmm } from "@/lib/domain/attendance";
import { GEO_LABEL } from "@/lib/domain/geo";
import { uid } from "@/lib/domain/ids";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Field, PageSkeleton, Segmented, cx, inputCls } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";

const WO_LABEL: Record<WorkOrder["status"], string> = { sent: "미접수", received: "접수", in_progress: "진행 중", done: "완료 보고 — 확인 필요", confirmed: "확인 완료", returned: "보완 요청 중" };
const WO_TONE: Record<WorkOrder["status"], "warn" | "ok" | "info" | "err" | "neutral"> = { sent: "warn", received: "info", in_progress: "info", done: "err", confirmed: "ok", returned: "warn" };

type Tab = "orders" | "reports" | "fixes";

function Inner() {
  const { db } = useMe();
  const q = useSearchParams().get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(q && ["orders", "reports", "fixes"].includes(q) ? q : "orders");
  if (!db) return <PageSkeleton />;
  const toConfirm = (db.workOrders ?? []).filter((w) => w.status === "done").length;
  const unreviewed = db.reports.filter((r) => r.status !== "voided" && !r.review).length;
  const fixes = (db.attendanceRequests ?? []).filter((x) => x.status === "pending").length;
  return (
    <PageBody>
      <PageHeader title="지시·확인" desc="본사가 현장에 일을 지시하고, 현장 보고와 근태 수정 요청을 확인하는 곳입니다. 모든 처리는 시각·처리자와 함께 이력에 남습니다." />
      <Segmented
        label="지시·확인 메뉴"
        value={tab}
        onChange={setTab}
        options={[
          { value: "orders", label: toConfirm ? `작업지시 · 확인 ${toConfirm}` : "작업지시", testId: "ord-tab-orders" },
          { value: "reports", label: unreviewed ? `현장 보고 확인 ${unreviewed}` : "현장 보고 확인", testId: "ord-tab-reports" },
          { value: "fixes", label: fixes ? `근태 수정 요청 ${fixes}` : "근태 수정 요청", testId: "ord-tab-fixes" },
        ]}
      />
      {tab === "orders" && <Orders db={db} />}
      {tab === "reports" && <Reports db={db} />}
      {tab === "fixes" && <Fixes db={db} />}
    </PageBody>
  );
}

const DEFECT_LINK_TEXT: Record<DefectNext, string> = {
  assign: "작업지시·이력 보기",
  repairing: "일정 안내·이력 보기",
  reply: "보수 완료 회신하기",
  check: "남은 보수 확인",
  client: "회신·이력 보기",
  closed: "이력 보기",
  reopened: "이력 보기",
};

/** 작업지시 카드의 하자 출처 — 링크·전화 접수는 ‘발주처’가 아니다 (점검 11차) */
function defectSourceLabel(db: DemoDB, requestId: string): string {
  const r = db.partnerRequests.find((x) => x.id === requestId);
  return r?.intake ? `하자보수 · ${intakeVia(r.intake)}` : "하자보수 · 발주처";
}
/** 이 작업지시로 고친 하자에 아직 보수 완료 회신을 보내지 않았는가 */
function needsCompletionReply(db: DemoDB, w: WorkOrder): boolean {
  const r = w.sourcePartnerRequestId ? db.partnerRequests.find((x) => x.id === w.sourcePartnerRequestId) : undefined;
  return !!r && !r.confirmedAt && !repliedAfterDone(w, r);
}

export function OrdersBoard() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Inner />
    </Suspense>
  );
}

const nameOf = (db: DemoDB, id?: string) => db.users.find((u) => u.id === id)?.name ?? "—";
const siteOf = (db: DemoDB, id: string) => db.sites.find((s) => s.id === id)?.shortName ?? "";

/** 확인 / 보완 요청(사유 필수) 두 버튼 */
function Decide({ onConfirm, onReturn, confirmLabel = "확인", returnLabel = "보완 요청", testPrefix, notePlaceholder = "사유 (예: 보수 후 사진 추가)", sendLabel = "보내기" }: { onConfirm: () => Promise<void>; onReturn: (note: string) => Promise<void>; confirmLabel?: string; returnLabel?: string; testPrefix: string; notePlaceholder?: string; sendLabel?: string }) {
  const [ret, setRet] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!ret ? (
        <>
          <Button size="sm" variant="cta" loading={busy} onClick={() => act(onConfirm)} data-testid={`${testPrefix}-confirm`}>
            {confirmLabel}
          </Button>
          <Button size="sm" variant="danger" onClick={() => setRet(true)} data-testid={`${testPrefix}-return`}>
            {returnLabel}
          </Button>
        </>
      ) : (
        <>
          <input className={cx(inputCls, "h-9 w-64 py-1 text-[0.84rem]")} value={note} onChange={(e) => setNote(e.target.value)} placeholder={notePlaceholder} aria-label="사유" data-testid={`${testPrefix}-note`} />
          <Button size="sm" variant="danger" loading={busy} disabled={note.trim().length < 2} onClick={() => act(() => onReturn(note))} data-testid={`${testPrefix}-return-send`}>
            {sendLabel}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRet(false)}>
            취소
          </Button>
        </>
      )}
    </div>
  );
}

function useRun() {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.push({ tone: "ok", title: ok });
    } catch (e) {
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "처리 실패" });
    }
  };
}

function Orders({ db }: { db: DemoDB }) {
  const go = useRun();
  const toast = useToast();
  // 요청함 ‘작업지시 보기’로 오면 그 작업지시로 내려가 표시한다 (D-68 점검 반영)
  const focusWo = useSearchParams().get("wo");
  useEffect(() => {
    if (focusWo) window.setTimeout(() => document.getElementById(`wo-${focusWo}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 150);
  }, [focusWo]);
  const sites = db.sites.filter((s) => s.status === "active");
  const [f, setF] = useState({ siteId: sites[0]?.id ?? "", title: "", detail: "", dueDate: "", urgent: false, assignee: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState(() => uid("idem"));
  const site = db.sites.find((s) => s.id === f.siteId);
  // 이 현장을 맡은 현장 직원과 본사 직원만 (D-65 점검 반영)
  const people = db.users.filter((u) => !u.inactive && u.role !== "partner" && u.role !== "ceo" && (!site || worksOnSite(u, site)));
  // 현장 담당이 없는 현장은 ‘현장 담당’ 칸을 빼고 첫 사람을 고른다 — 보내면 ‘받을 사람을 골라 주세요’로 막히던 문제 (D-77 리허설)
  const ownerOk = !!site && db.users.some((u) => u.id === site.fieldUserId && !u.inactive);
  const assignee = f.assignee || (ownerOk ? "" : (people[0]?.id ?? ""));
  const today = todayIso();
  const orders = [...(db.workOrders ?? [])].sort((a, b) => order(a) - order(b) || b.createdAt.localeCompare(a.createdAt));
  // 하자 작업지시의 ‘하자보수에서 …’ 문구는 하자보수 화면의 다음 할 일과 같게 (점검 12차)
  const defectNext = new Map(db.workOrders?.some((w) => w.sourcePartnerRequestId) ? defectRows(db, today).map((r) => [r.req.id, r.next] as const) : []);
  const create = async () => {
    try {
      await run("createWorkOrder", { siteId: f.siteId, title: f.title, detail: f.detail, assigneeUserId: assignee || undefined, dueDate: f.dueDate || undefined, urgent: f.urgent, idempotencyKey: key });
      setF({ ...f, title: "", detail: "", dueDate: "", urgent: false });
      setErrors({});
      setKey(uid("idem"));
    } catch (e) {
      if (e instanceof CommandError) setErrors(e.fieldErrors);
      // 칸 오류가 아닌 실패(현장 없음·권한·연결)도 알린다 — 아무 일도 없는 것처럼 보이던 문제 (D-65 점검 반영)
      if (!(e instanceof CommandError) || !Object.keys(e.fieldErrors).length) toast.push({ tone: "err", title: e instanceof Error ? e.message : "작업지시를 보내지 못했습니다" });
    }
  };
  return (
    <div className="grid gap-5 @min-[1100px]:grid-cols-[22rem_minmax(0,1fr)]">
      <Card data-testid="wo-create">
        <CardHeader title="새 작업지시" sub="현장 직원 휴대폰 ‘본사 요청’에 바로 나타납니다" />
        <div className="space-y-3 px-5 pb-5">
          <Field label="현장" htmlFor="wo-site">
            <select id="wo-site" className={inputCls} value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value, assignee: "" })}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shortName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="받는 사람" htmlFor="wo-assignee" error={errors.assigneeUserId} hint={site && ownerOk ? `비우면 현장 담당 ${nameOf(db, site.fieldUserId)}` : site && !people.length ? "이 현장을 맡은 직원이 없습니다. 운영 관리에서 먼저 배정하세요." : undefined}>
            <select id="wo-assignee" className={inputCls} value={assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}>
              {ownerOk && <option value="">현장 담당</option>}
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="지시 제목" htmlFor="wo-title" required error={errors.title}>
            <input id="wo-title" className={inputCls} value={f.title} maxLength={80} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="예) 3층 남측 실링 보수" data-testid="wo-title" />
          </Field>
          <Field label="내용" htmlFor="wo-detail" error={errors.detail}>
            <textarea id="wo-detail" rows={3} className={inputCls} value={f.detail} maxLength={500} onChange={(e) => setF({ ...f, detail: e.target.value })} placeholder="예) 보수 전·후 사진을 남겨 주세요." />
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="기한" htmlFor="wo-due" error={errors.dueDate}>
              <input id="wo-due" type="date" min={today} className={inputCls} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
            </Field>
            <label className="mb-2.5 inline-flex items-center gap-2 text-[0.88rem] font-semibold">
              <input type="checkbox" className="size-4 accent-[var(--t-active)]" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} /> 긴급
            </label>
          </div>
          <Button variant="cta" block icon={<Send size={16} />} onClick={create} data-testid="wo-send">
            지시 보내기
          </Button>
        </div>
      </Card>
      <Card data-testid="wo-board">
        <CardHeader title={`작업지시 ${orders.length}건`} sub="완료 보고는 사진·작업량을 보고 확인하거나 보완을 요청하세요" />
        {orders.length === 0 ? (
          <EmptyState title="보낸 작업지시가 없습니다" />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {orders.map((w) => {
              const late = w.dueDate && w.dueDate < today && !["done", "confirmed"].includes(w.status);
              const photos = (w.donePhotoIds ?? []).map((id) => db.photos.find((p) => p.id === id)).filter(Boolean);
              return (
                <li key={w.id} id={`wo-${w.id}`} className={cx("scroll-mt-24 space-y-1.5 px-5 py-3", focusWo === w.id && "bg-active-soft ring-2 ring-active ring-inset")} data-testid="wo-row" data-status={w.status} data-wo={w.id}>
                  <p className="flex flex-wrap items-center gap-1.5 text-[0.8rem] text-ink-3">
                    <b className="text-ink-2">{siteOf(db, w.siteId)}</b> → {nameOf(db, w.assigneeUserId)} · {fmtDate(w.createdAt.slice(0, 10))}
                    {w.dueDate && <span className={late ? "font-bold text-err" : ""}>· 기한 {fmtDate(w.dueDate)}{late ? " (지남)" : ""}</span>}
                    {w.urgent && <Badge tone="err">긴급</Badge>}
                    {w.sourcePartnerRequestId && <Badge tone="warn">{defectSourceLabel(db, w.sourcePartnerRequestId)}</Badge>}
                    <Badge tone={WO_TONE[w.status]}>{WO_LABEL[w.status]}</Badge>
                  </p>
                  <p className="text-[0.95rem] font-bold">{w.title}</p>
                  {(w.doneQty || w.doneNote) && (
                    <p className="text-[0.84rem] text-ink-2">
                      완료 보고: {[w.doneQty, w.doneNote].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {photos.length > 0 && <PhotoThumbs urls={photos.map((p) => p!.dataUrl)} label="완료 사진" />}
                  {w.sourcePartnerRequestId && (
                    // 하자는 하자보수 화면에서 처리한다 — 그 줄을 펼쳐 이력과 함께 (점검 11차)
                    <Link href={`/defects?req=${w.sourcePartnerRequestId}`} className="inline-flex min-h-11 items-center text-[0.82rem] font-bold text-theme-ink underline" data-testid="wo-to-request">
                      하자보수에서 {DEFECT_LINK_TEXT[defectNext.get(w.sourcePartnerRequestId) ?? "repairing"]} →
                    </Link>
                  )}
                  {w.status === "returned" && w.returnNote && <p className="text-[0.82rem] font-semibold text-warn">보완 요청: {w.returnNote}</p>}
                  {w.status === "done" && (
                    <Decide
                      testPrefix="wo"
                      confirmLabel="완료 확인"
                      onConfirm={() =>
                        go(
                          () => run("reviewWorkOrder", { workOrderId: w.id, decision: "confirm" }),
                          // 하자보수는 발주처에 회신해야 끝난다 — 확인만 하고 잊지 않게 (D-69 점검 반영)
                          // 일정 안내 회신만 있어도 보수 완료 회신은 아직이다 — 완료 보고 뒤 회신이 있는지로 본다 (점검 11차)
                          needsCompletionReply(db, w) ? "완료를 확인했습니다 — 하자보수에서 보수 완료 회신을 보내 주세요 (아래 링크)" : "작업지시 완료를 확인했습니다",
                        )
                      }
                      onReturn={(note) => go(() => run("reviewWorkOrder", { workOrderId: w.id, decision: "return", note }), "보완을 요청했습니다")}
                    />
                  )}
                  <details className="text-[0.76rem] text-ink-3">
                    <summary className="cursor-pointer">이력 {w.history.length}</summary>
                    <ol className="mt-1 space-y-0.5">
                      {w.history.map((h, i) => (
                        <li key={i}>
                          {fmtDate(h.at.slice(0, 10))} {hhmm(h.at)} · {nameOf(db, h.by)} · {WO_LABEL[h.to]}
                          {h.note ? ` · ${h.note}` : ""}
                        </li>
                      ))}
                    </ol>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

const order = (w: WorkOrder) => ({ done: 0, sent: 1, returned: 2, received: 3, in_progress: 4, confirmed: 5 })[w.status];

function Reports({ db }: { db: DemoDB }) {
  const go = useRun();
  const { canSeeMoney } = useMe();
  const live = db.reports.filter((r) => r.status !== "voided");
  const pending = live.filter((r) => !r.review);
  const returned = live.filter((r) => r.review?.status === "returned");
  const row = (r: FieldReport, actions: boolean) => {
    const photos = r.photoIds.map((id) => db.photos.find((p) => p.id === id)).filter(Boolean);
    const costs = db.costEntries.filter((e) => e.reportId === r.id && e.status !== "voided");
    const late = backdatedDays(r);
    const wo = r.workOrderId ? (db.workOrders ?? []).find((w) => w.id === r.workOrderId) : undefined;
    return (
      <li key={r.id} className="space-y-1.5 px-5 py-3" data-testid="rv-row" data-report={r.id}>
        <p className="flex flex-wrap items-center gap-1.5 text-[0.8rem] text-ink-3">
          <b className="text-ink-2">{siteOf(db, r.siteId)}</b> · {nameOf(db, r.createdBy)} · {fmtDate(r.reportDate)} 보고 ({hhmm(r.createdAt)} 작성)
          {r.geo && <Badge tone={r.geo.status === "inside" ? "ok" : r.geo.status === "outside" ? "err" : "neutral"}>{GEO_LABEL[r.geo.status]}</Badge>}
          {late > 0 && <Badge tone="warn">{late}일 지난 날짜</Badge>}
          {wo && <Badge tone="info">지시: {wo.title}</Badge>}
          {(r.supplements?.length ?? 0) > 0 && <Badge tone="info">보완 {r.supplements!.length}회</Badge>}
        </p>
        <p className="text-[0.9rem] font-semibold">{r.workDone}</p>
        {r.issues && <p className="text-[0.82rem] text-warn">문제: {r.issues}</p>}
        {r.supplements?.map((s, i) => (
          <p key={i} className="text-[0.82rem] text-ink-2">
            보완 ({hhmm(s.at)}): {s.text || "사진"}
          </p>
        ))}
        {costs.length > 0 && <p className="text-[0.82rem] text-ink-2">비용 {costs.length}건{canSeeMoney ? ` · ${fmtMan(costs.reduce((a, e) => a + e.amount, 0))}` : ""}</p>}
        {photos.length > 0 && <PhotoThumbs urls={photos.map((p) => p!.dataUrl)} label="현장 사진" />}
        {r.review?.status === "returned" && <p className="text-[0.82rem] font-semibold text-warn">보완 요청: {r.review.note} (현장 보완 대기)</p>}
        {actions && (
          <Decide
            testPrefix="rv"
            onConfirm={() => go(() => run("reviewReport", { reportId: r.id, decision: "confirm" }), "보고를 확인했습니다")}
            onReturn={(note) => go(() => run("reviewReport", { reportId: r.id, decision: "return", note }), "보완을 요청했습니다 — 현장 휴대폰에 표시됩니다")}
          />
        )}
      </li>
    );
  };
  return (
    <div className="grid gap-5">
      <Card data-testid="rv-pending">
        <CardHeader title={`확인할 현장 보고 ${pending.length}건`} sub="사진·작업 내용을 보고 ‘확인’하거나, 부족하면 사유와 함께 ‘보완 요청’ — 현장 휴대폰에 바로 표시됩니다" />
        {pending.length === 0 ? <EmptyState title="확인할 보고가 없습니다" /> : <ul className="divide-y divide-line border-t border-line">{pending.map((r) => row(r, true))}</ul>}
      </Card>
      {returned.length > 0 && (
        <Card data-testid="rv-returned">
          <CardHeader title={`보완 요청 중 ${returned.length}건`} />
          <ul className="divide-y divide-line border-t border-line">{returned.map((r) => row(r, false))}</ul>
        </Card>
      )}
    </div>
  );
}

function Fixes({ db }: { db: DemoDB }) {
  const go = useRun();
  const list = [...(db.attendanceRequests ?? [])].sort((a, b) => Number(a.status !== "pending") - Number(b.status !== "pending") || b.createdAt.localeCompare(a.createdAt));
  return (
    <Card data-testid="fix-board">
      <CardHeader title="근태 수정 요청" sub="GPS 실패·출퇴근 누락·잘못 찍힘을 직원이 사유와 함께 요청합니다. 승인하면 출퇴근 기록이 고쳐지고(또는 위치 없이 새로 등록) 이력이 남습니다." />
      {list.length === 0 ? (
        <EmptyState title="요청이 없습니다" />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {list.map((q) => {
            const rec = (db.attendance ?? []).find((r) => r.id === q.attendanceId);
            return (
              <li key={q.id} className="space-y-1.5 px-5 py-3" data-testid="fix-row" data-status={q.status}>
                <p className="flex flex-wrap items-center gap-1.5 text-[0.8rem] text-ink-3">
                  <b className="text-ink-2">{nameOf(db, q.userId)}</b> · {siteOf(db, q.siteId)} · {fmtDate(q.workDate)} · 요청 {hhmm(q.createdAt)}
                  <Badge tone={q.status === "pending" ? "warn" : q.status === "approved" ? "ok" : "err"}>{q.status === "pending" ? "확인 대기" : q.status === "approved" ? "승인" : "반려"}</Badge>
                </p>
                <p className="text-[0.92rem] font-bold">
                  {q.auto === "offline" ? (
                    <Badge tone="info" className="mr-1.5">
                      통신 불량 · 자동
                    </Badge>
                  ) : null}
                  {q.auto === "offline" ? "누른 시각 확인" : FIX_KIND_LABEL[q.kind]}
                  {q.inTime ? ` · 출근 ${q.inTime}` : ""}
                  {q.outTime ? ` · 퇴근 ${q.outTime}` : ""}
                </p>
                <p className="text-[0.82rem] text-ink-2">
                  사유: {q.reason}
                  {rec ? ` · 현재 기록: 출근 ${hhmm(rec.inAt)} ${GEO_LABEL[rec.inGeo.status]}${rec.outAt ? ` · 퇴근 ${hhmm(rec.outAt)}${rec.outGeo ? ` ${GEO_LABEL[rec.outGeo.status]}` : ""}` : " · 퇴근 없음"}` : " · 현재 기록 없음"}
                </p>
                {q.auto === "offline" && rec && <OfflineCheck db={db} rec={rec} userId={q.userId} pending={q.status === "pending"} />}
                {q.reviewNote && <p className="text-[0.8rem] text-ink-3">처리 메모: {q.reviewNote}</p>}
                {q.status === "pending" && (
                  <Decide
                    testPrefix="fix"
                    confirmLabel="승인"
                    returnLabel="반려"
                    notePlaceholder="반려 사유 (예: 그날 현장 출근 기록이 없음)"
                    sendLabel="반려하기"
                    onConfirm={() => go(() => run("reviewAttendanceFix", { requestId: q.id, decision: "approve" }), "승인 — 출퇴근 기록에 반영했습니다")}
                    onReturn={(note) => go(() => run("reviewAttendanceFix", { requestId: q.id, decision: "reject", note }), "반려했습니다")}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/**
 * 통신 불량 자동 요청 확인 도움 (리뷰 반영 D-55) — 누른 시각은 휴대폰 시계라 확인되지 않는다.
 * 누른 시각과 도착 시각의 차이, 그 사이 이 직원의 다른 앱 기록(있으면 통신이 됐을 수 있음)을 보여준다.
 */
function OfflineCheck({ db, rec, userId, pending }: { db: DemoDB; rec: AttendanceRecord; userId: string; pending: boolean }) {
  const parts = (
    [
      ["출근", rec.inSentLater, rec.corrections?.[0]?.before.inAt ?? rec.inAt],
      ["퇴근", rec.outSentLater, rec.corrections?.[0]?.before.outAt ?? rec.outAt],
    ] as const
  ).filter(([, sl, got]) => sl && got);
  if (!parts.length) return null;
  return (
    <ul className="space-y-0.5 rounded-lg bg-surface-2 px-3 py-2 text-[0.8rem]" data-testid="fix-offline">
      {parts.map(([what, sl, got]) => {
        const gap = Math.round((Date.parse(got!) - Date.parse(sl!.pressedAt)) / 60_000);
        const between = db.activityLogs.filter((l) => l.by === userId && l.at > sl!.pressedAt && l.at < got! && l.type !== "attendance").length;
        return (
          <li key={what}>
            {what}: 누른 시각 <b>{hhmm(sl!.pressedAt)}</b> <span className="text-ink-3">(휴대폰 시계 · 확인 안 됨)</span> → 서버 도착 <b>{hhmm(got!)}</b> ({gap}분 뒤)
            {between > 0 && pending && <span className="ml-1 font-bold text-warn" data-testid="fix-offline-between">· 그 사이 이 직원의 다른 앱 기록 {between}건 — 통신이 됐을 수 있어요</span>}
          </li>
        );
      })}
      <li className="text-ink-3">승인해도 ‘현장 밖’ 같은 위치 표시는 출퇴근 현황에 그대로 남습니다.</li>
    </ul>
  );
}

/** 사진 작게 보기 → 누르면 이 화면 안에서 크게 (데이터 주소 사진이 새 창에서 안 열리던 문제 · D-68 점검 반영) */
function PhotoThumbs({ urls, label }: { urls: string[]; label: string }) {
  const [big, setBig] = useState<string | null>(null);
  return (
    <div className="flex gap-1.5">
      {urls.map((u, i) => (
        <button key={i} type="button" onClick={() => setBig(u)} className="press overflow-hidden rounded-md" aria-label={`${label} ${i + 1} 크게 보기`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt="" className="size-14 object-cover" />
        </button>
      ))}
      <Modal open={!!big} onClose={() => setBig(null)} title={label} size="lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {big && <img src={big} alt={label} className="w-full rounded-xl" />}
      </Modal>
    </div>
  );
}
