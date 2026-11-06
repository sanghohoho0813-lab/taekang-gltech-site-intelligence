"use client";

/** 근태 수정 요청 — 날짜 → 무엇이 잘못됐나 → 시각 → 사유 → 보내기 (누르기만으로) */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CircleCheck, Clock3, HardHat } from "lucide-react";
import { run } from "@/lib/data/store";
import { useMe } from "@/lib/data/hooks";
import { IS_LIVE } from "@/lib/mode";
import { CommandError, errorMessage } from "@/lib/data/commands";
import { FIX_KIND_LABEL } from "@/lib/data/opsCommands";
import type { AttendanceRequest, Site } from "@/lib/domain/types";
import { todayIso } from "@/lib/domain/format";
import { hhmm, shiftDate } from "@/lib/domain/attendance";
import { uid } from "@/lib/domain/ids";
import { Chip, Choice, EasyBar, EasyPageHead, EasyQuestion, SectionBar, AtBottom, NoSite, useWizardActive, useStepHistory } from "./ui";
import { easyDate } from "./words";

const REASONS = ["휴대폰 배터리가 꺼짐", "위치(GPS)가 안 잡힘", "깜빡하고 못 누름", "현장 밖에서 잘못 누름", "휴대폰을 두고 옴", "기타 (본사에 전화로 설명)"];
const TIMES_IN = ["06:30", "07:00", "07:30", "08:00", "08:30", "09:00"];
const TIMES_OUT = ["16:00", "16:30", "17:00", "17:30", "18:00", "19:00"];

type Step = "site" | "date" | "kind" | "time" | "reason" | "confirm";

export function EasyFix() {
  const { db, role, userId } = useMe();
  const sites = useMemo<Site[]>(() => (!db ? [] : role === "field" && !IS_LIVE ? db.sites.filter((s) => s.fieldUserId === userId) : db.sites), [db, role, userId]);
  const [siteId, setSiteId] = useState(sites.length === 1 ? sites[0].id : "");
  const [stack, setStack] = useState<Step[]>([sites.length === 1 ? "date" : "site"]);
  useWizardActive(stack.length > 1);
  const [moreDays, setMoreDays] = useState(false);
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<AttendanceRequest["kind"] | "">("");
  const [inTime, setInTime] = useState("");
  const [outTime, setOutTime] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [key] = useState(() => uid("idem"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // 보낸 뒤(완료 화면)에는 단계 기록을 접는다
  useStepHistory(done ? 1 : stack.length, (d) => setStack((x) => x.slice(0, Math.max(1, d))));
  const step = stack[stack.length - 1];
  // 단계가 바뀌면 화면 맨 위(머리 띠)부터 보이게 (D-65)
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);
  if (!db) return null;
  if (!sites.length) return <NoSite title="출퇴근 수정 요청" />;
  const site = db.sites.find((s) => s.id === siteId) ?? (sites.length === 1 ? sites[0] : undefined);
  const go = (s: Step) => (setErr(null), setStack((x) => [...x, s]));
  const back = () => stack.length > 1 && setStack((x) => x.slice(0, -1));
  const rec = (db.attendance ?? []).find((r) => r.userId === userId && r.siteId === site?.id && r.workDate === date);
  const needIn = kind === "missed_in" || kind === "wrong_time";
  const needOut = kind === "missed_out" || (kind === "wrong_time" && !!rec?.outAt);
  // ‘시각이 잘못 찍혔어요’: 찍힌 시각을 미리 골라 두고, 바꾼 것만 보낸다 (출근만 틀렸으면 퇴근은 그대로 · D-65)
  const recIn = rec ? hhmm(rec.inAt) : "";
  const recOut = rec?.outAt ? hhmm(rec.outAt) : "";
  const inChanged = kind !== "wrong_time" || (!!inTime && inTime !== recIn);
  const outChanged = kind !== "wrong_time" || (!!outTime && outTime !== recOut);
  const pickKind = (k: AttendanceRequest["kind"]) => {
    setKind(k);
    if (k === "wrong_time") {
      setInTime(recIn);
      setOutTime(recOut);
    } else {
      setInTime("");
      setOutTime("");
    }
  };
  const myRequests = (db.attendanceRequests ?? []).filter((q) => q.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);

  const send = async () => {
    if (!site || !kind || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await run("requestAttendanceFix", { siteId: site.id, workDate: date, kind, ...(needIn && inTime && inChanged ? { inTime } : {}), ...(needOut && outTime && outChanged ? { outTime } : {}), reason: reasons.join(", "), idempotencyKey: key });
      setDone(true);
    } catch (e) {
      setErr(errorMessage(e, "보내지 못했어요."));
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <div className="space-y-5 pt-4 text-center" data-testid="fix-done">
        <CircleCheck size={64} className="mx-auto text-ok" aria-hidden />
        <p className="text-[1.6rem] font-extrabold">수정 요청을 보냈어요</p>
        <p className="text-[1.05rem] text-ink-2">본사가 확인하면 알림이 오고, ‘내 정보 → 출퇴근 수정 요청’에서 결과를 볼 수 있어요.</p>
        <Link href="/field" className="press flex h-[4rem] w-full items-center justify-center rounded-2xl bg-cta text-[1.2rem] font-extrabold text-cta-text">
          처음 화면으로
        </Link>
      </div>
    );

  const timeChips = (list0: string[], value: string, set: (v: string) => void, label: string, testId: string, recorded?: string) => {
    const list = recorded && !list0.includes(recorded) ? [recorded, ...list0] : list0;
    return (
    <div className="space-y-2">
      <p className="text-[1.15rem] font-bold">
        {label}
        {recorded && <span className="ml-2 text-[1rem] font-semibold text-ink-2">찍힌 시각 {recorded}{value === recorded ? " · 그대로" : ""}</span>}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {list.map((t) => (
          <Chip key={t} selected={value === t} onClick={() => set(t)} testId={testId}>
            <span className="num">{t}</span>
          </Chip>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[1.02rem] text-ink-2">
        다른 시각
        <input type="time" value={value} onChange={(e) => set(e.target.value)} className="h-12 rounded-xl border-2 border-line-strong px-3 text-[1.1rem]" aria-label={`${label} 직접 입력`} />
      </label>
    </div>
    );
  };

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;
  switch (step) {
    case "site":
      body = (
        <EasyQuestion title="어느 현장인가요?">
          <div className="space-y-2.5">
            {sites.map((s) => (
              <Choice key={s.id} icon={<HardHat size={24} />} label={s.shortName} sub={s.workType} onClick={() => (setSiteId(s.id), go("date"))} testId={`fix-site-${s.id}`} />
            ))}
          </div>
        </EasyQuestion>
      );
      break;
    case "date":
      body = (
        <EasyQuestion title="언제 일인가요?" testId="fix-date">
          <div className="space-y-2.5">
            {/* 본사가 받는 범위(7일)만큼 — 월요일에 지난 금요일 건도 요청할 수 있게 (D-66) */}
            {(moreDays ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2]).map((d) => {
              const v = shiftDate(today, -d);
              // 그날 이미 본사 확인을 기다리는 요청이 있으면 처음부터 알려 준다 — 다섯 번 누른 뒤에야 거절되던 문제 (D-67 점검 반영)
              const waiting = (db.attendanceRequests ?? []).some((q) => q.userId === userId && q.siteId === siteId && q.workDate === v && q.status === "pending");
              const label = d === 0 ? `오늘 · ${easyDate(v)}` : d === 1 ? `어제 · ${easyDate(v)}` : d === 2 ? `그제 · ${easyDate(v)}` : easyDate(v);
              return <Choice key={v} label={label} sub={waiting ? "본사 확인 중인 요청이 있어요 — 더 고칠 것은 본사에 전화해 주세요" : undefined} onClick={() => !waiting && (setDate(v), go("kind"))} selected={date === v} testId={`fix-date-${d}`} />;
            })}
            {!moreDays && (
              <button type="button" onClick={() => setMoreDays(true)} className="press min-h-[3.4rem] w-full rounded-2xl border-2 border-dashed border-line-strong text-[1.05rem] font-bold text-ink-2" data-testid="fix-date-more">
                더 지난 날 (일주일 전까지)
              </button>
            )}
          </div>
        </EasyQuestion>
      );
      footer = stack.length > 1 ? <EasyBar onBack={back} /> : null;
      break;
    case "kind":
      body = (
        <EasyQuestion title="무엇이 잘못됐나요?" help={rec ? `그날 기록: 출근 ${hhmm(rec.inAt)}${rec.outAt ? ` · 퇴근 ${hhmm(rec.outAt)}` : " · 퇴근 기록 없음"}` : "그날 출근 기록이 없어요."} testId="fix-kind">
          <div className="space-y-2.5">
            {(Object.keys(FIX_KIND_LABEL) as AttendanceRequest["kind"][])
              .filter((k) => (rec ? k !== "missed_in" : k === "missed_in"))
              .filter((k) => !(k === "missed_out" && rec?.outAt))
              // 오늘 아직 일하는 중이면 ‘퇴근을 못 눌렀어요’는 보이지 않게 (아직 퇴근 전)
              .filter((k) => !(k === "missed_out" && date === today && rec && !rec.outAt))
              .map((k) => (
                <Choice key={k} icon={<Clock3 size={24} />} label={FIX_KIND_LABEL[k]} onClick={() => (pickKind(k), go(k === "gps_issue" ? "reason" : "time"))} selected={kind === k} testId={`fix-kind-${k}`} />
              ))}
          </div>
        </EasyQuestion>
      );
      footer = <EasyBar onBack={back} />;
      break;
    case "time":
      body = (
        <EasyQuestion title="실제 시각을 골라 주세요" help="현장에 실제로 도착·퇴근한 시각이에요." testId="fix-time">
          {needIn && timeChips(TIMES_IN, inTime, setInTime, "출근 시각", "fix-in", kind === "wrong_time" ? recIn : undefined)}
          {needOut && timeChips(TIMES_OUT, outTime, setOutTime, "퇴근 시각", "fix-out", kind === "wrong_time" ? recOut : undefined)}
        </EasyQuestion>
      );
      {
        const missing = (needIn && !inTime) || (needOut && !outTime);
        const nothingChanged = kind === "wrong_time" && !inChanged && !outChanged;
        footer = <EasyBar onBack={back} onNext={() => go("reason")} nextDisabled={missing || nothingChanged} hint={missing ? "시각을 골라 주세요" : nothingChanged ? "바뀐 시각을 골라 주세요 (지금은 찍힌 시각 그대로예요)" : undefined} />;
      }
      break;
    case "reason":
      body = (
        <EasyQuestion title="왜 그랬나요?" help="해당하는 것을 누르세요." testId="fix-reason">
          <div className="flex flex-wrap gap-2.5">
            {REASONS.map((r) => (
              <Chip key={r} selected={reasons.includes(r)} onClick={() => setReasons((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]))} testId="fix-reason-chip">
                {r}
              </Chip>
            ))}
          </div>
        </EasyQuestion>
      );
      footer = <EasyBar onBack={back} onNext={() => go("confirm")} nextDisabled={reasons.length === 0} hint={reasons.length === 0 ? "이유를 하나 이상 골라 주세요" : undefined} />;
      break;
    case "confirm":
      body = (
        <EasyQuestion title="이렇게 요청할까요?" testId="fix-confirm">
          <div className="space-y-1.5 rounded-2xl border-2 border-line bg-surface p-4 text-[1.15rem]">
            <p>
              <b>{site?.shortName}</b> · {easyDate(date)}
            </p>
            <p>{kind ? FIX_KIND_LABEL[kind] : ""}</p>
            {needIn && inTime && inChanged && <p className="num">출근 {kind === "wrong_time" ? `${recIn} → ` : ""}{inTime}</p>}
            {needOut && outTime && outChanged && <p className="num">퇴근 {kind === "wrong_time" ? `${recOut} → ` : ""}{outTime}</p>}
            <p className="text-ink-2">사유: {reasons.join(", ")}</p>
          </div>
          {err && <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.05rem] font-semibold text-err">{err}</p>}
        </EasyQuestion>
      );
      footer = <EasyBar onBack={back} onNext={send} nextLabel="본사로 보내기" loading={busy} nextTestId="fix-send" />;
      break;
  }

  return (
    <div className="flex min-h-[calc(100dvh-12.5rem)] flex-col gap-6 lg:min-h-0" data-testid="easy-fix">
      <EasyPageHead title="출퇴근 수정 요청">
        {/* 현장을 먼저 물으면 첫 칸은 ‘현장’, 위치 문제는 ‘시각’ 단계를 건너뛴다 (D-65) */}
        {(() => {
          const withSite = stack[0] === "site";
          const sec = [...(withSite ? ["현장"] : []), "날짜", "내용", ...(kind === "gps_issue" ? [] : ["시각"]), "사유", "확인"];
          const order: Step[] = [...(withSite ? (["site"] as Step[]) : []), "date", "kind", ...(kind === "gps_issue" ? [] : (["time"] as Step[])), "reason", "confirm"];
          return <SectionBar onBand sections={sec} current={Math.max(0, order.indexOf(step))} />;
        })()}
      </EasyPageHead>
      <div key={step} className="anim-fade-up">
        {body}
      </div>
      <AtBottom bar={footer} />
      {myRequests.length > 0 && step === stack[0] && (
        <section className="space-y-2" data-testid="fix-history">
          <h2 className="text-[1.2rem] font-extrabold">내가 보낸 요청</h2>
          {myRequests.map((q) => (
            <p key={q.id} className="rounded-2xl border-2 border-line bg-surface px-4 py-3 text-[1.02rem]">
              {easyDate(q.workDate)} · {FIX_KIND_LABEL[q.kind]} ·{" "}
              <b className={q.status === "approved" ? "text-ok" : q.status === "rejected" ? "text-err" : "text-warn"}>{q.status === "approved" ? "승인됨" : q.status === "rejected" ? `반려됨${q.reviewNote ? `: ${q.reviewNote}` : ""}` : "본사 확인 중"}</b>
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
