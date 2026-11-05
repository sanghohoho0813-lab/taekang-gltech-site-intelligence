"use client";

/**
 * 내 정보 → 내 위치 기록 (직원 본인 열람·동의 그만두기 · D-43)
 * - 동의 상태, 회사가 정한 보관 기간·볼 수 있는 사람
 * - 내가 남긴 위치 기록 (출근·퇴근·보고·작업 인원) — 좌표가 남은 것은 지도로 확인
 * - ‘위치 기록 그만두기’: 동의를 그만두고 남은 내 좌표를 바로 지운다. 출퇴근은 그대로 할 수 있다.
 */
import { useState } from "react";
import { MapPin, ShieldCheck, ShieldOff } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { run } from "@/lib/data/store";
import { scrubQueuedLocation } from "@/lib/browser/outbox";
import { CommandError } from "@/lib/data/commands";
import { IS_LIVE } from "@/lib/mode";
import { GEO_LABEL, mapLink } from "@/lib/domain/geo";
import { fmtDateTime } from "@/lib/domain/format";
import { consentState, hasCoords, locationPolicy, myLocationRows, retentionText, viewersText } from "@/lib/domain/privacy";
import { cx } from "@/components/ui/primitives";

const SHOW = 5;

export function MyLocationCard() {
  const { db, userId } = useMe();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [all, setAll] = useState(false);
  if (!db) return null;
  const policy = locationPolicy(db);
  const { state, consent } = consentState(db, userId);
  const rows = myLocationRows(db, userId);
  const shown = all ? rows : rows.slice(0, SHOW);
  const site = (id: string) => db.sites.find((s) => s.id === id)?.shortName ?? "현장";

  const withdraw = async () => {
    setBusy(true);
    try {
      const r = await run("withdrawLocationConsent", {});
      // 휴대폰에 저장해 둔(아직 못 보낸) 출퇴근의 좌표·동의도 지운다
      if (IS_LIVE) await scrubQueuedLocation(userId);
      setMsg({ ok: true, text: `위치 기록을 그만뒀어요. 남아 있던 내 위치 좌표 ${r.count}건을 지웠어요.` });
      setAsk(false);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof CommandError ? e.message : "처리하지 못했어요. 잠시 뒤 다시 해 주세요." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="myloc-title" data-testid="my-location">
      <h2 id="myloc-title" className="flex items-center gap-2 text-[1.3rem] font-extrabold">
        <MapPin size={22} aria-hidden /> 내 위치 기록
      </h2>

      <div className={cx("rounded-2xl border-2 px-4 py-3", state === "agreed" ? "border-ok/40 bg-ok-bg" : "border-line bg-surface-2")} data-testid="my-location-state" data-state={state}>
        <p className="flex items-center gap-2 text-[1.12rem] font-bold">
          {state === "agreed" ? <ShieldCheck size={22} className="text-ok" aria-hidden /> : <ShieldOff size={22} className="text-ink-3" aria-hidden />}
          {state === "agreed" ? "위치 기록에 동의했어요" : state === "outdated" ? "회사 조건이 바뀌어 다음 출근 때 다시 여쭤봐요" : "위치 기록에 동의하지 않았어요"}
        </p>
        {consent && <p className="mt-0.5 text-[1rem] text-ink-2">동의한 때: {fmtDateTime(consent.at)}</p>}
        {state === "none" && <p className="mt-0.5 text-[1rem] text-ink-2">출퇴근은 그대로 되고, 본사에는 ‘위치 없음’으로 보여요.</p>}
      </div>

      <dl className="grid gap-1 text-[1.02rem]">
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-ink-2">보관</dt>
          <dd>{policy.retentionDays == null ? "회사가 정하는 기간 (정해지면 알려드려요)" : `${retentionText(policy.retentionDays)} 지나면 좌표 자동 삭제`}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-ink-2">보는 사람</dt>
          <dd>본사 {viewersText(policy.viewers)}, 그리고 나</dd>
        </div>
      </dl>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[1.02rem] text-ink-2">아직 남은 위치 기록이 없어요.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border-2 border-line bg-surface" data-testid="my-location-rows">
          {shown.map((r) => (
            <li key={r.key} className="flex min-h-14 items-center gap-2 px-4 py-2 text-[1.02rem]" data-testid="my-location-row">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {r.kind} · {site(r.siteId)}
                </span>
                <span className="num block text-[0.95rem] text-ink-2">
                  {fmtDateTime(r.at)} · {GEO_LABEL[r.geo.status]}
                  {r.geo.purged ? " · 좌표 지움" : ""}
                </span>
              </span>
              {hasCoords(r.geo) && r.geo.lat !== undefined && r.geo.lng !== undefined && (
                <a href={mapLink(r.geo.lat, r.geo.lng, `${r.kind} 위치`)} target="_blank" rel="noreferrer noopener" className="press inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border-2 border-line-strong px-3 font-bold">
                  지도
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.length > SHOW && (
        <button type="button" onClick={() => setAll(!all)} className="press min-h-12 w-full rounded-2xl border-2 border-line bg-surface text-[1.05rem] font-bold" data-testid="my-location-more">
          {all ? "접기" : `${rows.length - SHOW}건 더 보기`}
        </button>
      )}
      {IS_LIVE && <p className="text-[0.95rem] text-ink-3">이 휴대폰에는 최근 60일 기록만 보여요. 그 전 기록은 본사에 요청하세요.</p>}

      {msg && (
        <p role="status" className={cx("rounded-2xl px-4 py-3 text-[1.05rem] font-semibold", msg.ok ? "bg-ok-bg" : "bg-err-bg")} data-testid="my-location-msg">
          {msg.text}
        </p>
      )}

      {consent &&
        (ask ? (
          <div className="rounded-2xl border-2 border-err/40 bg-err-bg p-4" role="alertdialog" aria-label="위치 기록 그만두기 확인">
            <p className="text-[1.1rem] font-bold">위치 기록을 그만둘까요?</p>
            <p className="mt-1 text-[1.02rem]">남아 있는 내 위치 좌표를 바로 지워요. 출퇴근은 그대로 할 수 있고, 본사에는 ‘위치 없음’으로 보여요. 나중에 다시 동의할 수 있어요.</p>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <button type="button" onClick={() => setAsk(false)} className="press min-h-[3.6rem] rounded-2xl border-2 border-line-strong bg-surface text-[1.1rem] font-bold">
                아니요
              </button>
              <button type="button" onClick={() => void withdraw()} disabled={busy} className="press min-h-[3.6rem] rounded-2xl bg-err text-[1.1rem] font-bold text-white disabled:opacity-60" data-testid="my-location-withdraw-yes">
                {busy ? "지우는 중…" : "네, 그만두기"}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => { setMsg(null); setAsk(true); }} className="press flex min-h-[3.8rem] w-full items-center gap-3 rounded-2xl border-2 border-line-strong bg-surface px-4 text-left text-[1.1rem] font-bold" data-testid="my-location-withdraw">
            <ShieldOff size={22} aria-hidden /> 위치 기록 그만두기
          </button>
        ))}
    </section>
  );
}
