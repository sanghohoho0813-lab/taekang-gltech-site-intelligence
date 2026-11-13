"use client";

/** 내 정보 — 글자 크기 · 본사 전화 · 내 위치 기록 · 내가 보낸 보고 · 비밀번호 · 로그아웃 */
import Link from "next/link";
import { helpPhoneOf } from "@/lib/domain/companyPhone";
import { useState } from "react";
import { KeyRound, LogOut, Phone, Smartphone, Type, BookOpen } from "lucide-react";
import { VERDICT_LABEL, deviceVerdict } from "@/lib/domain/device";
import { useMe } from "@/lib/data/hooks";
import { logout, setPrefs, usePrefs, type FontScale } from "@/lib/data/store";
import { IS_LIVE } from "@/lib/mode";
import { ROLE_LABEL } from "@/lib/domain/labels";
import { PageSkeleton, cx } from "@/components/ui/primitives";
import { FIX_KIND_LABEL } from "@/lib/data/opsCommands";
import { easyDate } from "./words";
import { Choice, EasyPageHead } from "./ui";
import { PushCard } from "@/components/PushCard";
import { MyRecords } from "./EasyHome";
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
