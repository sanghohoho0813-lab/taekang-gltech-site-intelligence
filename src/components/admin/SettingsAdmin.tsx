"use client";

/** 운영 관리 · 운영 설정 — 현장 원가 반영 방식, 기본 일당, 회사명 */
import Link from "next/link";
import { useState } from "react";
import type { DemoDB } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { run } from "@/lib/data/store";
import { CommandError } from "@/lib/data/commands";
import { Button, Card, CardHeader, Field, cx, inputCls } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { MoneyField, toWon, wonText } from "./inputs";

export function SettingsAdmin({ db }: { db: DemoDB }) {
  const toast = useToast();
  const s = db.settings ?? DEFAULT_SETTINGS;
  const [approval, setApproval] = useState(s.costApproval);
  const [rate, setRate] = useState(wonText(s.laborDayRate));
  const [name, setName] = useState(db.company.name);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await run("setCompanySettings", { costApproval: approval, laborDayRate: toWon(rate), companyName: name });
      setErrors({});
      toast.push({ tone: "ok", title: "운영 설정을 저장했습니다" });
    } catch (e) {
      if (e instanceof CommandError) setErrors(e.fieldErrors);
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "저장 실패" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-testid="admin-settings">
      <CardHeader title="운영 설정" sub="회사 업무 방식에 맞춰 바꿉니다 — 바꾼 내용은 활동 이력에 남습니다" />
      <div className="space-y-5 px-5 pb-5">
        <fieldset>
          <legend className="mb-2 text-[0.9rem] font-bold">현장 입력 원가 반영 방식</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["immediate", "저장 즉시 반영", "현장소장이 저장하면 대표 손익이 바로 바뀝니다. 빠르지만 오입력도 바로 보입니다."],
                ["review", "본사 공무 확인 후 반영", "현장 입력은 ‘확인 대기’로 저장되고, 공무가 견적·세금계산서로 금액을 확정하면 반영됩니다."],
              ] as const
            ).map(([v, t, d]) => (
              <label key={v} className={cx("press cursor-pointer rounded-xl border px-3.5 py-3 text-[0.84rem]", approval === v ? "border-active bg-active-soft" : "border-line hover:bg-surface-2")}>
                <input type="radio" name="approval" className="sr-only" checked={approval === v} onChange={() => setApproval(v)} data-testid={`approval-${v}`} />
                <span className="block font-bold">{t}</span>
                <span className="block text-[0.76rem] text-ink-3">{d}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyField id="set-rate" label="노무 공수 기본 일당 (원)" value={rate} onChange={setRate} error={errors.laborDayRate} hint="현장 보고에서 ‘공수로 입력’할 때 기본값 (현장에서 바꿀 수 있음)" />
          <Field label="회사명" htmlFor="set-name" error={errors.companyName}>
            <input id="set-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.8rem] text-ink-3">
            위험 판단 기준(이익률 하락·예산 초과·장기 미수)은{" "}
            <Link href="/settings" className="font-semibold text-theme-ink underline">
              설정
            </Link>
            에서 바꿉니다.
          </p>
          <Button variant="cta" onClick={save} loading={busy} data-testid="settings-save">
            저장
          </Button>
        </div>
      </div>
    </Card>
  );
}
