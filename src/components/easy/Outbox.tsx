"use client";

/** 보내지 못한 보고함 — 자동 보내기(화면 없음) + 현장 첫 화면 안내 칸 (D-39) */
import { useCallback, useEffect, useState } from "react";
import { CloudUpload, Trash2, WifiOff } from "lucide-react";
import { run } from "@/lib/data/store";
import { IS_LIVE } from "@/lib/mode";
import { flushOutbox, onOutboxChange, outboxFor, outboxRemove, type OutboxItem, type Runner } from "@/lib/browser/outbox";

const runner: Runner = (name, args) => run(name, args as never);
const WHAT: Record<OutboxItem["name"], string> = { submitFieldReport: "보고", checkIn: "출퇴근", checkOut: "출퇴근", recordMaterial: "자재 기록" };

export function useOutbox(userId: string | undefined) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const refresh = useCallback(() => {
    if (!IS_LIVE || !userId) return;
    void outboxFor(userId).then(setItems);
  }, [userId]);
  useEffect(() => {
    refresh();
    return onOutboxChange(refresh);
  }, [refresh]);
  return items;
}

/** 현장 화면에 항상 붙어 있는 자동 보내기 — 앱을 열 때·연결이 돌아올 때·화면을 다시 볼 때·30초마다 */
export function OutboxRunner({ userId }: { userId: string | undefined }) {
  const items = useOutbox(userId);
  const waiting = items.filter((i) => !i.failed).length;
  useEffect(() => {
    if (!IS_LIVE || !userId) return;
    const go = () => void flushOutbox(userId, runner);
    go();
    const vis = () => document.visibilityState === "visible" && go();
    window.addEventListener("online", go);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("online", go);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [userId]);
  useEffect(() => {
    if (!IS_LIVE || !userId || !waiting) return;
    const t = window.setInterval(() => void flushOutbox(userId, runner), 30_000);
    return () => window.clearInterval(t);
  }, [userId, waiting]);
  return null;
}

/** 현장 첫 화면 — 휴대폰에 보관 중인 보고 */
export function OutboxTile({ userId }: { userId: string | undefined }) {
  const items = useOutbox(userId);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  if (!items.length) return null;
  const waiting = items.filter((i) => !i.failed);
  const failed = items.filter((i) => i.failed);
  const what = waiting.every((i) => i.name === "submitFieldReport") ? "보고" : "기록";
  return (
    <div className="space-y-2.5" data-testid="outbox">
      {waiting.length > 0 && (
        <div className="rounded-2xl border-2 border-warn/50 bg-warn-bg p-4" data-testid="outbox-waiting">
          <p className="flex items-center gap-2 text-[1.2rem] font-extrabold">
            <WifiOff size={24} aria-hidden /> 아직 못 보낸 {what} {waiting.length}건
          </p>
          <p className="mt-1 text-[1.05rem] text-ink-2">
            {what === "보고" ? "휴대폰에 사진까지 그대로 보관하고 있어요." : "휴대폰에 그대로 보관하고 있어요."}
            {waiting.some((i) => i.name === "checkIn" || i.name === "checkOut") && " 출퇴근은 누른 시각을 본사가 확인해요."}
            {waiting.some((i) => i.name === "recordMaterial") && " 자재 기록은 누른 날짜로 들어가요."} 신호가 잡히면 자동으로 보내요.
          </p>
          <ul className="mt-2 space-y-1 text-[1rem] text-ink-2">
            {waiting.map((i) => (
              <li key={i.id}>· {i.label}</li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!userId) return;
              setBusy(true);
              await flushOutbox(userId, runner);
              setBusy(false);
            }}
            className="press mt-3 flex min-h-[3.6rem] w-full items-center justify-center gap-2 rounded-2xl bg-solid text-[1.12rem] font-extrabold text-white disabled:opacity-60"
            data-testid="outbox-send"
          >
            <CloudUpload size={22} aria-hidden /> {busy ? "보내는 중…" : "지금 보내기"}
          </button>
        </div>
      )}
      {failed.map((i) => (
        <div key={i.id} className="rounded-2xl border-2 border-err/40 bg-err-bg p-4" data-testid="outbox-failed">
          <p className="text-[1.12rem] font-extrabold">보내지 못한 {WHAT[i.name]} — {i.label}</p>
          <p className="mt-1 text-[1.02rem] text-ink-2">본사 서버가 받지 않았어요: {i.failed}</p>
          <p className="text-[1.02rem] text-ink-2">{i.name === "submitFieldReport" || i.name === "recordMaterial" ? "본사에 전화해 확인한 뒤 지우세요." : "출퇴근이 빠졌으면 ‘출퇴근이 잘못 찍혔나요? 수정 요청하기’로 알린 뒤 지우세요."}</p>
          {ask === i.id ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setAsk(null)} className="press h-[3.4rem] rounded-2xl border-2 border-line-strong bg-surface text-[1.05rem] font-bold">
                아니요
              </button>
              <button
                type="button"
                onClick={async () => {
                  await outboxRemove(i.id);
                  setAsk(null);
                }}
                className="press h-[3.4rem] rounded-2xl bg-err text-[1.05rem] font-bold text-white"
                data-testid="outbox-delete"
              >
                네, 지울게요
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setAsk(i.id)} className="press mt-2 flex min-h-[3.2rem] w-full items-center justify-center gap-2 rounded-2xl border-2 border-line-strong bg-surface text-[1.05rem] font-bold" data-testid="outbox-delete-ask">
              <Trash2 size={20} aria-hidden /> {i.name === "submitFieldReport" ? "이 보고 지우기" : "이 기록 지우기"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
