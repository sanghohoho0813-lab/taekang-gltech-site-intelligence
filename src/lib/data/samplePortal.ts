/**
 * 발주처 포털 예시 자료 (D-93) — 운영(LIVE) 회사에 현장이 아직 하나도 없을 때, 본사가 발주처 화면이 어떻게 보이는지 미리 보도록.
 * 가상 현장·가상 발주처(시연판과 같은 자료)이고 브라우저 안에서만 만든다 — 서버에 저장하지 않고, 발주처 계정에는 보이지 않는다.
 */
import type { DemoDB } from "@/lib/domain/types";
import { createSeed } from "./seed";

let cached: DemoDB | null = null;

export function samplePortalDb(): DemoDB {
  if (!cached) cached = createSeed();
  return cached;
}
