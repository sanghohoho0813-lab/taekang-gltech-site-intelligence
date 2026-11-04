"use client";

/** 내 정보 → 앱 의견 보내기 (D-47) — 누르기만으로 보내고, 본사가 반영하면 결과·답변이 여기에 */
import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { run } from "@/lib/data/store";
import { CommandError } from "@/lib/data/commands";
import { FEEDBACK_CATEGORIES, FEEDBACK_LABEL, FEEDBACK_STATUS_LABEL, type FeedbackCategory } from "@/lib/domain/feedback";
import { fmtDateTime } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { cx } from "@/components/ui/primitives";

export function MyFeedback() {
  const { db, userId } = useMe();
  const [cat, setCat] = useState<FeedbackCategory | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [key, setKey] = useState(() => uid("idem"));
  if (!db) return null;
  const mine = (db.feedback ?? []).filter((f) => f.userId === userId).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  const send = async () => {
    if (!cat) return;
    setBusy(true);
    try {
      await run("sendFeedback", { category: cat, text: text.trim() || undefined, route: "/my", idempotencyKey: key });
      setMsg({ ok: true, text: "보냈어요. 본사가 확인하면 아래에 결과가 나와요." });
      setCat(null);
      setText("");
      setKey(uid("idem"));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof CommandError ? e.message : "보내지 못했어요. 잠시 뒤 다시 눌러 주세요." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3" aria-labelledby="fb-title" data-testid="my-feedback">
      <h2 id="fb-title" className="flex items-center gap-2 text-[1.3rem] font-extrabold">
        <MessageSquare size={22} aria-hidden /> 앱 의견 보내기
      </h2>
      <p className="text-[1.02rem] text-ink-2">불편한 점을 누르기만 하면 본사에 전달돼요.</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="어떤 점이 불편한가요">
        {FEEDBACK_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={cat === c}
            onClick={() => {
              setCat(c);
              setMsg(null);
            }}
            className={cx("press min-h-[3.4rem] rounded-2xl border-2 px-3 py-2 text-left text-[1.02rem] font-bold leading-snug", cat === c ? "border-active bg-active-soft" : "border-line bg-surface")}
            data-testid={`fb-cat-${c}`}
          >
            {FEEDBACK_LABEL[c]}
          </button>
        ))}
      </div>
      {cat && (
        <div className="space-y-2.5">
          <label htmlFor="fb-text" className="block text-[1.02rem] font-semibold">
            더 적을 말 <span className="font-normal text-ink-3">(안 적어도 돼요)</span>
          </label>
          <textarea id="fb-text" rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded-2xl border-2 border-line bg-surface px-3 py-2 text-[1.05rem]" placeholder="예) 어느 화면에서, 어떻게" data-testid="fb-text" />
          <button type="button" onClick={() => void send()} disabled={busy} className="press min-h-[3.6rem] w-full rounded-2xl bg-cta text-[1.12rem] font-extrabold text-cta-text disabled:opacity-60" data-testid="fb-send">
            {busy ? "보내는 중…" : "본사에 보내기"}
          </button>
        </div>
      )}
      {msg && (
        <p role="status" className={cx("rounded-2xl px-4 py-3 text-[1.05rem] font-semibold", msg.ok ? "bg-ok-bg" : "bg-err-bg")} data-testid="fb-msg">
          {msg.text}
        </p>
      )}
      {mine.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border-2 border-line bg-surface" data-testid="fb-mine">
          {mine.map((f) => (
            <li key={f.id} className="px-4 py-3 text-[1.02rem]" data-testid="fb-mine-item" data-status={f.status}>
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {FEEDBACK_LABEL[f.category]}
                <span className={cx("rounded-lg px-2 py-0.5 text-[0.9rem]", f.status === "done" ? "bg-ok-bg" : f.status === "hold" ? "bg-warn-bg" : "bg-surface-2")}>{FEEDBACK_STATUS_LABEL[f.status]}</span>
                <span className="ml-auto text-[0.92rem] font-normal text-ink-3">{fmtDateTime(f.at)}</span>
              </p>
              {f.text && <p className="mt-0.5 text-ink-2">{f.text}</p>}
              {f.reply && <p className="mt-1 rounded-xl bg-surface-2 px-3 py-2">본사: {f.reply}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
