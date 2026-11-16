"use client";

/**
 * 같은 시간 두 현장 정리 (D-80) — 겹친 날을 한 표에서 보고, 앞 현장 퇴근을 다음 현장 출근 시각(바꿀 수 있음)으로 한 번에 정정.
 * D-79 공무 점검: 김도윤 겹침 11일을 출퇴근 현황에서 하루씩 11번 고쳤다(마감 시간의 큰 몫).
 * 정리안은 ‘앞 현장에서 퇴근을 늦게 누른 경우’ 기준이다 — 뒤 기록이 앞 기록 안에 다 들어가 있으면 그 뒤 시간이 빠진다고 보여 준다.
 */
import { useMemo, useState } from "react";
import type { AttendanceRecord, DemoDB } from "@/lib/domain/types";
import { hhmm, minutesOf, overlapPairs, type OverlapPair } from "@/lib/domain/attendance";
import { todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { run } from "@/lib/data/store";
import { Button, EmptyState, Field, Notice, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

const short = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const hours = (m: number) => `${(m / 60).toFixed(1)}시간`;
/** 한국 날짜 + "HH:MM" → ISO */
const at = (date: string, hm: string) => new Date(`${date}T${hm}:00+09:00`).toISOString();

type Mode = "cut" | "attach";
const GEO_WORD: Record<string, string> = { inside: "현장 안", outside: "현장 밖", weak: "위치 불확실", none: "위치 없음", nosite: "현장 위치 미등록" };

export function OverlapFixModal({ db, from, to, userId, onClose }: { db: DemoDB; from: string; to: string; userId?: string; onClose: () => void }) {
  const toast = useToast();
  const pairs = useMemo(() => overlapPairs(db, from, to, userId), [db, from, to, userId]);
  // 처음 고르는 것: 꼬리가 없으면 ‘빼기’로 고름 · 앞 현장 퇴근이 현장 안(돌아가 일한 근거)이면 ‘다음 현장 퇴근에 붙이기’로 고름(근무시간 유지) ·
  // 근거 없이 꼬리가 빠지는 줄과 직접 확인할 줄은 고르지 않음 (D-80 공무·현장 점검: 두 번 센 44.0h인데 51.8h가 빠짐)
  const [checked, setChecked] = useState<Record<number, boolean>>(() => Object.fromEntries(pairs.map((p, i) => [i, !p.manual && (p.tailLostMin === 0 || p.returned)])));
  const [modes, setModes] = useState<Record<number, Mode>>(() => Object.fromEntries(pairs.map((p, i) => [i, p.returned ? "attach" : "cut"])));
  const [times, setTimes] = useState<Record<number, string>>(() => Object.fromEntries(pairs.map((p, i) => [i, hhmm(p.proposeOutAt)])));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => uid("idem"));
  const name = (id: string) => db.users.find((u) => u.id === id)?.name ?? "알 수 없음";
  const site = (id: string) => db.sites.find((s) => s.id === id)?.shortName ?? "";
  const mins = (a: string, b?: string) => (b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000)) : 0);

  // 줄마다 확인 — 시각을 지웠거나, 출근보다 이르거나, 원래 퇴근보다 늦으면 저장하지 않는다 (조용히 빠지지 않게 · 버그 배시 m4)
  const rowError = (p: OverlapPair, i: number): string | null => {
    if (!checked[i]) return null;
    const t = times[i] ?? "";
    if (!/^\d{2}:\d{2}$/.test(t)) return "시각을 넣어 주세요";
    const outAt = at(todayIso(new Date(p.proposeOutAt)), t);
    if (outAt <= p.earlier.inAt) return "앞 현장 출근보다 이릅니다";
    if (p.earlier.outAt && outAt >= p.earlier.outAt) return "원래 퇴근보다 늦습니다";
    return null;
  };

  // 기록마다 새 퇴근 (같은 앞 기록이 여러 번 겹치면 가장 이른 시각 · 붙이기면 다음 현장 퇴근을 앞 현장 원래 퇴근으로)
  const plan = useMemo(() => {
    const m = new Map<string, { rec: AttendanceRecord; outAt: string }>();
    let dup = 0;
    pairs.forEach((p, i) => {
      if (!checked[i] || rowError(p, i)) return;
      const outAt = at(todayIso(new Date(p.proposeOutAt)), times[i]);
      const cur = m.get(p.earlier.id);
      if (!cur || outAt < cur.outAt) m.set(p.earlier.id, { rec: p.earlier, outAt });
      dup += p.minutes;
      if (modes[i] === "attach" && p.tailLostMin > 0 && p.earlier.outAt) {
        const ext = m.get(p.later.id);
        if (!ext || p.earlier.outAt > ext.outAt) m.set(p.later.id, { rec: p.later, outAt: p.earlier.outAt });
      }
    });
    return { items: [...m.values()], dup };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs, checked, times, modes]);
  const errs = pairs.map((p, i) => rowError(p, i));
  const bad = errs.filter(Boolean).length;
  const before = plan.items.reduce((a, x) => a + (minutesOf(x.rec) ?? 0), 0);
  const after = plan.items.reduce((a, x) => a + mins(x.rec.inAt, x.outAt), 0);
  const dup = Math.min(plan.dup, Math.max(0, before - after));
  const extra = Math.max(0, before - after - dup);
  const touched = plan.items.length;

  const save = async () => {
    if (busy || touched === 0 || bad || note.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const r = await run("correctAttendanceBatch", {
        items: plan.items.map((x) => ({ attendanceId: x.rec.id, outAt: x.outAt, expect: { inAt: x.rec.inAt, outAt: x.rec.outAt ?? null } })),
        note,
        idempotencyKey: key,
      });
      toast.push({ tone: "ok", title: `${r.corrected}건 정리했습니다 (이력에 남음)`, desc: `고친 기록 근무시간 ${hours(before)} → ${hours(after)} · 현장 직원 휴대폰에 알림` });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "정리하지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`같은 시간 두 현장 정리${userId ? ` · ${name(userId)}` : ""}`}
      description={`${short(from)} ~ ${short(to)} · 같은 사람이 같은 시간에 두 현장에 출근해 있으면 근무시간이 두 번 셈해집니다. 앞 현장 퇴근을 다음 현장 출근 시각으로 고치는 안을 채웠습니다 — 이동 시간이 있었으면 시각을 바꾸세요. 한 건이라도 저장되지 않으면 아무것도 바뀌지 않습니다.`}
      size="xl"
      testId="overlap-fix"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={save} loading={busy} disabled={touched === 0 || bad > 0 || note.trim().length < 2} data-testid="overlap-save">
            {touched ? `${new Set(pairs.filter((_, i) => checked[i] && !errs[i]).map((p) => `${p.userId}|${p.workDate}`)).size}일 · 기록 ${touched}건 한 번에 정정` : "정정할 것 없음"}
          </Button>
        </>
      }
    >
      {pairs.length === 0 ? (
        <EmptyState title="이 기간에 시간이 겹치는 기록이 없습니다" />
      ) : (
        <div className="space-y-4">
          {pairs.some((p) => p.tailLostMin > 0) && (
            <Notice tone="info" title="다음 현장이 먼저 끝난 날">
              앞 현장 퇴근이 다음 현장 퇴근보다 늦은 날은 ‘꼬리’가 있습니다. 앞 현장 퇴근이 <b>현장 안</b>에서 찍혔으면 돌아가 일한 것으로 보고 <b>다음 현장 퇴근에 붙이기</b>(근무시간 유지)를 골라 두었습니다. 위치 근거가 없는 날은 고르지 않았으니 사람에게 확인하세요.
            </Notice>
          )}
          <div className="@container">
            <div tabIndex={0} role="region" aria-label="겹친 기록 표 (가로 스크롤)" className="overflow-x-auto rounded-xl border border-line">
              <table className="stack-table w-full min-w-[48rem] text-[0.84rem]">
                <thead>
                  <tr className="text-left text-[0.74rem] text-ink-3">
                    {["정리", "날짜", "앞 현장 (지금)", "다음 현장", "겹침", "앞 현장 새 퇴근"].map((h) => (
                      <th key={h} className="px-3 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((p, i) => (
                    <tr key={i} className={cx("border-t border-line align-top", !checked[i] && "opacity-60")} data-testid="overlap-row" data-manual={p.manual ? "1" : "0"}>
                      <td className="px-3 py-2.5" data-label="정리">
                        <input type="checkbox" className="size-5" aria-label={`${short(p.workDate)} ${name(p.userId)} 정리`} checked={!!checked[i]} onChange={(e) => setChecked({ ...checked, [i]: e.target.checked })} />
                      </td>
                      <td className="px-3 py-2.5 num" data-label="날짜">
                        {short(p.workDate)}
                        {!userId && <span className="block font-sans text-[0.76rem] font-semibold text-ink-2">{name(p.userId)}</span>}
                      </td>
                      <td className="px-3 py-2.5" data-label="앞 현장 (지금)">
                        <b>{site(p.earlier.siteId)}</b> <span className="num">{hhmm(p.earlier.inAt)}~{p.earlier.outAt ? hhmm(p.earlier.outAt) : "—"}</span>
                        {p.earlier.outGeo && <span className={cx("ml-1 rounded px-1 text-[0.72rem] font-bold", p.earlier.outGeo.status === "inside" ? "bg-ok-bg text-ok" : "bg-surface-3 text-ink-2")}>퇴근 {GEO_WORD[p.earlier.outGeo.status] ?? ""}</span>}
                      </td>
                      <td className="px-3 py-2.5" data-label="다음 현장">
                        <b>{site(p.later.siteId)}</b> <span className="num">{hhmm(p.later.inAt)}~{p.later.outAt ? hhmm(p.later.outAt) : "퇴근 없음"}</span>
                      </td>
                      <td className="px-3 py-2.5 num font-semibold text-warn" data-label="겹침">
                        {p.minutes < 1 ? "1분 미만" : `${p.minutes}분`}
                      </td>
                      <td className="stack-full px-3 py-2" data-label="앞 현장 새 퇴근">
                        <input type="time" aria-label={`${short(p.workDate)} 앞 현장 새 퇴근`} className={cx(inputCls, "num h-10 w-32 py-1", errs[i] && "border-err")} value={times[i] ?? ""} onChange={(e) => setTimes({ ...times, [i]: e.target.value })} disabled={!checked[i]} />
                        {errs[i] && <span className="mt-1 block text-[0.74rem] font-semibold text-err" data-testid="overlap-row-error">{errs[i]}</span>}
                        {p.manual && <span className="mt-1 block text-[0.74rem] font-semibold text-warn">직접 확인 — {p.later.outAt ? "두 기록이 같은 시각에 시작" : "다음 현장 퇴근 기록이 없음"}</span>}
                        {!p.manual && p.tailLostMin > 0 && (
                          <label className="mt-1 flex items-center gap-1.5 text-[0.76rem] text-ink-2">
                            <span className="shrink-0">꼬리 {p.tailLostMin}분 ({hhmm(p.later.outAt!)}~{hhmm(p.earlier.outAt!)}):</span>
                            <select className="h-9 min-w-0 rounded-lg border border-line-strong bg-surface px-2 text-[0.8rem] font-semibold text-ink" value={modes[i]} onChange={(e) => setModes({ ...modes, [i]: e.target.value as Mode })} disabled={!checked[i]} aria-label={`${short(p.workDate)} 꼬리 처리`}>
                              <option value="attach">다음 현장 퇴근에 붙이기 (근무시간 유지)</option>
                              <option value="cut">빼기</option>
                            </select>
                          </label>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {touched > 0 && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-[0.84rem] text-ink-2" data-testid="overlap-effect">
              고치는 기록 {touched}건의 근무시간 {hours(before)} → <b className="text-ink">{hours(after)}</b>: 두 번 세던 겹침 <b className="text-ink">{hours(dup)}</b> 빠짐
              {extra > 0 && (
                <>
                  {" "}
                  · 그 밖에 <b className="text-warn">{hours(extra)}</b> 더 빠짐 (꼬리 빼기·이동 시간)
                </>
              )}
              . 위치 기록은 바뀌지 않고, 처음 누른 시각과 사유가 이력에 남으며 현장 직원 휴대폰에 알림이 갑니다.
            </p>
          )}
          <Field label="정정 사유 (모든 건에 같이 남음)" htmlFor="ov-note" required>
            <input id="ov-note" className={inputCls} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="예) 오전 동탄·오후 판교 — 동탄 퇴근을 늦게 누름 (반장 확인)" data-testid="overlap-note" />
          </Field>
          {error && <Notice tone="err" title={error} />}
        </div>
      )}
    </Modal>
  );
}
