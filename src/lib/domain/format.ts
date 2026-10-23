/** 금액·비율·날짜 표시. 모든 금액은 원 단위 정수, 공급가액(부가세 별도). */

const nf = new Intl.NumberFormat("ko-KR");

/** 30,000,000원 */
export function fmtWon(v: number): string {
  return `${nf.format(Math.round(v))}원`;
}

/** 소수점 이하 0은 지운다: 8.5 → "8.5", 9.0 → "9" */
function trimNum(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** 억 단위: 850,000,000 → "8.5억 원". 1억 미만이면 만 원 단위로 */
export function fmtEok(v: number, opts: { digits?: number; unit?: boolean } = {}): string {
  const digits = opts.digits ?? 2;
  const unit = opts.unit ?? true;
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs < 100_000_000) return sign + fmtMan(abs, { unit });
  return `${sign}${trimNum(abs / 100_000_000, digits)}억${unit ? " 원" : ""}`;
}

/** 만 단위: 30,000,000 → "3,000만 원" */
export function fmtMan(v: number, opts: { unit?: boolean } = {}): string {
  const unit = opts.unit ?? true;
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  const man = abs / 10_000;
  const s = Number.isInteger(man) ? nf.format(man) : nf.format(Math.round(man * 10) / 10);
  return `${sign}${s}만${unit ? " 원" : ""}`;
}

/** 증감 표기: +4,000만 원 / −4,000만 원 */
export function fmtDelta(v: number, style: "eok" | "man" = "man"): string {
  if (v === 0) return "변동 없음";
  const sign = v > 0 ? "+" : "−";
  const body = style === "eok" ? fmtEok(Math.abs(v)) : fmtMan(Math.abs(v));
  return sign + body;
}

export function fmtPct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "—";
  return `${trimNum(v, digits)}%`;
}

/** %p 증감: −4%p */
export function fmtPp(v: number, digits = 1): string {
  if (!Number.isFinite(v) || v === 0) return "0%p";
  const sign = v > 0 ? "+" : "−";
  return `${sign}${trimNum(Math.abs(v), digits)}%p`;
}

const tz = "Asia/Seoul";

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("ko-KR", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}.${g("month")}.${g("day")}`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("ko-KR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${fmtDate(iso)} ${time}`;
}

export function fmtTime(iso: string, seconds = false): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hour12: false,
  }).format(new Date(iso));
}

export function fmtRelative(iso: string, now = Date.now()): string {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 45) return "방금 전";
  if (diff < 3600) return `${Math.round(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.round(diff / 3600)}시간 전`;
  const days = Math.round(diff / 86400);
  if (days < 31) return `${days}일 전`;
  return fmtDate(iso);
}

/** Asia/Seoul 기준 YYYY-MM-DD */
export function todayIso(now = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return p;
}

export function daysBetween(fromIso: string, to = new Date()): number {
  return Math.floor((to.getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

/** 입력 문자열 → 원 단위 정수 (쉼표·공백 제거). 잘못된 값이면 NaN */
export function parseWon(input: string): number {
  const cleaned = input.replace(/[,\s원]/g, "");
  if (cleaned === "") return NaN;
  if (!/^\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
}
