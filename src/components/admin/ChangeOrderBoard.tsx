"use client";

/**
 * 변경공사 회수 관리 (D-84) — 기성·수금 화면의 변경공사 카드.
 * 청구 안 한 추가 원가 → 변경공사 만들기 → 발주처 청구(다음 확인할 날) → 확인·답변 기록 → 승인(일부 승인은 사유)·반려(사유) → 다시 청구.
 * 승인 전 금액은 계약·이익에 넣지 않는다(calc.ts). 본사 화면에서만 쓴다(현장·발주처에는 변경공사 자체가 내려가지 않음).
 * 증빙 파일(변경계약서·공문·견적서 사진·PDF · D-88)은 CoEvidence.tsx.
 */
import { useState } from "react";
import Link from "next/link";
import { BadgeCheck, Ban, ChevronDown, CircleSlash, FilePlus2, MessageSquarePlus, RotateCcw, Send, Undo2 } from "lucide-react";
import { userLabel } from "@/lib/data/hooks";
import { Badge, Button, Card, CardHeader, Field, Notice, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CommandError } from "@/lib/data/commands";
import { run } from "@/lib/data/store";
import { siteFinancials } from "@/lib/domain/calc";
import { shiftDate } from "@/lib/domain/attendance";
import { CATEGORY_LABEL, COST_CATEGORIES, CO_STATUS_LABEL, REASON_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtEok, fmtMan, fmtPct, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { APPROVAL_BASIS_LABEL, CO_LOG_LABEL, CO_REVIEW_STALE_DAYS, coBoard, coStageText, type CoRow } from "@/lib/domain/changeOrders";
import type { ChangeOrder, ChangeOrderLog, CostCategory, CostEntry, DemoDB, EvidenceDocType } from "@/lib/domain/types";
import { IS_LIVE } from "@/lib/mode";
import { EvidenceRow, EvidenceUploadModal } from "./CoEvidence";

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const digits = (v: string) => v.replace(/[^\d]/g, "");
const commas = (v: string) => (digits(v) ? Number(digits(v)).toLocaleString("ko-KR") : "");
const siteName = (db: DemoDB, id: string) => db.sites.find((s) => s.id === id)?.shortName ?? "";

type StatusTo = "submitted" | "approved" | "rejected";

export function ChangeOrderBoard({ db }: { db: DemoDB }) {
  const today = todayIso();
  const b = coBoard(db, today);
  const [picked, setPicked] = useState<string[]>([]);
  const [showOther, setShowOther] = useState(false);
  const [create, setCreate] = useState<{ entries: CostEntry[]; reclaim?: ChangeOrder } | null>(null);
  const [status, setStatus] = useState<{ c: ChangeOrder; to: StatusTo } | null>(null);
  const [logging, setLogging] = useState<ChangeOrder | null>(null);
  const [reason, setReason] = useState<{ kind: "decline"; entries: CostEntry[] } | { kind: "no_reclaim"; c: ChangeOrder } | null>(null);
  const [showDeclined, setShowDeclined] = useState(false);
  const [evidence, setEvidence] = useState<{ coId: string; docType?: EvidenceDocType; after?: boolean } | null>(null);
  const pickedEntries = picked.map((id) => db.costEntries.find((e) => e.id === id)).filter((e): e is CostEntry => !!e);
  const pickedSites = new Set(pickedEntries.map((e) => e.siteId));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const t = b.totals;

  const extraRow = (e: CostEntry) => (
    <li key={e.id}>
      <label className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5 text-[0.86rem] hover:bg-surface-2" data-testid="co-extra">
        <input type="checkbox" className="h-4 w-4 shrink-0 translate-y-0.5 accent-[var(--color-active)]" checked={picked.includes(e.id)} onChange={() => toggle(e.id)} aria-label={`${siteName(db, e.siteId)} ${e.note || CATEGORY_LABEL[e.category]} 선택`} />
        <span className="shrink-0 font-semibold">{siteName(db, e.siteId)}</span>
        <span className="num shrink-0 text-ink-3">{md(e.date)}</span>
        <span className="min-w-0 flex-1 basis-[12rem] text-ink-2">
          {e.note || "메모 없음"} <span className="text-ink-3">· {CATEGORY_LABEL[e.category]} · {REASON_LABEL[e.reason]}</span>
        </span>
        <b className="num shrink-0 whitespace-nowrap">{fmtMan(e.amount)}</b>
      </label>
    </li>
  );

  return (
    <Card id="co-board" className="scroll-mt-24" data-testid="co-board">
      <CardHeader
        title="변경공사 — 청구·회수"
        sub="설계변경·발주처 요청으로 생긴 추가 원가를 변경공사로 청구하고 끝까지 챙깁니다. ‘승인(계약 반영)’만 계약금액·이익에 들어갑니다."
        right={
          <Button size="sm" icon={<FilePlus2 size={15} />} onClick={() => setCreate({ entries: [] })} disabled={!db.sites.length} data-testid="co-new">
            새 변경공사
          </Button>
        }
      />
      {/* 한눈에 — 청구 안 함 · 발주처 결정 대기 · 챙길 것 · 승인율 */}
      <div className="grid grid-cols-2 gap-2.5 px-5 pb-4 @min-[900px]:grid-cols-4" data-testid="co-summary">
        <Mini
          label="청구 안 한 추가 원가"
          value={t.unclaimedN ? `${fmtMan(t.unclaimed)}` : "없음"}
          sub={t.unclaimedN ? `설계변경·발주처 요청 ${t.unclaimedN}건` : t.reviewN ? `모두 변경공사로 만듦 · 발주처에 보내기 전 ${t.reviewN}건` : "설계변경 추가 원가는 모두 변경공사로 만듦"}
          tone={t.unclaimedN ? "warn" : undefined}
          testId="co-sum-unclaimed"
        />
        <Mini label="발주처 결정 대기" value={t.submittedN ? fmtMan(t.submitted) : "없음"} sub={`${t.submittedN ? `${t.submittedN}건 · 가장 오래 ${t.oldest}일` : "발주처에 청구한 건 없음"}${t.reviewN ? ` · 보내기 전 ${t.reviewN}건 ${fmtMan(t.review)}` : ""}`} testId="co-sum-open" />
        <Mini
          label="챙길 것"
          value={`${t.attention}건`}
          sub={
            t.attention
              ? [t.followDue ? `확인할 날 됨 ${t.followDue}` : "", t.noFollow ? `확인할 날 없음 ${t.noFollow}` : "", t.reviewStale ? `발주처 미발송 ${CO_REVIEW_STALE_DAYS}일 넘음 ${t.reviewStale}` : "", t.reclaimUndecided ? `반려 뒤 결정 ${t.reclaimUndecided}` : ""].filter(Boolean).join(" · ")
              : "확인할 날·미발송·반려 뒤 결정 모두 없음"
          }
          tone={t.attention ? "warn" : undefined}
          testId="co-sum-due"
        />
        <Mini
          label="승인율 (청구 대비)"
          value={t.claimPct === null ? "—" : `${t.claimPct}%`}
          sub={t.claimPct === null ? "결정된 청구가 아직 없음" : `결정된 청구 ${fmtMan(t.claimed)} → 승인 ${fmtMan(t.approved)}${t.recoveryPct !== null ? ` · 근거 원가 대비 ${t.recoveryPct}%` : ""}`}
          testId="co-sum-recovery"
        />
      </div>
      {t.paperMissing > 0 && (
        <p className="-mt-1.5 px-5 pb-3 text-[0.8rem] font-semibold text-warn" data-testid="co-paper-summary">
          승인됐는데 서면(변경계약서·공문) 파일이 없는 변경공사 {t.paperMissing}건 — 아래 ‘결정됨’에서 ‘올리기’로 날인본·공문을 올려 두세요.
        </p>
      )}

      {/* 1. 청구 안 한 추가 원가 */}
      <section id="co-unclaimed" className="scroll-mt-24 border-t border-line" data-testid="co-unclaimed">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-3 pb-1">
          <h3 className="text-[0.92rem] font-bold">청구 안 한 추가 원가 {b.unclaimed.length ? `${b.unclaimed.length}건` : ""}</h3>
          {picked.length > 0 && (
            <span className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="ghost" icon={<CircleSlash size={15} />} onClick={() => setReason({ kind: "decline", entries: pickedEntries })} data-testid="co-decline">
                청구 안 함
              </Button>
              <Button size="sm" variant="cta" icon={<FilePlus2 size={15} />} disabled={pickedSites.size > 1} title={pickedSites.size > 1 ? "같은 현장의 원가만 한 변경공사로 묶을 수 있습니다" : undefined} onClick={() => setCreate({ entries: pickedEntries })} data-testid="co-make">
                고른 {picked.length}건({fmtMan(pickedEntries.reduce((a, e) => a + e.amount, 0))})으로 변경공사 만들기
              </Button>
            </span>
          )}
        </div>
        {pickedSites.size > 1 && <p className="px-5 text-[0.8rem] font-semibold text-warn">같은 현장의 원가만 한 변경공사로 묶을 수 있습니다.</p>}
        {b.unclaimed.length ? (
          <ul className="divide-y divide-line">{b.unclaimed.map(extraRow)}</ul>
        ) : (
          <p className="px-5 pb-3 text-[0.84rem] text-ink-3">사유가 ‘설계변경·원청(발주처) 요청’인 추가 원가는 모두 변경공사로 청구했습니다.</p>
        )}
        {b.otherExtra.length > 0 && (
          <div className="px-5 pb-3">
            <button type="button" className="inline-flex items-center gap-1 text-[0.82rem] font-semibold text-theme-ink" onClick={() => setShowOther((v) => !v)} aria-expanded={showOther} data-testid="co-other-toggle">
              <ChevronDown size={15} className={cx("transition-transform", showOther && "rotate-180")} aria-hidden />
              다른 사유 추가 원가 {b.otherExtra.length}건 ({fmtMan(b.otherExtra.reduce((a, e) => a + e.amount, 0))}) — 발주처 때문이면 같이 청구할 수 있습니다
            </button>
          </div>
        )}
        {showOther && <ul className="divide-y divide-line border-t border-line">{b.otherExtra.map(extraRow)}</ul>}
        {b.declined.length > 0 && (
          <div className="px-5 pb-3">
            <button type="button" className="inline-flex items-center gap-1 text-[0.82rem] font-semibold text-ink-2" onClick={() => setShowDeclined((v) => !v)} aria-expanded={showDeclined} data-testid="co-declined-toggle">
              <ChevronDown size={15} className={cx("transition-transform", showDeclined && "rotate-180")} aria-hidden />
              청구 안 하기로 한 추가 원가 {b.declined.length}건 ({fmtMan(b.declined.reduce((a, e) => a + e.amount, 0))})
            </button>
          </div>
        )}
        {showDeclined && (
          <ul className="divide-y divide-line border-t border-line" data-testid="co-declined">
            {b.declined.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5 text-[0.84rem]">
                <span className="shrink-0 font-semibold">{siteName(db, e.siteId)}</span>
                <span className="num shrink-0 text-ink-3">{md(e.date)}</span>
                <span className="min-w-0 flex-1 basis-[12rem] text-ink-2">
                  {e.note || CATEGORY_LABEL[e.category]} <span className="text-ink-3">· 청구 안 함: {e.noClaim?.note} ({userLabel(db, e.noClaim?.by)})</span>
                </span>
                <b className="num shrink-0 whitespace-nowrap">{fmtMan(e.amount)}</b>
                <UndoDecline id={e.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. 진행 중 */}
      <section className="border-t border-line" data-testid="co-open">
        <h3 className="px-5 pt-3 pb-1 text-[0.92rem] font-bold">진행 중 {b.open.length ? `${b.open.length}건` : ""}</h3>
        {b.open.length ? (
          <ul className="divide-y divide-line" data-testid="change-orders">
            {b.open.map((r) => (
              <CoItem key={r.co.id} db={db} r={r} today={today} onStatus={(to) => setStatus({ c: r.co, to })} onLog={() => setLogging(r.co)} onEvidence={() => setEvidence({ coId: r.co.id })} />
            ))}
          </ul>
        ) : (
          <p className="px-5 pb-3 text-[0.84rem] text-ink-3">진행 중인 변경공사가 없습니다.</p>
        )}
      </section>

      {/* 3. 결정됨 */}
      {b.decided.length > 0 && (
        <section className="border-t border-line" data-testid="co-decided">
          <h3 className="px-5 pt-3 pb-1 text-[0.92rem] font-bold">결정됨 {b.decided.length}건</h3>
          <ul className="divide-y divide-line">
            {b.decided.map((r) => (
              <CoItem key={r.co.id} db={db} r={r} today={today} onReclaim={() => setCreate({ entries: r.linked.filter((e) => e.status === "active"), reclaim: r.co })} onNoReclaim={() => setReason({ kind: "no_reclaim", c: r.co })} onEvidence={() => setEvidence({ coId: r.co.id })} />
            ))}
          </ul>
        </section>
      )}

      {create && (
        <CreateModal
          db={db}
          entries={create.entries}
          reclaim={create.reclaim}
          onClose={(done) => {
            setCreate(null);
            if (done) setPicked([]);
          }}
        />
      )}
      {status && (
        <StatusModal
          db={db}
          c={status.c}
          to={status.to}
          onClose={(paper) => {
            const coId = status.c.id;
            setStatus(null);
            // 변경계약서·공문으로 승인했으면 바로 그 파일을 올리는 창 (D-88 · ‘나중에’로 닫을 수 있음)
            if (paper) setEvidence({ coId, docType: paper, after: true });
          }}
        />
      )}
      {evidence && <EvidenceUploadModal db={db} coId={evidence.coId} docType={evidence.docType} after={evidence.after} onClose={() => setEvidence(null)} />}
      {logging && <LogModal db={db} c={logging} onClose={() => setLogging(null)} />}
      {reason && (
        <ReasonModal
          db={db}
          target={reason}
          onClose={(done) => {
            setReason(null);
            if (done) setPicked([]);
          }}
        />
      )}
    </Card>
  );
}

function Mini({ label, value, sub, tone, testId }: { label: string; value: string; sub: string; tone?: "warn"; testId: string }) {
  return (
    <div className={cx("rounded-xl border px-3.5 py-3", tone === "warn" ? "border-warn/40 bg-warn-bg" : "border-line")} data-testid={testId}>
      <p className="text-[0.76rem] font-semibold text-ink-3">{label}</p>
      <p className="num whitespace-nowrap text-[1.1rem] font-extrabold">{value}</p>
      <p className="text-[0.74rem] text-ink-3">{sub}</p>
    </div>
  );
}

function CoItem({ db, r, today, onStatus, onLog, onReclaim, onNoReclaim, onEvidence }: { db: DemoDB; r: CoRow; today: string; onStatus?: (to: StatusTo) => void; onLog?: () => void; onReclaim?: () => void; onNoReclaim?: () => void; onEvidence: () => void }) {
  const c = r.co;
  const [open, setOpen] = useState(false);
  const decided = c.status === "approved" || c.status === "rejected";
  const approved = c.approvedAmount ?? c.amount;
  return (
    <li id={`co-${c.id}`} className="scroll-mt-24 px-5 py-3" data-testid="change-order" data-status={c.status}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-[18rem] space-y-0.5">
          <p className="flex flex-wrap items-center gap-1.5 text-[0.9rem]">
            <b>{r.site?.shortName}</b> {c.title}
            <Badge tone={c.status === "approved" ? "ok" : c.status === "rejected" ? "neutral" : "warn"}>{CO_STATUS_LABEL[c.status]}</Badge>
            {c.amount < 0 && <Badge tone="neutral">감액</Badge>}
            {c.reclaimOf && <Badge tone="neutral">재청구 건</Badge>}
          </p>
          <p className="num text-[0.8rem] text-ink-2">
            {c.status === "approved" && approved !== c.amount ? (
              <>
                승인 <b>{fmtMan(approved)}</b> <span className="text-ink-3">(요청 {fmtMan(c.amount)})</span>
              </>
            ) : (
              <>
                {decided ? (c.status === "approved" ? "승인 " : "요청 ") : "청구 "}
                <b>{fmtMan(c.status === "approved" ? approved : c.amount)}</b>
              </>
            )}
            {" · "}
            {r.linkedCost > 0 ? (
              <>
                근거 추가 원가 {fmtMan(r.linkedCost)} ({r.linked.length}건){c.status === "approved" && <> · 원가 대비 승인 {Math.round((approved / r.linkedCost) * 100)}%</>}
              </>
            ) : (
              <span className="text-ink-3">근거 원가 없음 (발주처 요청 추가공사 등)</span>
            )}
            {" · "}
            <span className={cx(!decided && r.days > db.thresholds.changeOrderPendingDays && "font-semibold text-warn")}>{coStageText(c, today)}</span>
            {c.nextFollowUp && !decided && (
              <span className={cx(r.followDue && "font-semibold text-warn")} data-testid="co-follow">
                {" · "}
                {r.followDue ? `확인할 날 ${md(c.nextFollowUp)} 됨` : `다음 확인 ${md(c.nextFollowUp)}`}
              </span>
            )}
            {r.noFollow && <span className="font-semibold text-warn" data-testid="co-no-follow"> · 다음 확인할 날 없음 — ‘기록’에서 정하기</span>}
            {r.reviewStale && <span className="font-semibold text-warn"> · 아직 발주처에 안 보냄</span>}
          </p>
          {c.status === "approved" && c.approvalBasis && <p className="text-[0.8rem] text-ink-2">승인 근거: {APPROVAL_BASIS_LABEL[c.approvalBasis]}</p>}
          {c.decisionNote && (
            <p className="text-[0.8rem] text-ink-2" data-testid="co-decision-note">
              {c.status === "rejected" ? "반려 사유" : "승인 메모"}: {c.decisionNote}
            </p>
          )}
          {r.last && !["created", "approved", "rejected", "no_reclaim"].includes(r.last.kind) && !open && (
            <p className="text-[0.78rem] text-ink-3">
              마지막 기록 {md(r.last.date)} {CO_LOG_LABEL[r.last.kind]}
              {r.last.note ? ` — ${r.last.note}` : ""} ({userLabel(db, r.last.by)})
            </p>
          )}
          {r.reclaimUndecided && (
            <p className="text-[0.8rem] font-semibold text-warn" data-testid="co-reclaim-undecided">
              반려된 {fmtMan(c.amount)} — 근거를 보강해 다시 청구할지, 손실로 정리할지 정하기
            </p>
          )}
          {c.noReclaim && (
            <p className="text-[0.8rem] text-ink-2">
              다시 청구 안 함: {c.noReclaim.note} ({userLabel(db, c.noReclaim.by)})
            </p>
          )}
          {r.reclaimedBy && (
            <Link href={`#co-${r.reclaimedBy.id}`} className="text-[0.8rem] font-semibold text-theme-ink">
              → 다시 청구함: {r.reclaimedBy.title} ({CO_STATUS_LABEL[r.reclaimedBy.status]})
            </Link>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {(c.log?.length ?? 0) > 0 && (
              <button type="button" className="inline-flex items-center gap-1 text-[0.78rem] font-semibold text-theme-ink" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="co-log-toggle">
                <ChevronDown size={14} className={cx("transition-transform", open && "rotate-180")} aria-hidden />
                기록 {c.log!.length}건
              </button>
            )}
            <EvidenceRow db={db} c={c} paper={r.paper} onAdd={onEvidence} />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!decided && onStatus && (
            <>
              {c.status === "review" && (
                <Button size="sm" variant="soft" icon={<Send size={15} />} onClick={() => onStatus("submitted")} data-testid="co-submit">
                  발주처 청구
                </Button>
              )}
              {onLog && (
                <Button size="sm" variant="outline" icon={<MessageSquarePlus size={15} />} onClick={onLog} data-testid="co-log">
                  기록
                </Button>
              )}
              <Button size="sm" variant="cta" icon={<BadgeCheck size={15} />} onClick={() => onStatus("approved")} data-testid="co-approve">
                승인 반영
              </Button>
              <Button size="sm" variant="ghost" icon={<Ban size={15} />} onClick={() => onStatus("rejected")} data-testid="co-reject">
                반려
              </Button>
            </>
          )}
          {c.status === "rejected" && !r.reclaimedBy && onReclaim && (
            <Button size="sm" variant="soft" icon={<RotateCcw size={15} />} onClick={onReclaim} data-testid="co-reclaim">
              다시 청구
            </Button>
          )}
          {r.reclaimUndecided && onNoReclaim && (
            <Button size="sm" variant="ghost" icon={<CircleSlash size={15} />} onClick={onNoReclaim} data-testid="co-no-reclaim">
              다시 청구 안 함
            </Button>
          )}
        </div>
      </div>
      {open && (
        <ol className="mt-2 space-y-1 border-l-2 border-line pl-3 text-[0.8rem]" data-testid="co-log-list">
          {[...(c.log ?? [])].reverse().map((l) => (
            <LogLine key={l.id} db={db} l={l} />
          ))}
        </ol>
      )}
    </li>
  );
}

function LogLine({ db, l }: { db: DemoDB; l: ChangeOrderLog }) {
  return (
    <li>
      <span className="num text-ink-3">{md(l.date)}</span> <b>{CO_LOG_LABEL[l.kind]}</b> {l.note && <span className="text-ink-2">— {l.note}</span>}{" "}
      <span className="text-[0.74rem] text-ink-3">({userLabel(db, l.by)})</span>
    </li>
  );
}

/** 변경공사 만들기 — 고른 추가 원가 근거 · 근거 없이 · 반려 건 다시 청구 */
function CreateModal({ db, entries, reclaim, onClose }: { db: DemoDB; entries: CostEntry[]; reclaim?: ChangeOrder; onClose: (done?: boolean) => void }) {
  const toast = useToast();
  const sum = entries.reduce((a, e) => a + e.amount, 0);
  const [siteId, setSiteId] = useState(reclaim?.siteId ?? entries[0]?.siteId ?? db.sites[0]?.id ?? "");
  // 기본 이름 — 첫 원가 메모의 앞부분만 (‘·’·‘—’ 앞) · 40자 (메모를 다 이어 붙여 62자가 되던 문제 · D-84 공무 점검)
  const [title, setTitle] = useState(reclaim ? reclaim.title : entries.length ? Array.from((entries[0].note || "").split(/\s[·—]\s|\s\(/)[0].trim()).slice(0, 40).join("") : "");
  const [amountText, setAmountText] = useState(reclaim ? Math.abs(reclaim.amount).toLocaleString("ko-KR") : sum ? sum.toLocaleString("ko-KR") : "");
  const [note, setNote] = useState("");
  const [key] = useState(() => uid("idem"));
  const [err, setErr] = useState<{ msg: string; fields?: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = Number(digits(amountText));
  const fixedSite = !!reclaim || entries.length > 0;
  return (
    <Modal
      open
      onClose={() => onClose()}
      title={reclaim ? "반려된 변경공사 다시 청구" : "변경공사 만들기"}
      description={reclaim ? `반려 사유: ${reclaim.decisionNote || "기록 없음"}` : entries.length ? `근거 추가 원가 ${entries.length}건 ${fmtMan(sum)}` : "근거 원가 없이 — 발주처가 요청한 추가공사 등"}
      size="sm"
      testId="co-create-modal"
      footer={
        <>
          <Button onClick={() => onClose()}>취소</Button>
          <Button
            variant="cta"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await run("createChangeOrder", { siteId, title, amount, note, idempotencyKey: key, ...(entries.length ? { entryIds: entries.map((e) => e.id) } : {}), ...(reclaim ? { reclaimOf: reclaim.id } : {}) });
                toast.push({ tone: "ok", title: "변경공사를 만들었습니다", desc: "‘진행 중’에서 발주처에 청구하세요. 승인 전에는 계약·이익에 들어가지 않습니다." });
                onClose(true);
              } catch (e) {
                setErr(e instanceof CommandError ? { msg: e.message, fields: e.fieldErrors } : { msg: "만들지 못했습니다. 다시 눌러 주세요." });
              } finally {
                setBusy(false);
              }
            }}
            data-testid="co-create-confirm"
          >
            만들기
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.88rem]">
        {entries.length > 0 && (
          <ul className="space-y-0.5 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[0.82rem]">
            {entries.map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {md(e.date)} {e.note || CATEGORY_LABEL[e.category]}
                </span>
                <b className="num shrink-0">{fmtMan(e.amount)}</b>
              </li>
            ))}
          </ul>
        )}
        {!fixedSite && (
          <Field label="현장" htmlFor="co-site">
            <select id="co-site" className={inputCls} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {db.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shortName}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="무슨 공사인지" htmlFor="co-title" required error={err?.fields?.title} counter={`${Array.from(title).length}/80`}>
          <input id="co-title" className={inputCls} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="예: 3층 남측 유리 사양 상향 (로이복층 → 삼중)" data-testid="co-title" />
        </Field>
        <Field label="발주처에 청구할 금액 (원)" htmlFor="co-amount" required error={err?.fields?.amount} hint={amount ? `= ${fmtMan(amount)}${sum && amount !== sum ? ` · 근거 원가 ${fmtMan(sum)}보다 ${amount > sum ? `${fmtMan(amount - sum)} 많음 (간접비·이윤 포함이면 보통)` : `${fmtMan(sum - amount)} 적음`}` : ""}` : sum ? "견적 금액 — 간접비·이윤을 붙여 근거 원가보다 크게 잡는 것이 보통입니다" : "발주처에 낼 견적 금액 (간접비·이윤 포함)"}>
          <input id="co-amount" inputMode="numeric" className={cx(inputCls, "num text-right")} value={amountText} onChange={(e) => setAmountText(commas(e.target.value))} data-testid="co-amount" />
        </Field>
        <Field label="메모 (선택)" htmlFor="co-note" error={err?.fields?.note} counter={`${Array.from(note).length}/200`}>
          <textarea id="co-note" rows={2} className={inputCls} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="예: 원청 서면 작업지시서 11/3 수령 · 견적서 첨부 예정" />
        </Field>
        <p className="text-[0.76rem] text-ink-3">만들면 ‘청구 검토 중’입니다. 발주처에 보내면 ‘발주처 청구’를 누르고, 다음 확인할 날을 정합니다.{IS_LIVE ? "" : " DEMO 환경입니다."}</p>
        {err && <Notice tone="err">{err.msg}</Notice>}
      </div>
    </Modal>
  );
}

/** 발주처 확인·답변·메모 기록 + 다음 확인할 날 */
function LogModal({ db, c, onClose }: { db: DemoDB; c: ChangeOrder; onClose: () => void }) {
  const toast = useToast();
  const today = todayIso();
  const [kind, setKind] = useState<"follow_up" | "client_reply" | "note">("follow_up");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [follow, setFollow] = useState(c.nextFollowUp && c.nextFollowUp > today ? c.nextFollowUp : shiftDate(today, 7));
  const [clear, setClear] = useState(false);
  const [key] = useState(() => uid("idem"));
  const [err, setErr] = useState<{ msg: string; fields?: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title="변경공사 기록"
      description={`${siteName(db, c.siteId)} ${c.title}`}
      size="sm"
      testId="co-log-modal"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await run("logChangeOrder", { coId: c.id, kind, date, note, nextFollowUp: clear && c.status === "review" ? null : follow, idempotencyKey: key });
                toast.push({ tone: "ok", title: "기록했습니다", desc: clear ? "다음 확인할 날을 지웠습니다" : `다음 확인 ${fmtDate(follow)}` });
                onClose();
              } catch (e) {
                setErr(e instanceof CommandError ? { msg: e.message, fields: e.fieldErrors } : { msg: "저장하지 못했습니다. 다시 눌러 주세요." });
              } finally {
                setBusy(false);
              }
            }}
            data-testid="co-log-confirm"
          >
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.88rem]">
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="mb-1 text-[0.82rem] font-semibold text-ink-2">무슨 기록</legend>
          {(["follow_up", "client_reply", "note"] as const).map((k) => (
            <label key={k} className={cx("cursor-pointer rounded-lg border px-3 py-1.5 text-[0.84rem] font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-active/40", kind === k ? "border-active bg-active-soft text-theme-ink" : "border-line")}>
              <input type="radio" name="co-kind" className="sr-only" checked={kind === k} onChange={() => setKind(k)} />
              {CO_LOG_LABEL[k]}
            </label>
          ))}
        </fieldset>
        <Field label="언제" htmlFor="co-log-date" error={err?.fields?.date}>
          <input id="co-log-date" type="date" className={cx(inputCls, "w-auto")} value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="내용" htmlFor="co-log-note" required error={err?.fields?.note} counter={`${Array.from(note).length}/200`}>
          <textarea id="co-log-note" rows={2} className={inputCls} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={kind === "client_reply" ? "예: 원청 공무 — 단가 5% 조정하면 이번 달 승인 가능" : "예: 원청 공무 김과장 통화 — 다음 주 검토 회의에 올림"} data-testid="co-log-note" />
        </Field>
        <Field label="다음 확인할 날" htmlFor="co-log-follow" error={err?.fields?.nextFollowUp} hint="그날이 되면 대시보드 처리 대기·아침 알림에 ‘변경공사 챙길 것’으로 뜹니다">
          <div className="flex flex-wrap items-center gap-1.5">
            <input id="co-log-follow" type="date" className={cx(inputCls, "w-auto")} value={follow} min={shiftDate(today, 1)} max={shiftDate(today, 180)} disabled={clear} onChange={(e) => setFollow(e.target.value)} data-testid="co-log-follow" />
            {[7, 14].map((d) => (
              <Button key={d} size="sm" variant="ghost" disabled={clear} onClick={() => setFollow(shiftDate(today, d))}>
                +{d}일
              </Button>
            ))}
            {/* 발주처에 청구한 건은 다음 확인할 날을 꼭 둔다 — 지우면 아무도 챙기지 않던 문제 (D-84 점검) */}
            {c.status === "review" && (
              <label className="inline-flex items-center gap-1 text-[0.82rem]">
                <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /> 정하지 않음
              </label>
            )}
          </div>
        </Field>
        {err && <Notice tone="err">{err.msg}</Notice>}
      </div>
    </Modal>
  );
}

/** 발주처 청구 · 승인 반영 · 반려 */
function StatusModal({ db, c, to, onClose }: { db: DemoDB; c: ChangeOrder; to: StatusTo; onClose: (paper?: "contract" | "letter") => void }) {
  const toast = useToast();
  const today = todayIso();
  const [amountText, setAmountText] = useState(Math.abs(c.amount).toLocaleString("ko-KR"));
  const [note, setNote] = useState("");
  const [follow, setFollow] = useState(shiftDate(today, 14));
  const [date, setDate] = useState(today);
  const [basis, setBasis] = useState<"" | "contract" | "letter" | "verbal">("");
  const [showCost, setShowCost] = useState(false);
  const [err, setErr] = useState<{ msg: string; fields?: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  // 감액 건은 칸에 크기만 적고 계산은 −로 (D-77)
  const minus = c.amount < 0;
  const amount = (minus ? -1 : 1) * Number(digits(amountText));
  const partial = to === "approved" && Math.abs(amount) !== Math.abs(c.amount);
  // 이 공사에 들어갈 예상 원가(선택) — 넣지 않으면 승인액 전부가 이익으로 잡힌다 (D-78 첫 달 리허설)
  const [costText, setCostText] = useState("");
  const [costCat, setCostCat] = useState<CostCategory>("material");
  const addedCost = minus ? 0 : Number(digits(costText)) || 0;
  const f = siteFinancials(db, c.siteId);
  const afterAdj = f.adjustedContract + (to === "approved" ? amount : 0);
  const afterEac = f.eac + (to === "approved" ? addedCost : 0);
  const afterMargin = afterAdj ? ((afterAdj - afterEac) / afterAdj) * 100 : 0;
  const linked = c.sourceEntryIds.some((id) => db.costEntries.some((e) => e.id === id && e.status === "active"));
  const title = { submitted: "발주처에 청구", approved: "변경공사 승인 반영", rejected: "변경공사 반려" }[to];
  const noteLabel = to === "rejected" ? "반려 사유" : to === "approved" ? (partial ? "요청과 다른 금액으로 승인한 사유" : "메모 (선택)") : "메모 (선택)";
  return (
    <Modal
      open
      onClose={() => onClose()}
      title={title}
      description={`${siteName(db, c.siteId)} ${c.title}`}
      size="sm"
      testId="co-status-modal"
      footer={
        <>
          <Button onClick={() => onClose()}>취소</Button>
          <Button
            variant={to === "rejected" ? "danger" : "cta"}
            loading={busy}
            onClick={async () => {
              if (to === "approved" && !basis) {
                setErr({ msg: "무엇을 받고 승인 반영하는지 골라 주세요.", fields: { basis: "승인 근거" } });
                return;
              }
              setBusy(true);
              try {
                const r = await run("setChangeOrderStatus", {
                  coId: c.id,
                  status: to,
                  approvedAmount: to === "approved" ? amount : undefined,
                  ...(to === "approved" && addedCost > 0 ? { addedCost: { category: costCat, amount: addedCost } } : {}),
                  ...(note.trim() ? { note } : {}),
                  ...(to === "submitted" && follow ? { followUp: follow } : {}),
                  ...(date !== today ? { date } : {}),
                  ...(to === "approved" && basis ? { basis } : {}),
                });
                toast.push({ tone: "ok", title: `${title} 완료`, desc: to === "approved" ? `이익률 ${fmtPct(r.before.marginPct)} → ${fmtPct(r.after.marginPct)}` : to === "submitted" ? `다음 확인 ${fmtDate(follow)}` : undefined });
                onClose(to === "approved" && (basis === "contract" || basis === "letter") ? basis : undefined);
              } catch (e) {
                setErr(e instanceof CommandError ? { msg: e.message, fields: e.fieldErrors } : { msg: "실패했습니다. 다시 눌러 주세요." });
              } finally {
                setBusy(false);
              }
            }}
            data-testid="co-confirm"
          >
            확인
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.88rem]">
        <Field label={to === "submitted" ? "발주처에 보낸 날" : to === "approved" ? "승인 받은 날" : "반려 받은 날"} htmlFor="co-status-date" error={err?.fields?.date} hint={to === "approved" ? "이 날 이익에 반영됩니다 — 공문·변경계약서 날짜" : "늦게 넣어도 실제 날짜로 적으면 며칠째가 맞습니다"}>
          <input id="co-status-date" type="date" className={cx(inputCls, "w-auto")} value={date} max={today} onChange={(e) => setDate(e.target.value)} data-testid="co-status-date" />
        </Field>
        {to === "approved" && (
          <fieldset data-testid="co-basis">
            <legend className="mb-1 text-[0.82rem] font-semibold text-ink-2">
              무엇을 받고 승인 반영하나요 <span className="text-err">*</span>
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {(["contract", "letter", "verbal"] as const).map((k) => (
                <label key={k} className={cx("cursor-pointer rounded-lg border px-3 py-1.5 text-[0.84rem] font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-active/40", basis === k ? "border-active bg-active-soft text-theme-ink" : "border-line")}>
                  <input type="radio" name="co-basis" className="sr-only" checked={basis === k} onChange={() => setBasis(k)} data-testid={`co-basis-${k}`} />
                  {APPROVAL_BASIS_LABEL[k]}
                </label>
              ))}
            </div>
            {err?.fields?.basis && <p className="mt-1 text-[0.8rem] font-semibold text-err">승인 근거를 골라 주세요.</p>}
            {basis === "verbal" && <p className="mt-1 text-[0.8rem] font-semibold text-warn">구두 승인도 계약·이익에 바로 들어갑니다. 서면을 받으면 이 변경공사의 ‘올리기’로 변경계약서·공문 파일을 올리세요.</p>}
            {(basis === "contract" || basis === "letter") && <p className="mt-1 text-[0.8rem] text-ink-3">확인을 누르면 {basis === "contract" ? "날인한 변경계약서" : "공문·메일"}를 사진이나 PDF로 올리는 창이 열립니다 (나중에 올려도 됩니다).</p>}
          </fieldset>
        )}
        {to === "approved" && (
          <>
            <Field label={minus ? "승인 감액 (원)" : "승인 금액 (원)"} htmlFor="co-amt" error={err?.fields?.approvedAmount} hint={amount ? `= ${minus ? "감액 " : ""}${fmtMan(Math.abs(amount))}${partial ? ` · 요청 ${fmtMan(Math.abs(c.amount))}과 다름 — 사유를 적어 주세요` : ""}` : undefined}>
              <input id="co-amt" inputMode="numeric" className={cx(inputCls, "num text-right")} value={amountText} onChange={(e) => setAmountText(commas(e.target.value))} data-testid="co-amt" />
            </Field>
            {!minus && linked && !showCost && (
              <button type="button" className="text-[0.82rem] font-semibold text-theme-ink" onClick={() => setShowCost(true)} data-testid="co-cost-open">
                이 공사에 앞으로 더 들어갈 원가가 있으면 넣기 (이미 들어온 근거 원가는 넣지 마세요)
              </button>
            )}
            {!minus && (!linked || showCost) && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr] sm:items-end">
                <Field label="원가 항목" htmlFor="co-cost-cat" error={err?.fields?.addedCostCategory}>
                  <select id="co-cost-cat" className={cx(inputCls, "w-auto")} value={costCat} onChange={(e) => setCostCat(e.target.value as CostCategory)} data-testid="co-cost-cat">
                    {COST_CATEGORIES.map((k) => (
                      <option key={k} value={k}>
                        {CATEGORY_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="이 공사에 들어갈 예상 원가 (원 · 선택)"
                  htmlFor="co-cost"
                  error={err?.fields?.addedCostAmount}
                  hint={
                    linked
                      ? "이 변경공사는 이미 들어온 추가 원가를 근거로 만들었습니다 — 그 원가는 이미 손익에 있으니 보통 비워 둡니다(두 번 계상)"
                      : addedCost
                        ? `= ${fmtMan(addedCost)} — 잔여예상원가에 더합니다. 이 공사 원가가 이미 원가로 들어가 있으면 두 번 계상되니 넣지 마세요`
                        : "넣지 않으면 승인 금액 전부가 이익으로 잡힙니다 — 단, 이 공사 원가가 이미 원가(추가 비용)로 들어가 있으면 넣지 마세요(두 번 계상)"
                  }
                >
                  <input id="co-cost" inputMode="numeric" className={cx(inputCls, "num text-right")} value={costText} onChange={(e) => setCostText(commas(e.target.value))} data-testid="co-cost" />
                </Field>
              </div>
            )}
            <Notice tone="info" title="반영 결과 (확정)">
              변경 반영 계약 {fmtEok(f.adjustedContract)} → {fmtEok(afterAdj)}
              {addedCost > 0 && <> · 예상 총원가 {fmtEok(f.eac)} → {fmtEok(afterEac)}</>} · 예상이익률 {fmtPct(f.marginPct)} → {fmtPct(afterMargin)}
              {linked && addedCost > 0 && <span className="mt-1 block font-semibold text-warn">근거 추가 원가는 이미 손익에 들어 있습니다 — 같은 원가를 또 넣으면 두 번 계상됩니다.</span>}
            </Notice>
          </>
        )}
        {to === "submitted" && (
          <>
            <p>‘발주처 청구(승인 대기)’로 바뀝니다. 계약금액·이익에는 아직 반영되지 않습니다.</p>
            <Field label="다음 확인할 날" htmlFor="co-follow" error={err?.fields?.followUp} hint="그날이 되면 처리 대기·아침 알림에 뜹니다 — 발주처 검토 일정을 묻는 날">
              <div className="flex flex-wrap items-center gap-1.5">
                <input id="co-follow" type="date" className={cx(inputCls, "w-auto")} value={follow} min={shiftDate(today, 1)} max={shiftDate(today, 180)} onChange={(e) => setFollow(e.target.value)} data-testid="co-follow-date" />
                {[7, 14, 30].map((d) => (
                  <Button key={d} size="sm" variant="ghost" onClick={() => setFollow(shiftDate(today, d))}>
                    +{d}일
                  </Button>
                ))}
              </div>
            </Field>
          </>
        )}
        {to === "rejected" && <p>반려하면 근거 추가 원가는 그대로 이익 감소로 남습니다. 근거를 보강해 ‘결정됨’의 ‘다시 청구’로 새 건을 만들 수 있습니다. 기록은 남습니다.</p>}
        <Field label={noteLabel} htmlFor="co-status-note" required={to === "rejected" || partial} error={err?.fields?.note} counter={`${Array.from(note).length}/200`}>
          <textarea
            id="co-status-note"
            rows={2}
            className={inputCls}
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            placeholder={to === "rejected" ? "예: 원청 — 설계 범위 안이라 불인정 (도면 A-301 근거로 다시 청구 검토)" : to === "approved" ? "예: 원청 단가 협의로 5% 감액 · 변경계약서 11/20 날인" : "예: 견적서·사진 메일 발송 (원청 공무 김과장)"}
            data-testid="co-status-note"
          />
        </Field>
        {to === "approved" && <p className="text-[0.76rem] text-ink-3">원청·발주처의 실제 승인(공문·변경계약서)을 확인한 경우에만 승인 반영하세요.{IS_LIVE ? "" : " DEMO 환경입니다."}</p>}
        {err && <Notice tone="err">{err.msg}</Notice>}
      </div>
    </Modal>
  );
}

/** 청구 안 함(추가 원가) · 다시 청구 안 함(반려 건) — 이유와 함께 */
function ReasonModal({ db, target, onClose }: { db: DemoDB; target: { kind: "decline"; entries: CostEntry[] } | { kind: "no_reclaim"; c: ChangeOrder }; onClose: (done?: boolean) => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [key] = useState(() => uid("idem"));
  const [err, setErr] = useState<{ msg: string; fields?: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const decline = target.kind === "decline";
  const sum = decline ? target.entries.reduce((a, e) => a + e.amount, 0) : target.c.amount;
  return (
    <Modal
      open
      onClose={() => onClose()}
      title={decline ? "변경공사로 청구 안 함" : "다시 청구 안 함 (손실로 정리)"}
      description={decline ? `추가 원가 ${target.entries.length}건 ${fmtMan(sum)}` : `${siteName(db, target.c.siteId)} ${target.c.title} · 반려 ${fmtMan(sum)}`}
      size="sm"
      testId="co-reason-modal"
      footer={
        <>
          <Button onClick={() => onClose()}>취소</Button>
          <Button
            variant="cta"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (decline) await run("declineClaim", { entryIds: target.entries.map((e) => e.id), note, idempotencyKey: key });
                else await run("logChangeOrder", { coId: target.c.id, kind: "no_reclaim", date: todayIso(), note, idempotencyKey: key });
                toast.push({ tone: "ok", title: decline ? "청구 안 함으로 정리했습니다" : "다시 청구 안 함으로 정리했습니다", desc: "그 금액은 그대로 이익 감소로 남습니다" });
                onClose(true);
              } catch (e) {
                setErr(e instanceof CommandError ? { msg: e.message, fields: e.fieldErrors } : { msg: "저장하지 못했습니다. 다시 눌러 주세요." });
              } finally {
                setBusy(false);
              }
            }}
            data-testid="co-reason-confirm"
          >
            정리
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.88rem]">
        <p>{decline ? "‘청구 안 한 추가 원가’·위험 신호·대표가 정할 일에서 빠지고, 아래 ‘청구 안 하기로 한 추가 원가’에 이유와 함께 남습니다. 되돌릴 수 있습니다." : "반려된 금액은 이익 감소로 남고, ‘챙길 것’·대표가 정할 일에서 빠집니다."}</p>
        <Field label="이유" htmlFor="co-reason-note" required error={err?.fields?.note} counter={`${Array.from(note).length}/200`}>
          <textarea id="co-reason-note" rows={2} className={inputCls} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={decline ? "예: 자재 반입 지연은 우리 책임 — 청구 근거 없음" : "예: 원청과 관계 고려 — 이번 현장은 우리가 부담 (대표 결정)"} data-testid="co-reason-note" />
        </Field>
        {err && <Notice tone="err">{err.msg}</Notice>}
      </div>
    </Modal>
  );
}

function UndoDecline({ id }: { id: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Undo2 size={14} />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await run("declineClaim", { entryIds: [id], undo: true });
          toast.push({ tone: "ok", title: "되돌렸습니다", desc: "다시 ‘청구 안 한 추가 원가’에 나옵니다" });
        } catch (e) {
          toast.push({ tone: "err", title: e instanceof CommandError ? e.message : "되돌리지 못했습니다" });
        } finally {
          setBusy(false);
        }
      }}
      data-testid="co-undo-decline"
    >
      되돌리기
    </Button>
  );
}
