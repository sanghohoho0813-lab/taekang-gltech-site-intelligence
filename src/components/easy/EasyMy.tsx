"use client";

/** 내 정보 — 글자 크기 · 본사 전화 · 내 위치 기록 · 내가 보낸 보고 · 비밀번호 · 로그아웃 */
import Link from "next/link";
import { helpPhoneOf } from "@/lib/domain/companyPhone";
import { useEffect, useState } from "react";
import { KeyRound, LogOut, Phone, Smartphone, Type, BookOpen } from "lucide-react";
import { VERDICT_LABEL, deviceVerdict } from "@/lib/domain/device";
import { useMe } from "@/lib/data/hooks";
import { logout, setPrefs, usePrefs, type FontScale } from "@/lib/data/store";
import { IS_LIVE } from "@/lib/mode";
import { ROLE_LABEL } from "@/lib/domain/labels";
import { PageSkeleton, cx } from "@/components/ui/primitives";
import { FIX_KIND_LABEL } from "@/lib/data/opsCommands";
import { hhmm, hqCorrections } from "@/lib/domain/attendance";
import { todayIso } from "@/lib/domain/format";
import { easyDate } from "./words";
import { Choice, EasyPageHead } from "./ui";
import { PushCard } from "@/components/PushCard";
import { CORR_SEEN_KEY, MyRecords } from "./EasyHome";
import { MyLocationCard } from "./MyLocation";
import { MyFeedback } from "./MyFeedback";

export function EasyMy() {
  const { db, role, userId, user } = useMe();
  const prefs = usePrefs();
  const [askOut, setAskOut] = useState(false);
  if (!db) return <PageSkeleton />;
  const phone = helpPhoneOf(db.settings);
  const lastCheck = (db.deviceChecks ?? []).find((c) => c.userId === userId);
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 pb-8 pt-5" data-testid="easy-my">
      <EasyPageHead title="내 정보" sub={`${user?.name ?? ""} · ${user?.title || ROLE_LABEL[role]}`} />

      {/* 본사가 고친 출퇴근 — 근무시간이 바뀌는 일이라 맨 위에 (알림·홈 안내가 여기로 · D-80 현장·급여 점검) */}
      <MyCorrections db={db} userId={userId} phone={phone} />

      {/* 가장 자주 찾는 ‘내가 보낸 보고’를 맨 위로 (홈 ‘모두 보기’·‘보완 요청’이 바로 여기로 · D-65) */}
      <section id="my-reports" className="scroll-mt-24 space-y-3" aria-labelledby="records-title">
        <h2 id="records-title" className="text-[1.3rem] font-extrabold">
          내가 보낸 보고
        </h2>
        <p className="text-[1.02rem] text-ink-2">비용은 ‘본사 확인 중 → 반영됨’ 순서로 바뀌어요. 반려되면 이유가 보여요.</p>
        <MyRecords db={db} userId={userId} />
      </section>

      {/* 출퇴근 수정 요청 결과 — 수정 요청 완료 화면이 ‘내 정보에서 결과를 볼 수 있어요’라고 안내하는 곳 (D-67 점검 반영) */}
      <MyFixRequests db={db} userId={userId} />

      <section className="space-y-2.5" aria-labelledby="font-title">
        <h2 id="font-title" className="flex items-center gap-2 text-[1.3rem] font-extrabold">
          <Type size={22} aria-hidden /> 글자 크기
        </h2>
        {(
          [
            ["md", "보통", "기본 크기"],
            ["lg", "크게", "조금 더 크게"],
            ["xl", "아주 크게", "가장 크게"],
          ] as [FontScale, string, string][]
        ).map(([v, label, sub]) => (
          <Choice key={v} label={label} sub={sub} selected={prefs.fontScale === v || (v === "md" && prefs.fontScale === "sm")} onClick={() => setPrefs({ fontScale: v })} testId={`my-font-${v}`} />
        ))}
      </section>

      {phone && (
        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="press flex min-h-[4.5rem] items-center gap-3 rounded-2xl border-2 border-line bg-surface px-4 text-[1.2rem] font-extrabold">
          <Phone size={26} className="text-ok" aria-hidden /> 본사에 전화하기 <span className="ml-auto text-[1.05rem] font-semibold text-ink-2">{phone}</span>
        </a>
      )}

      <Link href="/field/check" className="press flex min-h-[4rem] items-center gap-3 rounded-2xl border-2 border-line bg-surface px-4 text-[1.15rem] font-bold" data-testid="my-device-check">
        <Smartphone size={24} aria-hidden /> 내 휴대폰 점검
        <span className="ml-auto text-[0.98rem] font-semibold text-ink-3">{lastCheck ? `마지막 ${VERDICT_LABEL[deviceVerdict(lastCheck)]}` : "1분이면 끝나요"}</span>
      </Link>

      <Link href="/help" className="press flex min-h-[4rem] items-center gap-3 rounded-2xl border-2 border-line bg-surface px-4 text-[1.15rem] font-bold" data-testid="my-help">
        <BookOpen size={24} aria-hidden /> 사용 안내 보기
        <span className="ml-auto text-[0.98rem] font-semibold text-ink-3">버튼 이름 그대로</span>
      </Link>

      <PushCard audience={role === "field" ? "field" : "hq"} />

      {(role === "field" || (db.attendance ?? []).some((r) => r.userId === userId)) && <MyLocationCard />}

      <MyFeedback />

      {IS_LIVE ? (
        <section className="space-y-2.5">
          <Link href="/account" className="press flex min-h-[4rem] items-center gap-3 rounded-2xl border-2 border-line-strong bg-surface px-4 text-[1.15rem] font-bold">
            <KeyRound size={24} aria-hidden /> 비밀번호 바꾸기
          </Link>
          {askOut ? (
            <div className="rounded-2xl border-2 border-err/40 bg-err-bg p-4" role="alertdialog" aria-label="로그아웃 확인">
              <p className="text-[1.12rem] font-bold">로그아웃할까요? 다음에 다시 아이디·비밀번호를 넣어야 해요.</p>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <button type="button" onClick={() => setAskOut(false)} className="press h-[3.6rem] rounded-2xl border-2 border-line-strong bg-surface text-[1.1rem] font-bold">
                  아니요
                </button>
                <button type="button" onClick={() => void logout()} className="press h-[3.6rem] rounded-2xl bg-err text-[1.1rem] font-bold text-white" data-testid="logout">
                  네, 로그아웃
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setAskOut(true)} className="press flex min-h-[4rem] w-full items-center gap-3 rounded-2xl border-2 border-line-strong bg-surface px-4 text-left text-[1.15rem] font-bold text-err" data-testid="logout-ask">
              <LogOut size={24} aria-hidden /> 로그아웃
            </button>
          )}
          <p className="text-[0.98rem] text-ink-2">쓰는 동안에는 이 휴대폰에서 계속 로그인돼 있어요. 30일 넘게 안 쓰면(그리고 반년에 한 번) 다시 넣어요.</p>
        </section>
      ) : (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[1rem] text-ink-2">DEMO에서는 로그인이 없습니다. 실제 운영에서는 여기서 비밀번호 변경·로그아웃을 합니다.</p>
      )}
    </div>
  );
}

/**
 * 본사가 고친 내 출퇴근 (D-80) — 근무시간이 바뀌는 일이라 본인이 알 수 있게. 처음 누른 시각 → 지금 시각, 근무시간 변화, 누가·언제·왜.
 * (비용을 본사가 고치면 보이던 것과 같은 원칙 · D-79). 근태 수정 요청을 승인한 것은 아래 ‘출퇴근 수정 요청’에 따로 나온다. 최근 60일 기록만 휴대폰에 온다.
 */
function MyCorrections({ db, userId, phone }: { db: NonNullable<ReturnType<typeof useMe>["db"]>; userId: string; phone?: string }) {
  const [all, setAll] = useState(false);
  const recs = (db.attendance ?? []).filter((r) => r.userId === userId && hqCorrections(r).length > 0);
  const latest = recs.flatMap((r) => hqCorrections(r).map((c) => c.at)).sort().at(-1);
  // 여기까지 봤으면 홈 안내를 끈다 (이 휴대폰에서만)
  useEffect(() => {
    if (!latest) return;
    try {
      localStorage.setItem(CORR_SEEN_KEY, latest);
    } catch {
      /* 저장소를 못 써도 화면은 그대로 */
    }
  }, [latest]);
  if (!recs.length) return null;
  // 날짜마다 한 장 — 그날 두 현장을 함께 고친 경우(겹침 정리)도 하루 근무시간 변화로 보이게
  const days = [...new Set(recs.map((r) => r.workDate))].sort().reverse();
  const shown = all ? days : days.slice(0, 5);
  const name = (id: string) => db.users.find((u) => u.id === id)?.name ?? "본사";
  const hm = (iso: string, workDate: string) => `${todayIso(new Date(iso)) > workDate ? "다음 날 " : ""}${hhmm(iso)}`;
  const len = (a: string, b?: string | null) => (b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000)) : 0);
  const word = (m: number) => `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return (
    <section id="my-corrections" className="scroll-mt-24 space-y-3" aria-labelledby="corr-title" data-testid="my-corrections">
      <h2 id="corr-title" className="text-[1.3rem] font-extrabold">
        본사가 고친 출퇴근 <span className="text-[1.05rem] font-bold text-ink-2">{days.length}일</span>
      </h2>
      <ul className="space-y-2.5">
        {shown.map((d) => {
          const list = recs.filter((r) => r.workDate === d);
          const dayAll = (db.attendance ?? []).filter((r) => r.userId === userId && r.workDate === d);
          const was = dayAll.reduce((a, r) => {
            const f = hqCorrections(r)[0]?.before;
            return a + (f ? len(f.inAt, f.outAt) : len(r.inAt, r.outAt));
          }, 0);
          const now = dayAll.reduce((a, r) => a + len(r.inAt, r.outAt), 0);
          const notes = [...new Set(list.flatMap((r) => hqCorrections(r).map((c) => c.note)))];
          const last = list.flatMap((r) => hqCorrections(r)).sort((a, b) => a.at.localeCompare(b.at)).at(-1)!;
          return (
            <li key={d} className="rounded-2xl border-2 border-line bg-surface p-4" data-testid="my-correction">
              <p className="text-[1.12rem] font-extrabold">{easyDate(d)}</p>
              <ul className="mt-1 space-y-0.5">
                {list.map((r) => {
                  const f = hqCorrections(r)[0].before;
                  const changes = [f.inAt !== r.inAt ? `출근 ${hm(f.inAt, d)} → ${hm(r.inAt, d)}` : "", (f.outAt ?? "") !== (r.outAt ?? "") ? `퇴근 ${f.outAt ? hm(f.outAt, d) : "안 누름"} → ${r.outAt ? hm(r.outAt, d) : "없음"}` : ""].filter(Boolean);
                  return (
                    <li key={r.id} className="text-[1.05rem] num">
                      <b>{db.sites.find((x) => x.id === r.siteId)?.shortName}</b> {changes.join(" · ") || "시각은 그대로 (확인 표시만)"}
                    </li>
                  );
                })}
              </ul>
              {was !== now && <p className="mt-1 text-[1.02rem] font-bold text-ink num">그날 근무 {word(was)} → {word(now)}</p>}
              <p className="mt-0.5 text-[1rem] text-ink-2">이유: {notes.join(" / ")}</p>
              <p className="mt-0.5 text-[0.95rem] text-ink-3">
                {name(last.by)} · {easyDate(todayIso(new Date(last.at)))} 고침
              </p>
            </li>
          );
        })}
      </ul>
      {days.length > 5 && (
        <button type="button" onClick={() => setAll(!all)} className="press h-[3.3rem] w-full rounded-2xl border-2 border-line-strong text-[1.05rem] font-bold" data-testid="my-corrections-more">
          {all ? "접기" : `${days.length - 5}일 더 보기`}
        </button>
      )}
      {phone ? (
        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="press flex min-h-[3.6rem] items-center justify-center gap-2 rounded-2xl bg-surface-2 px-4 text-[1.1rem] font-bold text-ink">
          맞지 않으면 본사에 전화하기 <span className="font-semibold text-ink-2">{phone}</span>
        </a>
      ) : (
        <p className="text-[0.98rem] text-ink-2">맞지 않으면 본사에 알려 주세요.</p>
      )}
    </section>
  );
}

function MyFixRequests({ db, userId }: { db: NonNullable<ReturnType<typeof useMe>["db"]>; userId: string }) {
  const list = (db.attendanceRequests ?? []).filter((q) => q.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  if (!list.length) return null;
  const tone = { pending: "text-warn", approved: "text-ok", rejected: "text-err" } as const;
  const word = { pending: "본사 확인 중", approved: "승인됨", rejected: "반려됨" } as const;
  return (
    <section id="my-fixes" className="scroll-mt-24 space-y-3" aria-labelledby="fixes-title" data-testid="my-fixes">
      <h2 id="fixes-title" className="text-[1.3rem] font-extrabold">
        출퇴근 수정 요청
      </h2>
      <ul className="space-y-2.5">
        {list.map((q) => (
          <li key={q.id} className="rounded-2xl border-2 border-line bg-surface p-4" data-testid="my-fix-item" data-status={q.status}>
            <p className="flex flex-wrap items-center gap-x-2 text-[1.05rem] font-semibold text-ink-2">
              <b className="text-[1.12rem] text-ink">{db.sites.find((s) => s.id === q.siteId)?.shortName}</b>
              {easyDate(q.workDate)} · {FIX_KIND_LABEL[q.kind]}
            </p>
            <p className={cx("mt-1 text-[1.05rem] font-bold", tone[q.status])}>{word[q.status]}</p>
            {q.reviewNote && <p className="mt-0.5 text-[1rem] text-ink-2">본사: {q.reviewNote}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
