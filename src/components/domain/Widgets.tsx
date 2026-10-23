"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AlertTriangle, CircleAlert, CircleCheck, Info, Sparkles, Database } from "lucide-react";
import { Badge, Button, cx } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import type { Health } from "@/lib/data/hooks";
import { useDb } from "@/lib/data/store";
import { fmtTime } from "@/lib/domain/format";

export function HealthPill({ health }: { health: Health }) {
  const m = {
    ok: { tone: "ok" as const, t: "정상", I: CircleCheck },
    low: { tone: "info" as const, t: "확인", I: Info },
    medium: { tone: "warn" as const, t: "주의", I: CircleAlert },
    high: { tone: "err" as const, t: "경고", I: AlertTriangle },
  }[health];
  return (
    <Badge tone={m.tone} icon={<m.I size={13} aria-hidden />}>
      {m.t}
    </Badge>
  );
}

export function MethodChip({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[0.68rem] font-bold text-ink-2", className)}>
      규칙 기반 진단 · RULE v1
    </span>
  );
}

export function Freshness({ className }: { className?: string }) {
  const db = useDb();
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[0.75rem] text-ink-3", className)} data-testid="freshness">
      <Database size={13} aria-hidden />
      DEMO · 브라우저 로컬 저장소 · 마지막 업데이트 <span className="num font-semibold text-ink-2">{db ? fmtTime(db.updatedAt, true) : "—"}</span>
    </span>
  );
}

/** AI Ready 마커 — 실제 AI API는 연결되지 않았음을 정직하게 설명 */
export function AiReadyButton({ context = "risk" }: { context?: "risk" | "report" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong bg-surface px-2.5 py-1 text-[0.75rem] font-bold text-ink-2 hover:border-active hover:text-theme-ink"
        data-testid="ai-ready"
      >
        <Sparkles size={14} aria-hidden /> AI 요약 · 연결 예정
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="이 위치에는 AI API가 연결될 예정입니다 (현재 미연결)"
        size="md"
        footer={<Button onClick={() => setOpen(false)}>확인</Button>}
      >
        <div className="space-y-4 text-[0.88rem] text-ink-2">
          <Section title="지금 이 화면은 무엇으로 판단하나요?">
            <p>
              <b>규칙 기반 진단(RULE v1)</b>입니다. 이익률 하락 3%p, 원가항목 예산 5% 초과, 설계변경 원가의 변경공사 미등록, 미수 60일 초과 같은 <b>명확한 기준</b>으로 코드가 계산합니다. 금액·이익률 계산은 AI에 맡기지 않습니다.
            </p>
          </Section>
          <Section title={context === "risk" ? "AI가 들어가면 무엇을 하나요? (1개 기능만)" : "보고서에서 AI의 역할"}>
            <ul className="list-disc space-y-1 pl-5">
              <li>여러 위험 신호와 현장보고 문장을 함께 읽고 <b>대표에게 먼저 말할 3가지</b>를 자연어로 요약</li>
              <li>근거(사용한 데이터·수치)를 함께 표시하고, 실행은 반드시 사람이 승인 (L3)</li>
            </ul>
          </Section>
          <Section title="AI에 보낼 데이터 범위 (예정)">
            <p>현장 약칭·위험 신호 제목·근거 수치·현장보고 요약. 발주처 실명·개인정보·도면은 보내지 않습니다. API Key는 서버에만 보관합니다.</p>
          </Section>
          <Section title="연결 조건">
            <p>대표자 명시 승인 + API Key 제공 + 응답 시간 제한(타임아웃)·오류 시 규칙 기반 결과 유지. 현재 이 MVP는 외부 AI를 호출하지 않습니다.</p>
          </Section>
        </div>
      </Modal>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 font-bold text-ink">{title}</p>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  group = "ops",
  href,
  testId,
  extra,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: ReactNode;
  group?: "ops" | "growth" | "ax" | "admin";
  href?: string;
  testId?: string;
  extra?: ReactNode;
}) {
  const color = `var(--g-${group})`;
  const body = (
    <div className="flex h-full items-start gap-3 p-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${color} 14%, #fff)`, color }} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.8rem] font-semibold text-ink-3">{label}</p>
        <p className="mt-0.5 text-[1.6rem] font-extrabold leading-tight tracking-[-0.01em] text-ink num">{value}</p>
        {sub && <div className="mt-1 text-[0.76rem] text-ink-3">{sub}</div>}
        {extra}
      </div>
    </div>
  );
  const cls = "block rounded-2xl border border-line bg-surface shadow-card";
  return href ? (
    <Link href={href} className={cx(cls, "lift")} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  );
}

export function Delta({ value, format, invert = false, zeroText = "변동 없음" }: { value: number; format: (v: number) => string; invert?: boolean; zeroText?: string }) {
  if (Math.abs(value) < 1e-9) return <span className="text-ink-3">{zeroText}</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={cx("font-bold num", good ? "text-ok" : "text-err")}>
      {value > 0 ? "▲" : "▼"} {format(Math.abs(value))}
    </span>
  );
}
