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
  AttendanceRecord,
} from "@/lib/domain/types";
import { siteFinancials, snapshotOf } from "@/lib/domain/calc";
import { CONSENT_VERSION } from "@/lib/domain/privacy";

const M = 1_000_000; // 백만 원

function dayOffset(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}
function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export const DEMO_USERS: DemoUser[] = [
  { id: "u-ceo", role: "ceo", name: "대표자", title: "DEMO" },
  { id: "u-manager", role: "manager", name: "박지훈", title: "공무과장 (가상)" },
  { id: "u-field", role: "field", name: "최성민", title: "현장소장 (가상)" },
  { id: "u-field2", role: "field", name: "정우진", title: "현장소장 (가상)" },
  { id: "u-partner", role: "partner", name: "가상 A건설", title: "원청 현장 공무", partnerSiteIds: ["site-a"] },
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
      clientName: "가상 A건설(주) · 원청",
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
      clientName: "가상 건축주 B(주) · 직발주",
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
      clientName: "가상 C건설(주) · 원청 (공공공사)",
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
      id: "pr-seed-a-2",
      siteId: "site-a",
      partnerUserId: "u-partner",
      type: "quote",
      title: "1층 관리사무실 창 추가 설치 — 견적 문의 (DEMO)",
      description: "관리사무실 남측 벽에 고정창 2개소 추가를 검토 중입니다. 대략적인 금액과 시공 가능 시기를 알려주세요.",
      item: "24mm 로이 복층유리 · 기존 프레임 동일",
      qty: "2개소 (약 6㎡)",
      status: "reviewing",
      createdAt: dayOffset(now, -1),
      updatedAt: dayOffset(now, -1),
      history: [
        { at: dayOffset(now, -1), status: "received", by: "u-partner" },
        { at: dayOffset(now, -1), status: "reviewing", by: "u-manager", note: "현장 실측 일정 확인 중" },
      ],
    },
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
      billingLagPp: 10,
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
    title: "2차 기성 잔금 수금 요청 (건축주 B)",
    description: "60일 경과 미수 잔액에 대해 지급 일정 확인 공문 발송",
    signalTitle: "B현장 2차 기성 미수 5,000만 원 · 기준 60일 초과",
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
    notes: [{ at: dayOffset(now, -2), by: "u-manager", text: "건축주 B 재무팀 통화 — 공문 요청받음 (DEMO)" }],
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
  seedAttendance(base, now);
  return base;
}

/**
 * 가상 현장 위치 + 출퇴근 기록 (DEMO) — 좌표는 실제 현장이 아닌 가상 값.
 * 본사 ‘출퇴근 현황’에서 의심 표시(현장 밖 출근·퇴근 누락·위치가 매일 똑같음)를 보여주기 위한 예시.
 * 손익 숫자에는 영향 없음.
 */
function seedAttendance(db: DemoDB, now: Date) {
  const GEO: Record<string, [number, number]> = { "site-a": [37.2636, 127.0286], "site-b": [37.5642, 126.9751], "site-c": [36.3504, 127.3845] };
  for (const s of db.sites) {
    const g = GEO[s.id];
    if (g) s.geo = { lat: g[0], lng: g[1], radiusM: 300, setAt: dayOffset(now, -30), setBy: "u-manager" };
  }
  const kstDate = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(now.getTime() + days * 86_400_000));
  const at = (date: string, hm: string) => new Date(`${date}T${hm}:00+09:00`).toISOString();
  const jitter = (base: number, i: number, k: number) => Math.round((base + (((i * 37 + k * 11) % 9) - 4) * 0.00011) * 1e6) / 1e6;
  const rec: AttendanceRecord[] = [];
  const nowIsoStr = now.toISOString();
  // 최성민 (A현장) — 지난 6일 정상 출퇴근 (오늘은 시연에서 직접 출근)
  for (let i = 1; i <= 6; i++) {
    const d = kstDate(-i);
    const [la, ln] = GEO["site-a"];
    const inLat = jitter(la, i, 1);
    const inLng = jitter(ln, i, 2);
    rec.push({
      id: `att-seed-a-${i}`,
      siteId: "site-a",
      userId: "u-field",
      workDate: d,
      inAt: at(d, `07:${String(30 + ((i * 7) % 25)).padStart(2, "0")}`),
      inGeo: { status: "inside", lat: inLat, lng: inLng, accuracyM: 12 + i, distanceM: 20 + i * 9 },
      inDevice: "dev-demo-choi",
      outAt: at(d, `17:${String(10 + ((i * 5) % 40)).padStart(2, "0")}`),
      outGeo: { status: "inside", lat: jitter(la, i, 3), lng: jitter(ln, i, 4), accuracyM: 15, distanceM: 30 + i * 7 },
      outDevice: "dev-demo-choi",
    });
  }
  // 정우진 (C현장) — 지난 3일 출근 위치가 소수점까지 똑같음 + 어제 퇴근 누락 + 오늘 현장에서 3.3km 떨어진 곳에서 출근
  const spot = { lat: 36.3712, lng: 127.3611 };
  for (let i = 1; i <= 3; i++) {
    const d = kstDate(-i);
    rec.push({
      id: `att-seed-c-${i}`,
      siteId: "site-c",
      userId: "u-field2",
      workDate: d,
      inAt: at(d, "07:58"),
      inGeo: { status: "outside", lat: spot.lat, lng: spot.lng, accuracyM: 5, distanceM: 3121 },
      inDevice: "dev-demo-jung",
      ...(i === 1 ? {} : { outAt: at(d, "17:02"), outGeo: { status: "outside" as const, lat: spot.lat, lng: spot.lng, accuracyM: 5, distanceM: 3121 }, outDevice: "dev-demo-jung" }),
    });
  }
  const today = kstDate(0);
  const inToday = at(today, "07:55");
  if (inToday <= nowIsoStr) {
    rec.push({ id: "att-seed-c-0", siteId: "site-c", userId: "u-field2", workDate: today, inAt: inToday, inGeo: { status: "outside", lat: 36.3721, lng: 127.4093, accuracyM: 18, distanceM: 3279 }, inDevice: "dev-demo-jung" });
  }
  db.attendance = rec;
  // 최성민은 예전 문구(1판)로 동의 → 문구가 2판으로 바뀌어 다음 출근 때 한 번 다시 묻는다 (좌표는 동의한 사람만 남는다는 규칙과 맞춤 · D-43)
  db.consents = [
    { userId: "u-field", at: dayOffset(now, -10), version: 1 },
    { userId: "u-field2", at: dayOffset(now, -20), version: CONSENT_VERSION, retentionDays: null, viewers: "hq" },
  ];
  // 앱 의견 (가상) — 반영된 것 1건, 확인 전 1건 (D-47)
  db.feedback = [
    { id: "fb-seed-1", at: dayOffset(now, -5), userId: "u-field2", category: "small_text", text: "출퇴근 버튼 아래 안내 글씨가 작아요 (가상)", route: "/field", status: "done", reply: "안내 글씨를 키웠습니다. 화면 위 ‘글자 크게’도 써 보세요 (가상)", reviewedAt: dayOffset(now, -4), reviewedBy: "u-manager" },
    { id: "fb-seed-2", at: dayOffset(now, -1), userId: "u-field", category: "location", text: "B현장 지하에서는 위치가 잘 안 잡혀요 (가상)", route: "/field", status: "new" },
  ];
  // 작업 인원(출력) — A현장 유리 설치팀 지난 5일 매일 4명 (사진은 실제 사진을 쓰지 않으므로 없음)
  db.crewChecks = [1, 2, 3, 4, 5].map((i) => ({
    id: `crew-seed-a-${i}`,
    siteId: "site-a",
    workDate: kstDate(-i),
    team: "유리 설치팀 (가상 협력업체)",
    kind: "subcontract" as const,
    headcount: 4,
    at: at(kstDate(-i), "07:50"),
    by: "u-field",
  }));
  // 주요 자재 수량 (가상 · D-62) — A현장 커튼월 유닛·로이유리, B현장 단열유리. C현장은 품목을 아직 정하지 않음
  //   A 유닛: 설계 240 · 반입 144 · 설치 108(45%) / A 유리: 설계 520 · 반입 180 · 설치 104(20%)
  //   B 유리: 설계 460 · 반입 260 · 설치 276 → ‘설치가 반입보다 많음’(반입 기록 빠짐 확인) 예시
  const MAT: Record<string, DemoDB["sites"][number]["materials"]> = {
    "site-a": [
      { id: "mat-a-unit", name: "커튼월 유닛", unit: "EA", plannedQty: 240 },
      { id: "mat-a-glass", name: "삼중 로이유리", unit: "장", plannedQty: 520 },
    ],
    "site-b": [{ id: "mat-b-glass", name: "단열유리 (복층)", unit: "장", plannedQty: 460 }],
  };
  db.sites = db.sites.map((s) => (MAT[s.id] ? { ...s, materials: MAT[s.id] } : s));
  const mv = (id: string, siteId: string, itemId: string, kind: "in" | "install", qty: number, day: number, hm: string, note?: string) => ({ id, siteId, itemId, kind, qty, workDate: kstDate(day), at: at(kstDate(day), hm), by: "u-field", ...(note ? { note } : {}) });
  db.materialMoves = [
    mv("mm-seed-a1", "site-a", "mat-a-unit", "in", 96, -40, "09:10", "이전 반입 누계 (가상)"),
    mv("mm-seed-a2", "site-a", "mat-a-unit", "install", 48, -35, "17:00", "이전 설치 누계 (가상)"),
    mv("mm-seed-a3", "site-a", "mat-a-glass", "in", 180, -6, "10:20", "송장 대조 완료 (가상)"),
    mv("mm-seed-a4", "site-a", "mat-a-unit", "in", 48, -3, "08:40"),
    ...[5, 4, 3, 2, 1].map((d) => mv(`mm-seed-a-u${d}`, "site-a", "mat-a-unit", "install", 12, -d, "16:30")),
    mv("mm-seed-a5", "site-a", "mat-a-glass", "install", 60, -2, "16:40"),
    mv("mm-seed-a6", "site-a", "mat-a-glass", "install", 44, -1, "16:45"),
    mv("mm-seed-b1", "site-b", "mat-b-glass", "in", 260, -20, "09:00", "이전 반입 누계 (가상)"),
    mv("mm-seed-b2", "site-b", "mat-b-glass", "install", 230, -15, "17:10", "이전 설치 누계 (가상)"),
    mv("mm-seed-b3", "site-b", "mat-b-glass", "install", 46, -1, "16:50", "8~9층 (가상)"),
  ];

  // 근태 수정 요청 (가상) — 정우진 어제 퇴근 누락, 본사 확인 대기
  db.attendanceRequests = [
    { id: "afr-seed-1", siteId: "site-c", userId: "u-field2", workDate: kstDate(-1), kind: "missed_out", outTime: "17:30", reason: "휴대폰 배터리가 꺼짐", status: "pending", createdAt: at(kstDate(0), "07:40"), attendanceId: "att-seed-c-1" },
  ].filter((q) => q.createdAt <= nowIsoStr) as DemoDB["attendanceRequests"];
  // 본사 작업지시 (가상)
  db.workOrders = [
    {
      id: "wo-seed-1",
      siteId: "site-a",
      title: "3층 남측 실링 보수 (원청 지적사항)",
      detail: "원청 점검에서 지적된 3층 남측 코너 실링 들뜸 보수. 보수 전·후 사진을 남겨 주세요.",
      assigneeUserId: "u-field",
      dueDate: kstDate(2),
      urgent: true,
      status: "sent" as const,
      createdAt: dayOffset(now, -0.2),
      createdBy: "u-manager",
      history: [{ at: dayOffset(now, -0.2), by: "u-manager", to: "sent" as const }],
    },
    {
      id: "wo-seed-2",
      siteId: "site-a",
      title: "변경 구간 유리 반입 수량 확인",
      detail: "삼중 로이유리 반입 수량을 송장과 대조해 알려 주세요.",
      assigneeUserId: "u-field",
      dueDate: kstDate(1),
      status: "in_progress" as const,
      createdAt: dayOffset(now, -2),
      createdBy: "u-manager",
      history: [
        { at: dayOffset(now, -2), by: "u-manager", to: "sent" as const },
        { at: dayOffset(now, -1.8), by: "u-field", to: "received" as const },
        { at: dayOffset(now, -1.5), by: "u-field", to: "in_progress" as const },
      ],
    },
  ];
  // 현장 QR 태블릿 (가상, 연결 완료) — DEMO 비밀값은 브라우저 안에만 있다
  db.kiosks = db.sites.map((s, i) => ({
    id: `kio_demo${i + 1}`,
    siteId: s.id,
    name: `${s.shortName} 현장 사무실 태블릿 (가상)`,
    secret: `demo-kiosk-secret-${s.id}-not-for-live`,
    createdAt: dayOffset(now, -30),
    createdBy: "u-manager",
    pairedAt: dayOffset(now, -30),
  }));
}

/** 미팅 시나리오 입력값 — '데모 값 채우기' 버튼에서 사용 */
export const DEMO_SCENARIO = {
  siteId: "site-a",
  workDone: "3층 남측 커튼월 유닛 10개 설치. 원청 요청(건축주 지시)으로 3층 남측 회의실 구간 유리 사양 상향 — 로이복층 → 삼중 로이유리, 글레이징 부자재 변경 포함.",
  issues: "사양 변경으로 유리 차액·부자재와 추가 인력 투입 발생. 원청 서면 작업지시서 미수령 — 변경공사 청구 근거 확보 필요.",
  tomorrowPlan: "3층 남측 실링 작업, 변경 구간 시공 사진·물량 정리.",
  costs: [
    { category: "material" as const, amount: 30_000_000, note: "변경 구간 유리 차액(로이복층→삼중)·글레이징 부자재 (개략)" },
    { category: "labor" as const, amount: 10_000_000, note: "변경 구간 추가 투입 인원 (약 30공수, 연장 작업)" },
  ],
  reason: "design_change" as const,
};
