"use client";

/**
 * 출근·퇴근 (현장 직원 첫 화면 맨 위)
 * 누를 때 1번만 위치를 잡아 서버로 보낸다. 시각·현장 안/밖 판정은 서버가 한다.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CircleCheck, Loader2, LogIn, LogOut, MapPin, MapPinOff, QrCode, ShieldCheck } from "lucide-react";
import { run } from "@/lib/data/store";
import { IS_LIVE } from "@/lib/mode";
import { CommandError } from "@/lib/data/commands";
import type { DemoDB, GeoStamp, Site } from "@/lib/domain/types";
import { distanceM, geoText, type GeoSample } from "@/lib/domain/geo";
import { hhmm, minutesOf } from "@/lib/domain/attendance";
import { todayIso } from "@/lib/domain/format";
import { consentNotice, currentTerms, hasConsent, locationPolicy } from "@/lib/domain/privacy";
import { deviceId, locateOnce } from "@/lib/geo/client";
import { decodeQrFromFile } from "@/lib/geo/qrClient";
import { makeQrToken, parseQrText, qrWindow, QR_LABEL } from "@/lib/domain/qr";
import { cx } from "@/components/ui/primitives";
import { uid } from "@/lib/domain/ids";
import { flushOutbox, outboxAdd } from "@/lib/browser/outbox";
import { Choice } from "./ui";
import { useOutbox } from "./Outbox";

const kstDay = (iso: unknown) => (typeof iso === "string" && Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10) : "");

type Phase =
  | { k: "idle" }
  | { k: "consent"; mode: "in" | "out"; qr?: string }
  | { k: "locating"; mode: "in" | "out" }
  | { k: "pick"; mode: "in"; sample: GeoSample | null; reason?: GeoStamp["reason"]; consent?: boolean }
  | { k: "warn"; mode: "in" | "out"; site: Site; sample: GeoSample | null; reason?: GeoStamp["reason"]; distance?: number; consent?: boolean }
  | { k: "done"; mode: "in" | "out"; text: string; tone: "ok" | "warn" };

const bigBtn = "press flex min-h-[4.6rem] w-full items-center justify-center gap-2.5 rounded-full text-[1.35rem] font-extrabold shadow-card disabled:opacity-50";

export function EasyAttendance({ db, userId, sites, autoQr }: { db: DemoDB; userId: string; sites: Site[]; autoQr?: string }) {
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const autoDone = useRef(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const today = todayIso();
  const mine = (db.attendance ?? []).filter((r) => r.userId === userId && r.workDate === today);
  const open = mine.find((r) => !r.outAt);
  const closed = mine.filter((r) => r.outAt);
  // 지금 조건(보관 기간·볼 수 있는 사람)으로 동의했는지 — 회사가 조건을 불리하게 바꾸면 다시 묻는다 (D-43)
  const consented = hasConsent(db, userId);
  const reasked = !consented && (db.consents ?? []).some((c) => c.userId === userId);
  // 통신이 안 돼 휴대폰에 저장해 둔 오늘 출퇴근 (D-55) — 보내기 전까지 화면에 ‘저장됨’으로 보여준다
  const queued = useOutbox(userId).filter((i) => (i.name === "checkIn" || i.name === "checkOut") && !i.failed && kstDay(i.args.pressedAt) === today);
  const qIn = queued.find((i) => i.name === "checkIn");
  const qOut = queued.find((i) => i.name === "checkOut");
  const qInSite = qIn ? db.sites.find((s) => s.id === qIn.args.siteId) : undefined;
  const openSite = open ? db.sites.find((s) => s.id === open.siteId) : qIn && !qOut ? qInSite : undefined;
  // 출근 방식: 현장 QR + GPS
  const qrMode = db.settings?.attendanceMode === "qr";
  const todayRec = open ?? closed[0];
  const qrPending = qrMode && !!todayRec && todayRec.inQr?.status !== "ok";

  // QR 주소(/q/…)로 들어온 경우 바로 진행
  useEffect(() => {
    if (!autoQr || autoDone.current || sites.length === 0) return;
    autoDone.current = true;
    void startQr(autoQr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoQr, sites.length]);

  if (sites.length === 0) return null;

  const commit = async (mode: "in" | "out", site: Site, sample: GeoSample | null, reason?: GeoStamp["reason"], consent?: boolean, qrToken?: string) => {
    setBusy(true);
    setErr(null);
    // 중복 방지 키를 처음부터 붙인다 — 응답만 끊긴 경우 휴대폰에 저장했다가 다시 보내도 한 번만 기록된다
    const key = uid(`att-${mode}`);
    // 동의할 때는 화면에 보여준 조건을 함께 보낸다 — 그 사이 회사 규칙이 바뀌었으면 서버가 다시 보여달라고 한다 (D-49)
    const args = { siteId: site.id, sample, noLocation: sample ? undefined : (reason ?? "unavailable"), deviceId: deviceId() || undefined, consent, ...(consent ? { consentTerms: currentTerms(db) } : {}), ...(qrToken ? { qrToken } : {}), idempotencyKey: key };
    try {
      // 출근을 아직 휴대폰에 저장만 했으면 먼저 그것부터 보내 본다 — 아직 안 되면 퇴근도 저장 (보내는 순서: 출근 → 퇴근)
      if (mode === "out" && !open && qIn) {
        const f = await flushOutbox(userId, (n, a) => run(n, a as never));
        if (f.offline || f.waiting > 0) throw new CommandError("출근이 아직 전송 전", "NETWORK");
      }
      const r = mode === "in" ? await run("checkIn", { ...args }) : await run("checkOut", args);
      const qr = "qr" in r ? r.qr : undefined;
      const ok = r.geo.status === "inside" && (!qrToken || qr?.status === "ok");
      const word = mode === "in" ? "출근" : "퇴근";
      const qrText = qrToken ? (qr?.status === "ok" ? " · 현장 QR 확인" : ` — ${QR_LABEL[qr?.status ?? "invalid"]}: ‘QR 다시 찍기’를 눌러 주세요`) : "";
      setPhase({ k: "done", mode, tone: ok ? "ok" : "warn", text: ok ? `${word} 기록 완료${qrText}` : `${word} 기록 완료${qrText}${r.geo.status !== "inside" ? ` — 본사에 ‘${geoText(r.geo)}’로 표시됩니다` : ""}` });
    } catch (e) {
      if (IS_LIVE && e instanceof CommandError && e.code === "NETWORK") {
        // 통신이 안 됨 → 휴대폰에 저장 (QR은 30초마다 바뀌어 나중에 보내면 확인할 수 없으므로 빼고 저장)
        const pressedAt = new Date().toISOString();
        const word = mode === "in" ? "출근" : "퇴근";
        const { qrToken: _q, ...rest } = args;
        void _q;
        const saved = await outboxAdd({ id: key, userId, name: mode === "in" ? "checkIn" : "checkOut", args: { ...rest, pressedAt }, label: `${site.shortName} ${word} (${hhmm(pressedAt)}에 누름)` });
        if (saved) {
          setPhase({ k: "done", mode, tone: "warn", text: `연결이 안 돼서 ${word}을 휴대폰에 저장했어요 (${hhmm(pressedAt)}). 신호가 잡히면 자동으로 보내요. 누른 시각은 본사가 확인해요.` });
          return;
        }
      }
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

  /** 현장 태블릿 QR로 출근 (이미 출근했으면 QR 확인만) */
  const startQr = async (text: string, consent?: boolean) => {
    setErr(null);
    const p = parseQrText(text);
    if (!p) return setErr("TAEKANG 출근 QR이 아닙니다. 현장 태블릿의 QR을 찍어 주세요.");
    const site = sites.find((s) => s.id === p.siteId);
    if (!site) return setErr("내 담당 현장의 QR이 아닙니다.");
    // 오래된 사진(5분 넘음)은 바로 다시 찍게 한다 — 최종 판정은 서버
    if (qrWindow(Date.now()) - p.w > 10) return setErr("오래된 QR 사진이에요. 지금 태블릿 화면을 다시 찍어 주세요.");
    const rec = mine.find((r) => r.siteId === site.id);
    if (rec) {
      if (rec.inQr?.status === "ok") return setPhase({ k: "done", mode: "in", tone: "ok", text: "이미 현장 QR로 출근 확인되었습니다" });
      setBusy(true);
      try {
        await run("confirmQr", { siteId: site.id, qrToken: p.token });
        setPhase({ k: "done", mode: "in", tone: "ok", text: "현장 QR 확인 완료" });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "QR을 확인하지 못했습니다.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!consented && !consent) return setPhase({ k: "consent", mode: "in", qr: p.token });
    setPhase({ k: "locating", mode: "in" });
    const loc = await locateOnce();
    // QR이 현장에 있었다는 증거 → 위치가 밖이어도 묻지 않고 기록 (본사에는 둘 다 표시)
    await commit("in", site, "sample" in loc ? loc.sample : null, "error" in loc ? loc.error : undefined, consent, p.token);
  };

  const onQrPhoto = async (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    setBusy(true);
    const text = await decodeQrFromFile(f);
    setBusy(false);
    if (!text) return setErr("QR을 읽지 못했어요. 태블릿 가까이에서 QR 전체가 보이게 다시 찍어 주세요.");
    await startQr(text);
  };

  /** QR 사진 찍기 버튼 (휴대폰 카메라가 바로 열림) */
  const qrButton = (label: string, testId: string, primary = true) => (
    <label className={cx(bigBtn, "cursor-pointer", primary ? "bg-ok text-white" : "border-2 border-line-strong bg-surface text-ink !text-[1.15rem] !min-h-[3.8rem] shadow-none", busy && "pointer-events-none opacity-50")}>
      <QrCode size={28} aria-hidden /> {label}
      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void onQrPhoto(e.currentTarget)} data-testid={testId} />
    </label>
  );

  /** DEMO: 시연 장소에 태블릿이 없으므로, 가상 단말기의 지금 QR을 찍은 것으로 */
  const demoQr = () => {
    const k = (db.kiosks ?? []).find((x) => !x.revokedAt && x.secret && sites.some((s) => s.id === x.siteId) && (!todayRec || x.siteId === todayRec.siteId));
    if (k?.secret) void startQr(makeQrToken({ id: k.id, siteId: k.siteId, secret: k.secret }, Date.now()));
  };
  const demoQrBtn = !IS_LIVE && qrMode && (
    <button type="button" onClick={demoQr} className="press w-full rounded-xl bg-[#FFF7D6] px-3 py-3 text-[0.98rem] font-bold text-[#7A5200]" data-testid="att-demo-qr">
      DEMO · 현장 태블릿 QR을 찍은 것으로
    </button>
  );

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
    <section className={cx("space-y-3 rounded-[1.75rem] border p-5 shadow-pop", tone === "ok" ? "border-ok/30 bg-ok-bg" : tone === "warn" ? "border-warn/40 bg-warn-bg" : "border-line bg-surface")} data-testid="att-card" aria-live="polite">
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
        {reasked && <p className="rounded-xl bg-warn-bg px-3 py-2 text-[1.02rem] font-semibold">회사가 위치 기록 조건을 바꿔서 다시 여쭤봐요.</p>}
        <ul className="list-disc space-y-1.5 pl-5 text-[1.05rem] leading-relaxed text-ink" data-testid="att-consent-notice">
          {consentNotice(locationPolicy(db)).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <button type="button" onClick={() => (phase.qr ? void startQr(phase.qr, true) : void start(phase.mode, true))} className={cx(bigBtn, "bg-cta text-cta-text")} data-testid="att-consent-yes">
          동의하고 {phase.mode === "in" ? "출근" : "퇴근"}하기
        </button>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              const p = phase.qr ? parseQrText(phase.qr) : null;
              const s = p ? sites.find((x) => x.id === p.siteId) : undefined;
              if (p && s) void commit("in", s, null, "skipped", undefined, p.token);
              else decide("in", null, "skipped");
            }}
            className="press min-h-[3.6rem] rounded-full border-2 border-line-strong bg-surface text-[1.02rem] font-bold"
            data-testid="att-consent-no"
            hidden={phase.mode === "out"}
          >
            위치 없이 출근
          </button>
          {phase.mode === "out" && openSite && (
            <button type="button" onClick={() => commit("out", openSite, null, "skipped")} className="press min-h-[3.6rem] rounded-full border-2 border-line-strong bg-surface text-[1.02rem] font-bold">
              위치 없이 퇴근
            </button>
          )}
          <button type="button" onClick={() => setPhase({ k: "idle" })} className="press min-h-[3.6rem] rounded-full border-2 border-line-strong bg-surface text-[1.02rem] font-bold">
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
        <button type="button" onClick={() => commit(phase.mode, phase.site, phase.sample, phase.reason, phase.consent)} disabled={busy} className="press min-h-[3.8rem] w-full rounded-full border-2 border-line-strong bg-surface text-[1.08rem] font-bold" data-testid="att-anyway">
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
      {(qIn && !open && !closed.length) || (open && qOut) ? (
        <div className="space-y-1" data-testid="att-queued">
          {qIn && !open && (
            <p className="text-[1.15rem] font-bold" data-testid="att-status">
              {qInSite?.shortName} 출근 {hhmm(String(qIn.args.pressedAt))} · <span className="text-warn">휴대폰에 저장됨 (아직 안 보냄)</span>
            </p>
          )}
          {open && (
            <p className="text-[1.15rem] font-bold" data-testid="att-status">
              {openSite?.shortName} 출근 {hhmm(open.inAt)}
            </p>
          )}
          {qOut && (
            <p className="text-[1.15rem] font-bold">
              퇴근 {hhmm(String(qOut.args.pressedAt))} · <span className="text-warn">휴대폰에 저장됨 (아직 안 보냄)</span>
            </p>
          )}
          <p className="text-[1rem] text-ink-2">신호가 잡히면 자동으로 보내요. 누른 시각은 본사가 확인해요.</p>
          {!qOut && (
            <button type="button" onClick={() => tap("out")} disabled={busy} className={cx(bigBtn, "bg-primary text-white")} data-testid="att-out">
              <LogOut size={28} aria-hidden /> 퇴근하기
            </button>
          )}
        </div>
      ) : open ? (
        <>
          <p className="text-[1.15rem] font-bold" data-testid="att-status">
            {openSite?.shortName} 출근 {hhmm(open.inAt)} · <span className={open.inGeo.status === "inside" ? "text-ok" : "text-warn"}>{geoText(open.inGeo)}</span>
            {open.inQr?.status === "ok" && <span className="text-ok"> · 현장 QR 확인</span>}
          </p>
          {qrPending && (
            <>
              <p className="text-[1.02rem] font-bold text-warn" data-testid="att-qr-pending">
                현장 QR 확인이 아직 안 됐어요. 태블릿 QR을 찍어 주세요.
              </p>
              {qrButton("QR 다시 찍기", "att-qr-confirm-file", false)}
              {demoQrBtn}
            </>
          )}
          <button type="button" onClick={() => tap("out")} disabled={busy} className={cx(bigBtn, "bg-primary text-white")} data-testid="att-out">
            <LogOut size={28} aria-hidden /> 퇴근하기
          </button>
        </>
      ) : closed.length > 0 ? (
        <p className="text-[1.15rem] font-bold" data-testid="att-status">
          오늘 근무 끝 · {closed.map((r) => `${hhmm(r.inAt)}~${hhmm(r.outAt!)} (${Math.floor((minutesOf(r) ?? 0) / 60)}시간 ${(minutesOf(r) ?? 0) % 60}분)`).join(", ")}
        </p>
      ) : qrMode ? (
        <>
          {qrButton("QR 찍고 출근", "att-qr-file")}
          <p className="text-center text-[1rem] text-ink-2">현장 사무실 태블릿의 QR을 찍으세요. 사진을 찍으면 바로 출근됩니다.</p>
          {demoQrBtn}
          <button type="button" onClick={() => tap("in")} disabled={busy} className="press min-h-12 w-full rounded-xl text-[1.02rem] font-bold text-ink-2 underline underline-offset-4" data-testid="att-in">
            QR 없이 출근 (본사에 ‘QR 없음’으로 표시)
          </button>
        </>
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

/** 출퇴근이 잘못됐을 때 — 근태 수정 요청으로 */
export function FixLink() {
  return (
    <a href="/field/fix" className="press flex min-h-12 w-full items-center justify-center rounded-xl text-[1.02rem] font-bold text-ink-2 underline underline-offset-4" data-testid="att-fix-link">
      출퇴근이 잘못 찍혔나요? 수정 요청하기
    </a>
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
