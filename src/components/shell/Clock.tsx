"use client";

import { useEffect, useState } from "react";

const TZ = "Asia/Seoul";

function parts(d: Date) {
  const p = new Intl.DateTimeFormat("ko-KR", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { y: g("year"), m: g("month"), d: g("day"), w: g("weekday"), hh: g("hour"), mm: g("minute"), ss: g("second") };
}

/** 실시간 날짜·요일·시각(초) — 하드코딩 날짜 금지 (Asia/Seoul) */
export function Clock({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <span className={`num inline-block min-w-[9ch] ${className}`} aria-hidden>&nbsp;</span>;
  const p = parts(now);
  const iso = now.toISOString();
  return compact ? (
    <time dateTime={iso} className={`num whitespace-nowrap ${className}`} data-testid="clock">
      {p.m}.{p.d} {p.w} <span className="font-semibold">{p.hh}:{p.mm}:{p.ss}</span>
    </time>
  ) : (
    <time dateTime={iso} className={`num whitespace-nowrap ${className}`} data-testid="clock">
      {p.y}.{p.m}.{p.d} ({p.w}) <span className="font-semibold">{p.hh}:{p.mm}:{p.ss}</span>
    </time>
  );
}
