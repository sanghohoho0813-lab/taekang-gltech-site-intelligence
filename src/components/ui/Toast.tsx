"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { cx } from "./primitives";

interface ToastItem {
  id: number;
  tone: "ok" | "err" | "info";
  title: string;
  desc?: string;
  action?: { label: string; onClick: () => void };
  ttl: number;
}

const Ctx = createContext<{ push: (t: Omit<ToastItem, "id" | "ttl"> & { ttl?: number }) => void } | null>(null);

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("ToastProvider 필요");
  return c;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback((t: Omit<ToastItem, "id" | "ttl"> & { ttl?: number }) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-3), { ...t, id, ttl: t.ttl ?? (t.action ? 10000 : 5000) }]);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.2rem+env(safe-area-inset-bottom))] z-[100] flex flex-col items-center gap-2 px-3 md:bottom-6 md:right-6 md:left-auto md:items-end"
        aria-live="polite"
        role="status"
      >
        {items.map((t) => (
          <ToastView key={t.id} t={t} onDone={() => remove(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastView({ t, onDone }: { t: ToastItem; onDone: () => void }) {
  useEffect(() => {
    const h = setTimeout(onDone, t.ttl);
    return () => clearTimeout(h);
  }, [t.ttl, onDone]);
  const I = t.tone === "ok" ? CircleCheck : t.tone === "err" ? CircleAlert : Info;
  return (
    <div
      className={cx(
        "pointer-events-auto anim-pop flex w-full max-w-md items-start gap-3 rounded-2xl border bg-surface px-4 py-3 shadow-pop",
        t.tone === "err" ? "border-err/30" : "border-line",
      )}
      data-testid="toast"
    >
      <I size={20} className={cx("mt-0.5 shrink-0", t.tone === "ok" ? "text-ok" : t.tone === "err" ? "text-err" : "text-info")} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink text-[0.9rem]">{t.title}</p>
        {t.desc && <p className="mt-0.5 text-[0.82rem] text-ink-3">{t.desc}</p>}
      </div>
      {t.action && (
        <button
          type="button"
          className="press shrink-0 rounded-lg px-2.5 py-1.5 text-[0.82rem] font-bold text-theme-ink hover:bg-active-soft"
          onClick={() => {
            t.action?.onClick();
            onDone();
          }}
        >
          {t.action.label}
        </button>
      )}
      <button type="button" onClick={onDone} className="press -mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-3" aria-label="알림 닫기">
        <X size={16} />
      </button>
    </div>
  );
}
