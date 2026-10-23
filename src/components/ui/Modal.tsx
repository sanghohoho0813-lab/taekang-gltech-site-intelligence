"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./primitives";

let lockCount = 0;
function lock() {
  lockCount += 1;
  document.documentElement.classList.add("tk-scroll-lock");
}
function unlock() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.documentElement.classList.remove("tk-scroll-lock");
}

/**
 * Native <dialog> 기반 Modal / Mobile Bottom Sheet.
 * - ESC·배경 클릭·닫기 버튼으로 종료
 * - 열릴 때 스크롤 잠금, 닫힐 때 스크롤·포커스 복구 (Overlay 잔존 P0 방지)
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  testId,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  testId?: string;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      d.showModal();
      lock();
      return () => {
        if (d.open) d.close();
        unlock();
        const el = returnFocus.current;
        if (el && document.contains(el)) {
          try {
            el.focus({ preventScroll: true });
          } catch {
            // 무시
          }
        }
      };
    }
  }, [open]);

  if (!open) return null;

  const widths = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" };

  return (
    <dialog
      ref={ref}
      className={cx(
        "tk-dialog fixed inset-0 m-0 h-full w-full",
        "hidden open:flex items-end justify-center sm:items-center",
      )}
      aria-labelledby="tk-modal-title"
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onCloseRef.current();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      <div
        className={cx(
          "relative flex w-full flex-col bg-surface shadow-pop",
          "max-h-[92dvh] rounded-t-3xl sm:rounded-2xl sm:mx-4",
          "[animation:tk-sheet-up_220ms_ease-out_both] sm:[animation:tk-pop_200ms_ease-out_both]",
          widths[size],
        )}
      >
        <div className="sm:hidden mx-auto mt-2.5 h-1.5 w-11 rounded-full bg-line-strong" aria-hidden />
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 sm:px-6 sm:pt-5 border-b border-line">
          <div className="min-w-0">
            <h2 id="tk-modal-title" className="text-[1.1rem] font-bold text-ink leading-snug">
              {title}
            </h2>
            {description && <div className="mt-1 text-[0.85rem] text-ink-3">{description}</div>}
          </div>
          {dismissible && (
            <button type="button" onClick={onClose} className="press -mr-1 grid size-10 shrink-0 place-items-center rounded-xl text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="닫기">
              <X size={20} />
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6 scroll-thin">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5 sm:px-6 pb-[max(0.875rem,env(safe-area-inset-bottom))]">{footer}</footer>}
      </div>
    </dialog>
  );
}
