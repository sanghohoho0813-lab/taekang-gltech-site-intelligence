"use client";

/** 노무비·외주비의 팀 고르기 (D-81) — 그 현장 작업 인원(출력)에 나온 팀 + 회사 팀 단가의 팀. 비우면 ‘팀 미지정’ */
import type { DemoDB } from "@/lib/domain/types";
import { siteTeams } from "@/lib/domain/labor";
import { Field, inputCls } from "@/components/ui/primitives";

export function TeamInput({ db, siteId, id, value, onChange, hint }: { db: DemoDB; siteId: string; id: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const options = siteTeams(db, siteId, (db.settings?.teamRates ?? []).map((t) => t.team));
  return (
    <Field label="팀 (어느 팀 몫인지)" htmlFor={id} hint={hint ?? "작업 인원(출력)의 팀 이름과 같게 — 월 마감 노무 정산이 팀별로 맞춰집니다. 모르면 비워 두세요"}>
      <input id={id} list={`${id}-list`} value={value} maxLength={40} onChange={(e) => onChange(e.target.value)} className={inputCls} placeholder={options[0] ? `예) ${options[0].team}` : "예) 창호1팀"} data-testid={id} />
      <datalist id={`${id}-list`}>
        {options.map((t) => (
          <option key={t.team} value={t.team} />
        ))}
      </datalist>
    </Field>
  );
}
