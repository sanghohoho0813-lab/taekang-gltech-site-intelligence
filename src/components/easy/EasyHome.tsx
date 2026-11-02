"use client";

/** 현장 직원 첫 화면 — 큰 버튼 몇 개로 끝나도록 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Camera, CircleCheck, ClipboardPen, ListChecks, Phone, Receipt, Undo2, AlertCircle, Clock3 } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { run } from "@/lib/data/store";
import { IS_LIVE } from "@/lib/mode";
import type { DemoDB, FieldReport } from "@/lib/domain/types";
import { todayIso } from "@/lib/domain/format";
import { PageSkeleton, cx } from "@/components/ui/primitives";
import { BigTile } from "./ui";
import { EasyAttendance } from "./EasyAttendance";
import { EASY_CATEGORY, easyDate, easyWon } from "./words";

export function EasyHome() {
  const { db, role, userId, user } = useMe();
  const sites = useMemo(() => (!db ? [] : role === "field" && !IS_LIVE ? db.sites.filter((s) => s.fieldUserId === userId) : db.sites), [db, role, userId]);
  if (!db) return <PageSkeleton />;
  const today = todayIso();
  const mine = (r: FieldReport) => r.createdBy === userId && r.status !== "voided";
  const open = db.actions.filter((a) => a.assigneeUserId === userId && !["done", "dismissed"].includes(a.status));
  const phone = db.settings?.helpPhone;

  return (
    <div className="mx-auto w-full max-w-xl space-y-5 px-4 pb-8 pt-5" data-testid="easy-home">
      <header className="space-y-1">
        <h1 className="text-[1.7rem] font-extrabold leading-tight tracking-tight">
          안녕하세요, {user?.name ?? ""}님
        </h1>
        <p className="text-[1.15rem] font-semibold text-ink-2">{easyDate(today)}</p>
      </header>

      {sites.length > 0 && <EasyAttendance db={db} userId={userId} sites={sites} />}

      {sites.length === 0 ? (
        <p className="rounded-2xl border-2 border-line bg-surface px-4 py-4 text-[1.1rem] leading-relaxed" data-testid="easy-no-site">
          아직 맡은 현장이 없어요. 본사에 현장 지정을 요청해 주세요.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="내 현장 오늘 보고">
          {sites.map((s) => {
            const sent = db.reports.some((r) => r.siteId === s.id && r.reportDate === today && mine(r));
            return (
              <li key={s.id} className={cx("flex items-center gap-3 rounded-2xl border-2 px-4 py-3", sent ? "border-ok/30 bg-ok-bg" : "border-warn/40 bg-warn-bg")} data-testid="easy-site-status" data-sent={sent ? "1" : "0"}>
                {sent ? <CircleCheck size={28} className="shrink-0 text-ok" aria-hidden /> : <Clock3 size={28} className="shrink-0 text-warn" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[1.2rem] font-extrabold">{s.shortName}</span>
                  <span className="block text-[1.02rem] text-ink-2">{s.workType}</span>
                </span>
                <span className={cx("shrink-0 text-[1.08rem] font-extrabold", sent ? "text-ok" : "text-warn")}>{sent ? "오늘 보고 보냄" : "아직 안 보냄"}</span>
              </li>
            );
          })}
        </ul>
      )}

      {sites.length > 0 && (
        <nav className="space-y-3" aria-label="할 일">
          <BigTile href="/field/report" tone="cta" icon={<ClipboardPen size={30} />} label="오늘 보고하기" sub="작업 · 사진 · 비용을 차례대로 물어봐요" testId="easy-go-report" />
          <BigTile href="/field/report?mode=photo" icon={<Camera size={30} />} label="사진만 보내기" sub="찍어서 바로 보내요" testId="easy-go-photo" />
          <BigTile href="/field/report?mode=cost" icon={<Receipt size={30} />} label="추가 비용 알리기" sub="돈이 더 든 일이 생겼을 때" testId="easy-go-cost" />
          <BigTile
            href="/my-actions"
            tone={open.length ? "warn" : "plain"}
            icon={<ListChecks size={30} />}
            label={open.length ? `본사 요청 ${open.length}건` : "본사 요청"}
            sub={open.length ? open[0].title : "지금은 요청이 없어요"}
            badge={open.length ? <span className="grid size-10 shrink-0 place-items-center rounded-full bg-err text-[1.15rem] font-extrabold text-white">{open.length}</span> : undefined}
            testId="easy-go-actions"
          />
          {phone && <BigTile href={`tel:${phone.replace(/[^\d+]/g, "")}`} icon={<Phone size={30} />} label="본사에 전화하기" sub={`모르는 게 있으면 · ${phone}`} testId="easy-call" />}
        </nav>
      )}

      <section className="space-y-3" aria-labelledby="recent-title">
        <div className="flex items-baseline justify-between">
          <h2 id="recent-title" className="text-[1.3rem] font-extrabold">
            최근 보낸 보고
          </h2>
          <Link href="/my" className="press inline-flex min-h-12 items-center rounded-xl px-2 text-[1.05rem] font-bold text-theme-ink underline underline-offset-4">
            모두 보기
          </Link>
        </div>
        <MyRecords db={db} userId={userId} limit={3} />
      </section>
    </div>
  );
}

/** 내가 보낸 보고·비용 — 본사 확인 상태와 반려 이유까지 보여준다 */
export function MyRecords({ db, userId, limit }: { db: DemoDB; userId: string; limit?: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const reports = db.reports
    .filter((r) => r.createdBy === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit ?? 30);
  if (reports.length === 0) return <p className="rounded-2xl border-2 border-line bg-surface px-4 py-4 text-[1.08rem] text-ink-2">아직 보낸 보고가 없어요.</p>;
  const today = todayIso();
  const cancel = async (id: string) => {
    setBusy(id);
    setMsg(null);
    try {
      await run("voidReport", { reportId: id });
      setAsk(null);
      setMsg("보고를 취소했어요.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "취소하지 못했어요.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2.5">
      {msg && (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[1.05rem] font-semibold" role="status">
          {msg}
        </p>
      )}
      <ul className="space-y-2.5" data-testid="my-records">
        {reports.map((r) => {
          const site = db.sites.find((s) => s.id === r.siteId);
          const entries = db.costEntries.filter((e) => e.reportId === r.id);
          const voided = r.status === "voided";
          return (
            <li key={r.id} className={cx("rounded-2xl border-2 border-line bg-surface p-4", voided && "opacity-65")} data-testid="record-item">
              <p className="flex flex-wrap items-center gap-x-2 text-[1.02rem] font-semibold text-ink-2">
                <b className="text-[1.12rem] text-ink">{site?.shortName}</b>
                {easyDate(r.reportDate)}
                {r.photoIds.length > 0 && <span>· 사진 {r.photoIds.length}장</span>}
                {voided && <span className="font-bold text-ink-3">· 취소함</span>}
              </p>
              <p className="mt-1 line-clamp-2 text-[1.08rem] leading-relaxed text-ink">{r.workDone}</p>
              {entries.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {entries.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[1.02rem]">
                      <span className="font-bold">
                        {EASY_CATEGORY[e.category].label} <span className="num">{easyWon(e.amount)}</span>
                      </span>
                      <EntryState status={e.status} note={e.reviewNote} />
                    </li>
                  ))}
                </ul>
              )}
              {!voided && r.reportDate >= addDays(today, -7) && !entries.some((e) => e.reviewedAt) && (
                <div className="mt-3">
                  {ask === r.id ? (
                    <div className="grid grid-cols-2 gap-2" role="alertdialog" aria-label="보고 취소 확인">
                      <button type="button" onClick={() => setAsk(null)} className="press h-[3.3rem] rounded-xl border-2 border-line-strong text-[1.05rem] font-bold">
                        아니요
                      </button>
                      <button type="button" onClick={() => cancel(r.id)} disabled={busy === r.id} className="press h-[3.3rem] rounded-xl bg-err text-[1.05rem] font-bold text-white disabled:opacity-50" data-testid="record-cancel-yes">
                        네, 취소
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setAsk(r.id)} className="press inline-flex h-[3rem] items-center gap-1.5 rounded-xl border-2 border-line-strong px-3.5 text-[1rem] font-bold" data-testid="record-cancel">
                      <Undo2 size={18} aria-hidden /> 이 보고 취소
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EntryState({ status, note }: { status: string; note?: string }) {
  if (status === "pending")
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-warn-bg px-2 py-0.5 text-[0.95rem] font-bold text-warn">
        <Clock3 size={15} aria-hidden /> 본사 확인 중
      </span>
    );
  if (status === "rejected")
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-err-bg px-2 py-0.5 text-[0.95rem] font-bold text-err" data-testid="entry-rejected">
        <AlertCircle size={15} aria-hidden /> 본사 반려{note ? `: ${note}` : ""}
      </span>
    );
  if (status === "voided") return <span className="text-[0.95rem] font-bold text-ink-3">취소됨</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-ok-bg px-2 py-0.5 text-[0.95rem] font-bold text-ok">
      <CircleCheck size={15} aria-hidden /> 반영됨
    </span>
  );
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
