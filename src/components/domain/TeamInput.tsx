"use client";

/**
 * 노무비·외주비의 팀 고르기 (D-81) — 그 현장 작업 인원(출력)에 나온 팀 (외주비는 외주 팀만).
 * 출력에 없는 이름이면 바로 알린다 — 오타가 팀별 비교에서 조용히 빠지던 문제 (D-81 점검). 비우면 ‘팀 미지정’.
 */
import type { CostCategory, DemoDB } from "@/lib/domain/types";
import { siteTeams, teamKey } from "@/lib/domain/labor";
import { Field, inputCls } from "@/components/ui/primitives";

export function TeamInput({ db, siteId, id, value, onChange, hint, category = "labor" }: { db: DemoDB; siteId: string; id: string; value: string; onChange: (v: string) => void; hint?: string; category?: CostCategory }) {
  const all = siteTeams(db, siteId, (db.settings?.teamRates ?? []).map((t) => t.team));
  const options = category === "subcontract" ? all.filter((t) => t.kind === "subcontract") : all;
  const v = value.trim();
  const known = !v || options.some((t) => teamKey(t.team) === teamKey(v));
  const directOnSub = category === "subcontract" && v && all.some((t) => t.kind === "direct" && teamKey(t.team) === teamKey(v));
  const warn = known
    ? undefined
    : directOnSub
      ? `‘${v}’은 직영 팀입니다 — 외주비는 외주 팀에만 붙여야 팀별 비교에 들어갑니다`
      : `‘${v}’은 이 현장 작업 인원(출력)에 없는 팀 이름입니다 — 팀별 비교에 들어가지 않습니다. 오타인지 확인하세요${options.length ? ` (있는 팀: ${options.map((t) => t.team).join(", ")})` : ""}`;
  return (
    <Field label="팀 (어느 팀 몫인지)" htmlFor={id} hint={warn ? undefined : (hint ?? (category === "subcontract" ? "외주 팀 이름과 같게 — 크레인·폐기물처럼 출력에 없는 업체 외주비는 비워 두세요" : "작업 인원(출력)의 팀 이름과 같게 — 월 마감 노무 정산이 팀별로 맞춰집니다. 모르면 비워 두세요"))}>
      <input id={id} list={`${id}-list`} value={value} maxLength={40} onChange={(e) => onChange(e.target.value)} className={inputCls} placeholder={options[0] ? `예) ${options[0].team}` : "예) 창호1팀"} aria-describedby={warn ? `${id}-warn` : undefined} data-testid={id} />
      <datalist id={`${id}-list`}>
        {options.map((t) => (
          <option key={t.team} value={t.team} />
        ))}
      </datalist>
      {warn && (
        <span id={`${id}-warn`} className="mt-1 block text-[0.78rem] font-semibold text-warn" data-testid={`${id}-warn`}>
          {warn}
        </span>
      )}
    </Field>
  );
}
