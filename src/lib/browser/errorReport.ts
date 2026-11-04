"use client";

/**
 * 화면 오류 자동 보내기 (운영 모드 · D-47) — 한 화면에서 최대 5번, 같은 오류는 1번.
 * 브라우저 확장 프로그램·인터넷 끊김 같은 앱 밖 원인은 보내지 않는다. 문구의 개인정보는 서버가 다시 지운다.
 */
import { CommandError } from "@/lib/data/commands";
import { IS_LIVE } from "@/lib/mode";

let sent = 0;
const seen = new Set<string>();
const NOISE = /ResizeObserver loop|^Script error\.?$|Non-Error promise rejection captured|Load failed|Failed to fetch|NetworkError|AbortError/i;

export function reportClientError(err: unknown, kind = "error") {
  if (!IS_LIVE || typeof window === "undefined" || sent >= 5) return;
  if (err instanceof CommandError && (err.code === "NETWORK" || err.code === "VALIDATION" || err.code === "DUPLICATE")) return;
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err)?.slice(0, 200) ?? "알 수 없는 오류");
  const stack = e.stack ?? "";
  if (NOISE.test(e.message) || /chrome-extension:|moz-extension:|safari-extension:/.test(stack)) return;
  const key = `${kind}:${e.message}`;
  if (seen.has(key)) return;
  seen.add(key);
  sent += 1;
  void fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    keepalive: true,
    body: JSON.stringify({ message: `${kind === "error" ? "" : `[${kind}] `}${e.name && e.name !== "Error" ? `${e.name}: ` : ""}${e.message}`.slice(0, 300), stack: stack.slice(0, 1500), route: location.pathname }),
  }).catch(() => {});
}

let installed = false;
export function installErrorReporter() {
  if (installed || !IS_LIVE || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => reportClientError(ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => reportClientError(ev.reason, "promise"));
}
