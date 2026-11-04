"use client";

/**
 * 휴대폰 점검 — 브라우저에서 실제로 해 보는 확인 (D-46). 좌표는 보내지 않고 정확도만 쓴다.
 * 사진은 사용자가 직접 찍어야 해서 화면에서 따로 확인한다.
 */
import type { DeviceCheckStatus } from "@/lib/domain/device";
import { locateOnce } from "@/lib/geo/client";
import { pushState } from "./push";

export async function checkNetwork(live: boolean): Promise<{ status: DeviceCheckStatus; ms?: number }> {
  const t0 = performance.now();
  try {
    const r = await fetch(live ? "/api/health" : "/manifest.webmanifest", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(12_000) });
    const ms = Math.round(performance.now() - t0);
    if (!r.ok) return { status: "fail", ms };
    return { status: ms > 3_000 ? "warn" : "ok", ms };
  } catch {
    return { status: "fail" };
  }
}

/** 위치: 잘 잡히는지만 본다 (기록하지 않음). 150m보다 크면 ‘위치 불확실’과 같은 기준으로 경고 */
export async function checkLocation(): Promise<{ status: DeviceCheckStatus; accuracyM?: number; reason?: string }> {
  const r = await locateOnce(15_000);
  if ("sample" in r) return { status: r.sample.accuracy <= 150 ? "ok" : "warn", accuracyM: r.sample.accuracy };
  return { status: r.error === "timeout" ? "warn" : "fail", reason: r.error };
}

/** 저장 공간: 보내지 못한 보고를 보관하는 휴대폰 저장소(IndexedDB)에 실제로 쓰고 읽어 본다 */
export async function checkStorage(): Promise<DeviceCheckStatus> {
  try {
    if (typeof indexedDB === "undefined") return "fail";
    const ok = await new Promise<boolean>((resolve) => {
      const req = indexedDB.open("tk-site-intel-check", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("t");
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction("t", "readwrite");
          tx.objectStore("t").put("ok", "k");
          tx.oncomplete = () => {
            db.close();
            indexedDB.deleteDatabase("tk-site-intel-check");
            resolve(true);
          };
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      };
    });
    if (!ok) return "fail";
    const est = await navigator.storage?.estimate?.().catch(() => null);
    if (est?.quota && est.usage !== undefined && est.quota - est.usage < 50_000_000) return "warn";
    return "ok";
  } catch {
    return "fail";
  }
}

export async function checkPush(live: boolean): Promise<DeviceCheckStatus> {
  const s = await pushState(live).catch(() => ({ kind: "unsupported" as const }));
  if (s.kind === "on") return "ok";
  if (s.kind === "demo" || s.kind === "server-off") return "skip";
  return "warn";
}

export function checkHome(): DeviceCheckStatus {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return standalone ? "ok" : "warn";
}
