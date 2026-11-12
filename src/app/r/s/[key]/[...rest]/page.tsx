"use client";

import { PublicMessage } from "@/components/intake/PublicShell";

/** 진행 확인 주소 뒤에 다른 글자가 붙은 경우 — 내부 화면으로 보내지 않는다 (D-74 점검 10차) */
export default function IntakeStatusExtra() {
  return <PublicMessage testId="intake-status" state="notfound" title="열 수 없는 주소입니다" desc="주소가 잘못 이어 붙었습니다. 받은 주소를 그대로 눌러 주세요." />;
}
