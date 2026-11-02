"use client";

/**
 * 현장 QR 단말기 화면 (현장 사무실 태블릿) — 로그인 없음
 * 본사가 준 8자리 연결 코드로 한 번 연결하면, 단말기 비밀값으로 30초마다 바뀌는 QR을 스스로 만든다 (인터넷이 끊겨도 동작).
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { dispatch } from "@/lib/data/store";
import { pairKiosk } from "@/lib/data/attendanceCommands";
import { IS_LIVE } from "@/lib/mode";
import { QR_STEP_MS, makeQrToken } from "@/lib/domain/qr";
import { qrPath } from "@/lib/geo/qrClient";
import { api } from "@/lib/live/api";
import { LogoMark } from "@/components/shell/Logo";

const KEY = "tk-site-intel:kiosk";

interface Paired {
  kioskId: string;
  siteId: string;
  siteName: string;
  kioskName: string;
  companyName: string;
  secret: string;
  /** 서버 시각 − 태블릿 시각 (ms) */
  offset: number;
}

function load(): Paired | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Paired) : null;
  } catch {
    return null;
  }
}

function KioskInner() {
  const q = useSearchParams();
  const [paired, setPaired] = useState<Paired | null>(null);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const pair = async (c: string) => {
    setBusy(true);
    setErr(null);
    try {
      let r: Omit<Paired, "offset"> & { serverNow?: number };
      if (IS_LIVE) {
        const res = await api<Omit<Paired, "offset"> & { serverNow: number }>("/api/kiosk/pair", { body: { code: c } });
        if (!res.ok || !res.data) throw new Error(res.error ?? "연결하지 못했습니다.");
        r = res.data;
      } else {
        r = dispatch((db, ctx) => pairKiosk(db, { code: c }, ctx)) as Omit<Paired, "offset">;
      }
      const p: Paired = { kioskId: r.kioskId, siteId: r.siteId, siteName: r.siteName, kioskName: r.kioskName, companyName: r.companyName, secret: r.secret, offset: r.serverNow ? r.serverNow - Date.now() : 0 };
      localStorage.setItem(KEY, JSON.stringify(p));
      setPaired(p);
      window.history.replaceState(null, "", "/kiosk");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "연결하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const p = load();
    setPaired(p);
    setReady(true);
    const c = q.get("c");
    if (!p && c) void pair(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1초마다 다시 그림 (30초마다 코드가 바뀜)
  useEffect(() => {
    if (!paired) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [paired]);

  // 화면 꺼짐 방지
  useEffect(() => {
    if (!paired) return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    void nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    return () => void lock?.release().catch(() => undefined);
  }, [paired]);

  // LIVE: 해제 여부 확인 + 서버 시각으로 태블릿 시계 오차 보정 (2분마다)
  useEffect(() => {
    if (!IS_LIVE || !paired) return;
    const check = async () => {
      const t0 = Date.now();
      const r = await api<{ active: boolean; now: number }>(`/api/kiosk/status?id=${encodeURIComponent(paired.kioskId)}`);
      if (!r.ok || !r.data) return;
      if (!r.data.active) setRevoked(true);
      const offset = r.data.now - Math.round((t0 + Date.now()) / 2);
      setPaired((p) => (p ? { ...p, offset } : p));
    };
    void check();
    const t = window.setInterval(() => void check(), 120_000);
    return () => window.clearInterval(t);
  }, [paired?.kioskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const serverNow = now + (paired?.offset ?? 0);
  const token = useMemo(() => (paired ? makeQrToken({ id: paired.kioskId, siteId: paired.siteId, secret: paired.secret }, serverNow) : ""), [paired, Math.floor(serverNow / QR_STEP_MS)]); // eslint-disable-line react-hooks/exhaustive-deps
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const qr = useMemo(() => (token ? qrPath(`${origin}/q/${token}`) : null), [token, origin]);
  const left = Math.ceil((QR_STEP_MS - (serverNow % QR_STEP_MS)) / 1000);

  if (!ready) return null;

  if (!paired)
    return (
      <main className="grid min-h-dvh place-items-center bg-[#F4F5F7] px-5 py-10" data-testid="kiosk-pair">
        <div className="w-full max-w-md space-y-5 rounded-3xl bg-white p-7 shadow-card">
          <div className="flex items-center gap-2.5">
            <LogoMark size={32} />
            <p className="text-[1rem] font-extrabold tracking-[0.06em]">현장 QR 단말기 연결</p>
          </div>
          <p className="text-[1.05rem] leading-relaxed text-ink-2">본사 ‘출퇴근 현황’에서 받은 8자리 연결 코드를 넣으세요. (코드는 30분 동안, 한 번만 쓸 수 있습니다)</p>
          <input
            aria-label="연결 코드"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 8))}
            className="num h-[4.5rem] w-full rounded-2xl border-2 border-line-strong text-center text-[2rem] font-extrabold tracking-[0.35em] focus:border-active focus:outline-none"
            placeholder="XXXXXXXX"
            autoCapitalize="characters"
            data-testid="kiosk-code"
          />
          {err && <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.02rem] font-bold text-err">{err}</p>}
          <button type="button" disabled={code.length !== 8 || busy} onClick={() => pair(code)} className="press h-[4rem] w-full rounded-2xl bg-cta text-[1.25rem] font-extrabold text-cta-text disabled:opacity-40" data-testid="kiosk-pair-submit">
            연결
          </button>
        </div>
      </main>
    );

  if (revoked)
    return (
      <main className="grid min-h-dvh place-items-center bg-[#F4F5F7] px-5" data-testid="kiosk-revoked">
        <div className="max-w-md space-y-4 rounded-3xl bg-white p-7 text-center shadow-card">
          <p className="text-[1.5rem] font-extrabold">이 단말기는 본사에서 해제되었습니다</p>
          <p className="text-[1.05rem] text-ink-2">새 연결 코드를 받아 다시 연결해 주세요.</p>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(KEY);
              setPaired(null);
              setRevoked(false);
            }}
            className="press h-14 w-full rounded-2xl border-2 border-line-strong text-[1.1rem] font-bold"
          >
            다시 연결하기
          </button>
        </div>
      </main>
    );

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-white px-5 py-6 text-center" data-testid="kiosk-live">
      <div className="space-y-1">
        <p className="text-[1rem] font-bold text-ink-2">
          {paired.companyName} · {paired.kioskName}
        </p>
        <h1 className="text-[2.2rem] font-extrabold leading-tight">{paired.siteName} 출근 QR</h1>
      </div>
      {qr && (
        <div className="rounded-3xl border-4 border-ink bg-white p-4" data-testid="kiosk-qr" data-token={token}>
          <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} className="block size-[min(72vw,60vh,30rem)]" role="img" aria-label="출근 QR 코드" shapeRendering="crispEdges">
            <rect x={-2} y={-2} width={qr.size + 4} height={qr.size + 4} fill="#fff" />
            <path d={qr.d} fill="#000" />
          </svg>
        </div>
      )}
      <div className="w-full max-w-md space-y-2">
        <div className="h-3 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <div className="h-full bg-active transition-[width] duration-1000 ease-linear" style={{ width: `${(left / (QR_STEP_MS / 1000)) * 100}%` }} />
        </div>
        <p className="num text-[1.1rem] font-bold text-ink-2" aria-live="off">
          {left}초 뒤에 새 QR로 바뀝니다 · {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(serverNow))}
        </p>
      </div>
      <p className="max-w-lg text-[1.35rem] font-bold leading-relaxed">
        휴대폰 TAEKANG 첫 화면에서 <span className="text-theme-ink">‘QR 찍고 출근’</span>을 누르고 이 화면을 찍으세요.
      </p>
      {!IS_LIVE && <p className="rounded-xl bg-[#FFF7D6] px-3 py-2 text-[0.9rem] font-bold text-[#7A5200]">DEMO · 가상 단말기</p>}
      <button
        type="button"
        onClick={() => {
          if (window.confirm("이 태블릿의 단말기 연결을 해제할까요? 다시 쓰려면 본사에서 새 코드를 받아야 합니다.")) {
            localStorage.removeItem(KEY);
            setPaired(null);
          }
        }}
        className="press mt-4 rounded-xl px-3 py-2 text-[0.9rem] font-semibold text-ink-3"
      >
        이 태블릿 연결 해제
      </button>
    </main>
  );
}

export default function KioskPage() {
  return (
    <Suspense fallback={null}>
      <KioskInner />
    </Suspense>
  );
}
