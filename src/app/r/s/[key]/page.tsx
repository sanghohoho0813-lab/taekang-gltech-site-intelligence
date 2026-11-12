"use client";

/**
 * 하자 접수 진행 확인 화면 (D-74) — 접수할 때 받은 주소로만 열린다. 그 접수 한 건의 진행 단계·회신·보수 사진, 그리고 ‘확인했습니다’.
 * 담당자 이름·내부 메모·금액은 없다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Check, RefreshCw } from "lucide-react";
import { dispatch, useDb } from "@/lib/data/store";
import { errorMessage } from "@/lib/data/commands";
import { confirmIntake } from "@/lib/data/intakeCommands";
import { IS_LIVE } from "@/lib/mode";
import { fmtDate, fmtDateTime } from "@/lib/domain/format";
import { INTAKE_STATUS_RE, intakeStatusView, tokenHash, type IntakeStatusView } from "@/lib/domain/intake";
import { Button, PageSkeleton, cx, inputCls } from "@/components/ui/primitives";
import { PublicMessage, PublicShell } from "@/components/intake/PublicShell";

type Load = { status: "loading" } | { status: "ok"; view: IntakeStatusView } | { status: "gone" } | { status: "error"; message: string };

export default function IntakeStatusPage() {
  const { key } = useParams<{ key: string }>();
  const db = useDb();
  const [live, setLive] = useState<Load>({ status: "loading" });

  const loadLive = useCallback(async () => {
    if (!INTAKE_STATUS_RE.test(key)) return setLive({ status: "gone" });
    try {
      const r = await fetch(`/api/intake/status/${key}`, { cache: "no-store", credentials: "omit" });
      const body = await r.json().catch(() => null);
      if (r.status === 404) return setLive({ status: "gone" });
      if (!r.ok || !body?.no) return setLive({ status: "error", message: body?.error ?? "화면을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요." });
      setLive({ status: "ok", view: body as IntakeStatusView });
    } catch {
      setLive({ status: "error", message: "인터넷 연결을 확인한 뒤 다시 열어 주세요." });
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
    return {
      status: "ok",
      view: intakeStatusView({ company: db.company.name, site: db.sites.find((s) => s.id === demoReq.siteId), req: demoReq, workOrder: (db.workOrders ?? []).find((w) => w.id === demoReq.linkedWorkOrderId) }),
    };
  }, [db, demoReq]);

  const load = IS_LIVE ? live : demo;
  const photoSrc = (id: string) => (IS_LIVE ? `/api/intake/status/${key}/photo/${encodeURIComponent(id)}` : (db?.photos.find((p) => p.id === id)?.dataUrl ?? ""));
  const confirm = async (note: string) => {
    if (IS_LIVE) {
      const r = await fetch(`/api/intake/status/${key}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", body: JSON.stringify({ note }) });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? "확인하지 못했습니다. 잠시 뒤 다시 눌러 주세요.");
      await loadLive();
    } else {
      dispatch((d, ctx) => confirmIntake(d, { requestId: demoReq?.id ?? "", note }, { ...ctx, userId: "system" }));
    }
  };

  if (load.status === "loading")
    return (
      <div className="min-h-dvh bg-[#F6F5F3] px-4 py-6" data-testid="intake-status" data-state="loading">
        <PageSkeleton />
      </div>
    );
  if (load.status === "gone")
    return <PublicMessage testId="intake-status" state="notfound" title="열 수 없는 주소입니다" desc="주소가 끝까지 입력됐는지 확인해 주세요. 진행 상황은 시공사에 전화로 문의하셔도 됩니다." />;
  if (load.status === "error")
    return (
      <PublicMessage testId="intake-status" state="error" title="화면을 열지 못했습니다" desc={load.message}>
        <Button variant="cta" className="mt-5" onClick={() => (IS_LIVE ? void loadLive() : window.location.reload())}>
          다시 열기
        </Button>
      </PublicMessage>
    );
  return <StatusBody view={load.view} photoSrc={photoSrc} onConfirm={confirm} onRefresh={IS_LIVE ? loadLive : undefined} />;
}

function StatusBody({ view, photoSrc, onConfirm, onRefresh }: { view: IntakeStatusView; photoSrc: (id: string) => string; onConfirm: (note: string) => Promise<void>; onRefresh?: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const sent = view.photos.filter((p) => p.kind === "sent");
  const repair = view.photos.filter((p) => p.kind === "repair");
  const doConfirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(note.trim());
    } catch (e) {
      setErr(errorMessage(e, e instanceof Error ? e.message : "확인하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PublicShell company={view.company} sub="하자 접수 진행 확인" sample={view.sample} testId="intake-status" state={view.confirmedAt ? "confirmed" : `step-${view.step}`}>
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[0.84rem] font-semibold text-ink-2" data-testid="status-site">{view.siteName}</p>
            <h1 className="num text-[1.2rem] font-extrabold leading-snug">
              접수 번호 <span data-testid="status-no">{view.no}</span>
            </h1>
          </div>
          {onRefresh && (
            <Button
              size="sm"
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

        {/* 진행 단계 */}
        <p className="mt-4 text-[1.08rem] font-extrabold text-theme-ink" data-testid="status-label">{view.label}</p>
        <ol className="mt-2 grid grid-cols-5 gap-1" aria-label="진행 단계" data-testid="status-steps">
          {view.steps.map((s, i) => (
            <li key={s} className="text-center" aria-current={i === view.step ? "step" : undefined}>
              <span className={cx("block h-2 rounded-full", i <= view.step ? "bg-[var(--t-active)]" : "bg-surface-3")} />
              <span className={cx("mt-1.5 block text-[0.72rem] leading-tight", i === view.step ? "font-extrabold text-ink" : i < view.step ? "font-semibold text-ink-2" : "text-ink-3")}>{s}</span>
            </li>
          ))}
        </ol>
        {view.dueDate && (
          <p className="mt-3 rounded-xl bg-active-soft px-3.5 py-2 text-[0.9rem] font-semibold text-theme-ink" data-testid="status-due">
            보수 예정일 {fmtDate(view.dueDate)} <span className="font-normal">(현장 사정으로 바뀔 수 있습니다)</span>
          </p>
        )}
      </section>

      {view.reply && (
        <section className="mt-4 rounded-2xl border border-line bg-surface p-5" data-testid="status-reply">
          <h2 className="text-[1rem] font-extrabold">시공사 회신</h2>
          {view.repliedAt && <p className="num text-[0.78rem] text-ink-3">{fmtDateTime(view.repliedAt)}</p>}
          <p className="mt-2 whitespace-pre-wrap text-[0.95rem] leading-relaxed [overflow-wrap:anywhere]">{view.reply}</p>
          {repair.length > 0 && (
            <>
              <p className="mt-3 text-[0.84rem] font-bold text-ink-2">보수 완료 사진</p>
              <ul className="mt-1.5 grid grid-cols-1 gap-2.5 min-[26rem]:grid-cols-2" data-testid="status-repair-photos">
                {repair.map((p) => (
                  <li key={p.id} className="overflow-hidden rounded-xl border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoSrc(p.id)} alt="보수 완료 사진" className="aspect-[4/3] w-full bg-surface-2 object-cover" />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {view.confirmedAt ? (
        <p className="mt-4 flex items-center gap-2 rounded-2xl border border-ok/30 bg-ok-bg px-5 py-4 text-[0.98rem] font-bold text-ok" data-testid="status-confirmed">
          <Check size={20} aria-hidden /> {fmtDate(view.confirmedAt)}에 확인하셨습니다. 감사합니다.
        </p>
      ) : view.canConfirm ? (
        <section className="mt-4 rounded-2xl border border-line bg-surface p-5" data-testid="status-confirm">
          <h2 className="text-[1rem] font-extrabold">보수가 잘 됐는지 확인해 주세요</h2>
          <label htmlFor="st-note" className="mt-2 block text-[0.84rem] text-ink-2">
            남길 말 <span className="text-ink-3">(선택)</span>
          </label>
          <input id="st-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={cx(inputCls, "mt-1 min-h-12")} data-testid="status-note" />
          {err && (
            <p role="alert" className="mt-2 text-[0.88rem] font-semibold text-err">
              {err}
            </p>
          )}
          <Button variant="cta" size="lg" block className="mt-3" loading={busy} onClick={doConfirm} data-testid="status-confirm-btn">
            보수 확인했습니다
          </Button>
          <p className="mt-2 text-[0.82rem] leading-relaxed text-ink-3">아직 문제가 남아 있으면 누르지 말고, QR을 다시 찍어 새로 접수하거나 시공사에 전화로 알려 주세요.</p>
        </section>
      ) : null}

      <section className="mt-4 rounded-2xl border border-line bg-surface p-5" data-testid="status-request">
        <h2 className="text-[1rem] font-extrabold">접수한 내용</h2>
        <dl className="mt-2 space-y-2 text-[0.92rem]">
          <div>
            <dt className="text-[0.8rem] text-ink-3">접수한 때</dt>
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
        </dl>
        {sent.length > 0 && (
          <ul className="mt-3 grid grid-cols-3 gap-2" data-testid="status-sent-photos">
            {sent.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-xl border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoSrc(p.id)} alt="보낸 사진" className="aspect-square w-full bg-surface-2 object-cover" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-4 pb-6 text-center text-[0.8rem] leading-relaxed text-ink-3">
        이 주소를 아는 사람은 이 접수의 진행을 볼 수 있습니다. 필요한 분에게만 알려 주세요.
        <br />
        급한 일은 시공사에 전화로 알려 주세요.
      </p>
    </PublicShell>
  );
}
