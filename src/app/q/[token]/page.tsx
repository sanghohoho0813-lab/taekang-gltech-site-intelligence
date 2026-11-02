"use client";

/** 현장 태블릿 QR을 휴대폰 기본 카메라로 찍으면 열리는 주소 — 바로 출근(또는 QR 확인) */
import Link from "next/link";
import { use, useMemo } from "react";
import { useMe } from "@/lib/data/hooks";
import { IS_LIVE } from "@/lib/mode";
import { PageSkeleton } from "@/components/ui/primitives";
import { EasyAttendance } from "@/components/easy/EasyAttendance";

export default function QrPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { db, role, userId } = useMe();
  const sites = useMemo(() => (!db ? [] : role === "field" && !IS_LIVE ? db.sites.filter((s) => s.fieldUserId === userId) : db.sites), [db, role, userId]);
  if (!db) return <PageSkeleton />;
  return (
    <div className="mx-auto w-full max-w-xl space-y-5 px-4 pb-8 pt-5" data-testid="qr-page">
      <h1 className="text-[1.6rem] font-extrabold">현장 QR 출근</h1>
      {role !== "field" ? (
        <p className="rounded-2xl border-2 border-line bg-surface px-4 py-4 text-[1.1rem]">현장 직원 계정으로 열어 주세요.</p>
      ) : (
        <EasyAttendance db={db} userId={userId} sites={sites} autoQr={decodeURIComponent(token)} />
      )}
      <Link href="/field" className="press flex h-[3.8rem] items-center justify-center rounded-2xl border-2 border-line-strong bg-surface text-[1.12rem] font-bold">
        처음 화면으로
      </Link>
    </div>
  );
}
