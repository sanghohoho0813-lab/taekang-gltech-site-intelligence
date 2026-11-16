"use client";

/**
 * 같은 시간 두 현장 정리 (D-80) — 겹친 날을 한 표에서 보고, 앞 현장 퇴근을 다음 현장 출근 시각(바꿀 수 있음)으로 한 번에 정정.
 * D-79 공무 점검: 김도윤 겹침 11일을 출퇴근 현황에서 하루씩 11번 고쳤다(마감 시간의 큰 몫).
 * 정리안은 ‘앞 현장에서 퇴근을 늦게 누른 경우’ 기준이다 — 뒤 기록이 앞 기록 안에 다 들어가 있으면 그 뒤 시간이 빠진다고 보여 준다.
 */
import { useMemo, useState } from "react";
import type { AttendanceRecord, DemoDB } from "@/lib/domain/types";
import { hhmm, minutesOf, overlapPairs } from "@/lib/domain/attendance";
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

export function OverlapFixModal({ db, from, to, userId, onClose }: { db: DemoDB; from: string; to: string; userId?: string; onClose: () => void }) {
  const toast = useToast();
  const pairs = useMemo(() => overlapPairs(db, from, to, userId), [db, from, to, userId]);
  const [checked, setChecked] = useState<Record<number, boolean>>(() => Object.fromEntries(pairs.map((p, i) => [i, !p.manual])));
  const [times, setTimes] = useState<Record<number, string>>(() => Object.fromEntries(pairs.map((p, i) => [i, hhmm(p.proposeOutAt)])));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => uid("idem"));
  const name = (id: string) => db.users.find((u) => u.id === id)?.name ?? "알 수 없음";
  const site = (id: string) => db.sites.find((s) => s.id === id)?.shortName ?? "";

  // 앞 기록마다 새 퇴근 시각 (같은 앞 기록이 여러 번 겹치면 가장 이른 시각)
  const plan = useMemo(() => {
    const m = new Map<string, { rec: AttendanceRecord; outAt: string }>();
    pairs.forEach((p, i) => {
      if (!checked[i] || !/^\d{2}:\d{2}$/.test(times[i] ?? "")) return;
      const outAt = at(todayIso(new Date(p.proposeOutAt)), times[i]);
      const cur = m.get(p.earlier.id);
      if (!cur || outAt < cur.outAt) m.set(p.earlier.id, { rec: p.earlier, outAt });
    });
    return [...m.values()];
  }, [pairs, checked, times]);
  const bad = plan.filter((x) => x.outAt <= x.rec.inAt);
  const before = plan.reduce((a, x) => a + (minutesOf(x.rec) ?? 0), 0);
  const after = plan.reduce((a, x) => a + Math.max(0, Math.round((new Date(x.outAt).getTime() - new Date(x.rec.inAt).getTime()) / 60_000)), 0);

  const save = async () => {
    if (busy || plan.length === 0 || bad.length || note.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const r = await run("correctAttendanceBatch", { items: plan.map((x) => ({ attendanceId: x.rec.id, outAt: x.outAt })), note, idempotencyKey: key });
      toast.push({ tone: "ok", title: `${r.corrected}건 정리했습니다 (이력에 남음)`, desc: `그날들 근무시간 ${hours(r.minutesBefore)} → ${hours(r.minutesAfter)}` });
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
      description={`${short(from)} ~ ${short(to)} · 같은 사람이 같은 시간에 두 현장에 출근해 있으면 근무시간이 두 번 셈해집니다. 앞 현장 퇴근을 다음 현장 출근 시각으로 고치는 안을 채웠습니다 — 이동 시간이 있었으면 시각을 바꾸세요.`}
      size="xl"
      testId="overlap-fix"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={save} loading={busy} disabled={plan.length === 0 || bad.length > 0 || note.trim().length < 2} data-testid="overlap-save">
            {plan.length ? `${plan.length}건 한 번에 정정` : "정정할 것 없음"}
          </Button>
        </>
      }
    >
      {pairs.length === 0 ? (
        <EmptyState title="이 기간에 시간이 겹치는 기록이 없습니다" />
      ) : (
        <div className="space-y-4">
          <div tabIndex={0} role="region" aria-label="겹친 기록 표 (가로 스크롤)" className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[46rem] text-[0.84rem]">
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
                    <td className="px-3 py-2.5">
                      <input type="checkbox" className="size-5" aria-label={`${short(p.workDate)} ${name(p.userId)} 정리`} checked={!!checked[i]} onChange={(e) => setChecked({ ...checked, [i]: e.target.checked })} />
                    </td>
                    <td className="px-3 py-2.5 num">
                      {short(p.workDate)}
                      {!userId && <span className="block font-sans text-[0.76rem] font-semibold text-ink-2">{name(p.userId)}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <b>{site(p.earlier.siteId)}</b> <span className="num">{hhmm(p.earlier.inAt)}~{p.earlier.outAt ? hhmm(p.earlier.outAt) : "—"}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <b>{site(p.later.siteId)}</b> <span className="num">{hhmm(p.later.inAt)}~{p.later.outAt ? hhmm(p.later.outAt) : "퇴근 없음"}</span>
                    </td>
                    <td className="px-3 py-2.5 num font-semibold text-warn">{p.minutes}분</td>
                    <td className="px-3 py-2">
                      <input type="time" aria-label={`${short(p.workDate)} 앞 현장 새 퇴근`} className={cx(inputCls, "num h-10 w-32 py-1")} value={times[i] ?? ""} onChange={(e) => setTimes({ ...times, [i]: e.target.value })} disabled={!checked[i]} />
                      {p.manual && <span className="mt-1 block text-[0.74rem] font-semibold text-warn">직접 확인 — {p.later.outAt ? "두 기록이 같은 시각에 시작" : "다음 현장 퇴근 기록이 없음"}</span>}
                      {!p.manual && p.tailLostMin > 0 && checked[i] && (
                        <span className="mt-1 block text-[0.74rem] text-ink-3">
                          다음 현장이 {hhmm(p.later.outAt!)}에 끝나 그 뒤 앞 현장 {p.tailLostMin}분은 빠집니다 — 앞 현장에 돌아가 일했으면 이 줄은 빼고 사람에게 확인하세요
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bad.length > 0 && <Notice tone="err" title="퇴근 시각이 그날 출근보다 이릅니다 — 시각을 확인하세요." />}
          {plan.length > 0 && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-[0.84rem] text-ink-2" data-testid="overlap-effect">
              앞 현장 기록 {plan.length}건의 근무시간이 {hours(before)} → <b className="text-ink">{hours(after)}</b>로 줄고, 같은 시간을 두 번 세던 것이 없어집니다. 위치 기록은 바뀌지 않고, 정정 이력에 사유가 남습니다.
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
