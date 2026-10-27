"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Monitor, Smartphone, Columns2, RotateCcw, Presentation, Handshake, LayoutDashboard } from "lucide-react";
import { resetDemo, setPrefs, usePrefs, type DeviceView } from "@/lib/data/store";
import { ROLE_LABEL } from "@/lib/domain/labels";
import type { RoleId } from "@/lib/domain/types";
import { canAccess, homeFor } from "@/lib/nav";
import { Button, cx } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useTour } from "@/components/tour/Tour";

/**
 * Hybrid Demo Control Bar (마스터 v1.1 HYBRID DEMO CONTROL LAYER)
 * 제품 Navigation과 분리된 얇은 상단 바 — Device View·Surface 전환·역할 프리뷰·시연·초기화.
 * Frame(iframe) 안과 1024px 미만에서는 표시하지 않는다.
 */
export function DemoBar({ active }: { active: boolean }) {
  const prefs = usePrefs();
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const tour = useTour();
  const [confirm, setConfirm] = useState(false);
  const onPartner = pathname.startsWith("/partner");

  const setDevice = (v: DeviceView) => setPrefs({ deviceView: v });
  const setRole = (r: RoleId) => {
    setPrefs({ role: r });
    if (!canAccess(r, pathname)) router.push(homeFor(r));
  };

  return (
    <div
      className={cx(
        "only-top no-print sticky top-0 z-50 hidden h-[var(--demo-bar-h)] items-center gap-3 border-b border-black/30 bg-[#0E1013] px-3 text-[0.75rem] text-[#D5DAE1] lg:flex",
        !active && "lg:hidden",
      )}
      data-testid="demo-bar"
      role="region"
      aria-label="시연 제어 바"
    >
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#FFF7D6] px-2.5 py-0.5 font-bold text-[#7A5200]">
        <span className="size-1.5 rounded-full bg-[#C98A00]" aria-hidden />
        <span>
          DEMO<span className="hidden min-[1180px]:inline"> · 가상 시연 데이터</span>
        </span>
      </span>
      <span className="hidden whitespace-nowrap font-semibold tracking-[0.06em] text-white/80 min-[1640px]:inline">TAEKANG SITE INTELLIGENCE · 시연용 MVP</span>

      <div className="mx-auto flex shrink-0 items-center gap-1 rounded-xl bg-white/8 p-0.5" role="radiogroup" aria-label="화면 보기 모드 (Device View)" data-testid="device-switch">
        {(
          [
            { v: "pc", label: "PC", I: Monitor },
            { v: "mobile", label: "Mobile", I: Smartphone },
            { v: "dual", label: "PC+Mobile", I: Columns2 },
          ] as const
        ).map(({ v, label, I }) => {
          const on = prefs.deviceView === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setDevice(v)}
              data-testid={`device-${v}`}
              className={cx(
                "press inline-flex h-[1.85rem] items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-bold",
                on ? "bg-white text-[#111] shadow-sm" : "text-white/75 hover:bg-white/10 hover:text-white",
              )}
            >
              <I size={15} aria-hidden /> {label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            if (onPartner) {
              if (prefs.role === "partner") setPrefs({ role: "ceo" });
              router.push("/dashboard");
            } else router.push("/partner");
          }}
          className="press inline-flex h-[1.85rem] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-semibold text-white/85 hover:bg-white/10"
          data-testid="surface-switch"
        >
          {onPartner ? <LayoutDashboard size={15} aria-hidden /> : <Handshake size={15} aria-hidden />}
          {onPartner ? "Business AX 보기" : "발주처 포털 보기"}
        </button>
        <label className="inline-flex shrink-0 items-center gap-1.5">
          <span className="whitespace-nowrap text-white/60">역할</span>
          <select
            value={prefs.role}
            onChange={(e) => setRole(e.target.value as RoleId)}
            className="h-[1.85rem] rounded-lg border border-white/15 bg-white/10 px-2 font-semibold text-white"
            aria-label="Demo 역할 (권한 프리뷰)"
            data-testid="demo-role"
          >
            {(["ceo", "manager", "field", "partner"] as RoleId[]).map((r) => (
              <option key={r} value={r} className="text-ink">
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => (tour.active ? tour.stop() : tour.start("presentation"))}
          data-testid="demo-tour"
          className="press inline-flex h-[1.85rem] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-semibold text-white/85 hover:bg-white/10"
        >
          <Presentation size={15} aria-hidden /> {tour.active ? "시연 종료" : "시연 시작"}
        </button>
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="press inline-flex h-[1.85rem] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-semibold text-white/85 hover:bg-white/10"
          data-testid="demo-reset"
        >
          <RotateCcw size={15} aria-hidden /> 데모 초기화
        </button>
      </div>

      <ResetDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          resetDemo();
          setConfirm(false);
          toast.push({ tone: "ok", title: "데모를 초기 상태로 되돌렸습니다", desc: "A현장: 계약 10억 · EAC 8.5억 · 예상이익 1.5억 · 15%" });
        }}
      />
    </div>
  );
}

export function ResetDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="데모를 초기 상태로 되돌릴까요?"
      size="sm"
      testId="reset-dialog"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={onConfirm} data-testid="reset-confirm" icon={<RotateCcw size={17} />}>
            초기화
          </Button>
        </>
      }
    >
      <p className="text-[0.92rem] text-ink-2">
        시연 중 입력한 현장보고·원가·조치·Proof Event·발주처 요청이 모두 지워지고 가상 시드 데이터(현장 3개)로 돌아갑니다.
      </p>
      <p className="mt-2 text-[0.82rem] text-ink-3">테마·글자 크기·화면 모드 설정은 유지됩니다. 이 작업은 이 브라우저의 DEMO 저장소에만 적용됩니다.</p>
    </Modal>
  );
}
