/**
 * Canonical 7 Theme × 6 Core Color (Unified v4.0 C절 / v2.0 4.1절)
 * Theme = Shell·Active·CTA·KPI 강조·Chart의 분위기만 바꾼다.
 * Neutral(본문·표·폼·모달)·Semantic(성공/경고/오류/정보)·Group Icon Hue는 Theme와 분리 (globals.css).
 *
 * 06 Onyx Gold는 태강지엘텍 참고 시안(다크 차콜 + 절제된 오렌지)에 맞춘 기본 Seed:
 *   Accent #B89032 → #E25A1C, Highlight #E0C76F → #F3B07E 두 값만 Brand Hue 튜닝 (마스터 6절 허용, DECISIONS D-06)
 */
export type ThemeId = "deep-navy" | "navy-gold" | "emerald-gold" | "forest-sage" | "deep-teal" | "onyx-gold" | "pure-white";

export interface ThemeDef {
  id: ThemeId;
  no: string;
  name: string;
  note?: string;
  core: { shell: string; primary: string; secondary: string; accent: string; highlight: string; soft: string };
  /** 원본(Canonical) 값과 다르게 튜닝된 키 */
  tuned?: Partial<Record<keyof ThemeDef["core"], string>>;
  shellLight: boolean;
  map: {
    cta: keyof ThemeDef["core"];
    active: keyof ThemeDef["core"];
    ink: string; // 흰 배경 위 강조 텍스트 (대비 4.5:1 이상)
    wordmark: keyof ThemeDef["core"];
    chart: [keyof ThemeDef["core"], keyof ThemeDef["core"], keyof ThemeDef["core"]];
  };
}

export const THEMES: ThemeDef[] = [
  {
    id: "deep-navy",
    no: "01",
    name: "Deep Navy Blue",
    core: { shell: "#0B1830", primary: "#2457D6", secondary: "#1687A7", accent: "#17A889", highlight: "#E7C873", soft: "#DCE8F7" },
    shellLight: false,
    map: { cta: "primary", active: "primary", ink: "#2457D6", wordmark: "highlight", chart: ["primary", "secondary", "accent"] },
  },
  {
    id: "navy-gold",
    no: "02",
    name: "Navy Gold",
    core: { shell: "#111A2D", primary: "#2847A7", secondary: "#A37A28", accent: "#D0A84B", highlight: "#F0D995", soft: "#EFE8D7" },
    shellLight: false,
    map: { cta: "primary", active: "primary", ink: "#2847A7", wordmark: "highlight", chart: ["primary", "secondary", "accent"] },
  },
  {
    id: "emerald-gold",
    no: "03",
    name: "Emerald Gold",
    core: { shell: "#11332B", primary: "#0E7663", secondary: "#2C9277", accent: "#B4862A", highlight: "#E8CE88", soft: "#E2F0EA" },
    shellLight: false,
    map: { cta: "primary", active: "primary", ink: "#0E7663", wordmark: "highlight", chart: ["primary", "accent", "secondary"] },
  },
  {
    id: "forest-sage",
    no: "04",
    name: "Forest Sage",
    core: { shell: "#17352C", primary: "#356E58", secondary: "#73977E", accent: "#A58E4D", highlight: "#D9D2AA", soft: "#E5ECE5" },
    shellLight: false,
    map: { cta: "primary", active: "primary", ink: "#356E58", wordmark: "highlight", chart: ["primary", "accent", "secondary"] },
  },
  {
    id: "deep-teal",
    no: "05",
    name: "Deep Teal",
    core: { shell: "#08323A", primary: "#087A83", secondary: "#1597A3", accent: "#D2704C", highlight: "#E9B59B", soft: "#DDEDEF" },
    shellLight: false,
    map: { cta: "primary", active: "primary", ink: "#087A83", wordmark: "highlight", chart: ["primary", "accent", "secondary"] },
  },
  {
    id: "onyx-gold",
    no: "06",
    name: "Onyx Gold",
    note: "태강 브랜드 기본 · Accent/Highlight 오렌지 튜닝",
    core: { shell: "#15171C", primary: "#343942", secondary: "#6A717C", accent: "#E25A1C", highlight: "#F3B07E", soft: "#E6E8EC" },
    tuned: { accent: "#B89032", highlight: "#E0C76F" },
    shellLight: false,
    map: { cta: "accent", active: "accent", ink: "#C2410C", wordmark: "accent", chart: ["accent", "primary", "secondary"] },
  },
  {
    id: "pure-white",
    no: "07",
    name: "Pure White",
    core: { shell: "#FFFFFF", primary: "#171B20", secondary: "#343B44", accent: "#6B7680", highlight: "#D47A4A", soft: "#FAFAF8" },
    shellLight: true,
    map: { cta: "primary", active: "highlight", ink: "#171B20", wordmark: "highlight", chart: ["primary", "highlight", "accent"] },
  },
];

export const DEFAULT_THEME: ThemeId = "onyx-gold";

/* ── WCAG 대비 보정 ─────────────────────────────────────────────
 * Core 6색은 그대로 두고, 글자가 올라가는 파생 토큰(CTA 배경·흰 글자 배지·강조 텍스트)만
 * 검은색을 조금씩 섞어 4.5:1(본문 기준)을 넘길 때까지 어둡게 한다. (QA_REPORT A11y, DECISIONS D-11)
 */
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
const lum = (c: number[]) => {
  const a = c.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};
export function contrast(a: string, b: string): number {
  const [l1, l2] = [lum(rgb(a)), lum(rgb(b))];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const mixHex = (a: string, b: string, pA: number) => toHex(rgb(a).map((v, i) => v * pA + rgb(b)[i] * (1 - pA)));
/** fg가 bg 위에서 min 대비를 넘을 때까지 검은색 비율을 2%씩 늘린다 */
export function ensureContrast(fg: string, bg: string, min = 4.6): string {
  let c = fg;
  for (let k = 0; k < 40 && contrast(c, bg) < min; k++) c = mixHex(fg, "#000000", 1 - (k + 1) * 0.02);
  return c;
}

/** 글자가 올라가는 차트 막대: 흰 글자 → 짙은 글자 → (둘 다 미달이면) 막대를 어둡게 + 흰 글자 */
function labelPair(bg: string): { fill: string; text: string } {
  if (contrast(bg, "#FFFFFF") >= 4.5) return { fill: bg, text: "#FFFFFF" };
  if (contrast(bg, "#111418") >= 4.5) return { fill: bg, text: "#111418" };
  return { fill: ensureContrast(bg, "#FFFFFF"), text: "#FFFFFF" };
}

/** 테마별 실제 사용 색 (CSS와 QA 테스트가 같은 값을 쓴다) */
export function themeTokens(t: ThemeDef) {
  const c = t.core;
  const active = c[t.map.active];
  const activeSoft = mixHex(active, "#FFFFFF", 0.12);
  return {
    cta: ensureContrast(c[t.map.cta], "#FFFFFF"),
    active,
    activeSoft,
    solid: ensureContrast(active, "#FFFFFF"),
    ink: ensureContrast(t.map.ink, activeSoft),
    chart1Label: labelPair(c[t.map.chart[0]]),
    chart2Label: labelPair(c[t.map.chart[1]]),
    /** Shell 위 Wordmark 보조 문구 (밝은 Shell에서 연한 Highlight가 묻히지 않게) */
    wordmark: ensureContrast(c[t.map.wordmark], c.shell),
  };
}

export function themeCss(): string {
  return THEMES.map((t) => {
    const c = t.core;
    const v = (k: keyof ThemeDef["core"]) => c[k];
    const tk = themeTokens(t);
    const dark = !t.shellLight;
    const lines = [
      `--t-shell:${c.shell}`,
      `--t-primary:${c.primary}`,
      `--t-secondary:${c.secondary}`,
      `--t-accent:${c.accent}`,
      `--t-highlight:${c.highlight}`,
      `--t-soft:${c.soft}`,
      `--t-cta:${tk.cta}`,
      `--t-cta-text:#FFFFFF`,
      `--t-active:${tk.active}`,
      `--t-active-soft:${tk.activeSoft}`,
      `--t-solid:${tk.solid}`,
      `--t-ink:${tk.ink}`,
      `--t-chart-1-fill:${tk.chart1Label.fill}`,
      `--t-chart-1-text:${tk.chart1Label.text}`,
      `--t-chart-2-fill:${tk.chart2Label.fill}`,
      `--t-chart-2-text:${tk.chart2Label.text}`,
      `--t-wordmark:${tk.wordmark}`,
      `--t-chart-1:${v(t.map.chart[0])}`,
      `--t-chart-2:${v(t.map.chart[1])}`,
      `--t-chart-3:${v(t.map.chart[2])}`,
      `--t-shell-text:${dark ? "#F3F4F6" : "#171B20"}`,
      `--t-shell-strong:${dark ? "#FFFFFF" : "#0B0D10"}`,
      `--t-shell-muted:${dark ? "#AEB7C3" : "#5F6B77"}`,
      `--t-shell-line:${dark ? "rgba(255,255,255,0.09)" : "#E7EAEE"}`,
      `--t-shell-hover:${dark ? "rgba(255,255,255,0.07)" : "#F3F4F6"}`,
      `--t-shell-active-bg:${dark ? `color-mix(in srgb, ${v(t.map.active)} 24%, ${c.shell})` : `color-mix(in srgb, ${v(t.map.active)} 12%, #FFFFFF)`}`,
      `--t-shell-card:${dark ? "rgba(255,255,255,0.05)" : "#F7F8FA"}`,
      `--t-icon-tint:${dark ? "20%" : "14%"}`,
    ];
    return `[data-theme="${t.id}"]{${lines.join(";")}}`;
  }).join("\n");
}
