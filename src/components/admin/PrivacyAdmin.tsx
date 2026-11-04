"use client";

/**
 * 운영 관리 · 개인위치정보 (계약 별지 제5호 대응 · D-43)
 * - 규칙: 좌표 보관 기간, 좌표를 볼 수 있는 사람 — 대표만 바꿀 수 있다 (서버도 대표만 허용)
 * - 현황: 좌표가 남은 기록, 지운 기록, 마지막 자동 정리 / ‘지금 정리’
 * - 직원별 동의 현황, 퇴사·요청 처리용 ‘좌표 지우기’
 * - 직원에게 알리는 내용 (출근 동의 화면과 같은 문구)
 * 무엇으로 정할지(기간·문구·신고 필요 여부)는 회사가 법률·노무 전문가와 확인한다. 이 화면은 정한 대로 실행한다.
 */
import { useState } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import type { DemoDB, LocationPolicy, RoleId } from "@/lib/domain/types";
import { run } from "@/lib/data/store";
import { CommandError } from "@/lib/data/commands";
import { userLabel } from "@/lib/data/hooks";
import { fmtDate, fmtDateTime } from "@/lib/domain/format";
import { RETENTION_CHOICES, canSeeCoordinates, consentNotice, consentState, coordinateStats, hasCoords, locationPolicy, myLocationRows, retentionText, viewersText } from "@/lib/domain/privacy";
import { Badge, Button, Card, CardHeader, Field, Notice, cx, inputCls } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";

const CHOICES: { value: string; label: string }[] = [
  { value: "", label: "아직 정하지 않음 (자동 삭제 안 함)" },
  ...RETENTION_CHOICES.map((d) => ({ value: String(d), label: retentionText(d) })),
];

export function PrivacyAdmin({ db, role }: { db: DemoDB; role: RoleId }) {
  const toast = useToast();
  const policy = locationPolicy(db);
  const isCeo = role === "ceo";
  const [days, setDays] = useState(policy.retentionDays == null ? "" : String(policy.retentionDays));
  const [viewers, setViewers] = useState<LocationPolicy["viewers"]>(policy.viewers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [erase, setErase] = useState<{ userId: string; reason: string } | null>(null);
  const seeCoords = canSeeCoordinates(role, policy);
  const stats = coordinateStats(db);
  const changed = days !== (policy.retentionDays == null ? "" : String(policy.retentionDays)) || viewers !== policy.viewers;
  const people = db.users.filter((u) => u.role === "field" || u.role === "manager" || (db.attendance ?? []).some((r) => r.userId === u.id) || (db.consents ?? []).some((c) => c.userId === u.id));

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      toast.push({ tone: "ok", title: await fn() });
    } catch (e) {
      if (e instanceof CommandError) setErrors(e.fieldErrors);
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "처리하지 못했습니다" });
    } finally {
      setBusy(null);
    }
  };
  const save = () =>
    act("save", async () => {
      const r = await run("setLocationPolicy", { retentionDays: days ? Number(days) : null, viewers });
      setErrors({});
      return r.reconsent ? "저장했습니다 — 직원에게 불리한 변경이라 다음 출근 때 다시 동의를 받습니다" : "개인위치정보 규칙을 저장했습니다";
    });
  const purgeNow = () => act("purge", async () => `보관 기간이 지난 좌표 ${(await run("purgeLocationsNow", {})).count}건을 지웠습니다`);
  const purgeMember = () =>
    erase &&
    act(`member-${erase.userId}`, async () => {
      const r = await run("purgeMemberLocations", { userId: erase.userId, reason: erase.reason });
      setErase(null);
      return `${userLabel(db, erase.userId)} 좌표 ${r.count}건을 지웠습니다`;
    });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5" data-testid="admin-privacy">
      <Card>
        <CardHeader title="개인위치정보 규칙" sub="출퇴근·보고 위치(좌표)를 얼마나 보관하고 누가 볼지 — 계약 별지 제5호 ‘적용 확인’ 항목" right={!isCeo ? <Badge>대표만 바꿀 수 있음</Badge> : undefined} />
        <div className="space-y-4 px-5 pb-5">
          {policy.retentionDays == null && (
            <Notice tone="warn" title="보관 기간이 정해지지 않았습니다">
              좌표가 지워지지 않고 계속 쌓입니다. 법률·노무 전문가와 정한 기간을 넣어 주세요. 정하면 그 기간이 지난 좌표를 매일 자동으로 지웁니다.
            </Notice>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="좌표 보관 기간" htmlFor="pv-days" error={errors.retentionDays} hint="지나면 좌표·거리·오차를 지웁니다. 출퇴근 시각과 현장 안/밖 판정은 근무 기록으로 남습니다.">
              <select id="pv-days" className={inputCls} value={days} onChange={(e) => setDays(e.target.value)} disabled={!isCeo} data-testid="privacy-days">
                {CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
                {days && !CHOICES.some((c) => c.value === days) && <option value={days}>{retentionText(Number(days))}</option>}
              </select>
            </Field>
            <fieldset>
              <legend className="mb-2 text-[0.9rem] font-bold">좌표를 볼 수 있는 사람</legend>
              <div className="grid gap-2">
                {(
                  [
                    ["ceo", "대표만", "관리자 화면에는 현장 안/밖 판정만 보입니다."],
                    ["hq", "대표·관리자", "관리자도 지도 위치를 봅니다."],
                  ] as const
                ).map(([v, t, d]) => (
                  <label key={v} className={cx("press cursor-pointer rounded-xl border px-3.5 py-2.5 text-[0.84rem]", viewers === v ? "border-active bg-active-soft" : "border-line hover:bg-surface-2", !isCeo && "pointer-events-none opacity-70")}>
                    <input type="radio" name="pv-viewers" className="sr-only" checked={viewers === v} onChange={() => setViewers(v)} disabled={!isCeo} data-testid={`privacy-viewers-${v}`} />
                    <span className="block font-bold">{t}</span>
                    <span className="block text-[0.76rem] text-ink-3">{d}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <p className="text-[0.8rem] text-ink-3">직원은 언제나 자기 기록을 볼 수 있습니다. 보관 기간을 늘리거나 볼 수 있는 사람을 넓히면 직원에게 다음 출근 때 다시 동의를 받습니다. 바꾼 내용은 활동 이력에 남습니다.</p>
          {isCeo && (
            <div className="flex justify-end">
              <Button variant="cta" onClick={save} loading={busy === "save"} disabled={!changed} data-testid="privacy-save">
                규칙 저장
              </Button>
            </div>
          )}
        </div>
      </Card>

      {seeCoords && (
        <Card data-testid="privacy-stats">
          <CardHeader title="좌표 보관 현황" sub={policy.purgedOn ? `마지막 자동 정리 ${fmtDate(policy.purgedOn)}` : "아직 자동 정리 기록 없음"} />
          <div className="space-y-3 px-5 pb-5">
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label="좌표가 남은 기록" value={`${stats.count}건`} testId="privacy-count" />
              <Stat label="가장 오래된 좌표" value={stats.oldest ? fmtDate(stats.oldest) : "—"} />
              <Stat label="좌표를 지운 기록" value={`${stats.purged}건`} sub="판정만 남음" />
            </div>
            {isCeo && policy.retentionDays != null && (
              <Button icon={<Trash2 size={15} />} onClick={purgeNow} loading={busy === "purge"} data-testid="privacy-purge">
                지금 정리 ({retentionText(policy.retentionDays)} 지난 좌표)
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card data-testid="privacy-people">
        <CardHeader title="직원별 동의 현황" sub="동의는 직원이 처음 위치를 남길 때 휴대폰에서 직접 합니다. 직원은 ‘내 정보 → 내 위치 기록’에서 언제든 그만둘 수 있습니다." />
        <ul className="divide-y divide-line border-t border-line">
          {people.map((u) => {
            const { state, consent } = consentState(db, u.id);
            const left = myLocationRows(db, u.id).filter((r) => hasCoords(r.geo)).length;
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 text-[0.86rem]" data-testid="privacy-person" data-user={u.id}>
                <span className="min-w-40 flex-1 font-semibold">
                  {u.name} <span className="text-[0.78rem] font-normal text-ink-3">{u.title}</span>
                </span>
                <Badge tone={state === "agreed" ? "ok" : state === "outdated" ? "warn" : "neutral"}>{state === "agreed" ? "동의" : state === "outdated" ? "다시 동의 필요" : "동의 안 함"}</Badge>
                {consent && (
                  <span className="num text-[0.78rem] text-ink-3">
                    {fmtDateTime(consent.at)} · 문구 {consent.version}판{consent.version >= 2 ? ` · 보관 ${retentionText(consent.retentionDays)} · ${viewersText(consent.viewers ?? "hq")}` : ""}
                  </span>
                )}
                {seeCoords && <span className="num text-[0.78rem] text-ink-2">좌표 {left}건</span>}
                {isCeo && left > 0 && (
                  <Button size="sm" variant="danger" onClick={() => setErase({ userId: u.id, reason: "" })} data-testid="privacy-erase">
                    좌표 지우기
                  </Button>
                )}
                {erase?.userId === u.id && (
                  <div className="basis-full rounded-xl border border-err/30 bg-err-bg p-3" role="alertdialog" aria-label={`${u.name} 좌표 지우기 확인`}>
                    <p className="font-semibold">{u.name}의 남은 좌표를 모두 지웁니다. 출퇴근 시각·판정은 남고, 되돌릴 수 없습니다.</p>
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <Field label="사유 (활동 이력에 남음)" htmlFor={`pv-reason-${u.id}`}>
                        <input id={`pv-reason-${u.id}`} className={cx(inputCls, "w-56")} value={erase.reason} maxLength={80} onChange={(e) => setErase({ ...erase, reason: e.target.value })} placeholder="예) 퇴사 / 본인 요청" data-testid="privacy-erase-reason" />
                      </Field>
                      <Button size="sm" variant="ghost" onClick={() => setErase(null)}>
                        취소
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => void purgeMember()} loading={busy === `member-${u.id}`} data-testid="privacy-erase-yes">
                        지우기
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card data-testid="privacy-notice">
        <CardHeader title="직원에게 알리는 내용" sub="직원 휴대폰의 위치 기록 동의 화면에 이 문구가 그대로 나옵니다 (지금 규칙 기준)" />
        <div className="px-5 pb-5">
          <ul className="list-disc space-y-1 pl-5 text-[0.88rem] leading-relaxed">
            {consentNotice(policy).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className="mt-3 flex items-start gap-1.5 text-[0.78rem] text-ink-3">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
            문구·보관 기간·위치정보 관련 신고 필요 여부는 회사가 법률·노무 전문가와 확인해 정합니다. 문구를 바꿔야 하면 미래AI랩에 요청해 주세요 (문구 판이 올라가 직원에게 다시 동의를 받습니다).
          </p>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5" data-testid={testId}>
      <p className="text-[0.76rem] font-semibold text-ink-2">{label}</p>
      <p className="num text-[1.15rem] font-extrabold">{value}</p>
      {sub && <p className="text-[0.74rem] text-ink-3">{sub}</p>}
    </div>
  );
}
