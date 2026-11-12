"use client";

import { PublicMessage } from "@/components/intake/PublicShell";

/** 주소가 ‘/r’까지만 남은 경우 — 내부 로그인 화면으로 보내지 않는다 (D-74) */
export default function IntakeRoot() {
  return <PublicMessage testId="intake-page" state="notfound" title="열 수 없는 주소입니다" desc="주소가 끝까지 입력됐는지 확인해 주세요. QR을 다시 찍거나 받은 주소를 그대로 눌러 주세요." />;
}
