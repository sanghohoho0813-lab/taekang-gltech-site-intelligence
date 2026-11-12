"use client";

/**
 * 하자 접수 진행 확인 화면 (D-74) — 접수할 때 받은 주소로만 열린다. 그 접수 한 건의 진행 단계·시공사 답변·보수 사진,
 * 그리고 ‘잘 고쳐졌습니다’ 또는 ‘아직 문제가 있습니다’(같은 주소에서 새 접수로 이어진다).
 * 담당자 이름·내부 메모·금액은 없다. 접수할 때 올린 사진은 다시 보여 주지 않는다 (장수만).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Check, RefreshCw } from "lucide-react";
import { dispatch, useDb } from "@/lib/data/store";
import { errorMessage } from "@/lib/data/commands";
import { confirmIntake, reopenIntake } from "@/lib/data/intakeCommands";
import { IS_LIVE } from "@/lib/mode";
import { fmtDate, fmtDateTime } from "@/lib/domain/format";
import { INTAKE_STATUS_RE, intakeRound, intakeStatusView, tokenHash, type IntakeStatusView } from "@/lib/domain/intake";
import { Button, cx, inputCls } from "@/components/ui/primitives";
import { CallHint, PublicLoading, PublicMessage, PublicShell, ZoomPhoto } from "@/components/intake/PublicShell";

type Load = { status: "loading" } | { status: "ok"; view: IntakeStatusView; stale?: string } | { status: "gone" } | { status: "error"; message: string };

/** 주소 끝에 문장부호·글자가 붙어 와도 주소만 골라 쓴다 */
function cleanKey(raw: string): string {
  let d = raw;
  try {
    d = decodeURIComponent(raw);
  } catch {
    // 그대로 쓴다
  }
  const m = /^([A-Za-z0-9_-]{32})(?![A-Za-z0-9_-])/.exec(d);
  return m ? m[1] : d;
}
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
/** 2026-11-15 → 11월 15일(일) */
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일(${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}
const kstToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const NETWORK = "인터넷 연결을 확인한 뒤 다시 눌러 주세요.";

export default function IntakeStatusPage() {
  const { key: rawKey } = useParams<{ key: string }>();
  const key = useMemo(() => cleanKey(rawKey), [rawKey]);
  const db = useDb();
  const [live, setLive] = useState<Load>({ status: "loading" });

  const loadLive = useCallback(async () => {
    if (!INTAKE_STATUS_RE.test(key)) return setLive({ status: "gone" });
    // 새로 고침이 실패해도 보고 있던 내용은 그대로 둔다 (한 줄로만 알린다)
    const keep = (message: string) => setLive((cur) => (cur.status === "ok" ? { ...cur, stale: message } : { status: "error", message }));
    try {
      const r = await fetch(`/api/intake/status/${key}`, { cache: "no-store", credentials: "omit" });
      const body = await r.json().catch(() => null);
      if (r.status === 404) return setLive({ status: "gone" });
      if (!r.ok || !body?.no) return keep(r.status === 429 ? "지금은 여는 사람이 많습니다. 잠시 뒤 다시 눌러 주세요." : (body?.error ?? "화면을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요."));
      setLive({ status: "ok", view: body as IntakeStatusView });
    } catch {
      keep("인터넷 연결을 확인한 뒤 다시 열어 주세요.");
    }
  }, [key]);
  useEffect(() => {
    if (IS_LIVE) void loadLive();
  }, [loadLive]);

  const hash = useMemo(() => (INTAKE_STATUS_RE.test(key) ? tokenHash(key) : ""), [key]);
  const demoReq = !IS_LIVE && db && hash ? db.partnerRequests.find((r) => r.statusKey === hash && r.intake) : undefined;
  const demo: Load = useMemo(() => {
    if (IS_LIVE || !db) return { status: "loading" };
    if (!demoReq) return { status: "gone" };
    const link = demoReq.intake && demoReq.intake.id !== "phone" ? (db.intakes ?? []).find((i) => i.id === demoReq.intake!.id) : undefined;
    const site = db.sites.find((s) => s.id === demoReq.siteId);
    const prev = demoReq.reopenedFrom ? db.partnerRequests.find((r) => r.id === demoReq.reopenedFrom) : undefined;
    return {
      status: "ok",
      view: intakeStatusView({
        company: db.company.name,
        ...(db.settings?.publicPhone ? { phone: db.settings.publicPhone } : {}),
        site: link?.place ? { name: link.place } : site,
        req: demoReq,
        workOrder: (db.workOrders ?? []).find((w) => w.id === demoReq.linkedWorkOrderId),
        ...(prev ? { prev } : {}),
        round: intakeRound(db, demoReq),
        today: kstToday(),
      }),
    };
  }, [db, demoReq]);

  const load = IS_LIVE ? live : demo;
  const photoSrc = (id: string) => (IS_LIVE ? `/api/intake/status/${key}/photo/${encodeURIComponent(id)}` : (db?.photos.find((p) => p.id === id)?.dataUrl ?? ""));
  /** ‘잘 고쳐졌습니다’·‘아직 문제가 있습니다’ — 통신이 끊기면 우리말로 알린다 */
  const send = async (kind: "confirm" | "reopen", note: string) => {
    if (!IS_LIVE) {
      if (kind === "confirm") dispatch((d, ctx) => confirmIntake(d, { requestId: demoReq?.id ?? "", statusKey: hash, note }, { ...ctx, userId: "system" }));
      else dispatch((d, ctx) => reopenIntake(d, { requestId: demoReq?.id ?? "", statusKey: hash, note }, { ...ctx, userId: "system" }));
      return;
    }
    let r: Response;
    try {
      r = await fetch(`/api/intake/status/${key}/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", body: JSON.stringify({ note }) });
    } catch {
      throw new Error(NETWORK);
    }
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(r.status === 429 ? "잠시 뒤 다시 눌러 주세요. (요청이 많습니다)" : (body?.error ?? "보내지 못했습니다. 잠시 뒤 다시 눌러 주세요."));
    await loadLive();
  };

  if (load.status === "loading") return <PublicLoading testId="intake-status" />;
  if (load.status === "gone")
    return (
      <PublicMessage
        testId="intake-status"
        state="notfound"
        title="열 수 없는 주소입니다"
        desc="주소가 끝까지 입력됐는지 확인해 주세요. 시공사에서 주소를 새로 보냈다면 새 주소로 열어 주세요. 접수 번호를 알면 시공사에 전화로 진행을 물어보실 수 있습니다."
      />
    );
  if (load.status === "error")
    return (
      <PublicMessage testId="intake-status" state="error" title="화면을 열지 못했습니다" desc={load.message}>
        <Button variant="cta" className="mt-5" onClick={() => (IS_LIVE ? void loadLive() : window.location.reload())}>
          다시 열기
        </Button>
      </PublicMessage>
    );
  return <StatusBody view={load.view} stale={load.stale} photoSrc={photoSrc} onSend={send} onRefresh={IS_LIVE ? loadLive : undefined} />;
}

function StatusBody({ view, stale, photoSrc, onSend, onRefresh }: { view: IntakeStatusView; stale?: string; photoSrc: (id: string) => string; onSend: (kind: "confirm" | "reopen", note: string) => Promise<void>; onRefresh?: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [issue, setIssue] = useState("");
  const [mode, setMode] = useState<"choose" | "reopen">("choose");
  const [busy, setBusy] = useState<"confirm" | "reopen" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const done = !!view.confirmedAt;
  // 다시 접수하면 같은 주소가 새 접수를 보여 준다 — 입력 칸을 비운다
  useEffect(() => {
    setMode("choose");
    setIssue("");
    setNote("");
    setErr(null);
  }, [view.no]);
  const run = async (kind: "confirm" | "reopen") => {
    if (busy) return;
    if (kind === "reopen" && issue.trim().length < 2) {
      setErr("어떤 문제가 남았는지 적어 주세요.");
      document.getElementById("st-issue")?.focus();
      return;
    }
    setBusy(kind);
    setErr(null);
    try {
      await onSend(kind, kind === "confirm" ? note.trim() : issue.trim());
    } catch (e) {
      setErr(errorMessage(e, e instanceof Error ? e.message : "보내지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };
  return (
    <PublicShell company={view.company} phone={view.phone} sub="하자 접수 진행 확인" sample={view.sample} testId="intake-status" state={done ? "confirmed" : `step-${view.step}`}>
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[0.84rem] font-semibold text-ink-2 [overflow-wrap:anywhere]" data-testid="status-site">{view.siteName}</p>
            <h1 className="num text-[1.2rem] font-extrabold leading-snug">
              접수 번호 <span data-testid="status-no">{view.no}</span>
            </h1>
          </div>
          {onRefresh && (
            <Button
              className="min-h-11"
              icon={<RefreshCw size={15} className={refreshing ? "animate-spin" : undefined} />}
              onClick={async () => {
                setRefreshing(true);
                await onRefresh();
                setRefreshing(false);
              }}
              data-testid="status-refresh"
            >
              새로 고침
            </Button>
          )}
        </div>
        {stale && (
          <p role="alert" className="mt-2 rounded-xl bg-warn-bg px-3.5 py-2 text-[0.86rem] font-semibold text-warn" data-testid="status-stale">
            {stale} 아래는 조금 전에 받은 내용입니다.
          </p>
        )}
        {view.prev && (
          <p className="mt-2 text-[0.86rem] text-ink-2" data-testid="status-prev">
            접수 번호 <b className="num">{view.prev.no}</b>에서 다시 접수된 건입니다.
          </p>
        )}

        {/* 진행 단계 */}
        <p className={cx("mt-4 text-[1.12rem] font-extrabold", done ? "text-ok" : "text-theme-ink")} data-testid="status-label">{view.label}</p>
        <p className="mt-0.5 text-[0.92rem] leading-relaxed text-ink-2" data-testid="status-hint">{view.hint}</p>
        <ol className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${view.steps.length}, minmax(0, 1fr))` }} aria-label="진행 단계" data-testid="status-steps">
          {view.steps.map((s, i) => (
            <li key={s} className="text-center" aria-current={i === view.step ? "step" : undefined}>
              <span className={cx("block h-2 rounded-full", i <= view.step ? (done ? "bg-ok" : "bg-[var(--t-active)]") : "bg-surface-3")} />
              <span className={cx("mt-1.5 block text-[0.74rem] leading-tight", i === view.step ? "font-extrabold text-ink" : i < view.step ? "font-semibold text-ink-2" : "text-ink-3")}>{s}</span>
            </li>
          ))}
        </ol>
        {view.dueDate && (
          <p className="mt-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[0.9rem] text-ink" data-testid="status-due">
            보수 목표일 <b className="num">{dayLabel(view.dueDate)}</b> <span className="text-ink-2">· 현장 사정에 따라 바뀔 수 있습니다</span>
          </p>
        )}
      </section>

      {view.reply && (
        <section className="mt-4 rounded-2xl border border-line bg-surface p-5" data-testid="status-reply">
          <h2 className="text-[1rem] font-extrabold">시공사 답변</h2>
          {view.repliedAt && <p className="num text-[0.78rem] text-ink-3">{fmtDateTime(view.repliedAt)}</p>}
          <p className="mt-2 whitespace-pre-wrap text-[0.95rem] leading-relaxed [overflow-wrap:anywhere]">{view.reply}</p>
          {view.photos.length > 0 && (
            <>
              <p className="mt-3 text-[0.84rem] font-bold text-ink-2">
                보수 완료 사진 <span className="font-normal text-ink-3">· 누르면 크게 보입니다</span>
              </p>
              <ul className="mt-1.5 grid grid-cols-1 gap-2.5 min-[26rem]:grid-cols-2" data-testid="status-repair-photos">
                {view.photos.map((p) => (
                  <li key={p.id} className="overflow-hidden rounded-xl border border-line">
                    <ZoomPhoto src={photoSrc(p.id)} alt="보수 완료 사진" className="aspect-[4/3]" />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {!view.reply && view.prev?.reply && (
        <section className="mt-4 rounded-2xl border border-line bg-surface p-5" data-testid="status-prev-reply">
          <h2 className="text-[0.95rem] font-extrabold text-ink-2">앞 접수({view.prev.no}) 때 받은 답변</h2>
          <p className="mt-1.5 whitespace-pre-wrap text-[0.9rem] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{view.prev.reply}</p>
        </section>
      )}

      {done ? (
        <div className="mt-4 rounded-2xl border border-ok/30 bg-ok-bg px-5 py-4 text-ok" data-testid="status-confirmed">
          <p className="flex items-center gap-2 text-[0.98rem] font-bold">
            <Check size={20} aria-hidden /> {fmtDate(view.confirmedAt!)}에 확인하셨습니다. 감사합니다.
          </p>
          {view.confirmNote && <p className="mt-1 text-[0.9rem] text-ink [overflow-wrap:anywhere]">남기신 말: {view.confirmNote}</p>}
          <p className="mt-1.5 text-[0.84rem] font-normal text-ink-2">나중에 같은 곳에 다시 문제가 생기면 접수 화면에서 새로 접수하시거나 전화로 알려 주세요.</p>
        </div>
      ) : view.canConfirm ? (
        <section className="mt-4 rounded-2xl border border-line bg-surface p-5" data-testid="status-confirm">
          <h2 className="text-[1rem] font-extrabold">{view.noRepair ? "시공사 답변을 확인해 주세요" : "보수가 잘 됐는지 확인해 주세요"}</h2>
          {mode === "choose" ? (
            <>
              <label htmlFor="st-note" className="mt-2 block text-[0.84rem] text-ink-2">
                남길 말 <span className="text-ink-3">(선택)</span>
              </label>
              <input id="st-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={cx(inputCls, "mt-1 min-h-12")} data-testid="status-note" />
              {err && (
                <p role="alert" className="mt-2 text-[0.88rem] font-semibold text-err" data-testid="status-error">
                  {err}
                </p>
              )}
              <Button variant="cta" size="lg" block className="mt-3" loading={busy === "confirm"} onClick={() => void run("confirm")} data-testid="status-confirm-btn">
                {view.noRepair ? "답변 확인했습니다" : "잘 고쳐졌습니다 (확인)"}
              </Button>
              {view.canReopen ? (
                <Button
                  size="lg"
                  block
                  className="mt-2"
                  onClick={() => {
                    setErr(null);
                    setMode("reopen");
                  }}
                  data-testid="status-reopen-open"
                >
                  아직 문제가 있습니다
                </Button>
              ) : (
                <div className="mt-3 text-[0.86rem] leading-relaxed text-ink-2">
                  <p>아직 문제가 남아 있으면 시공사에 전화로 알려 주세요.</p>
                  <CallHint company={view.company} phone={view.phone} className="mt-1.5" />
                </div>
              )}
              <p className="mt-2.5 text-[0.82rem] leading-relaxed text-ink-3">‘확인’을 누르면 시공사에 전달되고 되돌릴 수 없습니다. 아직 보지 못했으면 누르지 않으셔도 됩니다.</p>
            </>
          ) : (
            <>
              <label htmlFor="st-issue" className="mt-2 block text-[0.92rem] font-bold text-ink">
                어떤 문제가 남았나요?
              </label>
              <textarea id="st-issue" value={issue} onChange={(e) => setIssue(e.target.value)} maxLength={300} rows={3} placeholder="예: 비가 오니 같은 자리에서 다시 샙니다." className={cx(inputCls, "mt-1 h-auto min-h-24 resize-none leading-relaxed")} aria-required data-testid="status-issue" />
              {err && (
                <p role="alert" className="mt-2 text-[0.88rem] font-semibold text-err" data-testid="status-error">
                  {err}
                </p>
              )}
              <Button variant="cta" size="lg" block className="mt-3" loading={busy === "reopen"} onClick={() => void run("reopen")} data-testid="status-reopen-btn">
                다시 접수하기
              </Button>
              <Button
                block
                className="mt-2 min-h-11"
                onClick={() => {
                  setErr(null);
                  setMode("choose");
                }}
                data-testid="status-reopen-cancel"
              >
                돌아가기
              </Button>
              <p className="mt-2.5 text-[0.82rem] leading-relaxed text-ink-3">같은 접수에 이어서 다시 접수됩니다. 이 주소에서 계속 진행을 보실 수 있고, 담당자가 적어 주신 번호로 다시 연락드립니다.</p>
            </>
          )}
        </section>
      ) : null}

      <section className="mt-4 rounded-2xl border border-line bg-surface p-5" data-testid="status-request">
        <h2 className="text-[1rem] font-extrabold">접수한 내용</h2>
        <dl className="mt-2 space-y-2 text-[0.92rem]">
          <div>
            <dt className="text-[0.8rem] text-ink-3">접수 일시</dt>
            <dd className="num font-semibold">{fmtDateTime(view.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-[0.8rem] text-ink-3">위치</dt>
            <dd className="font-semibold [overflow-wrap:anywhere]">{view.location}</dd>
          </div>
          <div>
            <dt className="text-[0.8rem] text-ink-3">내용</dt>
            <dd className="whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">{view.description}</dd>
          </div>
          {view.sentPhotos > 0 && (
            <div>
              <dt className="text-[0.8rem] text-ink-3">사진</dt>
              <dd data-testid="status-sent-photos">보낸 사진 {view.sentPhotos}장 (시공사에 전달되었습니다)</dd>
            </div>
          )}
        </dl>
      </section>

      <div className="mt-4 pb-6 text-center text-[0.8rem] leading-relaxed text-ink-3">
        <p>이 주소를 아는 사람은 이 접수의 진행을 볼 수 있습니다. 필요한 분에게만 알려 주세요.</p>
        {view.phone ? <CallHint company={view.company} phone={view.phone} className="mt-2 justify-center" /> : <p>급한 일은 시공사에 전화로 알려 주세요.</p>}
      </div>
    </PublicShell>
  );
}
