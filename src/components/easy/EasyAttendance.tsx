"use client";

/**
 * 출근·퇴근 (현장 직원 첫 화면 맨 위)
 * 누를 때 1번만 위치를 잡아 서버로 보낸다. 시각·현장 안/밖 판정은 서버가 한다.
 */
import { useState } from "react";
import { AlertTriangle, CircleCheck, Loader2, LogIn, LogOut, MapPin, MapPinOff, ShieldCheck } from "lucide-react";
import { run } from "@/lib/data/store";
import { IS_LIVE } from "@/lib/mode";
import { CommandError } from "@/lib/data/commands";
import type { DemoDB, GeoStamp, Site } from "@/lib/domain/types";
import { distanceM, geoText, type GeoSample } from "@/lib/domain/geo";
import { hhmm, minutesOf } from "@/lib/domain/attendance";
import { todayIso } from "@/lib/domain/format";
import { deviceId, locateOnce } from "@/lib/geo/client";
import { cx } from "@/components/ui/primitives";
import { Choice } from "./ui";

type Phase =
  | { k: "idle" }
  | { k: "consent"; mode: "in" | "out" }
  | { k: "locating"; mode: "in" | "out" }
  | { k: "pick"; mode: "in"; sample: GeoSample | null; reason?: GeoStamp["reason"]; consent?: boolean }
  | { k: "warn"; mode: "in" | "out"; site: Site; sample: GeoSample | null; reason?: GeoStamp["reason"]; distance?: number; consent?: boolean }
  | { k: "done"; mode: "in" | "out"; text: string; tone: "ok" | "warn" };

const bigBtn = "press flex min-h-[4.6rem] w-full items-center justify-center gap-2.5 rounded-3xl text-[1.35rem] font-extrabold shadow-card disabled:opacity-50";

export function EasyAttendance({ db, userId, sites }: { db: DemoDB; userId: string; sites: Site[] }) {
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const today = todayIso();
  const mine = (db.attendance ?? []).filter((r) => r.userId === userId && r.workDate === today);
  const open = mine.find((r) => !r.outAt);
  const closed = mine.filter((r) => r.outAt);
  const consented = (db.consents ?? []).some((c) => c.userId === userId);
  const openSite = open ? db.sites.find((s) => s.id === open.siteId) : undefined;

  if (sites.length === 0) return null;

  const commit = async (mode: "in" | "out", site: Site, sample: GeoSample | null, reason?: GeoStamp["reason"], consent?: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const args = { siteId: site.id, sample, noLocation: sample ? undefined : (reason ?? "unavailable"), deviceId: deviceId() || undefined, consent };
      const r = mode === "in" ? await run("checkIn", args) : await run("checkOut", args);
      const ok = r.geo.status === "inside";
      const word = mode === "in" ? "출근" : "퇴근";
      setPhase({ k: "done", mode, tone: ok ? "ok" : "warn", text: ok ? `${word} 기록 완료` : `${word} 기록 완료 — 본사에 ‘${geoText(r.geo)}’로 표시됩니다` });
    } catch (e) {
      setErr(e instanceof CommandError || e instanceof Error ? e.message : "기록하지 못했습니다. 다시 눌러 주세요.");
      setPhase({ k: "idle" });
    } finally {
      setBusy(false);
    }
  };

  /** 위치를 잡고 → 현장을 정하고 → 현장 안이면 바로 기록, 아니면 한 번 더 묻는다 */
  const start = async (mode: "in" | "out", consent?: boolean) => {
    setErr(null);
    setPhase({ k: "locating", mode });
    const loc = await locateOnce();
    const sample = "sample" in loc ? loc.sample : null;
    const reason = "error" in loc ? loc.error : undefined;
    decide(mode, sample, reason, consent);
  };

  const decide = (mode: "in" | "out", sample: GeoSample | null, reason: GeoStamp["reason"] | undefined, consent?: boolean, chosen?: Site) => {
    let site: Site | undefined = mode === "out" ? openSite : chosen;
    if (mode === "in" && !site) {
      if (sites.length === 1) site = sites[0];
      else if (sample) {
        // 반경 안에 있는 가장 가까운 담당 현장
        site = sites
          .filter((s) => s.geo)
          .map((s) => ({ s, d: distanceM(s.geo!, sample) }))
          .filter((x) => x.d <= x.s.geo!.radiusM)
          .sort((a, b) => a.d - b.d)[0]?.s;
      }
      if (!site) return setPhase({ k: "pick", mode: "in", sample, reason, consent });
    }
    if (!site) return;
    // 동의하지 않고 '위치 없이'를 고른 경우 → 묻지 않고 바로 기록 (본사에 '위치 없음' 표시)
    if (!sample && reason === "skipped") return void commit(mode, site, null, "skipped");
    const d = sample && site.geo ? distanceM(site.geo, sample) : undefined;
    const inside = !!sample && !!site.geo && d! <= site.geo.radiusM && sample.accuracy <= 150;
    if (inside) return void commit(mode, site, sample, undefined, consent);
    setPhase({ k: "warn", mode, site, sample, reason, distance: d, consent });
  };

  const tap = (mode: "in" | "out") => (consented ? start(mode) : setPhase({ k: "consent", mode }));

  /** DEMO: 시연 장소가 현장이 아니므로 현장 위치에 있다고 가정 */
  const demoHere = (mode: "in" | "out", site?: Site) => {
    const s = site ?? (mode === "out" ? openSite : sites.find((x) => x.geo));
    if (!s?.geo) return;
    const sample = { lat: s.geo.lat + 0.0003, lng: s.geo.lng + 0.0002, accuracy: 12 };
    void commit(mode, s, sample, undefined, true);
  };
  const demoBtn = (mode: "in" | "out", site?: Site) =>
    !IS_LIVE && (
      <button type="button" onClick={() => demoHere(mode, site)} className="press w-full rounded-xl bg-[#FFF7D6] px-3 py-3 text-[0.98rem] font-bold text-[#7A5200]" data-testid="att-demo-here">
        DEMO · 현장에 있는 것으로 가정하고 기록
      </button>
    );

  const box = (children: React.ReactNode, tone: "plain" | "ok" | "warn" = "plain") => (
    <section className={cx("space-y-3 rounded-3xl border-2 p-4", tone === "ok" ? "border-ok/30 bg-ok-bg" : tone === "warn" ? "border-warn/40 bg-warn-bg" : "border-line bg-surface")} data-testid="att-card" aria-live="polite">
      {children}
    </section>
  );

  // ───── 진행 화면 ─────
  if (phase.k === "consent")
    return box(
      <>
        <p className="flex items-center gap-2 text-[1.3rem] font-extrabold">
          <ShieldCheck size={26} className="text-theme-ink" aria-hidden /> 위치 기록 동의
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-[1.05rem] leading-relaxed text-ink">
          <li>
            <b>출근·퇴근 버튼을 누를 때만</b> 위치를 한 번 기록합니다. 계속 따라다니며 기록하지 않습니다.
          </li>
          <li>현장에 있었는지 확인하는 데만 씁니다. 기록은 회사 본사(대표·관리자)만 봅니다.</li>
          <li>동의하지 않아도 출근은 됩니다. 이때는 본사에 ‘위치 없음’으로 표시됩니다.</li>
        </ul>
        <button type="button" onClick={() => start(phase.mode, true)} className={cx(bigBtn, "bg-cta text-cta-text")} data-testid="att-consent-yes">
          동의하고 {phase.mode === "in" ? "출근" : "퇴근"}하기
        </button>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={() => decide("in", null, "skipped")} className="press min-h-[3.6rem] rounded-2xl border-2 border-line-strong bg-surface text-[1.02rem] font-bold" data-testid="att-consent-no" hidden={phase.mode === "out"}>
            위치 없이 출근
          </button>
          {phase.mode === "out" && openSite && (
            <button type="button" onClick={() => commit("out", openSite, null, "skipped")} className="press min-h-[3.6rem] rounded-2xl border-2 border-line-strong bg-surface text-[1.02rem] font-bold">
              위치 없이 퇴근
            </button>
          )}
          <button type="button" onClick={() => setPhase({ k: "idle" })} className="press min-h-[3.6rem] rounded-2xl border-2 border-line-strong bg-surface text-[1.02rem] font-bold">
            취소
          </button>
        </div>
      </>,
    );

  if (phase.k === "locating")
    return box(
      <>
        <p className="flex items-center gap-2.5 text-[1.3rem] font-extrabold">
          <Loader2 size={26} className="animate-spin text-theme-ink" aria-hidden /> 위치 확인 중…
        </p>
        <p className="text-[1.05rem] text-ink-2">하늘이 보이는 곳에 서 있으면 더 빨라요. (최대 15초)</p>
        {demoBtn(phase.mode)}
      </>,
    );

  if (phase.k === "pick")
    return box(
      <>
        <p className="text-[1.3rem] font-extrabold">어느 현장에 출근하나요?</p>
        {phase.reason === "denied" && <DeniedHelp />}
        <div className="space-y-2.5">
          {sites.map((s) => (
            <Choice key={s.id} icon={<MapPin size={24} />} label={s.shortName} sub={s.workType} onClick={() => decide("in", phase.sample, phase.reason, phase.consent, s)} testId={`att-site-${s.id}`} />
          ))}
        </div>
        {demoBtn("in")}
      </>,
      "warn",
    );

  if (phase.k === "warn") {
    const far = phase.distance !== undefined ? (phase.distance >= 1000 ? `${(phase.distance / 1000).toFixed(1)}km` : `${Math.round(phase.distance)}m`) : null;
    const title = !phase.sample
      ? "위치를 잡지 못했어요"
      : !phase.site.geo
        ? "현장 위치가 아직 등록되지 않았어요"
        : phase.sample.accuracy > 150
          ? `위치 오차가 커요 (약 ${Math.round(phase.sample.accuracy)}m)`
          : `현장에서 ${far} 떨어진 곳이에요`;
    return box(
      <>
        <p className="flex items-start gap-2 text-[1.3rem] font-extrabold leading-snug">
          {phase.sample ? <AlertTriangle size={26} className="mt-0.5 shrink-0 text-warn" aria-hidden /> : <MapPinOff size={26} className="mt-0.5 shrink-0 text-warn" aria-hidden />} {title}
        </p>
        {phase.reason === "denied" && <DeniedHelp />}
        <p className="text-[1.05rem] text-ink-2">현장에 도착했다면 ‘다시 위치 잡기’를 누르세요. 그대로 기록하면 본사 화면에 표시됩니다.</p>
        <button type="button" onClick={() => start(phase.mode, phase.consent)} className={cx(bigBtn, "bg-cta text-cta-text")} data-testid="att-retry">
          다시 위치 잡기
        </button>
        <button type="button" onClick={() => commit(phase.mode, phase.site, phase.sample, phase.reason, phase.consent)} disabled={busy} className="press min-h-[3.8rem] w-full rounded-2xl border-2 border-line-strong bg-surface text-[1.08rem] font-bold" data-testid="att-anyway">
          이대로 {phase.mode === "in" ? "출근" : "퇴근"} 기록 (본사에 표시됨)
        </button>
        {demoBtn(phase.mode, phase.site)}
        <button type="button" onClick={() => setPhase({ k: "idle" })} className="press min-h-12 w-full rounded-xl text-[1.02rem] font-bold text-ink-2">
          취소
        </button>
      </>,
      "warn",
    );
  }

  // ───── 평소 화면 ─────
  return box(
    <>
      {phase.k === "done" && (
        <p className={cx("flex items-start gap-2 text-[1.12rem] font-bold leading-snug", phase.tone === "ok" ? "text-ok" : "text-warn")} role="status" data-testid="att-result">
          {phase.tone === "ok" ? <CircleCheck size={24} className="mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle size={24} className="mt-0.5 shrink-0" aria-hidden />}
          {phase.text}
        </p>
      )}
      {err && <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.05rem] font-bold text-err">{err}</p>}
      {open ? (
        <>
          <p className="text-[1.15rem] font-bold" data-testid="att-status">
            {openSite?.shortName} 출근 {hhmm(open.inAt)} · <span className={open.inGeo.status === "inside" ? "text-ok" : "text-warn"}>{geoText(open.inGeo)}</span>
          </p>
          <button type="button" onClick={() => tap("out")} disabled={busy} className={cx(bigBtn, "bg-primary text-white")} data-testid="att-out">
            <LogOut size={28} aria-hidden /> 퇴근하기
          </button>
        </>
      ) : closed.length > 0 ? (
        <p className="text-[1.15rem] font-bold" data-testid="att-status">
          오늘 근무 끝 · {closed.map((r) => `${hhmm(r.inAt)}~${hhmm(r.outAt!)} (${Math.floor((minutesOf(r) ?? 0) / 60)}시간 ${(minutesOf(r) ?? 0) % 60}분)`).join(", ")}
        </p>
      ) : (
        <>
          <button type="button" onClick={() => tap("in")} disabled={busy} className={cx(bigBtn, "bg-ok text-white")} data-testid="att-in">
            <LogIn size={28} aria-hidden /> 출근하기
          </button>
          <p className="text-center text-[1rem] text-ink-2">현장에 도착하면 누르세요. 누를 때 위치를 한 번 확인합니다.</p>
        </>
      )}
    </>,
    phase.k === "done" ? (phase.tone === "ok" ? "ok" : "warn") : "plain",
  );
}

function DeniedHelp() {
  return (
    <div className="rounded-2xl bg-surface px-4 py-3 text-[1rem] leading-relaxed text-ink">
      <p className="font-bold">휴대폰이 위치를 막고 있어요</p>
      <p>
        <b>아이폰</b>: 설정 → 앱(Safari) → 위치 → ‘허용’
      </p>
      <p>
        <b>갤럭시</b>: 주소창 왼쪽 자물쇠 → 권한 → 위치 ‘허용’
      </p>
    </div>
  );
}
