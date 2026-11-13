/** Grouped Navigation (v4.0 B절) + 역할별 화면 노출. LIVE에서 실제 데이터 보안은 서버(src/server/authz.ts)가 담당한다. */
import type { RoleId } from "@/lib/domain/types";
import { IS_LIVE } from "@/lib/mode";

export type GroupId = "portal" | "ops" | "growth" | "ax" | "admin";

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
  /** 현장 직원에게 보이는 쉬운 이름 */
  fieldLabel?: string;
}

/** 역할에 맞는 메뉴 이름 (현장 직원은 쉬운 말) */
export function navLabel(item: Pick<NavItem, "label" | "fieldLabel">, role: RoleId): string {
  return role === "field" && item.fieldLabel ? item.fieldLabel : item.label;
}

export const GROUPS: { id: GroupId; label: string; color: string }[] = [
  // 발주처 포털은 고객에게 보이는 화면이라 내부 메뉴(고객·정산)와 섞지 않고 맨 위에 따로 둔다 (D-67)
  { id: "portal", label: "고객 화면", color: "var(--g-portal)" },
  { id: "ops", label: "운영", color: "var(--g-ops)" },
  { id: "growth", label: "고객·정산", color: "var(--g-growth)" },
  { id: "ax", label: "AX·성과", color: "var(--g-ax)" },
  { id: "admin", label: "관리", color: "var(--g-admin)" },
];

const INTERNAL: RoleId[] = ["ceo", "manager"];
const ALL_INTERNAL: RoleId[] = ["ceo", "manager", "field"];

export const NAV: NavItem[] = [
  { href: "/partner", label: "발주처 포털", icon: "Handshake", group: "portal", roles: ["ceo", "manager", "partner"], desc: "발주처가 보는 화면 — 공정·공개 사진·요청 (내부 금액 없음)" },
  { href: "/dashboard", label: "대시보드", icon: "LayoutDashboard", group: "ops", roles: INTERNAL, alsoAccess: ["field"], desc: "전체 현장 손익·위험 한눈에" },
  { href: "/sites", label: "현장 관리", fieldLabel: "내 현장", icon: "Building2", group: "ops", roles: ALL_INTERNAL, desc: "현장별 손익·원가·공정" },
  { href: "/field", label: "현장 보고", fieldLabel: "홈", icon: "ClipboardPen", group: "ops", roles: ALL_INTERNAL, desc: "모바일 일보·추가 비용 입력" },
  { href: "/daily", label: "공사일보", icon: "NotebookText", group: "ops", roles: INTERNAL, desc: "현장 보고·작업 인원·출퇴근·사진으로 자동 작성되는 공사일보·주간 보고 (인쇄)" },
  { href: "/photos", label: "사진대장", icon: "Images", group: "ops", roles: INTERNAL, desc: "현장 사진을 날짜·공종별로 모은 공사사진대장 (고른 사진만 인쇄)" },
  { href: "/orders", label: "지시·확인", icon: "ClipboardCheck", group: "ops", roles: INTERNAL, desc: "작업지시·현장 보고 확인·근태 수정 요청" },
  { href: "/schedule", label: "공정 일정", icon: "CalendarClock", group: "ops", roles: INTERNAL, desc: "계획 대비 늦은 공정·준공 예상·출근 공백" },
  { href: "/labor", label: "투입·인건비", icon: "HardHat", group: "ops", roles: INTERNAL, desc: "작업 인원 × 팀 단가 추정 vs 실제 노무비·누락 표시" },
  { href: "/attendance", label: "출퇴근 현황", icon: "MapPinCheck", group: "ops", roles: INTERNAL, desc: "GPS 출퇴근·보고 위치·의심 표시" },
  { href: "/my-actions", label: "내 조치", fieldLabel: "본사 요청", icon: "ListChecks", group: "ops", roles: ALL_INTERNAL, desc: "배정된 위험 조치 처리" },
  { href: "/my", label: "내 정보", icon: "UserRound", group: "ops", roles: ["field"], alsoAccess: ["ceo", "manager"], desc: "글자 크기·내가 보낸 보고·비밀번호" },
  { href: "/defects", label: "하자보수", icon: "Wrench", group: "growth", roles: INTERNAL, desc: "발주처·접수 QR·전화로 들어온 하자 — 작업지시·회신·처리 이력·관리대장 (인쇄)" },
  { href: "/finance", label: "기성·수금", icon: "Wallet", group: "growth", roles: INTERNAL, desc: "계약·변경공사·기성·입금·미수" },
  { href: "/report", label: "대표 보고서", icon: "FileBarChart", group: "growth", roles: INTERNAL, desc: "실시간 손익 변화 보고" },
  { href: "/close", label: "월 마감", icon: "CalendarCheck", group: "growth", roles: INTERNAL, desc: "지난달 기성·입금·원가·노무·출퇴근을 한 장에 · 닫기 전에 볼 것" },
  { href: "/insights", label: "위험 분석·조치", icon: "ShieldAlert", group: "ax", roles: INTERNAL, alsoAccess: ["field"], desc: "규칙 기반 진단 → 조치 → 결과" },
  { href: "/usage", label: "사용 현황", icon: "Activity", group: "ax", roles: INTERNAL, desc: "현장 직원 정착도·본사 응답 시간 (실사용 검증)" },
  { href: "/evidence", label: "실증 기록", icon: "BadgeCheck", group: "ax", roles: INTERNAL, desc: "조치 성과 기록·성과 지표·12주 계획" },
  { href: "/why-ax", label: "기획의도", icon: "Lightbulb", group: "ax", roles: ALL_INTERNAL, desc: "왜 이 AX인가", only: "demo" },
  { href: "/launch", label: "시범 운영 준비", icon: "Rocket", group: "admin", roles: INTERNAL, desc: "첫날 준비 점검 — 회사 설정·현장 위치·직원별 첫 로그인·휴대폰·위치 동의 · 로그인 쪽지 인쇄" },
  { href: "/data", label: "자료 이관·점검", icon: "FileUp", group: "admin", roles: INTERNAL, desc: "지난 기성·변경공사·출력·원가 엑셀 가져오기 · 현장별 자료 준비 점검" },
  { href: "/admin", label: "운영 관리", icon: "Building2", group: "admin", roles: INTERNAL, desc: "현장 등록·사용자·운영 설정·공무 확인", only: "live" },
  { href: "/quality", label: "오류·의견", icon: "MessageSquareWarning", group: "admin", roles: INTERNAL, desc: "현장 앱 의견 반영·앱 오류 기록 (4단계 검수 근거)" },
  { href: "/design", label: "상세설계서", icon: "FileText", group: "admin", roles: INTERNAL, desc: "계약 1단계 산출물 — 업무 흐름·화면·역할별 권한·데이터 구조·보안 설계 (인쇄·서명)" },
  { href: "/acceptance", label: "검수 확인서", icon: "FileCheck2", group: "admin", roles: INTERNAL, desc: "계약 단계별 기준·확인 방법·시스템에 쌓인 실사용 근거 (인쇄·서명)" },
  { href: "/audit", label: "활동 이력", icon: "History", group: "admin", roles: INTERNAL, desc: "누가·언제·무엇을 바꿨는지 회사 전체 검색·CSV (지워지지 않음)" },
  { href: "/help", label: "사용 안내", icon: "BookOpen", group: "admin", roles: ["ceo", "manager", "partner"], alsoAccess: ["field"], desc: "역할별 운영 매뉴얼 (인쇄용)" },
  { href: "/settings", label: "설정", icon: "Settings", group: "admin", roles: ["ceo", "manager", "field", "partner"], desc: IS_LIVE ? "화면·위험 기준·데이터 가져오기" : "테마·글자·역할·데모·데이터" },
  { href: "/presentation", label: "시연 모드", icon: "Presentation", group: "admin", roles: INTERNAL, desc: "실제 화면으로 따라 하는 시연", only: "demo" },
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
  // 발주처·현장 직원의 ‘설정’은 글자 크기·알림·비밀번호뿐 — 본사 설명(위험 기준·데이터 가져오기)을 보이지 않게 (D-77 리허설)
  return NAV.filter((n) => visible(n) && n.roles.includes(role)).map((n) => (n.href === "/settings" && IS_LIVE && (role === "partner" || role === "field") ? { ...n, desc: "글자 크기·알림·비밀번호" } : n));
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
      { href: "/field", label: "홈", icon: "Home" },
      { href: "/field/report", label: "보고하기", icon: "ClipboardPen" },
      { href: "/my-actions", label: "본사 요청", icon: "ListChecks" },
      { href: "/my", label: "내 정보", icon: "UserRound" },
    ];
  if (role === "partner")
    return [
      { href: "/partner", label: "현장현황", icon: "Handshake" },
      { href: "/help", label: "사용 안내", icon: "BookOpen" },
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
