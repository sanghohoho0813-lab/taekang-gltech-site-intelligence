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
 * 창을 닫으며 되돌린 기록(history.back)이 아직 끝나지 않았음 — 그 사이에 열린 다음 창이 그 ‘뒤로’를 사용자의 뒤로로 알고
 * 바로 닫히던 문제 (예: ‘남은 보수 확인’ → ‘보수 완료 회신 쓰기’ · 점검 12차). 다음 창은 이것이 끝난 뒤에 기록을 쌓는다.
 */
let pendingBack: Promise<void> | null = null;
function backAndWait() {
  const done = new Promise<void>((resolve) => {
    const finish = () => {
      window.removeEventListener("popstate", finish);
      window.clearTimeout(t);
      resolve();
    };
    const t = window.setTimeout(finish, 500);
    window.addEventListener("popstate", finish);
  });
  const mine = done.then(() => {
    if (pendingBack === mine) pendingBack = null;
  });
  pendingBack = mine;
  window.history.back();
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

  const dismissRef = useRef(dismissible);
  dismissRef.current = dismissible;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      d.showModal();
      lock();
      // 휴대폰 ‘뒤로’ = 창 닫기 (D-67 점검 반영) — 창을 열 때 같은 주소로 기록을 하나 쌓고, 뒤로가 오면 창만 닫는다.
      // 버튼·Esc로 닫으면 쌓은 기록을 되돌린다(그 사이 다른 화면으로 이동했으면 건드리지 않음).
      const id = `m${Math.random().toString(36).slice(2, 9)}`;
      let popped = false;
      let started = false;
      let gone = false;
      const onPop = () => {
        if (popped) return;
        // 위에 열렸던 창(사진 크게 보기 등)이 닫히며 내 기록으로 돌아온 것 — 나는 닫지 않는다 (함께 닫혀 입력이 사라지던 문제 · D-68 점검 반영)
        if ((window.history.state as { __modal?: string } | null)?.__modal === id) return;
        popped = true;
        if (dismissRef.current) onCloseRef.current();
        else {
          popped = false;
          window.history.pushState({ __modal: id }, "", window.location.href);
        }
      };
      const start = () => {
        if (gone) return;
        started = true;
        window.history.pushState({ __modal: id }, "", window.location.href);
        window.addEventListener("popstate", onPop);
      };
      // 앞 창이 닫히며 되돌리는 중이면 그것이 끝난 뒤에 (바로 쌓으면 그 ‘뒤로’에 이 창이 닫힌다)
      if (pendingBack) void pendingBack.then(start);
      else start();
      return () => {
        gone = true;
        window.removeEventListener("popstate", onPop);
        if (started && !popped && (window.history.state as { __modal?: string } | null)?.__modal === id) backAndWait();
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
        // 창 안에 연 창(사진 크게 보기 등)의 Esc는 그 창만 닫는다 — 바깥 창까지 닫혀 적던 글이 사라지던 문제 (점검 11차)
        if (e.target !== e.currentTarget) return;
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
