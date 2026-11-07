"use client";

/**
 * 하자보증 (D-70) — 현장별 보증 기간(계약서 기준)과 준공일. 본사만 고친다.
 * 법정 기간을 대신 정하지 않는다: 계약서의 하자담보책임기간을 그대로 넣게 안내한다. 금액(보증금·증권 금액)은 넣지 않는다.
 */
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { run } from "@/lib/data/store";
import { useMe } from "@/lib/data/hooks";
import { errorMessage } from "@/lib/data/commands";
import { fmtDate, todayIso } from "@/lib/domain/format";
import type { Site } from "@/lib/domain/types";
import { WARRANTY_LABEL, monthsText, warrantyStatus, type WarrantyState } from "@/lib/domain/warranty";
import { Badge, Button, Card, CardHeader, Field, Notice, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export const WARRANTY_TONE: Record<WarrantyState, "neutral" | "info" | "ok" | "warn" | "err"> = { none: "neutral", pending: "info", active: "ok", soon: "warn", expired: "neutral" };

/** 한 줄 요약 — “보증 중 · 2028.11.29까지 (D-752)” */
export function warrantyLine(site: Pick<Site, "warranty">, today: string): string {
  const w = warrantyStatus(site, today);
  if (w.state === "none") return "하자보증 기간 미입력";
  if (w.state === "pending") return `준공 후 ${monthsText(w.months!)} (준공일 입력 전)`;
  if (w.state === "expired") return `보증 끝남 · ${fmtDate(w.endDate!)}까지였음`;
  return `${WARRANTY_LABEL[w.state]} · ${fmtDate(w.endDate!)}까지 (${w.daysLeft === 0 ? "오늘 만료" : `${w.daysLeft}일 남음`})`;
}

export function WarrantyCard({ site, compact = false }: { site: Site; compact?: boolean }) {
  const { role } = useMe();
  const [edit, setEdit] = useState(false);
  const today = todayIso();
  const w = warrantyStatus(site, today);
  const hq = role === "ceo" || role === "manager";
  return (
    <Card data-testid="warranty-card" data-state={w.state}>
      <CardHeader
        title="하자보증"
        sub="계약서의 하자담보책임기간 기준 · 금액은 넣지 않습니다"
        right={
          hq ? (
            <Button size="sm" variant="soft" icon={<ShieldCheck size={15} />} onClick={() => setEdit(true)} data-testid="warranty-edit">
              {site.warranty ? "고치기" : "보증 기간 넣기"}
            </Button>
          ) : undefined
        }
      />
      <div className={cx("px-5 pb-4 text-[0.88rem]", compact && "pb-3")}>
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={WARRANTY_TONE[w.state]} data-testid="warranty-state">{WARRANTY_LABEL[w.state]}</Badge>
          <span className="num font-semibold text-ink" data-testid="warranty-line">{warrantyLine(site, today)}</span>
        </p>
        {w.startDate && (
          <p className="num mt-1 text-[0.8rem] text-ink-3">
            준공 {fmtDate(w.startDate)} · 보증 {monthsText(w.months!)} → {fmtDate(w.endDate!)}까지
          </p>
        )}
        {w.state === "soon" && <p className="mt-1.5 text-[0.8rem] font-semibold text-warn">만료 전에 발주처와 함께 최종 점검하고 남은 하자를 정리하세요.</p>}
        {w.state === "pending" && hq && <p className="mt-1.5 text-[0.8rem] text-ink-3">준공(인도)하면 준공일을 넣으세요. 그날부터 보증 기간을 셉니다.</p>}
        {w.state === "none" && hq && <p className="mt-1.5 text-[0.8rem] text-ink-3">계약서의 하자담보책임기간을 넣어 두면 하자 요청이 보증 기간 안인지 바로 보입니다.</p>}
        {hq && site.warranty?.note && <p className="mt-1.5 text-[0.8rem] text-ink-2">메모(내부): {site.warranty.note}</p>}
      </div>
      {edit && <WarrantyModal site={site} onClose={() => setEdit(false)} />}
    </Card>
  );
}

function WarrantyModal({ site, onClose }: { site: Site; onClose: () => void }) {
  const toast = useToast();
  const [months, setMonths] = useState(String(site.warranty?.months ?? ""));
  const [completed, setCompleted] = useState(site.warranty?.completedDate ?? "");
  const [note, setNote] = useState(site.warranty?.note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async (clear = false) => {
    setBusy(true);
    try {
      await run("setSiteWarranty", clear ? { siteId: site.id, clear: true } : { siteId: site.id, months: Number(months), completedDate: completed || undefined, note });
      toast.push({ tone: "ok", title: clear ? "하자보증 정보를 지웠습니다" : "하자보증을 저장했습니다" });
      onClose();
    } catch (e) {
      const fe = (e as { fieldErrors?: Record<string, string> }).fieldErrors;
      if (fe && Object.keys(fe).length) setErrors(fe);
      else toast.push({ tone: "err", title: errorMessage(e, "저장하지 못했습니다.") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="하자보증 기간"
      description={site.name}
      size="md"
      testId="warranty-modal"
      footer={
        <>
          {site.warranty && (
            <Button variant="ghost" disabled={busy} onClick={() => save(true)} data-testid="warranty-clear">
              지우기
            </Button>
          )}
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" disabled={busy} onClick={() => save(false)} data-testid="warranty-save">
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Notice tone="info">기간은 계약서(하자담보책임기간·하자보수보증서)에 적힌 대로 넣으세요. 공종별 법정 기간은 이 화면이 정하지 않습니다.</Notice>
        <Field label="보증 기간 (개월)" htmlFor="w-months" required error={errors.months}>
          <div className="flex flex-wrap items-center gap-2">
            <input id="w-months" inputMode="numeric" className={cx(inputCls, "num w-28")} value={months} onChange={(e) => setMonths(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} data-testid="warranty-months" />
            {[12, 24, 36].map((m) => (
              <button key={m} type="button" onClick={() => setMonths(String(m))} className={cx("press min-h-11 rounded-xl border px-3 text-[0.84rem] font-bold", months === String(m) ? "border-active bg-active-soft text-theme-ink" : "border-line")}>
                {monthsText(m)}
              </button>
            ))}
          </div>
        </Field>
        <Field label="준공(인도)일 — 보증 시작" htmlFor="w-completed" error={errors.completedDate} hint="아직 준공 전이면 비워 두세요.">
          <input id="w-completed" type="date" max={todayIso()} min={site.startDate} className={inputCls} value={completed} onChange={(e) => setCompleted(e.target.value)} data-testid="warranty-completed" />
        </Field>
        <Field label="메모 (본사만 봄 · 선택)" htmlFor="w-note" error={errors.note} counter={`${note.length}/80`}>
          <input id="w-note" className={inputCls} maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예) 계약서 제12조 · 보증서 번호" />
        </Field>
      </div>
    </Modal>
  );
}
