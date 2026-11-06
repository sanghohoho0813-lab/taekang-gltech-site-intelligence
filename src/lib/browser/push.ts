/** 휴대폰 알림 켜기·끄기 (브라우저 쪽, D-37) */

export type PushState =
  | { kind: "demo" }
  | { kind: "unsupported" }
  /** 아이폰: 홈 화면에 추가한 아이콘으로 열어야 알림 가능 */
  | { kind: "ios-install" }
  | { kind: "server-off" }
  | { kind: "denied" }
  | { kind: "off" }
  | { kind: "on" };

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function keyBytes(b64url: string): Uint8Array {
  const b64 = (b64url + "=".repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function serverStatus(): Promise<{ enabled: boolean; publicKey: string | null; subscribed: number }> {
  const r = await fetch("/api/push", { cache: "no-store", credentials: "same-origin" });
  if (!r.ok) throw new Error("알림 상태를 확인하지 못했습니다.");
  return r.json();
}

async function currentSub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function pushState(live: boolean): Promise<PushState> {
  if (!live) return { kind: "demo" };
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return { kind: "unsupported" };
  if (!("PushManager" in window) || !("Notification" in window)) return isIos() && !standalone() ? { kind: "ios-install" } : { kind: "unsupported" };
  if (isIos() && !standalone()) return { kind: "ios-install" };
  if (Notification.permission === "denied") return { kind: "denied" };
  const s = await serverStatus().catch(() => null);
  if (!s?.enabled) return { kind: "server-off" };
  const sub = await currentSub().catch(() => null);
  return sub && s.subscribed > 0 ? { kind: "on" } : { kind: "off" };
}

export async function enablePush(): Promise<PushState> {
  const s = await serverStatus();
  if (!s.enabled || !s.publicKey) return { kind: "server-off" };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { kind: perm === "denied" ? "denied" : "off" };
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(s.publicKey) as BufferSource });
  const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ subscription: sub.toJSON() }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "알림을 켜지 못했습니다.");
  return { kind: "on" };
}

export async function disablePush(): Promise<PushState> {
  const sub = await currentSub().catch(() => null);
  await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ endpoint: sub?.endpoint }) });
  await sub?.unsubscribe().catch(() => {});
  return { kind: "off" };
}

/**
 * 로그아웃할 때 이 휴대폰의 알림만 끈다 — 함께 쓰는 휴대폰에서 앞 사람 알림이 계속 오던 문제 (D-67).
 * 이 기기에 구독이 없으면 아무것도 하지 않는다(다른 기기의 알림은 그대로).
 */
export async function unsubscribeThisDevice(): Promise<void> {
  const sub = await currentSub().catch(() => null);
  if (!sub) return;
  await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export async function testPush(): Promise<number> {
  const r = await fetch("/api/push/test", { method: "POST", credentials: "same-origin" });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "시험 알림을 보내지 못했습니다.");
  return Number((await r.json()).sent ?? 0);
}
