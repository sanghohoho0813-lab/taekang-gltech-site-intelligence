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

export function themeCss(): string {
  return THEMES.map((t) => {
    const c = t.core;
    const v = (k: keyof ThemeDef["core"]) => c[k];
    const dark = !t.shellLight;
    const lines = [
      `--t-shell:${c.shell}`,
      `--t-primary:${c.primary}`,
      `--t-secondary:${c.secondary}`,
      `--t-accent:${c.accent}`,
      `--t-highlight:${c.highlight}`,
      `--t-soft:${c.soft}`,
      `--t-cta:${v(t.map.cta)}`,
      `--t-cta-text:#FFFFFF`,
      `--t-active:${v(t.map.active)}`,
      `--t-active-soft:color-mix(in srgb, ${v(t.map.active)} 12%, #FFFFFF)`,
      `--t-ink:${t.map.ink}`,
      `--t-wordmark:${v(t.map.wordmark)}`,
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
