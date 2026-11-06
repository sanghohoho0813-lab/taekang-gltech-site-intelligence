"use client";

/**
 * 하자보수 (본사 · D-69) — 발주처 하자보수 요청의 진행·기한·처리 기간을 한 화면에, 인쇄용 하자보수 관리대장까지.
 * 처리(작업지시 보내기·회신)는 요청함에서 한다 — 이 화면은 빠진 것 없이 챙기고 기록을 남기는 곳. 금액은 없다.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { AlarmClock, CircleCheck, Hourglass, Printer, Wrench } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { DEFECT_NEXT_LABEL, defectLedger, defectRows, defectStats, type DefectRow } from "@/lib/domain/defects";
import { fmtDate, todayIso } from "@/lib/domain/format";
import { shiftDate } from "@/lib/domain/attendance";
import { IS_LIVE } from "@/lib/mode";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { StatCard } from "@/components/domain/Widgets";
import { Badge, Button, Card, CardHeader, EmptyState, PageSkeleton, Segmented, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";

type View = "open" | "all" | "ledger";
const NEXT_TONE = { assign: "err", repairing: "theme", reply: "warn", client: "info", closed: "ok" } as const;

export function DefectBoard() {
  const { db } = useMe();
  const today = todayIso();
  const [view, setView] = useState<View>("open");
  const [siteId, setSiteId] = useState("all");
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
        desc="발주처가 포털로 보낸 하자보수 요청의 진행·기한·처리 기간입니다. 작업지시 보내기와 회신은 ‘요청함’에서 합니다. 금액은 들어가지 않습니다."
        right={
          <Link href="/insights#requests">
            <Button variant="soft" icon={<Wrench size={16} />} data-testid="defects-to-inbox">
              요청함에서 처리
            </Button>
          </Link>
        }
      />
      <div className="no-print grid grid-cols-2 gap-3 @min-[900px]:grid-cols-4" data-testid="defect-kpis">
        <StatCard testId="defect-kpi-open" label="진행 중" value={`${st.open}건`} sub={`전체 ${st.total}건`} icon={<Hourglass size={20} />} group="growth" />
        <StatCard testId="defect-kpi-todo" label="본사 할 일" value={`${st.hqTodo}건`} sub="작업지시·회신 / 완료 확인·회신" icon={<Wrench size={20} />} group="ops" />
        <StatCard testId="defect-kpi-overdue" label="기한 지남" value={`${st.overdue}건`} sub="발주처 희망일·작업지시 기한 기준" icon={<AlarmClock size={20} />} group="ops" />
        <StatCard testId="defect-kpi-days" label="보수까지 평균" value={st.avgDays === null ? "—" : `${st.avgDays}일`} sub={`보수 완료 ${st.repaired}건 · 발주처 확인 ${st.confirmed}건`} icon={<CircleCheck size={20} />} group="ax" />
      </div>
      <div className="no-print flex flex-wrap items-center gap-2">
        <Segmented
          label="보기"
          value={view}
          onChange={setView}
          options={[
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
        <DefectList rows={view === "open" ? scoped.filter((r) => r.next !== "client" && r.next !== "closed") : scoped} today={today} empty={view === "open" ? "진행 중인 하자보수가 없습니다" : "하자보수 요청이 없습니다"} />
      )}
    </PageBody>
  );
}

function DefectList({ rows, today, empty }: { rows: DefectRow[]; today: string; empty: string }) {
  const [big, setBig] = useState<{ src: string; title: string } | null>(null);
  const { db } = useMe();
  const photo = (id?: string) => (id ? db?.photos.find((p) => p.id === id)?.dataUrl : undefined);
  return (
    <Card data-testid="defect-list">
      {rows.length === 0 ? (
        <EmptyState icon={<Wrench size={26} />} title={empty} desc="발주처가 포털 ‘요청하기’에서 하자보수 요청을 보내면 여기에 모입니다." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const before = photo(r.beforePhotoId);
            const after = photo(r.afterPhotoId);
            const limit = r.req.desiredDate;
            return (
              <li key={r.req.id} className={cx("flex flex-col gap-2 px-5 py-4 @min-[760px]:flex-row @min-[760px]:items-start", r.overdue && "bg-err-bg/30")} data-testid="defect-row" data-next={r.next}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[0.78rem] text-ink-3">
                    <b className="text-ink-2">{r.site?.shortName}</b>
                    <span>{r.partnerName}</span>
                    <span className="num">접수 {fmtDate(r.req.createdAt)}</span>
                    {r.req.reopenedFrom && <Badge tone="warn">다시 요청</Badge>}
                  </p>
                  <p className="mt-0.5 text-[0.98rem] font-bold [overflow-wrap:anywhere]">{r.req.title}</p>
                  {r.req.location && <p className="text-[0.84rem] font-semibold text-ink-2">위치: {r.req.location}</p>}
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8rem]">
                    <Badge tone={NEXT_TONE[r.next]} data-testid="defect-next">{DEFECT_NEXT_LABEL[r.next]}</Badge>
                    <span className="text-ink-3">발주처 화면: {r.stage.label}</span>
                    <span className={cx("num font-semibold", r.next === "closed" || r.next === "client" ? "text-ink-2" : r.days >= 7 ? "text-err" : "text-ink-2")} data-testid="defect-days">
                      {r.repairedDate ? `보수까지 ${r.days}일` : `${r.days}일째`}
                    </span>
                    {r.overdue && <b className="text-err" data-testid="defect-overdue">기한 지남</b>}
                    {limit && !r.repairedDate && <span className="num text-ink-3">희망 {fmtDate(limit)}{limit < today ? " (지남)" : ""}</span>}
                    {r.wo?.dueDate && !r.repairedDate && <span className="num text-ink-3">작업 기한 {fmtDate(r.wo.dueDate)}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {[["전", before], ["후", after]].map(([k, src]) =>
                    src ? (
                      <button key={k} type="button" onClick={() => setBig({ src: src as string, title: `${r.req.title} — 보수 ${k}` })} className="press relative overflow-hidden rounded-lg border border-line" aria-label={`보수 ${k} 사진 크게 보기`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src as string} alt="" className="size-14 object-cover" />
                        <span className="absolute left-0 top-0 rounded-br-md bg-black/60 px-1 text-[0.66rem] font-bold text-white">{k}</span>
                      </button>
                    ) : null,
                  )}
                  <Link href={r.next === "repairing" && r.wo ? `/orders?wo=${r.wo.id}` : "/insights#requests"} className="press inline-flex min-h-11 items-center rounded-xl border border-line-strong px-3 text-[0.84rem] font-bold" data-testid="defect-open">
                    {r.next === "assign" ? "작업지시·회신" : r.next === "reply" ? "회신하기" : r.next === "repairing" ? "작업지시 보기" : "요청 보기"}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={!!big} onClose={() => setBig(null)} title={big?.title ?? "사진"} size="lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {big && <img src={big.src} alt={big.title} className="w-full rounded-xl" />}
      </Modal>
    </Card>
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
            {!IS_LIVE && <p className="text-[0.72rem] font-bold text-[#7A5200]">DEMO · 가상 시연 데이터</p>}
          </div>
        </header>
        {list.length === 0 ? (
          <p className="py-6 text-center text-[0.9rem] text-ink-3" data-testid="defect-ledger-empty">
            이 기간에 접수된 하자보수가 없습니다.
          </p>
        ) : (
          <ol className="space-y-3">
            {list.map((r) => {
              const before = photo(r.beforePhotoId);
              const after = photo(r.afterPhotoId);
              return (
                <li key={r.req.id} className="break-inside-avoid rounded-xl border border-line p-3 text-[0.84rem]" data-testid="defect-ledger-row">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-bold [overflow-wrap:anywhere]">
                      <span className="num mr-1.5 text-ink-3">{r.no}.</span>
                      {r.req.title}
                    </p>
                    <span className="text-[0.78rem] font-bold text-theme-ink">{r.stage.label}</span>
                  </div>
                  <dl className="mt-1.5 grid gap-x-4 gap-y-1 @min-[560px]:grid-cols-2 print:grid-cols-2">
                    {[
                      ["위치", r.req.location ?? "—"],
                      ["요청", `${r.partnerName} · 접수 ${fmtDate(r.req.createdAt)}`],
                      ["하자 내용", r.req.description],
                      ["조치 내용", r.req.reply ?? (r.wo?.doneNote ? `현장 보고: ${r.wo.doneNote}` : "—")],
                      ["보수 완료", r.repairedDate ? `${fmtDate(r.repairedDate)} (접수 후 ${r.days}일)` : `진행 중 (${r.days}일째)`],
                      ["발주처 확인", r.confirmedDate ? fmtDate(r.confirmedDate) : "—"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <dt className="w-[4.6rem] shrink-0 text-ink-3">{k}</dt>
                        <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {(before || after) && (
                    <div className="mt-2 grid max-w-[26rem] grid-cols-2 gap-2">
                      {[["보수 전", before], ["보수 후", after]].map(([k, src]) => (
                        <figure key={k} className="overflow-hidden rounded-lg border border-line">
                          {src ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={src} alt={`${k} 사진`} className="aspect-[4/3] w-full bg-surface-2 object-cover print:object-contain" />
                          ) : (
                            <div className="grid aspect-[4/3] place-items-center bg-surface-2 text-[0.76rem] text-ink-3">사진 없음</div>
                          )}
                          <figcaption className="px-1.5 py-0.5 text-[0.72rem] text-ink-3">{k}</figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <footer className="mt-4 border-t border-line pt-2 text-[0.72rem] text-ink-3 [break-inside:avoid]">
          발주처 포털 하자보수 요청·본사 작업지시·회신 기록으로 자동 작성했습니다. 금액은 들어가지 않습니다. 보수 완료일은 태강지엘텍이 완료를 확인(작업지시 확인 또는 회신)한 날입니다.
        </footer>
      </article>
    </>
  );
}
