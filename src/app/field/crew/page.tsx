"use client";

import { EasyCrew } from "@/components/easy/EasyCrew";

/** /field/crew — 오늘 작업 인원 알리기 (출력) */
export default function FieldCrewPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-6 pt-5">
      <EasyCrew />
    </div>
  );
}
