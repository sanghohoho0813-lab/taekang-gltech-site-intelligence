"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EasyReport, type EasyMode } from "@/components/easy/EasyReport";
import { PageSkeleton } from "@/components/ui/primitives";

function ReportInner() {
  const q = useSearchParams();
  const router = useRouter();
  const m = q.get("mode");
  const mode: EasyMode = m === "photo" || m === "cost" ? m : "full";
  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-6 pt-5">
      <EasyReport key={mode} mode={mode} siteId={q.get("site") ?? undefined} onExit={() => router.push("/field")} />
    </div>
  );
}

/** /field/report — 쉬운 현장 보고 (한 화면에 질문 하나) */
export default function FieldReportPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReportInner />
    </Suspense>
  );
}
