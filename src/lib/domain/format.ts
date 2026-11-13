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
export function fmtEok(v: number, opts: { digits?: number; unit?: boolean; fixed?: boolean } = {}): string {
  const digits = opts.digits ?? 2;
  const unit = opts.unit ?? true;
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  // 표 칸(fixed)은 소수 자리를 맞춘다 — ‘8.5’·‘12’·‘0.35’가 섞여 자릿수가 들쭉날쭉하던 문제 (D-68)
  const num = (n: number) => (opts.fixed ? n.toFixed(digits) : trimNum(n, digits));
  // 표 칸: 0은 ‘—’, 0.01억 미만은 만 원으로 (‘0.00억’·‘<0.01억’이 읽기 어렵던 문제 · D-68 점검 반영)
  if (opts.fixed && !unit && abs === 0) return "—";
  if (opts.fixed && !unit && abs < 1_000_000) return sign + fmtMan(abs, { unit: false });
  // 단위 없이(‘단위 억 원’ 표) 쓸 때는 1억 미만도 억으로 — 한 표에 ‘8,060만’과 ‘1.5’가 섞이던 문제 (D-66)
  if (abs < 100_000_000) return unit ? sign + fmtMan(abs, { unit }) : abs > 0 && abs < 1_000_000 ? `${sign}<0.01억` : `${sign}${num(abs / 100_000_000)}억`;
  return `${sign}${num(abs / 100_000_000)}억${unit ? " 원" : ""}`;
}

/** 만 단위: 30,000,000 → "3,000만 원", 1억 이상은 "1억 5,000만 원" */
export function fmtMan(v: number, opts: { unit?: boolean } = {}): string {
  const unit = opts.unit ?? true;
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(Math.round(v));
  if (abs === 0) return unit ? "0원" : "0";
  if (abs >= 100_000_000) {
    const eok = Math.floor(abs / 100_000_000);
    const rest = Math.round((abs % 100_000_000) / 10_000);
    return `${sign}${nf.format(eok)}억${rest ? ` ${nf.format(rest)}만` : ""}${unit ? " 원" : ""}`;
  }
  const man = abs / 10_000;
  const s = Number.isInteger(man) ? nf.format(man) : nf.format(Math.round(man * 10) / 10);
  return `${sign}${s}만${unit ? " 원" : ""}`;
}

/** 표 전용 만 원 숫자: 380,000,000 → "38,000" (열 머리에 '단위: 만 원' 표기) */
export function fmtManNum(v: number): string {
  const sign = v < 0 ? "−" : "";
  return sign + nf.format(Math.round(Math.abs(v) / 10_000));
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
  // 음수는 금액과 같은 ‘−’ 기호로 (한 줄에 ‘−0.30억’과 ‘-5.9%’가 섞이던 문제 · D-68 점검 반영)
  const t = trimNum(v, digits);
  return `${t.startsWith("-") ? (t === "-0" ? "0" : `−${t.slice(1)}`) : t}%`;
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

/**
 * ‘18억’, ‘1억 8천만’, ‘1.8억’, ‘18억5000만’, ‘3,500만’, ‘1,800,000,000’ → 원 단위 정수. 읽을 수 없으면 NaN.
 * 금액 칸에 ‘18억’을 치면 숫자만 남아 18원으로 저장되고 손익 기준이 망가지던 문제 (D-77 리허설).
 */
export function parseKoreanWon(input: string): number {
  const s = input.replace(/[,\s원₩]/g, "");
  if (s === "") return NaN;
  if (/^\d+$/.test(s)) return Number(s);
  const UNIT: Record<string, number> = { 조: 1e12, 억: 1e8, 천만: 1e7, 백만: 1e6, 만: 1e4, 천: 1e3 };
  const re = /(\d+(?:\.\d+)?)(조|억|천만|백만|만|천)?/gy;
  let total = 0;
  let pos = 0;
  let m: RegExpExecArray | null;
  while (pos < s.length && (m = re.exec(s))) {
    if (m[0] === "") break;
    const unit = m[2] ? UNIT[m[2]] : 1;
    // 단위 없는 소수(‘18.5’)는 원 단위로 받지 않는다
    if (!m[2] && m[1].includes(".")) return NaN;
    total += Number(m[1]) * unit;
    pos = re.lastIndex;
  }
  if (pos !== s.length) return NaN;
  return Math.round(total);
}

/** 입력 문자열 → 원 단위 정수 (쉼표·공백 제거). 잘못된 값이면 NaN */
export function parseWon(input: string): number {
  const cleaned = input.replace(/[,\s원]/g, "");
  if (cleaned === "") return NaN;
  if (!/^\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
}
