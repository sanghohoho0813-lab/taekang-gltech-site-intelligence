/**
 * DEMO 시드 — 창호·유리·커튼월 업종의 "가상 현장 3개".
 * 실제 태강지엘텍의 현장·발주처·매출·계약이 아니다.
 * 날짜는 하드코딩하지 않고 시드 생성 시점(now) 기준 상대값으로 만든다.
 *
 * 미팅 시나리오(가상 현장 A): 계약 10억 · EAC 8.5억(발생 5.1억 + 잔여 3.4억) · 예상이익 1.5억 · 이익률 15%
 */
import type {
  ActionItem,
  CostBudget,
  CostCategory,
  CostEntry,
  CostForecast,
  DemoDB,
  DemoUser,
  FieldReport,
  PartnerRequest,
  PaymentReceived,
  ProgressBilling,
  Site,
  SiteContract,
  ChangeOrder,
  ActivityLog,
} from "@/lib/domain/types";
import { siteFinancials, snapshotOf } from "@/lib/domain/calc";

const M = 1_000_000; // 백만 원

function dayOffset(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}
function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export const DEMO_USERS: DemoUser[] = [
  { id: "u-ceo", role: "ceo", name: "대표자", title: "DEMO" },
  { id: "u-manager", role: "manager", name: "박관리", title: "과장 (가상)" },
  { id: "u-field", role: "field", name: "최현장", title: "현장소장 (가상)" },
  { id: "u-field2", role: "field", name: "정공무", title: "공무 대리 (가상)" },
  { id: "u-partner", role: "partner", name: "가상 발주처 A", title: "공사 담당자", partnerSiteIds: ["site-a"] },
];

export const ROLE_DEFAULT_USER: Record<string, string> = {
  ceo: "u-ceo",
  manager: "u-manager",
  field: "u-field",
  partner: "u-partner",
};

type Split = Record<CostCategory, number>;

interface SiteSeed {
  site: Omit<Site, "startDate" | "endDate" | "stages"> & { startOffset: number; endOffset: number };
  stages: { name: string; start: number; end: number; pct: number }[];
  contract: number;
  budget: Split;
  incurred: Split;
  remaining: Split;
  billings: { amount: number; offset: number }[];
  payments: { amount: number; offset: number; round?: number }[];
}

const SITES: SiteSeed[] = [
  {
    site: {
      id: "site-a",
      code: "TK-DEMO-A",
      name: "가상 현장 A · 물류센터 커튼월·창호 공사",
      shortName: "A현장",
      workType: "커튼월·창호",
      region: "경기 남부 (가상)",
      clientId: "client-a",
      clientName: "가상 발주처 A(주)",
      status: "active",
      progressPct: 58,
      managerUserId: "u-manager",
      fieldUserId: "u-field",
      illustration: "logistics",
      startOffset: -210,
      endOffset: 150,
    },
    stages: [
      { name: "앵커·브라켓 설치", start: -200, end: -120, pct: 100 },
      { name: "커튼월 유닛 제작", start: -150, end: -20, pct: 85 },
      { name: "커튼월 유닛 설치", start: -60, end: 60, pct: 45 },
      { name: "창호·유리 시공", start: -10, end: 110, pct: 20 },
      { name: "실링·마감·준공검사", start: 90, end: 150, pct: 0 },
    ],
    contract: 1000 * M,
    budget: { material: 380 * M, labor: 230 * M, subcontract: 150 * M, equipment: 50 * M, overhead: 40 * M },
    incurred: { material: 240 * M, labor: 130 * M, subcontract: 90 * M, equipment: 30 * M, overhead: 20 * M },
    remaining: { material: 140 * M, labor: 100 * M, subcontract: 60 * M, equipment: 20 * M, overhead: 20 * M },
    billings: [
      { amount: 200 * M, offset: -150 },
      { amount: 180 * M, offset: -90 },
      { amount: 170 * M, offset: -30 },
    ],
    payments: [
      { amount: 200 * M, offset: -120, round: 1 },
      { amount: 180 * M, offset: -60, round: 2 },
      { amount: 70 * M, offset: -8, round: 3 },
    ],
  },
  {
    site: {
      id: "site-b",
      code: "TK-DEMO-B",
      name: "가상 현장 B · 오피스 리모델링 창호 교체",
      shortName: "B현장",
      workType: "창호 교체·단열유리",
      region: "서울 (가상)",
      clientId: "client-b",
      clientName: "가상 발주처 B(주)",
      status: "active",
      progressPct: 72,
      managerUserId: "u-manager",
      fieldUserId: "u-field",
      illustration: "office",
      startOffset: -160,
      endOffset: 60,
    },
    stages: [
      { name: "기존 창호 철거", start: -150, end: -100, pct: 100 },
      { name: "프레임 설치", start: -110, end: -30, pct: 100 },
      { name: "단열유리 시공", start: -40, end: 30, pct: 60 },
      { name: "코킹·마감", start: 10, end: 60, pct: 10 },
    ],
    contract: 620 * M,
    budget: { material: 250 * M, labor: 150 * M, subcontract: 90 * M, equipment: 19_400_000, overhead: 30 * M },
    incurred: { material: 190 * M, labor: 105 * M, subcontract: 60 * M, equipment: 14 * M, overhead: 21 * M },
    remaining: { material: 60 * M, labor: 45 * M, subcontract: 30 * M, equipment: 5_400_000, overhead: 9 * M },
    billings: [
      { amount: 150 * M, offset: -130 },
      { amount: 150 * M, offset: -95 },
      { amount: 100 * M, offset: -40 },
    ],
    payments: [
      { amount: 150 * M, offset: -100, round: 1 },
      { amount: 100 * M, offset: -35, round: 2 },
    ],
  },
  {
    site: {
      id: "site-c",
      code: "TK-DEMO-C",
      name: "가상 현장 C · 공공청사 유리 아트리움·금속구조물 공사",
      shortName: "C현장",
      workType: "유리 아트리움·금속구조물",
      region: "충청권 (가상)",
      clientId: "client-c",
      clientName: "가상 발주처 C (공공)",
      status: "active",
      progressPct: 35,
      managerUserId: "u-manager",
      fieldUserId: "u-field2",
      illustration: "civic",
      startOffset: -120,
      endOffset: 240,
    },
    stages: [
      { name: "철골 하부구조", start: -110, end: -20, pct: 90 },
      { name: "아트리움 프레임 제작", start: -60, end: 60, pct: 40 },
      { name: "유리 설치", start: 30, end: 180, pct: 0 },
      { name: "금속 마감·준공", start: 150, end: 240, pct: 0 },
    ],
    contract: 1450 * M,
    budget: { material: 600 * M, labor: 300 * M, subcontract: 230 * M, equipment: 70 * M, overhead: 50 * M },
    incurred: { material: 260 * M, labor: 120 * M, subcontract: 70 * M, equipment: 30 * M, overhead: 20 * M },
    remaining: { material: 360 * M, labor: 190 * M, subcontract: 165 * M, equipment: 40 * M, overhead: 30 * M },
    billings: [
      { amount: 300 * M, offset: -60 },
      { amount: 200 * M, offset: -20 },
    ],
    payments: [{ amount: 300 * M, offset: -40, round: 1 }],
  },
];

/** 발생원가를 3회 나누어 과거 이력처럼 만든다 (합계는 정확히 유지) */
function splitIncurred(total: number): number[] {
  const a = Math.round((total * 0.45) / M) * M;
  const b = Math.round((total * 0.35) / M) * M;
  return [a, b, total - a - b];
}

export function createSeed(now = new Date()): DemoDB {
  const nowIso = now.toISOString();
  const sites: Site[] = [];
  const contracts: SiteContract[] = [];
  const budgets: CostBudget[] = [];
  const forecasts: CostForecast[] = [];
  const costEntries: CostEntry[] = [];
  const billings: ProgressBilling[] = [];
  const payments: PaymentReceived[] = [];

  for (const s of SITES) {
    const { startOffset, endOffset, ...rest } = s.site;
    sites.push({
      ...rest,
      startDate: dateOnly(dayOffset(now, startOffset)),
      endDate: dateOnly(dayOffset(now, endOffset)),
      stages: s.stages.map((st, i) => ({
        id: `${s.site.id}-stage-${i + 1}`,
        name: st.name,
        startDate: dateOnly(dayOffset(now, st.start)),
        endDate: dateOnly(dayOffset(now, st.end)),
        progressPct: st.pct,
      })),
    });
    const plannedCost = Object.values(s.budget).reduce((a, b) => a + b, 0);
    contracts.push({
      siteId: s.site.id,
      contractAmount: s.contract,
      signedDate: dateOnly(dayOffset(now, startOffset - 20)),
      plannedCostTotal: plannedCost,
    });
    (Object.keys(s.budget) as CostCategory[]).forEach((cat) => {
      budgets.push({ siteId: s.site.id, category: cat, amount: s.budget[cat] });
      forecasts.push({
        siteId: s.site.id,
        category: cat,
        remaining: s.remaining[cat],
        basisDate: dateOnly(dayOffset(now, -7)),
        note: "DEMO 기준 잔여예상원가 (월간 재추정 가정)",
      });
      const parts = splitIncurred(s.incurred[cat]);
      const offsets = [startOffset + 40, Math.round(startOffset / 2), -14];
      parts.forEach((amt, i) => {
        if (amt <= 0) return;
        const at = dayOffset(now, offsets[i]);
        costEntries.push({
          id: `${s.site.id}-seed-${cat}-${i + 1}`,
          siteId: s.site.id,
          category: cat,
          amount: amt,
          date: dateOnly(at),
          forecastImpact: "baseline",
          reason: "planned",
          note: `DEMO 기준 발생원가 ${i + 1}차 집계`,
          source: "SEED",
          createdBy: "u-manager",
          createdAt: at,
          status: "active",
        });
      });
    });
    s.billings.forEach((b, i) => {
      billings.push({
        id: `${s.site.id}-bill-${i + 1}`,
        siteId: s.site.id,
        round: i + 1,
        amount: b.amount,
        billedDate: dateOnly(dayOffset(now, b.offset)),
        status: "confirmed",
      });
    });
    s.payments.forEach((p, i) => {
      payments.push({
        id: `${s.site.id}-pay-${i + 1}`,
        siteId: s.site.id,
        billingId: p.round ? `${s.site.id}-bill-${p.round}` : undefined,
        amount: p.amount,
        receivedDate: dateOnly(dayOffset(now, p.offset)),
      });
    });
  }

  const changeOrders: ChangeOrder[] = [
    {
      id: "co-c-1",
      siteId: "site-c",
      title: "아트리움 유리 사양 변경 (DEMO)",
      amount: 80 * M,
      status: "submitted",
      requestedAt: dayOffset(now, -45),
      sourceEntryIds: [],
      note: "발주처 요청에 따른 사양 변경 — 승인 대기 (가상)",
    },
  ];

  const reports: FieldReport[] = [
    {
      id: "rpt-seed-a-1",
      siteId: "site-a",
      reportDate: dateOnly(dayOffset(now, -1)),
      workDone: "3층 동측 커튼월 유닛 12개 설치 완료. 앵커 볼트 토크 검사 실시.",
      issues: "오후 강풍 예보로 타워크레인 양중 2시간 중지.",
      tomorrowPlan: "3층 남측 유닛 설치, 실링 사전 점검.",
      photoIds: [],
      costEntryIds: [],
      createdBy: "u-field",
      createdAt: dayOffset(now, -1),
      status: "submitted",
    },
    {
      id: "rpt-seed-b-1",
      siteId: "site-b",
      reportDate: dateOnly(dayOffset(now, -2)),
      workDone: "8~9층 단열유리 교체 46매 완료.",
      issues: "입주사 업무시간 소음 민원 1건 — 작업시간 조정.",
      tomorrowPlan: "10층 프레임 보강, 유리 반입.",
      photoIds: [],
      costEntryIds: [],
      createdBy: "u-field",
      createdAt: dayOffset(now, -2),
      status: "submitted",
    },
    {
      id: "rpt-seed-c-1",
      siteId: "site-c",
      reportDate: dateOnly(dayOffset(now, -3)),
      workDone: "아트리움 하부 철골 용접 검사 완료.",
      issues: "유리 사양 변경 회신 대기로 발주 보류 중.",
      tomorrowPlan: "프레임 시제품 제작 착수.",
      photoIds: [],
      costEntryIds: [],
      createdBy: "u-field2",
      createdAt: dayOffset(now, -3),
      status: "submitted",
    },
  ];

  const partnerRequests: PartnerRequest[] = [
    {
      id: "pr-seed-a-1",
      siteId: "site-a",
      partnerUserId: "u-partner",
      type: "schedule",
      title: "준공 전 외관 점검 일정 문의 (DEMO)",
      description: "외관 점검 가능 일정을 알려주세요.",
      status: "answered",
      createdAt: dayOffset(now, -12),
      updatedAt: dayOffset(now, -11),
      reply: "실링·마감 공정 착수 후 협의 일정 안내 예정입니다. (DEMO 회신)",
      repliedBy: "u-manager",
      history: [
        { at: dayOffset(now, -12), status: "received", by: "u-partner" },
        { at: dayOffset(now, -11), status: "reviewing", by: "u-manager" },
        { at: dayOffset(now, -11), status: "answered", by: "u-manager", note: "일정 안내" },
      ],
    },
  ];

  const base: DemoDB = {
    version: 1,
    rev: 1,
    seededAt: nowIso,
    updatedAt: nowIso,
    company: {
      name: "(주)태강지엘텍",
      product: "TAEKANG SITE INTELLIGENCE",
      tagline: "AI 기반 창호·유리 공사 현장 수익·공정관리 플랫폼",
    },
    users: DEMO_USERS,
    sites,
    contracts,
    budgets,
    forecasts,
    costEntries,
    reports,
    photos: [],
    changeOrders,
    billings,
    payments,
    partnerRequests,
    signalStates: {},
    actions: [],
    proofEvents: [],
    activityLogs: [],
    baseline: {},
    thresholds: {
      targetMarginPct: 13,
      marginDropPp: 3,
      overrunPct: 5,
      costProgressGapPp: 10,
      receivableDays: 60,
      changeOrderPendingDays: 30,
    },
    idempotencyKeys: [],
  };

  // 기존 진행 중 조치 1건: B현장 미수금 회수 (가상)
  const fB = siteFinancials(base, "site-b");
  const actionB: ActionItem = {
    id: "act-seed-b-1",
    signalKey: "RECEIVABLE_OVERDUE:site-b",
    rule: "RECEIVABLE_OVERDUE",
    siteId: "site-b",
    title: "2차 기성 잔금 수금 요청 (발주처 B)",
    description: "60일 경과 미수 잔액에 대해 지급 일정 확인 공문 발송",
    signalTitle: "B현장 2차 기성 미수 · 60일 경과",
    signalWhy: ["확정 기성 4억 − 수금 2.5억 = 미수 1.5억", "2차 잔액 5,000만 원 60일 초과"],
    signalDetectedAt: dayOffset(now, -35),
    causeEntryIds: [],
    assigneeUserId: "u-manager",
    dueDate: dateOnly(dayOffset(now, 5)),
    status: "in_progress",
    createdAt: dayOffset(now, -3),
    createdBy: "u-manager",
    approvedBy: "u-manager",
    kpiBefore: {
      at: dayOffset(now, -3),
      eac: fB.eac,
      expectedProfit: fB.expectedProfit,
      marginPct: fB.marginPct,
      adjustedContract: fB.adjustedContract,
      pendingClaimAmount: fB.pendingChangeAmount,
    },
    notes: [{ at: dayOffset(now, -2), by: "u-manager", text: "발주처 B 재무팀 통화 — 공문 요청받음 (DEMO)" }],
    history: [
      { at: dayOffset(now, -3), by: "u-manager", to: "assigned" },
      { at: dayOffset(now, -2), by: "u-manager", from: "assigned", to: "in_progress" },
    ],
  };
  base.actions.push(actionB);

  const logs: ActivityLog[] = [
    { id: "log-seed-1", at: dayOffset(now, -1), by: "u-field", type: "report", siteId: "site-a", summary: "A현장 현장보고 등록 (원가 변동 없음)", link: "/sites/site-a" },
    { id: "log-seed-2", at: dayOffset(now, -3), by: "u-manager", type: "action", siteId: "site-b", summary: "B현장 미수금 회수 조치 생성·배정", link: "/insights" },
  ];
  base.activityLogs = logs;

  for (const s of sites) base.baseline[s.id] = snapshotOf(siteFinancials(base, s.id));
  return base;
}

/** 미팅 시나리오 입력값 — '데모 값 채우기' 버튼에서 사용 */
export const DEMO_SCENARIO = {
  siteId: "site-a",
  workDone: "3층 남측 커튼월 유닛 10개 설치. 발주처 요청으로 3층 일부 구간 유리 사양을 로이복층 → 삼중유리로 변경 시공.",
  issues: "사양 변경으로 유리 추가 발주 및 야간 추가 인력 투입 발생. 변경공사 청구 근거 확보 필요.",
  tomorrowPlan: "3층 남측 실링 작업, 변경 구간 시공 사진 정리.",
  costs: [
    { category: "material" as const, amount: 30_000_000, note: "삼중유리 추가 발주 (사양 변경분)" },
    { category: "labor" as const, amount: 10_000_000, note: "변경 구간 야간 추가 인력" },
  ],
  reason: "design_change" as const,
};
