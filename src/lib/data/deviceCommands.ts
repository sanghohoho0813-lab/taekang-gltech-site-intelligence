/**
 * 휴대폰 점검 결과 보내기 (D-46) — 본인 것만, 사람마다 마지막 결과 1개. 좌표는 받지 않는다(정확도만 10m 단위).
 */
import type { DemoDB } from "@/lib/domain/types";
import { DEVICE_CHECK_KEYS, DEVICE_CHECK_LABEL, deviceVerdict, VERDICT_LABEL, type DeviceCheck, type DeviceCheckKey, type DeviceCheckStatus, type DevicePlatform } from "@/lib/domain/device";
import { CommandError, clone, log, nowIso, touch, userName, type Ctx } from "./commands";

export interface DeviceCheckInput {
  platform: DevicePlatform;
  browser: string;
  inApp?: boolean;
  items: Partial<Record<DeviceCheckKey, DeviceCheckStatus>>;
  accuracyM?: number;
}

const STATUSES: DeviceCheckStatus[] = ["ok", "warn", "fail", "skip"];

export function reportDeviceCheck(db0: DemoDB, input: DeviceCheckInput, ctx: Ctx) {
  const errors: Record<string, string> = {};
  if (!input || typeof input !== "object") throw new CommandError("점검 결과 형식이 올바르지 않습니다.", "VALIDATION");
  if (!["ios", "android", "other"].includes(input.platform)) errors.platform = "휴대폰 종류";
  if (typeof input.browser !== "string" || !input.browser.trim() || input.browser.length > 40 || /[<>]/.test(input.browser)) errors.browser = "브라우저 이름";
  const items: DeviceCheck["items"] = {};
  if (!input.items || typeof input.items !== "object" || Array.isArray(input.items)) errors.items = "점검 항목";
  else
    for (const [k, v] of Object.entries(input.items)) {
      if (!(DEVICE_CHECK_KEYS as readonly string[]).includes(k) || !STATUSES.includes(v as DeviceCheckStatus)) errors.items = "점검 항목";
      else items[k as DeviceCheckKey] = v as DeviceCheckStatus;
    }
  if (!errors.items && !Object.keys(items).length) errors.items = "점검 항목";
  const acc = input.accuracyM;
  if (acc !== undefined && (typeof acc !== "number" || !Number.isFinite(acc) || acc < 0 || acc > 100_000)) errors.accuracyM = "위치 정확도";
  if (Object.keys(errors).length) throw new CommandError("점검 결과 형식이 올바르지 않습니다.", "VALIDATION", errors);
  const db = clone(db0);
  const rec: DeviceCheck = {
    userId: ctx.userId,
    at: nowIso(ctx),
    platform: input.platform,
    browser: input.browser.trim(),
    ...(input.inApp ? { inApp: true } : {}),
    items,
    ...(acc !== undefined ? { accuracyM: Math.round(acc / 10) * 10 } : {}),
  };
  db.deviceChecks = [...(db.deviceChecks ?? []).filter((c) => c.userId !== ctx.userId), rec];
  const v = deviceVerdict(rec);
  const bad = (Object.entries(items) as [DeviceCheckKey, DeviceCheckStatus][]).filter(([, s]) => s === "fail" || s === "warn").map(([k]) => DEVICE_CHECK_LABEL[k]);
  log(db, ctx, "device", `${userName(db, ctx.userId)} 휴대폰 점검 — ${VERDICT_LABEL[v]} · ${rec.browser}${bad.length ? ` · 확인: ${bad.join(", ")}` : ""}`);
  touch(db, ctx);
  return { db, result: { verdict: v } };
}
