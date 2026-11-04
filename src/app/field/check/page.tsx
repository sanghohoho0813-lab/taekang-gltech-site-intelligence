"use client";

import { EasyDeviceCheck } from "@/components/easy/EasyDeviceCheck";

/** /field/check — 내 휴대폰 점검 (D-46) */
export default function FieldCheckPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-8 pt-5">
      <EasyDeviceCheck />
    </div>
  );
}
