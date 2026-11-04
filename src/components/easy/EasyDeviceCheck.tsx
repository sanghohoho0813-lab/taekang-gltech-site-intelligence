"use client";

/**
 * 내 휴대폰 점검 (D-46) — 현장에서 쓰기 전에 한 번. 인터넷·위치·저장 공간·알림·홈 화면·브라우저를 자동으로,
 * 사진은 한 장 찍어서 확인 → 고치는 방법을 큰 글씨로 → 본사에 결과 보내기 (좌표는 보내지 않음)
 */
import Link from "next/link";
import { useRef, useState } from "react";
import { Camera, CircleAlert, CircleCheck, CircleX, Loader2, MinusCircle, Send, Smartphone } from "lucide-react";
import { run } from "@/lib/data/store";
import { CommandError } from "@/lib/data/commands";
import { IS_LIVE } from "@/lib/mode";
import { DEVICE_CHECK_KEYS, DEVICE_CHECK_LABEL, VERDICT_LABEL, deviceFix, deviceVerdict, summarizeUa, type DeviceCheckKey, type DeviceCheckStatus } from "@/lib/domain/device";
import { checkHome, checkLocation, checkNetwork, checkPush, checkStorage } from "@/lib/browser/deviceCheck";
import { cx } from "@/components/ui/primitives";
import { downscalePhoto } from "./photo";

type Items = Partial<Record<DeviceCheckKey, DeviceCheckStatus>>;
const ICON: Record<DeviceCheckStatus, React.ReactNode> = {
  ok: <CircleCheck size={26} className="text-ok" aria-hidden />,
  warn: <CircleAlert size={26} className="text-warn" aria-hidden />,
  fail: <CircleX size={26} className="text-err" aria-hidden />,
  skip: <MinusCircle size={26} className="text-ink-3" aria-hidden />,
};
const WORD: Record<DeviceCheckStatus, string> = { ok: "좋아요", warn: "확인해 주세요", fail: "고쳐야 해요", skip: "건너뜀" };
const bigBtn = "press flex min-h-[3.8rem] w-full items-center justify-center gap-2 rounded-2xl text-[1.15rem] font-extrabold disabled:opacity-60";

export function EasyDeviceCheck() {
  const [phase, setPhase] = useState<"intro" | "running" | "photo" | "result">("intro");
  const [items, setItems] = useState<Items>({});
  const [current, setCurrent] = useState<DeviceCheckKey | null>(null);
  const [accuracy, setAccuracy] = useState<number | undefined>();
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const photoRef = useRef<HTMLInputElement>(null);
  const ua = typeof navigator === "undefined" ? { platform: "other" as const, browser: "", inApp: false, old: false } : summarizeUa(navigator.userAgent);

  const start = async () => {
    setPhase("running");
    setItems({});
    setSent(null);
    const set = (k: DeviceCheckKey, s: DeviceCheckStatus) => setItems((x) => ({ ...x, [k]: s }));
    set("browser", ua.inApp ? "fail" : ua.old ? "warn" : "ok");
    setCurrent("network");
    set("network", (await checkNetwork(IS_LIVE)).status);
    setCurrent("location");
    const loc = await checkLocation();
    setAccuracy(loc.accuracyM);
    set("location", loc.status);
    setCurrent("storage");
    set("storage", await checkStorage());
    setCurrent("push");
    set("push", await checkPush(IS_LIVE));
    setCurrent("home");
    set("home", checkHome());
    setCurrent(null);
    setPhase("photo");
  };

  const onPhoto = async (f?: File) => {
    if (!f) return;
    try {
      const url = await downscalePhoto(f);
      setItems((x) => ({ ...x, photo: url.startsWith("data:image/jpeg;base64,") && url.length > 200 ? "ok" : "fail" }));
    } catch {
      setItems((x) => ({ ...x, photo: "fail" }));
    }
    setPhase("result");
  };

  const send = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await run("reportDeviceCheck", { platform: ua.platform, browser: ua.browser || "알 수 없는 브라우저", inApp: ua.inApp, items, ...(accuracy !== undefined ? { accuracyM: accuracy } : {}) });
      setSent(VERDICT_LABEL[r.verdict]);
    } catch (e) {
      setErr(e instanceof CommandError ? e.message : "보내지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const verdict = deviceVerdict({ items });
  return (
    <div className="space-y-5" data-testid="device-check">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-[1.7rem] font-extrabold leading-tight">
          <Smartphone size={28} aria-hidden /> 내 휴대폰 점검
        </h1>
        <p className="text-[1.1rem] text-ink-2">현장에서 쓰기 전에 한 번 눌러 보세요. 1분이면 끝나요.</p>
      </header>

      {phase === "intro" && (
        <div className="space-y-4">
          <ul className="list-disc space-y-1.5 pl-5 text-[1.05rem] leading-relaxed">
            <li>인터넷·위치·저장 공간·알림·홈 화면을 차례로 확인해요.</li>
            <li>위치는 잘 잡히는지만 보고 <b>기록하지 않아요</b>. 위치를 물어보면 ‘허용’을 눌러 주세요.</li>
            <li>마지막에 사진을 한 장 찍어 봐요 (아무거나 괜찮아요).</li>
          </ul>
          <button type="button" onClick={() => void start()} className={cx(bigBtn, "bg-cta text-cta-text")} data-testid="device-start">
            점검 시작
          </button>
        </div>
      )}

      {phase !== "intro" && (
        <ul className="divide-y divide-line rounded-2xl border-2 border-line bg-surface" data-testid="device-items">
          {DEVICE_CHECK_KEYS.map((k) => {
            const s = items[k];
            const fix = s ? deviceFix(k, s, ua.platform, ua.inApp) : "";
            return (
              <li key={k} className="px-4 py-3" data-testid="device-item" data-key={k} data-status={s ?? "pending"}>
                <p className="flex items-center gap-2.5 text-[1.12rem] font-bold">
                  {s ? ICON[s] : current === k ? <Loader2 size={26} className="animate-spin text-ink-3" aria-hidden /> : <span className="inline-block size-[26px] rounded-full border-2 border-line" aria-hidden />}
                  {DEVICE_CHECK_LABEL[k]}
                  <span className="ml-auto text-[0.98rem] font-semibold text-ink-2">{s ? WORD[s] : current === k ? "확인 중…" : ""}</span>
                </p>
                {k === "browser" && s && <p className="mt-0.5 pl-9 text-[0.95rem] text-ink-3">{ua.browser}</p>}
                {k === "location" && accuracy !== undefined && <p className="mt-0.5 pl-9 text-[0.95rem] text-ink-3">정확도 약 {Math.round(accuracy)}m</p>}
                {fix && <p className="mt-1 pl-9 text-[1.02rem] leading-relaxed">{fix}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {phase === "photo" && (
        <div className="space-y-3 rounded-2xl border-2 border-active bg-active-soft p-4">
          <p className="text-[1.15rem] font-extrabold">사진을 한 장 찍어 볼까요?</p>
          <p className="text-[1.02rem] text-ink-2">보고할 때처럼 찍히고 올라가는지 확인해요. 사진은 본사로 보내지 않아요.</p>
          <button type="button" onClick={() => photoRef.current?.click()} className={cx(bigBtn, "bg-cta text-cta-text")} data-testid="device-photo">
            <Camera size={24} aria-hidden /> 사진 찍어 보기
          </button>
          <button
            type="button"
            onClick={() => {
              setItems((x) => ({ ...x, photo: "skip" }));
              setPhase("result");
            }}
            className={cx(bigBtn, "border-2 border-line-strong bg-surface")}
            data-testid="device-photo-skip"
          >
            건너뛰기
          </button>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="점검용 사진" data-testid="device-photo-input" onChange={(e) => void onPhoto(e.target.files?.[0])} />
        </div>
      )}

      {phase === "result" && (
        <div className="space-y-3" data-testid="device-result" data-verdict={verdict}>
          <p className={cx("rounded-2xl px-4 py-3 text-[1.2rem] font-extrabold", verdict === "ready" ? "bg-ok-bg" : verdict === "warn" ? "bg-warn-bg" : "bg-err-bg")}>
            {verdict === "ready" ? "이 휴대폰은 현장에서 쓸 준비가 됐어요." : verdict === "warn" ? "쓸 수는 있어요. 노란 항목을 확인해 주세요." : "빨간 항목을 고쳐야 제대로 쓸 수 있어요."}
          </p>
          {sent ? (
            <p role="status" className="rounded-2xl bg-ok-bg px-4 py-3 text-[1.08rem] font-semibold" data-testid="device-sent">
              본사에 점검 결과를 보냈어요 ({sent}).
            </p>
          ) : (
            <button type="button" onClick={() => void send()} disabled={busy} className={cx(bigBtn, "bg-cta text-cta-text")} data-testid="device-send">
              <Send size={22} aria-hidden /> {busy ? "보내는 중…" : "본사에 결과 보내기"}
            </button>
          )}
          {err && <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.02rem] font-semibold">{err}</p>}
          <button type="button" onClick={() => void start()} className={cx(bigBtn, "border-2 border-line-strong bg-surface")} data-testid="device-again">
            다시 점검하기
          </button>
          <Link href="/my" className={cx(bigBtn, "border-2 border-line bg-surface")}>
            내 정보로 돌아가기
          </Link>
        </div>
      )}
    </div>
  );
}
