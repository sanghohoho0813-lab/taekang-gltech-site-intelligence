/** Grouped Navigation (v4.0 B절) + 역할별 화면 노출. LIVE에서 실제 데이터 보안은 서버(src/server/authz.ts)가 담당한다. */
import type { RoleId } from "@/lib/domain/types";
import { IS_LIVE } from "@/lib/mode";

export type GroupId = "ops" | "growth" | "ax" | "admin";

export interface NavItem {
  href: string;
  label: string;
  icon: string; // lucide icon name (components/shell/icons.tsx에서 매핑)
  group: GroupId;
  roles: RoleId[];
  /** 메뉴에는 없지만 역할별 대체 화면으로 접근 가능한 역할 (예: 현장직원의 /dashboard = 현장 홈) */
  alsoAccess?: RoleId[];
  desc: string;
  /** DEMO(영업 시연)에서만 / LIVE(실제 운영)에서만 보이는 메뉴 */
  only?: "demo" | "live";
}

export const GROUPS: { id: GroupId; label: string; color: string }[] = [
  { id: "ops", label: "운영", color: "var(--g-ops)" },
  { id: "growth", label: "고객·정산", color: "var(--g-growth)" },
  { id: "ax", label: "AX·성과", color: "var(--g-ax)" },
  { id: "admin", label: "관리", color: "var(--g-admin)" },
];

const INTERNAL: RoleId[] = ["ceo", "manager"];
const ALL_INTERNAL: RoleId[] = ["ceo", "manager", "field"];

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "대시보드", icon: "LayoutDashboard", group: "ops", roles: INTERNAL, alsoAccess: ["field"], desc: "전체 현장 손익·위험 한눈에" },
  { href: "/sites", label: "현장 관리", icon: "Building2", group: "ops", roles: ALL_INTERNAL, desc: "현장별 손익·원가·공정" },
  { href: "/field", label: "현장 보고", icon: "ClipboardPen", group: "ops", roles: ALL_INTERNAL, desc: "모바일 일보·추가 비용 입력" },
  { href: "/my-actions", label: "내 조치", icon: "ListChecks", group: "ops", roles: ALL_INTERNAL, desc: "배정된 위험 조치 처리" },
  { href: "/finance", label: "기성·수금", icon: "Wallet", group: "growth", roles: INTERNAL, desc: "계약·변경공사·기성·입금·미수" },
  { href: "/report", label: "대표 보고서", icon: "FileBarChart", group: "growth", roles: INTERNAL, desc: "실시간 손익 변화 보고" },
  { href: "/partner", label: "발주처 포털", icon: "Handshake", group: "growth", roles: ["ceo", "manager", "partner"], desc: "발주처·협력사 상태 공유" },
  { href: "/insights", label: "위험 분석·조치", icon: "ShieldAlert", group: "ax", roles: INTERNAL, alsoAccess: ["field"], desc: "규칙 기반 진단 → 조치 → 결과" },
  { href: "/evidence", label: "실증 Evidence", icon: "BadgeCheck", group: "ax", roles: INTERNAL, desc: "Proof Event·KPI·12주 계획" },
  { href: "/why-ax", label: "기획의도", icon: "Lightbulb", group: "ax", roles: ALL_INTERNAL, desc: "왜 이 AX인가", only: "demo" },
  { href: "/admin", label: "운영 관리", icon: "Building2", group: "admin", roles: INTERNAL, desc: "현장 등록·사용자·운영 설정·공무 확인", only: "live" },
  { href: "/settings", label: "설정", icon: "Settings", group: "admin", roles: ["ceo", "manager", "field", "partner"], desc: IS_LIVE ? "화면·위험 기준·데이터 가져오기" : "테마·글자·역할·데모·데이터" },
  { href: "/presentation", label: "시연 모드", icon: "Presentation", group: "admin", roles: INTERNAL, desc: "실제 화면 Guided Demo", only: "demo" },
];

const visible = (n: NavItem) => !n.only || n.only === (IS_LIVE ? "live" : "demo");

/** 경로별 접근 가능 역할 (권한 프리뷰) */
export function canAccess(role: RoleId, pathname: string): boolean {
  if (pathname === "/") return true;
  const item = NAV.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"));
  if (!item) return true;
  if (!visible(item)) return false;
  return item.roles.includes(role) || !!item.alsoAccess?.includes(role);
}

export function navFor(role: RoleId): NavItem[] {
  return NAV.filter((n) => visible(n) && n.roles.includes(role));
}

export function homeFor(role: RoleId): string {
  if (role === "partner") return "/partner";
  if (role === "field") return "/field";
  return "/dashboard";
}

/** 모바일 Bottom Nav (핵심 4개 + 더보기) */
export function bottomNavFor(role: RoleId): { href: string; label: string; icon: string }[] {
  if (role === "field")
    return [
      { href: "/field", label: "현장보고", icon: "ClipboardPen" },
      { href: "/my-actions", label: "내 조치", icon: "ListChecks" },
      { href: "/sites", label: "내 현장", icon: "Building2" },
    ];
  if (role === "partner")
    return [
      { href: "/partner", label: "현장현황", icon: "Handshake" },
      { href: "/settings", label: "설정", icon: "Settings" },
    ];
  return [
    { href: "/dashboard", label: "홈", icon: "LayoutDashboard" },
    { href: "/sites", label: "현장", icon: "Building2" },
    { href: "/insights", label: "위험·조치", icon: "ShieldAlert" },
    { href: "/report", label: "보고서", icon: "FileBarChart" },
  ];
}

export const PERMISSION_MATRIX: { feature: string; ceo: string; manager: string; field: string; partner: string }[] = [
  { feature: "전체 현장 손익·이익률", ceo: "✓", manager: "✓", field: "✕", partner: "✕" },
  { feature: "현장 원가 입력·현장보고", ceo: "✓", manager: "✓", field: "✓ (담당 현장)", partner: "✕" },
  { feature: "위험 분석·조치 생성/배정", ceo: "✓", manager: "✓", field: "✕", partner: "✕" },
  { feature: "배정된 조치 처리", ceo: "✓", manager: "✓", field: "✓ (본인)", partner: "✕" },
  { feature: "기성·수금·변경공사 승인", ceo: "✓", manager: "✓", field: "✕", partner: "✕" },
  { feature: "대표 보고서", ceo: "✓", manager: "✓", field: "✕", partner: "✕" },
  { feature: "발주처 포털 (진행률·요청)", ceo: "미리보기", manager: "미리보기", field: "✕", partner: "✓ (본인 현장)" },
  { feature: "내부 원가·이익·미수·타 현장", ceo: "✓", manager: "✓", field: "부분", partner: "✕ 비노출" },
];
