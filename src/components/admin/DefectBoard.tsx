"use client";

/**
 * 하자보수 (본사 · D-69 · D-75) — 발주처 포털·하자 접수 링크·전화로 들어온 하자의 진행·기한·처리 기간을 한 화면에, 인쇄용 하자보수 관리대장까지.
 * D-75부터 이 화면에서 바로 처리한다: 작업지시 보내기·회신·접수자에게 알리기·버리기, 그리고 한 건의 처리 이력. 금액은 없다.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlarmClock, ChevronDown, CircleCheck, Hourglass, PhoneIncoming, Printer, QrCode, Send, Wrench } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { DEFECT_NEXT_LABEL, defectLedger, defectRows, defectStats, defectTimeline, repairingLabel, type DefectRow } from "@/lib/domain/defects";
import { fmtDate, fmtDateTime, todayIso } from "@/lib/domain/format";
import { shiftDate } from "@/lib/domain/attendance";
import { IS_LIVE } from "@/lib/mode";
import { DEFECT_WARRANTY_LABEL, WARRANTY_LABEL, warrantyClientLine, warrantyLine, warrantyStatus } from "@/lib/domain/warranty";
import { WARRANTY_TONE } from "@/components/admin/WarrantyCard";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { StatCard } from "@/components/domain/Widgets";
import { Badge, Button, Card, CardHeader, EmptyState, PageSkeleton, Segmented, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { IntakeContact, PhoneDefectModal } from "@/components/admin/IntakeLinks";
import { DefectOrderModal, PhotoStrip, ReplyModal } from "@/components/admin/RequestModals";
import { userLabel } from "@/lib/data/hooks";
import type { DemoDB, PartnerRequest } from "@/lib/domain/types";
import { intakeState, intakeVia } from "@/lib/domain/intake";

type View = "todo" | "open" | "all" | "ledger";
// 본사가 손댈 것만 진한 색 — ‘현장 보수 중’은 기다리는 상태라 중립 (D-69 점검 반영)
const NEXT_TONE = { assign: "err", reply: "warn", repairing: "neutral", client: "info", closed: "ok", reopened: "neutral" } as const;
// 링크·전화 접수는 ‘발주처’가 아니라 ‘접수자’ (D-74 점검 10차)
const nextLabel = (r: DefectRow) => (r.next === "repairing" ? repairingLabel(r.wo) : r.req.intake ? DEFECT_NEXT_LABEL[r.next].replace("발주처", "접수자").replace("다시 요청됨", "다시 접수됨") : DEFECT_NEXT_LABEL[r.next]);
const daysText = (r: DefectRow) => (r.repairedDate ? (r.days === 0 ? "접수 당일 보수" : `보수까지 ${r.days}일`) : r.days === 0 ? "오늘 접수" : `${r.days}일째`);

export function DefectBoard() {
  const { db } = useMe();
  const today = todayIso();
  const [view, setView] = useState<View>("open");
  const [siteId, setSiteId] = useState("all");
  const [phone, setPhone] = useState(false);
  // 현장 상세·대시보드에서 ‘이 현장 하자’로 들어오면 그 현장만 (?site=) · 처리 대기에서 들어오면 본사 할 일만 (?view=todo)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const site = q.get("site");
    if (site) setSiteId(site);
    if (q.get("view") === "todo") setView("todo");
  }, []);
  const rows = useMemo(() => (db ? defectRows(db, today) : []), [db, today]);
  if (!db) return <PageSkeleton />;
  const scoped = siteId === "all" ? rows : rows.filter((r) => r.req.siteId === siteId);
  const st = defectStats(scoped);
  const sites = db.sites.filter((s) => rows.some((r) => r.req.siteId === s.id) || s.status !== "completed");
  return (
    <PageBody>
      <PageHeader
        className="no-print"
        title="하자보수"
        desc="발주처 포털, 하자 접수 링크(QR), 전화로 들어온 하자를 여기서 처리합니다 — 작업지시 보내기·회신·접수자에게 알리기. 계정이 없는 관리사무소에는 ‘하자 접수 QR’을 만들어 주세요. 금액은 들어가지 않습니다."
        right={
          <span className="flex flex-wrap justify-end gap-2">
            <Button icon={<PhoneIncoming size={16} />} onClick={() => setPhone(true)} data-testid="defects-phone-register">
              전화 받은 하자 등록
            </Button>
            <a href="#warranty" className="press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-active-soft px-4 text-[0.9rem] font-bold text-theme-ink" data-testid="defects-to-qr">
              <QrCode size={16} aria-hidden /> 하자 접수 QR·보증
            </a>
          </span>
        }
      />
      {phone && <PhoneDefectModal db={db} onClose={() => setPhone(false)} />}
      <div className="no-print grid grid-cols-2 gap-3 @min-[900px]:grid-cols-4" data-testid="defect-kpis">
        <StatCard testId="defect-kpi-open" label="진행 중" value={`${st.open}건`} sub={`확인 대기 ${st.waiting} · 끝남 ${st.confirmed}`} icon={<Hourglass size={20} />} group="growth" />
        <button type="button" onClick={() => setView("todo")} className="press block rounded-2xl text-left" aria-label={`본사 할 일 ${st.hqTodo}건 — 목록 보기`}>
          <StatCard testId="defect-kpi-todo" label="본사 할 일" value={`${st.hqTodo}건`} sub={`작업지시 보낼 것 ${st.assign} · 회신할 것 ${st.reply}`} icon={<Wrench size={20} />} group="ops" className="h-full" />
        </button>
        <StatCard testId="defect-kpi-overdue" label="기한 지남" value={`${st.overdue}건`} sub="발주처 희망일·작업지시 기한 기준" icon={<AlarmClock size={20} />} group="ops" />
        <StatCard testId="defect-kpi-days" label="보수 완료까지" value={st.avgDays === null ? "—" : `평균 ${st.avgDays}일`} sub={st.repaired ? `보수한 ${st.repaired}건 기준 (접수 → 본사 확인)` : "아직 보수한 건 없음"} icon={<CircleCheck size={20} />} group="ax" />
      </div>
      <div className="no-print flex flex-wrap items-center gap-2">
        <Segmented
          label="보기"
          value={view}
          onChange={setView}
          options={[
            { value: "todo", label: `본사 할 일 ${st.hqTodo}`, testId: "defect-view-todo" },
            { value: "open", label: `진행 중 ${st.open}`, testId: "defect-view-open" },
            { value: "all", label: "전체", testId: "defect-view-all" },
            { value: "ledger", label: "관리대장 인쇄", testId: "defect-view-ledger" },
          ]}
        />
        <label htmlFor="defect-site" className="sr-only">
          현장
        </label>
        <span className="block w-full max-w-xs">
          <select id="defect-site" className={cx(inputCls, "h-11 py-1")} value={siteId} onChange={(e) => setSiteId(e.target.value)} data-testid="defect-site">
            {view !== "ledger" && <option value="all">모든 현장</option>}
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shortName} · {s.name}
              </option>
            ))}
          </select>
        </span>
      </div>
      {view === "ledger" ? (
        <Ledger rows={rows} siteId={siteId === "all" ? (sites[0]?.id ?? "") : siteId} today={today} />
      ) : (
        <DefectList
          db={db}
          rows={view === "todo" ? scoped.filter((r) => r.next === "assign" || r.next === "reply") : view === "open" ? scoped.filter((r) => r.next === "assign" || r.next === "reply" || r.next === "repairing") : scoped}
          today={today}
          empty={view === "todo" ? "지금 본사가 할 일이 없습니다" : view === "open" ? "진행 중인 하자보수가 없습니다" : "하자보수 요청이 없습니다"}
          emptyHint={view !== "all" && st.total > 0 ? `현장 보수 중이거나 끝난 하자는 ‘${view === "todo" ? "진행 중’·‘" : ""}전체’에서 볼 수 있습니다.` : undefined}
        />
      )}
      {/* 보증·접수 QR은 참고 정보 — 할 일 목록 아래에 (휴대폰에서 목록이 화면 몇 장 아래로 밀리던 문제 · D-75) */}
      {view !== "ledger" && <WarrantyOverview />}
    </PageBody>
  );
}

function DefectList({ db, rows, today, empty, emptyHint }: { db: DemoDB; rows: DefectRow[]; today: string; empty: string; emptyHint?: string }) {
  const [big, setBig] = useState<{ src: string; title: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState<PartnerRequest | null>(null);
  const [reply, setReply] = useState<PartnerRequest | null>(null);
  const photo = (id?: string) => (id ? db.photos.find((p) => p.id === id)?.dataUrl : undefined);
  const toggle = (id: string) => setOpen((x) => (x.has(id) ? new Set([...x].filter((y) => y !== id)) : new Set([...x, id])));
  return (
    <Card data-testid="defect-list">
      {rows.length === 0 ? (
        <EmptyState icon={<Wrench size={26} />} title={empty} desc={emptyHint ?? "발주처 포털 ‘요청하기’, 하자 접수 QR, 전화 접수로 들어온 하자가 여기에 모입니다."} />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const before = photo(r.beforePhotoId);
            const after = photo(r.afterPhotoId);
            const limit = r.req.desiredDate;
            const expanded = open.has(r.req.id);
            // 한 줄에 가장 먼저 할 일 하나 — 누르면 이 화면에서 바로 처리한다 (D-75)
            const primary =
              r.next === "assign" ? (
                <Button variant="cta" icon={<Wrench size={16} />} onClick={() => setOrder(r.req)} className="min-w-[8.5rem]" data-testid="defect-order">
                  작업지시 보내기
                </Button>
              ) : r.next === "reply" ? (
                <Button variant="cta" icon={<Send size={16} />} onClick={() => setReply(r.req)} className="min-w-[8.5rem]" data-testid="defect-reply">
                  {r.req.status === "answered" ? "보수 완료 회신" : "회신하기"}
                </Button>
              ) : r.next === "repairing" && r.wo ? (
                <Link href={`/orders?wo=${r.wo.id}`} className="press inline-flex min-h-11 min-w-[8.5rem] items-center justify-center rounded-xl border border-line-strong px-3 text-[0.86rem] font-bold" data-testid="defect-open">
                  작업지시 보기
                </Link>
              ) : null;
            return (
              <li key={r.req.id} className={cx("px-5 py-4", r.overdue && "bg-err-bg/30")} data-testid="defect-row" data-next={r.next} data-id={r.req.id}>
                <div className="flex flex-col gap-2 @min-[760px]:flex-row @min-[760px]:items-start">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[0.78rem] text-ink-3">
                      <b className="text-ink-2">{r.site?.shortName}</b>
                      <span>{r.partnerName}</span>
                      <span className="num">접수 {fmtDate(r.req.createdAt)}</span>
                      {r.req.reopenedFrom && <Badge tone="warn">{r.req.intake ? "다시 접수" : "다시 요청"}</Badge>}
                      {r.warranty && (
                        <Badge tone={r.warranty === "after" ? "warn" : r.warranty === "in" ? "ok" : "neutral"} data-testid="defect-warranty">
                          {DEFECT_WARRANTY_LABEL[r.warranty]}
                        </Badge>
                      )}
                    </p>
                    <p className="mt-0.5 text-[0.98rem] font-bold [overflow-wrap:anywhere]">{r.req.title}</p>
                    {r.req.location && <p className="text-[0.84rem] font-semibold text-ink-2">위치: {r.req.location}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8rem]">
                      <Badge tone={NEXT_TONE[r.next]} data-testid="defect-next">{nextLabel(r)}</Badge>
                      <span className="text-ink-3">{r.req.intake ? "접수자" : "발주처"} 화면: {r.stage.label}</span>
                      <span className={cx("num font-semibold", r.repairedDate || r.next === "reopened" ? "text-ink-2" : r.days >= 7 ? "text-err" : "text-ink-2")} data-testid="defect-days">
                        {daysText(r)}
                      </span>
                      {r.overdue && <b className="text-err" data-testid="defect-overdue">기한 지남</b>}
                      {limit && !r.repairedDate && <span className="num text-ink-3">희망 {fmtDate(limit)}{limit < today ? " (지남)" : ""}</span>}
                      {r.wo?.dueDate && !r.repairedDate && <span className="num text-ink-3">작업 기한 {fmtDate(r.wo.dueDate)}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {/* 사진 칸은 늘 두 자리 — 줄마다 버튼 위치가 흔들리지 않게 (D-69 점검 반영) */}
                    {[["전", before], ["후", after]].map(([k, src]) =>
                      src ? (
                        <button key={k} type="button" onClick={() => setBig({ src: src as string, title: `${r.req.title} — 보수 ${k}` })} className="press relative size-14 overflow-hidden rounded-lg border border-line" aria-label={`보수 ${k} 사진 크게 보기`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src as string} alt="" className="size-full object-cover" />
                          <span className="absolute left-0 top-0 rounded-br-md bg-black/60 px-1 text-[0.66rem] font-bold text-white">{k}</span>
                        </button>
                      ) : (
                        <span key={k} className="hidden size-14 @min-[760px]:block" aria-hidden />
                      ),
                    )}
                    <span className="flex flex-wrap items-center gap-2">
                      {primary}
                      <Button variant="ghost" onClick={() => toggle(r.req.id)} aria-expanded={expanded} icon={<ChevronDown size={16} className={cx("transition-transform", expanded && "rotate-180")} />} data-testid="defect-more">
                        {expanded ? "접기" : r.req.intake && r.next === "client" ? "접수자에게 알리기·이력" : "자세히·이력"}
                      </Button>
                    </span>
                  </div>
                </div>
                {expanded && <DefectDetail db={db} row={r} onOrder={() => setOrder(r.req)} onReply={() => setReply(r.req)} />}
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={!!big} onClose={() => setBig(null)} title={big?.title ?? "사진"} size="lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {big && <img src={big.src} alt={big.title} className="w-full rounded-xl" />}
      </Modal>
      {order && <DefectOrderModal db={db} req={order} onClose={() => setOrder(null)} />}
      {reply && <ReplyModal db={db} req={reply} onClose={() => setReply(null)} />}
    </Card>
  );
}

const TONE_DOT = { info: "bg-[var(--t-active)]", ok: "bg-ok", warn: "bg-warn", neutral: "bg-line-strong" } as const;

/** 한 건 펼침 — 적힌 내용 전부·접수자(링크·전화 접수)·사진·처리 이력 */
function DefectDetail({ db, row, onOrder, onReply }: { db: DemoDB; row: DefectRow; onOrder: () => void; onReply: () => void }) {
  const r = row.req;
  const events = defectTimeline(db, r);
  const canOrder = r.type === "defect" && !row.wo && !r.closedWithoutRepair && !r.confirmedAt && row.next !== "reopened";
  const canReply = row.next === "assign" || row.next === "reply" || (r.status === "answered" && row.next === "client" && !r.confirmedAt && !!row.wo && row.repair?.stage === "checking");
  return (
    <div className="mt-3 grid gap-4 rounded-xl border border-line bg-surface-2/60 p-4 @min-[900px]:grid-cols-[1fr_minmax(16rem,22rem)]" data-testid="defect-detail">
      <div className="min-w-0 space-y-2">
        {r.description.trim() !== r.title && <p className="whitespace-pre-wrap text-[0.88rem] leading-relaxed [overflow-wrap:anywhere]" data-testid="defect-detail-desc">{r.description}</p>}
        {r.intake ? (
          <IntakeContact db={db} req={r} />
        ) : (
          <p className="text-[0.84rem] text-ink-2">
            요청한 분: <b className="text-ink">{userLabel(db, r.partnerUserId)}</b> (발주처 포털 — 회신하면 그분 휴대폰에 알림이 갑니다)
          </p>
        )}
        <PhotoStrip db={db} ids={r.photoIds} label={r.intake ? "접수 사진" : "발주처 사진"} testId="defect-detail-photos" />
        <PhotoStrip db={db} ids={row.wo?.donePhotoIds} label="현장 완료 사진" testId="defect-detail-done-photos" />
        <PhotoStrip db={db} ids={r.replyPhotoIds} label="회신에 보낸 사진" testId="defect-detail-reply-photos" />
        {r.reply && (
          <p className="rounded-lg bg-surface px-3 py-2 text-[0.84rem] text-ink-2 [overflow-wrap:anywhere]">
            <b className="text-ink">회신:</b> {r.reply}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {canOrder && row.next !== "assign" && (
            <Button size="sm" variant="soft" icon={<Wrench size={15} />} onClick={onOrder} data-testid="defect-detail-order">
              작업지시 보내기
            </Button>
          )}
          {canReply && row.next !== "reply" && row.next !== "assign" && (
            <Button size="sm" variant="soft" icon={<Send size={15} />} onClick={onReply} data-testid="defect-detail-reply">
              보수 완료 회신
            </Button>
          )}
          {row.next === "assign" && (
            <Button size="sm" variant="ghost" icon={<Send size={15} />} onClick={onReply} data-testid="defect-detail-reply">
              작업지시 없이 회신하기
            </Button>
          )}
          {row.wo && (
            <Link href={`/orders?wo=${row.wo.id}`} className="press inline-flex min-h-9 items-center rounded-full px-3 text-[0.82rem] font-bold text-theme-ink underline underline-offset-2">
              작업지시 보기
            </Link>
          )}
          <Link href={`/insights?req=${r.id}#requests`} className="press inline-flex min-h-9 items-center rounded-full px-3 text-[0.82rem] font-semibold text-ink-2 underline underline-offset-2" data-testid="defect-detail-inbox">
            요청함에서 보기
          </Link>
        </div>
      </div>
      <section aria-label="처리 이력" data-testid="defect-timeline">
        <h3 className="text-[0.84rem] font-bold text-ink-2">처리 이력</h3>
        <ol className="mt-2 space-y-2.5">
          {events.map((e, i) => (
            <li key={i} className="flex gap-2.5 text-[0.82rem]" data-testid="defect-event">
              <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[e.tone])} aria-hidden />
              <span className="min-w-0">
                <span className="num text-ink-3">{fmtDateTime(e.at).slice(5)}</span> <b className="text-ink">{e.label}</b>
                {e.who && <span className="text-ink-2"> · {e.who}</span>}
                {e.detail && <span className="block text-ink-2 [overflow-wrap:anywhere]">{e.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** 하자보수 관리대장 — 현장·접수 기간을 골라 A4로 인쇄 (보수 전·후 사진 포함) */
function Ledger({ rows, siteId, today }: { rows: DefectRow[]; siteId: string; today: string }) {
  const { db } = useMe();
  const [from, setFrom] = useState(shiftDate(today, -89));
  const [to, setTo] = useState(today);
  if (!db) return null;
  const site = db.sites.find((s) => s.id === siteId);
  const list = defectLedger(rows, siteId, from, to);
  const photo = (id?: string) => (id ? db.photos.find((p) => p.id === id)?.dataUrl : undefined);
  return (
    <>
      <div className="no-print flex flex-wrap items-end gap-2">
        <label className="text-[0.8rem] font-semibold text-ink-2">
          접수일 부터
          <input type="date" className={cx(inputCls, "num mt-1 h-11 w-auto py-1")} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} data-testid="ledger-from" />
        </label>
        <label className="text-[0.8rem] font-semibold text-ink-2">
          까지
          <input type="date" className={cx(inputCls, "num mt-1 h-11 w-auto py-1")} value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} data-testid="ledger-to" />
        </label>
        <Button icon={<Printer size={17} />} onClick={() => window.print()} disabled={!list.length} data-testid="defect-ledger-print">
          인쇄·PDF
        </Button>
      </div>
      <article className="mx-auto w-full max-w-[60rem] rounded-2xl border border-line bg-surface px-5 py-5 @min-[760px]:px-8 print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0" data-testid="defect-ledger">
        <header className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b-2 border-ink pb-1.5">
          <div>
            <p className="text-[0.78rem] font-extrabold tracking-[0.06em] text-ink-2">(주)태강지엘텍</p>
            <h2 className="text-[1.3rem] font-extrabold">하자보수 관리대장</h2>
          </div>
          <div className="text-right text-[0.82rem]">
            <p className="font-bold">{site?.name ?? "—"}</p>
            <p className="num text-ink-2">
              접수 {fmtDate(from)} ~ {fmtDate(to)} · {list.length}건
            </p>
            {/* 인쇄물: 계약서 기준·날짜만 (보증 정보가 있을 때만 · D-70 점검 반영) */}
            {site?.warranty && <p className="num text-ink-2" data-testid="defect-ledger-warranty">{warrantyClientLine(site)}</p>}
            {!IS_LIVE && <p className="text-[0.72rem] font-bold text-[#7A5200]">DEMO · 가상 시연 데이터</p>}
          </div>
        </header>
        {list.length === 0 ? (
          <p className="py-6 text-center text-[0.9rem] text-ink-3" data-testid="defect-ledger-empty">
            이 기간에 접수된 하자보수가 없습니다.
          </p>
        ) : (
          <div tabIndex={0} role="region" aria-label="하자보수 관리대장 표 (가로 스크롤)" className="overflow-x-auto scroll-thin">
            {/* 표: 인쇄하면 쪽마다 머리(현장·기간)가 다시 찍힌다 · 휴대폰에서는 옆으로 밀어 본다 (D-69 점검 반영) */}
            {/* 칸 너비를 고정 — 글이 긴 두 칸(하자 내용·조치 내용)이 다섯 글자 폭으로 눌리던 문제 (D-75) */}
            <table className="w-full min-w-[46rem] table-fixed border-collapse text-[0.8rem] print:min-w-0" data-testid="defect-ledger-table">
              <thead>
                <tr className="hidden print:table-row">
                  <th colSpan={6} className="pb-1 text-left text-[0.72rem] font-semibold text-ink-3">
                    하자보수 관리대장 · {site?.shortName} · 접수 {fmtDate(from)} ~ {fmtDate(to)}
                    {!IS_LIVE ? " · DEMO 가상 데이터" : ""}
                  </th>
                </tr>
                <tr className="border-y border-line bg-surface-2 text-left text-[0.72rem] text-ink-3 print:bg-white">
                  <th className="w-[2rem] px-1.5 py-1.5 font-semibold">번호</th>
                  <th className="w-[5.4rem] px-1.5 py-1.5 font-semibold">접수</th>
                  <th className="px-1.5 py-1.5 font-semibold">위치 · 하자 내용</th>
                  <th className="px-1.5 py-1.5 font-semibold">조치 내용</th>
                  <th className="w-[6.2rem] px-1.5 py-1.5 font-semibold">보수 완료 · 확인</th>
                  <th className="w-[7.2rem] px-1.5 py-1.5 font-semibold">사진 (전·후)</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const before = photo(r.beforePhotoId);
                  const after = photo(r.afterPhotoId);
                  return (
                    <tr key={r.req.id} className="break-inside-avoid border-b border-line align-top" data-testid="defect-ledger-row">
                      <td className="num px-1.5 py-1.5 font-bold" data-label="번호">{r.no}</td>
                      <td className="num px-1.5 py-1.5" data-label="접수">
                        {fmtDate(r.req.createdAt)}
                        {/* 링크·전화 접수는 접수 번호만 — 소속 칸은 접수자가 자유롭게 적은 글이라 인쇄물에 넣지 않는다 (D-74 점검 10차) */}
                        <span className="block text-[0.72rem] text-ink-3">{r.req.intake ? `${intakeVia(r.req.intake)} ${r.req.intake.no}` : r.partnerName}</span>
                        {r.warranty && <span className="block text-[0.72rem] font-semibold text-ink-2">{DEFECT_WARRANTY_LABEL[r.warranty]}</span>}
                      </td>
                      <td className="px-1.5 py-1.5 [overflow-wrap:anywhere]" data-label="위치 · 하자 내용">
                        <b className="block">{r.req.title}</b>
                        {r.req.location && <span className="block text-ink-2">{r.req.location}</span>}
                        {/* 제목이 적은 내용의 앞부분이면(링크·전화 접수) 같은 글을 두 번 찍지 않는다 */}
                        {r.req.description.trim() !== r.req.title && <span className="block text-ink-2">{r.req.description}</span>}
                      </td>
                      {/* 조치 내용은 발주처에 보낸 회신만 — 현장 메모(내부)는 넣지 않는다 (D-69 점검 반영) */}
                      <td className="px-1.5 py-1.5 [overflow-wrap:anywhere]" data-label="조치 내용">{r.req.reply ?? "— (회신 전)"}</td>
                      <td className="num px-1.5 py-1.5" data-label="보수 완료 · 확인">
                        {r.repairedDate ? (
                          <>
                            {fmtDate(r.repairedDate)}
                            <span className="block text-[0.72rem] text-ink-3">{r.days === 0 ? "접수 당일" : `접수 후 ${r.days}일`}</span>
                          </>
                        ) : (
                          <span className="text-ink-2">진행 중 · {r.days === 0 ? "오늘 접수" : `${r.days}일째`}</span>
                        )}
                        <span className="mt-0.5 block text-[0.72rem] text-ink-2" data-testid="defect-ledger-confirm">
                          {r.confirmedDate ? `확인 ${fmtDate(r.confirmedDate)}` : r.next === "reopened" ? "다시 요청됨" : r.repairedDate ? "확인 전" : ""}
                        </span>
                      </td>
                      <td className="px-1.5 py-1.5" data-label="사진 (전·후)">
                        <span className="flex gap-1">
                          {[["전", before], ["후", after]].map(([k, src]) =>
                            src ? (
                              <figure key={k} className="w-[3.2rem] overflow-hidden rounded border border-line">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={src} alt={`보수 ${k} 사진`} className="aspect-square w-full object-cover" />
                                <figcaption className="text-center text-[0.66rem] text-ink-3">{k}</figcaption>
                              </figure>
                            ) : null,
                          )}
                          {!before && !after && <span className="text-[0.74rem] text-ink-3">없음</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <footer className="mt-4 border-t border-line pt-2 text-[0.72rem] text-ink-3 [break-inside:avoid]">
          발주처 포털·하자 접수 링크·전화로 들어온 하자보수 요청과 본사 작업지시·회신 기록으로 자동 작성했습니다. 금액은 들어가지 않습니다. 보수 완료일은 태강지엘텍이 완료를 확인(작업지시 확인 또는 회신)한 날입니다.
        </footer>
      </article>
    </>
  );
}

/** 현장별 하자보증 한눈에 (D-70) — 만료 임박부터, 진행 중 하자 수와 함께 */
function WarrantyOverview() {
  const { db } = useMe();
  if (!db) return null;
  const today = todayIso();
  const rows = db.sites
    .map((s) => ({ s, w: warrantyStatus(s, today) }))
    .sort((a, b) => ({ soon: 0, active: 1, pending: 2, expired: 3, none: 4 })[a.w.state] - ({ soon: 0, active: 1, pending: 2, expired: 3, none: 4 })[b.w.state] || (a.w.daysLeft ?? 9e9) - (b.w.daysLeft ?? 9e9));
  return (
    <Card id="warranty" className="no-print scroll-mt-24" data-testid="warranty-overview">
      <CardHeader title="현장별 하자보증 · 하자 접수 QR" sub="계약서 기준 보증 기간 · 계정이 없는 관리사무소·발주처 담당은 ‘하자 접수 QR’로 접수합니다 · 현장 상세 ‘발주처·하자보증’ 탭에서 넣고 고칩니다" />
      <ul className="divide-y divide-line border-t border-line">
        {rows.map(({ s, w }) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[0.86rem]" data-testid="warranty-row" data-state={w.state}>
            <b className="min-w-[4.5rem]">{s.shortName}</b>
            <Badge tone={WARRANTY_TONE[w.state]}>{WARRANTY_LABEL[w.state]}</Badge>
            {/* 휴대폰에서 두 글자씩 세로로 눌리던 문제 — 좁으면 다음 줄로 (D-70 점검 반영) */}
            <span className="num min-w-[min(100%,14rem)] flex-1 text-ink-2">{warrantyLine(s, today, { withState: false })}</span>
            <Link href={`/sites/${s.id}?tab=requests`} className="press inline-flex min-h-11 items-center rounded-xl px-2 text-[0.82rem] font-bold text-theme-ink underline" data-testid="warranty-row-edit">
              {s.warranty ? "보기·고치기" : "보증 기간 넣기"}
            </Link>
            {(() => {
              const links = (db.intakes ?? []).filter((i) => i.siteId === s.id && intakeState(i) === "open");
              const got = links.reduce((a, i) => a + i.count, 0);
              return (
                <Link href={`/sites/${s.id}?tab=requests#intake`} className={cx("press inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-[0.82rem] font-bold", links.length ? "text-ink-2 underline" : "bg-active-soft text-theme-ink")} data-testid="warranty-row-intake">
                  <QrCode size={15} aria-hidden /> {links.length ? `접수 QR ${links.length}개 · 접수 ${got}건` : "하자 접수 QR 만들기"}
                </Link>
              );
            })()}
          </li>
        ))}
      </ul>
    </Card>
  );
}
