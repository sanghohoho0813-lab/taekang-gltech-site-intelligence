"use client";

/**
 * 오류·의견 (계약 4단계 ‘피드백 반영·오류 0건’ 근거 · D-47)
 * - 기간(시범 운영 기간) 요약: 의견 반영·보류·확인 전, 기록된 앱 오류 횟수·종류·오류 난 날
 * - 현장 의견: 반영함/보류(이유 필수) + 답변 → 보낸 사람 휴대폰 ‘내 정보’와 알림
 * - 앱 오류 기록 (운영 모드): 화면·서버, 횟수, 화면 주소, 내용(개인정보 지움), 브라우저
 * - CSV: 검수 자료로 첨부
 */
import { MetricTile } from "@/components/domain/Widgets";
import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { useMe, userLabel } from "@/lib/data/hooks";
import { run } from "@/lib/data/store";
import { CommandError } from "@/lib/data/commands";
import { IS_LIVE } from "@/lib/mode";
import { FEEDBACK_LABEL, FEEDBACK_STATUS_LABEL, qualitySummary, type ErrorEntry, type Feedback, type FeedbackStatus } from "@/lib/domain/feedback";
import { fmtDateTime, todayIso } from "@/lib/domain/format";
import { shiftDate } from "@/lib/domain/attendance";
import { toCsv } from "@/lib/domain/csv";
import { downloadCsv } from "@/lib/browser/download";
import { ROLE_LABEL } from "@/lib/domain/labels";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, Field, Notice, PageSkeleton, Segmented, cx, inputCls } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

export function QualityBoard() {
  const { db } = useMe();
  const today = todayIso();
  const [from, setFrom] = useState(shiftDate(today, -13));
  const [to, setTo] = useState(today);
  const [errors, setErrors] = useState<ErrorEntry[] | null>(null);
  const [errState, setErrState] = useState<"idle" | "loading" | "fail">("idle");
  const load = async () => {
    if (!IS_LIVE) return;
    setErrState("loading");
    try {
      const r = await fetch("/api/errors", { cache: "no-store", credentials: "same-origin" });
      if (!r.ok) throw new Error();
      setErrors(((await r.json()) as { errors: ErrorEntry[] }).errors);
      setErrState("idle");
    } catch {
      setErrState("fail");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  if (!db) return <PageSkeleton />;
  const feedback = (db.feedback ?? []).filter((f) => kst(f.at) >= from && kst(f.at) <= to).sort((a, b) => (a.status === "new" ? 0 : 1) - (b.status === "new" ? 0 : 1) || b.at.localeCompare(a.at));
  const errs = (errors ?? []).filter((e) => (kst(e.lastAt) >= from && kst(e.lastAt) <= to) || (kst(e.at) >= from && kst(e.at) <= to));
  const sum = qualitySummary(db.feedback ?? [], errors ?? [], from, to);
  const csv = () => {
    const rows: (string | number)[][] = [
      [`기간 ${from} ~ ${to}`],
      ["앱 의견", `전체 ${sum.feedback.total}`, `반영 ${sum.feedback.done}`, `보류 ${sum.feedback.hold}`, `확인 전 ${sum.feedback.open}`],
      ...(IS_LIVE ? [["앱 오류(기록된 것)", `총 ${sum.errors.total}회`, `${sum.errors.kinds}종류`, `화면 ${sum.errors.client}회`, `서버 ${sum.errors.server}회`, `오류 난 날 ${sum.errors.errorDays}일`]] : []),
      [],
      ["보낸 시각", "보낸 사람", "종류", "내용", "상태", "본사 답변", "확인 시각", "확인한 사람"],
      ...feedback.map((f) => [fmtDateTime(f.at), userLabel(db, f.userId), FEEDBACK_LABEL[f.category], f.text, FEEDBACK_STATUS_LABEL[f.status], f.reply ?? "", f.reviewedAt ? fmtDateTime(f.reviewedAt) : "", f.reviewedBy ? userLabel(db, f.reviewedBy) : ""]),
      ...(IS_LIVE ? [[], ["처음", "마지막", "횟수", "구분", "화면", "내용", "사람", "역할", "브라우저"], ...errs.map((e) => [fmtDateTime(e.at), fmtDateTime(e.lastAt), e.count, e.source === "client" ? "화면" : "서버", e.route, e.message, userLabel(db, e.userId), ROLE_LABEL[e.role as keyof typeof ROLE_LABEL] ?? e.role, e.browser ?? ""])] : []),
    ];
    downloadCsv(`오류_의견_${from}_${to}.csv`, toCsv(rows));
  };
  return (
    <PageBody>
      <PageHeader
        eyebrow={<DemoBadge compact />}
        title="오류·의견"
        desc="현장이 보낸 앱 의견을 반영하고, 앱에서 난 오류를 확인합니다. 시범 운영 기간을 골라 CSV로 내려받아 4단계 검수 자료로 쓰세요."
        right={
          <Button size="sm" icon={<Download size={15} />} onClick={csv} data-testid="quality-csv">
            CSV
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <Field label="시작일" htmlFor="q-from">
            <input id="q-from" type="date" className={cx(inputCls, "w-44")} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} data-testid="quality-from" />
          </Field>
          <Field label="종료일" htmlFor="q-to">
            <input id="q-to" type="date" className={cx(inputCls, "w-44")} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} data-testid="quality-to" />
          </Field>
          <div className="grid flex-1 grid-cols-2 gap-2 @min-[760px]:grid-cols-4" data-testid="quality-summary">
            <Stat label="앱 의견" value={`${sum.feedback.total}건`} sub={`반영 ${sum.feedback.done} · 보류 ${sum.feedback.hold}`} />
            <Stat label="확인 전 의견" value={`${sum.feedback.open}건`} tone={sum.feedback.open ? "warn" : "ok"} testId="quality-open" />
            <Stat label="기록된 앱 오류" value={IS_LIVE ? `${sum.errors.total}회` : "—"} sub={IS_LIVE ? `${sum.errors.kinds}종류 · 화면 ${sum.errors.client} · 서버 ${sum.errors.server}` : "실제 운영에서 자동 기록"} tone={IS_LIVE ? (sum.errors.total ? "err" : "ok") : undefined} testId="quality-errors" />
            <Stat label="오류 난 날" value={IS_LIVE ? `${sum.errors.errorDays}일` : "—"} sub="기간 중" />
          </div>
        </div>
      </Card>

      <Card data-testid="quality-feedback">
        <CardHeader title="현장 앱 의견" sub="‘반영함’·‘보류’를 저장하면 보낸 사람 휴대폰 ‘내 정보’에 결과와 답변이 보이고 알림이 갑니다. 보류는 이유가 필요합니다." />
        {feedback.length === 0 ? (
          <EmptyState title="이 기간에 받은 의견이 없습니다" desc="현장 휴대폰 ‘내 정보 → 앱 의견 보내기’로 들어옵니다." />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {feedback.map((f) => (
              <FeedbackRow key={f.id} f={f} name={userLabel(db, f.userId)} reviewer={f.reviewedBy ? userLabel(db, f.reviewedBy) : ""} />
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="quality-error-list">
        <CardHeader
          title="앱 오류 기록"
          sub="화면(휴대폰·PC)과 서버에서 예상하지 못한 오류. 같은 사람·화면·내용은 1시간 단위로 묶어 횟수로 보여줍니다. 이메일·긴 숫자 등은 지우고 남깁니다."
          right={
            IS_LIVE ? (
              <Button size="sm" variant="ghost" icon={<RefreshCw size={15} />} onClick={() => void load()} loading={errState === "loading"} data-testid="quality-reload">
                새로고침
              </Button>
            ) : undefined
          }
        />
        {!IS_LIVE ? (
          <div className="px-5 pb-5">
            <Notice tone="info">실제 운영(로그인)에서 자동으로 기록됩니다. 시연 화면에서는 기록하지 않습니다.</Notice>
          </div>
        ) : errState === "fail" ? (
          <div className="px-5 pb-5">
            <Notice tone="err">오류 기록을 불러오지 못했습니다. 새로고침을 눌러 주세요.</Notice>
          </div>
        ) : errs.length === 0 ? (
          <EmptyState title="이 기간에 기록된 앱 오류가 없습니다" desc="인터넷 끊김처럼 앱 밖의 원인은 기록하지 않습니다." />
        ) : (
          <div tabIndex={0} role="region" aria-label="앱 오류 기록 표 (가로 스크롤)" className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[52rem] text-[0.82rem]">
              <thead>
                <tr className="text-left text-[0.74rem] text-ink-3">
                  {["마지막", "횟수", "구분", "화면", "내용", "사람", "브라우저"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {errs.map((e) => (
                  <tr key={e.id} className="border-t border-line align-top" data-testid="quality-error" data-source={e.source}>
                    <td className="num px-3 py-2 whitespace-nowrap">{fmtDateTime(e.lastAt)}</td>
                    <td className="num px-3 py-2 font-bold">{e.count}</td>
                    <td className="px-3 py-2">
                      <Badge tone={e.source === "server" ? "err" : "warn"}>{e.source === "server" ? "서버" : "화면"}</Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-[0.76rem]">{e.route}</td>
                    <td className="px-3 py-2 break-all">{e.message}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{userLabel(db, e.userId)}</td>
                    <td className="px-3 py-2 text-ink-3">{e.browser ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageBody>
  );
}

function FeedbackRow({ f, name, reviewer }: { f: Feedback; name: string; reviewer: string }) {
  const toast = useToast();
  const [status, setStatus] = useState<FeedbackStatus>(f.status);
  const [reply, setReply] = useState(f.reply ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const changed = status !== f.status || reply.trim() !== (f.reply ?? "");
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      await run("reviewFeedback", { feedbackId: f.id, status, reply: reply.trim() || undefined });
      toast.push({ tone: "ok", title: "저장했습니다 — 보낸 사람에게 결과가 보입니다" });
    } catch (e) {
      setErr(e instanceof CommandError ? e.message : "저장하지 못했습니다");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="space-y-2 px-5 py-3.5" data-testid="quality-fb" data-id={f.id} data-status={f.status}>
      <p className="flex flex-wrap items-center gap-2 text-[0.9rem]">
        <b>{FEEDBACK_LABEL[f.category]}</b>
        <Badge tone={f.status === "done" ? "ok" : f.status === "hold" ? "warn" : "info"}>{FEEDBACK_STATUS_LABEL[f.status]}</Badge>
        <span className="text-ink-2">{name}</span>
        <span className="ml-auto text-[0.78rem] text-ink-3">
          {fmtDateTime(f.at)}
          {f.route ? ` · ${f.route}` : ""}
        </span>
      </p>
      {f.text && <p className="text-[0.88rem]">{f.text}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <Segmented
          label="처리"
          size="sm"
          value={status}
          onChange={setStatus}
          options={[
            { value: "new", label: "확인 전", testId: "fb-status-new" },
            { value: "done", label: "반영함", testId: "fb-status-done" },
            { value: "hold", label: "보류", testId: "fb-status-hold" },
          ]}
        />
        <label className="sr-only" htmlFor={`fb-reply-${f.id}`}>
          답변
        </label>
        <input id={`fb-reply-${f.id}`} className={cx(inputCls, "h-9 min-w-56 flex-1 py-1")} value={reply} maxLength={300} onChange={(e) => setReply(e.target.value)} placeholder={status === "hold" ? "보류 이유 (필수)" : "답변 (보낸 사람에게 보임)"} data-testid="fb-reply" />
        <Button size="sm" variant="cta" onClick={() => void save()} loading={busy} disabled={!changed} data-testid="fb-save">
          저장
        </Button>
      </div>
      {err && <p className="text-[0.8rem] font-semibold text-err">{err}</p>}
      {f.reviewedAt && (
        <p className="text-[0.76rem] text-ink-3">
          {reviewer} · {fmtDateTime(f.reviewedAt)}
        </p>
      )}
    </li>
  );
}

function Stat({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "err"; testId?: string }) {
  return <MetricTile label={label} value={value} sub={sub} tone={tone === "ok" ? undefined : tone} testId={testId} compact />;
}
