"use client";

/** 휴대폰 위치 1번 잡기 + 기기 번호 (브라우저 전용) */
import type { GeoSample } from "@/lib/domain/geo";
import type { GeoStamp } from "@/lib/domain/types";

export type LocateResult = { sample: GeoSample } | { error: NonNullable<GeoStamp["reason"]> };

/** 출근·퇴근 버튼을 누를 때만 호출 — 계속 추적하지 않는다 */
export function locateOnce(timeoutMs = 15_000): Promise<LocateResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve({ error: "unsupported" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ sample: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }),
      (e) => resolve({ error: e.code === e.PERMISSION_DENIED ? "denied" : e.code === e.TIMEOUT ? "timeout" : "unavailable" }),
      // 예전에 잡아 둔 위치(캐시)는 쓰지 않는다
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

const DEVICE_KEY = "tk-site-intel:device";

/** 이 휴대폰의 무작위 번호 — 같은 휴대폰으로 여러 명이 출근하는지 확인용 (개인정보 아님) */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9_-]{6,64}$/.test(id)) {
      id = "dev-" + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return ""; // 저장 공간을 못 쓰면 기기 번호 없이 (같은 휴대폰 확인에서 제외)
  }
}
