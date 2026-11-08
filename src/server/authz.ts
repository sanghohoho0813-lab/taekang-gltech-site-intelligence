/**
 * 서버 권한 검사 (LIVE 모드의 실제 보안 경계).
 * 1) authorize: 역할·담당 현장·작성자 기준으로 명령 실행 가능 여부 판단 + 신뢰할 수 없는 입력을 서버 값으로 덮어쓰기
 * 2) viewFor: 역할별로 내려보낼 데이터만 남긴다 — 현장직원·발주처에게는 계약·원가·이익·기성·미수가 아예 전송되지 않음
 * 3) sanitizeResult: 명령 결과에서도 금액 정보 제거
 */
import { hasMoney, stripMoney } from "@/lib/domain/redact";
import { PARTNER_FEED_KEEP_DAYS, partnerProgressFeed, partnerRepairView, photoWithdrawn, replyPhotoIds } from "@/lib/domain/partnerFeed";

import { FIELD_COST_MAX } from "@/lib/domain/limits";
export { FIELD_COST_MAX };
import type { ActionItem, DemoDB, GeoStamp, SiteContract } from "@/lib/domain/types";
import { canSeeStamp, hasCoords, locationPolicy, stripGeo } from "@/lib/domain/privacy";
import { computeSignals } from "@/lib/domain/risk";
import { CommandError } from "@/lib/data/commands";
import type { CommandName } from "@/lib/data/registry";
import type { Member } from "./auth";

export class ForbiddenError extends Error {
  constructor(message = "이 작업을 할 권한이 없습니다.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export const canSeeMoney = (m: Pick<Member, "role">) => m.role === "ceo" || m.role === "manager";

/** 현장직원이 다룰 수 있는 현장: 현장 담당자로 지정됐거나 사용자에 배정된 현장 */
export function fieldSiteIds(m: Member, db: DemoDB): Set<string> {
  const ids = new Set(m.siteIds);
  for (const s of db.sites) if (s.fieldUserId === m.id) ids.add(s.id);
  return ids;
}

type Args = Record<string, unknown>;
const CEO_ONLY = new Set<CommandName>(["setLocationPolicy", "purgeLocationsNow", "purgeMemberLocations"]);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** 실행 가능하면 (서버 값으로 보정된) 인자를 돌려주고, 아니면 ForbiddenError */
export function authorize(m: Member, name: CommandName, argsIn: unknown, db: DemoDB, now = new Date()): unknown {
  if (!argsIn || typeof argsIn !== "object") throw new CommandError("요청 형식이 올바르지 않습니다.");
  const args = { ...(argsIn as Args) };

  // 위험 신호는 클라이언트가 보낸 내용을 믿지 않고 서버에서 다시 계산한 신호로 바꾼다
  if (name === "createAction") {
    const key = str((args.signal as Args | undefined)?.key);
    const signal = computeSignals(db, now).find((s) => s.key === key);
    if (!signal) throw new CommandError("위험 신호가 이미 해소되었거나 바뀌었습니다. 화면을 새로고침해주세요.", "STATE");
    args.signal = signal;
  }

  if (canSeeMoney(m)) {
    // 개인위치정보 규칙·좌표 삭제는 대표만 (관리자가 자기 열람 범위를 넓히거나 기록을 지우지 못하게 · D-43)
    if (CEO_ONLY.has(name) && m.role !== "ceo") throw new ForbiddenError("대표만 할 수 있습니다.");
    if (name === "submitFieldReport") args.source = args.source === "FIELD" ? "FIELD" : "PC";
    return args;
  }

  if (m.role === "field") {
    const sites = fieldSiteIds(m, db);
    const entry = (id: unknown) => db.costEntries.find((e) => e.id === id);
    const action = (id: unknown): ActionItem | undefined => db.actions.find((a) => a.id === id);
    const mine = (a?: ActionItem) => !!a && a.assigneeUserId === m.id;
    switch (name) {
      case "submitFieldReport":
        if (!sites.has(str(args.siteId))) throw new ForbiddenError("담당 현장에만 보고할 수 있습니다.");
        // 현장 입력 1건 상한 1억 원 — 원 단위 실수(1만 배)가 그대로 손익에 들어가지 않게, 큰 금액은 본사가 입력 (D-66 점검 반영)
        if (Array.isArray(args.costs) && (args.costs as { amount?: unknown }[]).some((c) => typeof c?.amount === "number" && c.amount > FIELD_COST_MAX))
          throw new ForbiddenError("현장에서는 1건에 1억 원까지 넣을 수 있어요. 금액을 확인하거나 본사에 알려 주세요.");
        args.source = "FIELD";
        return args;
      case "voidReport": {
        const r = db.reports.find((x) => x.id === args.reportId);
        if (!r || r.createdBy !== m.id) throw new ForbiddenError("본인이 등록한 보고만 되돌릴 수 있습니다.");
        // 본사 공무가 이미 확인(승인·반려)한 비용이 있으면 현장에서 혼자 취소할 수 없다
        if (r.costEntryIds.some((id) => entry(id)?.reviewedAt) || r.review?.status === "confirmed") throw new ForbiddenError("본사가 이미 확인한 보고입니다. 취소가 필요하면 본사에 요청해주세요.");
        return args;
      }
      case "voidCostEntry":
      case "editCostEntry": {
        const e = entry(args.entryId);
        if (!e || e.createdBy !== m.id || !sites.has(e.siteId)) throw new ForbiddenError("본인이 입력한 원가만 고칠 수 있습니다.");
        if (e.reviewedAt) throw new ForbiddenError("본사가 이미 확인한 원가입니다. 바꾸려면 본사에 요청해주세요.");
        // 원가 수정으로 현장 입력 상한(1억)을 넘기지 못하게 (D-67 점검 반영)
        if (name === "editCostEntry" && typeof (args.patch as { amount?: unknown } | undefined)?.amount === "number" && (args.patch as { amount: number }).amount > FIELD_COST_MAX)
          throw new ForbiddenError("현장에서는 1건에 1억 원까지 넣을 수 있어요. 금액을 확인하거나 본사에 알려 주세요.");
        return args;
      }
      case "setActionStatus":
        if (!mine(action(args.actionId))) throw new ForbiddenError("배정된 조치만 처리할 수 있습니다.");
        if (!["in_progress", "on_hold"].includes(str(args.to))) throw new ForbiddenError("현장에서는 진행 시작·보류만 바꿀 수 있습니다.");
        return args;
      case "addActionNote":
      case "completeAction":
        if (!mine(action(args.actionId))) throw new ForbiddenError("배정된 조치만 처리할 수 있습니다.");
        if (name === "completeAction") {
          // 현장 완료는 '확인 대기'로 남기고, 결과 확인(확정)은 본사가 한다
          const input = { ...((args.input as Args) ?? {}) };
          input.confirm = false;
          // 변경공사 청구(금액)는 본사만 — 현장에서 보낸 금액으로 변경공사가 생기지 않게 (D-66 점검 반영)
          input.registerChangeOrder = false;
          delete input.claimAmount;
          args.input = input;
        }
        return args;
      case "updateProgress":
        if (!sites.has(str(args.siteId))) throw new ForbiddenError("담당 현장의 공정률만 바꿀 수 있습니다.");
        return args;
      case "requestAttendanceFix":
        // 본인 근태만 (명령이 로그인 사용자 id로 기록) · 담당 현장만
        if (!sites.has(str(args.siteId))) throw new ForbiddenError("담당 현장의 근태만 요청할 수 있습니다.");
        return args;
      case "workOrderStep": {
        const w = (db.workOrders ?? []).find((x) => x.id === args.workOrderId);
        if (!w || w.assigneeUserId !== m.id) throw new ForbiddenError("나에게 온 작업지시만 처리할 수 있습니다.");
        return args;
      }
      case "supplementReport": {
        const r = db.reports.find((x) => x.id === args.reportId);
        if (!r || r.createdBy !== m.id) throw new ForbiddenError("본인이 보낸 보고만 보완할 수 있습니다.");
        return args;
      }
      case "withdrawLocationConsent":
        // 본인 동의만 (명령이 로그인 사용자 id로 처리)
        return {};
      case "reportDeviceCheck":
      case "sendFeedback":
        // 본인 것만 (명령이 로그인 사용자 id로 기록)
        return args;
      case "recordMaterial":
        if (!sites.has(str(args.siteId))) throw new ForbiddenError("담당 현장의 자재만 기록할 수 있습니다.");
        // 끝난·멈춘 현장에는 현장에서 새로 넣지 않는다 (본사는 정리용으로 넣을 수 있음 · 리뷰 반영 D-63)
        if (db.sites.find((s) => s.id === args.siteId)?.status !== "active") throw new ForbiddenError("진행 중인 현장에만 자재를 기록할 수 있습니다.");
        return args;
      case "voidMaterialMove": {
        const mv = (db.materialMoves ?? []).find((x) => x.id === args.moveId);
        if (!mv || mv.by !== m.id || !sites.has(mv.siteId)) throw new ForbiddenError("본인이 남긴 자재 기록만 취소할 수 있습니다.");
        // 현장에서는 오늘 남긴 것만 — 지난 기록(이미 인쇄한 공사일보·설치율 근거)은 본사가 사유를 남기고 취소 (리뷰 반영 D-63)
        // 자정 전에 누르고 자정 뒤에 전송된 기록(통신 불량 보관)도 받은 날이 오늘이면 취소할 수 있게 (D-66 점검 반영)
        if (mv.workDate !== kstDate(now.toISOString()) && kstDate(mv.at) !== kstDate(now.toISOString())) throw new ForbiddenError("지난 날 기록은 현장에서 취소할 수 없습니다. 본사에 취소를 요청해 주세요.");
        return args;
      }
      case "checkIn":
      case "checkOut":
      case "confirmQr":
      case "reportCrew":
        // 본인 출퇴근만 (명령이 로그인 사용자 id로 기록) · 담당 현장만
        if (!sites.has(str(args.siteId))) throw new ForbiddenError("담당 현장에만 출퇴근할 수 있습니다.");
        return args;
      default:
        throw new ForbiddenError();
    }
  }

  if (m.role === "partner") {
    if (name === "createPartnerRequest" && m.partnerSiteIds.includes(str(args.siteId))) return args;
    // 본인이 보낸, 지금 볼 수 있는 현장의 요청만 확인 (D-68)
    if (name === "confirmPartnerRequest") {
      const r = db.partnerRequests.find((x) => x.id === str(args.requestId));
      if (r && r.partnerUserId === m.id && m.partnerSiteIds.includes(r.siteId)) return args;
    }
    throw new ForbiddenError();
  }
  throw new ForbiddenError();
}

const zeroContract = (siteId: string): SiteContract => ({ siteId, contractAmount: 0, signedDate: "", plannedCostTotal: 0 });

/** 회사 목표 이익률·하락 기준은 내부 경영 정보 — 현장·발주처에는 작동하지 않는 값으로 바꿔 보낸다 */
const hideMarginTargets = (t: DemoDB["thresholds"]): DemoDB["thresholds"] => ({ ...t, targetMarginPct: 0, marginDropPp: 100 });

/** 현장 휴대폰에 보내는 기록 기간 (일) — 그보다 오래된 기록은 서버에 남아 있고 본사 화면에서 봅니다 */
export const FIELD_WINDOW_DAYS = 60;
const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

/**
 * 다른 사람의 출퇴근·작업 인원·보고 위치에서 좌표를 뺀다 (판정만 남김).
 * keep: 볼 수 있는 좌표인가 (현장 직원은 없음, 관리자는 지금 규칙·수집할 때 약속(대표만)을 함께 봄 · D-49)
 */
function withoutOthersCoords(db: DemoDB, me: string, keep: (g: GeoStamp) => boolean = () => false): Pick<DemoDB, "attendance" | "crewChecks" | "reports"> {
  const strip = (g: GeoStamp | undefined) => (hasCoords(g) && !keep(g) ? stripGeo(g) : g);
  return {
    attendance: (db.attendance ?? []).map((r) => (r.userId === me ? r : { ...r, inGeo: strip(r.inGeo)!, ...(r.outGeo ? { outGeo: strip(r.outGeo) } : {}) })),
    crewChecks: (db.crewChecks ?? []).map((c) => (c.by === me || !hasCoords(c.geo) ? c : { ...c, geo: strip(c.geo) })),
    reports: db.reports.map((r) => (r.createdBy === me || !hasCoords(r.geo) ? r : { ...r, geo: strip(r.geo) })),
  };
}

/** 역할별로 내려보낼 데이터만 남긴다 */
export function viewFor(m: Member, db: DemoDB, now = new Date()): DemoDB {
  // QR 단말기 비밀값·연결 코드는 누구에게도 내려보내지 않는다 (태블릿은 연결할 때 한 번만 받음)
  const kiosks = (db.kiosks ?? []).map((k) => {
    const { secret: _s, pairHash: _p, ...rest } = k;
    void _s;
    void _p;
    return rest;
  });
  const base = { ...db, idempotencyKeys: [], me: m.id, kiosks };
  if (canSeeMoney(m)) {
    if (m.role === "ceo") return { ...base, scope: "full" };
    // 관리자: 대표가 ‘좌표는 대표만’으로 정했거나, 그렇게 정했을 때 모은 좌표는 판정만 (본인 기록은 그대로 · D-43·D-49)
    const policy = locationPolicy(db);
    return { ...base, scope: "full", ...withoutOthersCoords(db, m.id, (g) => canSeeStamp(m.role, policy, g)) };
  }

  const users = db.users.map((u) => ({ id: u.id, role: u.role, name: u.name, title: u.title, ...(u.inactive ? { inactive: true } : {}) }));
  const empty = {
    contracts: [],
    budgets: [],
    forecasts: [],
    costEntries: [],
    reports: [],
    photos: [],
    changeOrders: [],
    billings: [],
    payments: [],
    partnerRequests: [],
    actions: [],
    proofEvents: [],
    activityLogs: [],
    baseline: {},
    signalStates: {},
    attendance: [],
    consents: [],
    deviceChecks: [],
    feedback: [],
    kiosks: [],
    crewChecks: [],
    attendanceRequests: [],
    workOrders: [],
    importBatches: [],
    materialMoves: [],
  } satisfies Partial<DemoDB>;

  if (m.role === "field") {
    const sites = fieldSiteIds(m, db);
    // 휴대폰에는 최근 60일 + 아직 끝나지 않은 것만 (데이터 사용량·개인정보 최소화, D-34)
    const since = kstDate(new Date(now.getTime() - FIELD_WINDOW_DAYS * 86_400_000).toISOString());
    // 위험 조치: 자동 생성된 근거 문구(signalTitle·signalWhy)·청구 금액·본사가 쓴 결과에는 금액이 들어가므로 빼고 보낸다 (D-41)
    const actions = db.actions
      .filter((a) => a.assigneeUserId === m.id)
      .map((a) => ({
        ...a,
        signalTitle: "",
        signalWhy: [],
        claimAmount: undefined,
        result: a.completedBy === m.id ? a.result : undefined,
        kpiBefore: { ...a.kpiBefore, eac: 0, expectedProfit: 0, marginPct: 0, adjustedContract: 0, pendingClaimAmount: 0 },
      }));
    const actionIds = new Set(actions.map((a) => a.id));
    // 같은 현장 동료의 보고·작업 인원 기록은 보되, 동료가 보낸 위치 좌표는 빼고 보낸다 (D-43)
    const others = withoutOthersCoords({ ...db, attendance: [] }, m.id);
    // 엑셀로 옮긴 지난 공정 기록(본사 메모 포함)은 현장 휴대폰에 보내지 않는다 — 현장 화면은 쓰지 않는다 (D-71 점검 반영)
    const reports = others.reports.filter((r) => sites.has(r.siteId) && !r.importBatchId && (r.reportDate >= since || (r.createdBy === m.id && r.review?.status === "returned")));
    const crewChecks = (others.crewChecks ?? []).filter((c) => sites.has(c.siteId) && c.workDate >= since);
    const workOrders = (db.workOrders ?? []).filter((w) => w.assigneeUserId === m.id && (w.status !== "confirmed" || kstDate(w.createdAt) >= since));
    const photoRefs = new Set([
      ...reports.flatMap((r) => [...r.photoIds, ...(r.supplements ?? []).flatMap((s) => s.photoIds)]),
      ...crewChecks.flatMap((c) => (c.photoId ? [c.photoId] : [])),
      ...workOrders.flatMap((w) => w.donePhotoIds ?? []),
      // 하자보수 작업지시: 발주처가 보낸 하자 사진 (D-68)
      ...workOrders.flatMap((w) => w.refPhotoIds ?? []),
    ]);
    // 자재 반입·설치는 담당 현장 것 전부 — 휴대폰이 보여 주는 누계·현장 보관 수량이 60일 밖 기록 때문에 틀리지 않게 (수량만 · 금액·좌표 없음)
    const materialMoves = (db.materialMoves ?? []).filter((x) => sites.has(x.siteId));
    return {
      ...base,
      ...empty,
      scope: "field",
      users,
      // 하자보증 본사 메모는 현장 휴대폰에 보내지 않는다 (D-70)
      sites: db.sites.filter((s) => sites.has(s.id)).map((s) => (s.warranty ? { ...s, warranty: { months: s.warranty.months, ...(s.warranty.completedDate ? { completedDate: s.warranty.completedDate } : {}), setAt: "", setBy: "" } } : s)),
      // 계산 엔진이 깨지지 않도록 금액 0의 빈 계약만 둔다 (현장 화면은 금액을 표시하지 않음)
      contracts: [...sites].map(zeroContract),
      costEntries: db.costEntries.filter((e) => e.createdBy === m.id && sites.has(e.siteId) && (e.date >= since || e.status === "pending")),
      reports,
      photos: db.photos.filter((p) => sites.has(p.siteId) && (photoRefs.has(p.id) || (!!p.actionId && actionIds.has(p.actionId)) || kstDate(p.createdAt) >= since)),
      // 발주처 요청은 현장 휴대폰에 보내지 않는다 — 회신 글에 금액이 들어갈 수 있고, 보수에 필요한 위치·사진은 작업지시에 담겨 간다 (D-68 점검 반영)
      partnerRequests: [],
      actions,
      // 실증 기록은 확인 여부만 (근거·결과 문구에 금액이 들어감)
      proofEvents: db.proofEvents
        .filter((p) => actionIds.has(p.action_id))
        .map((p) => ({ ...p, trigger: "", why: [], decision: "", action: "", result: "", kpi_before: {}, kpi_after: {} })),
      // 본인 활동 이력만 — 이력 문구는 본사용이라 ‘예상 총원가 …’ 같은 금액이 들어가므로 지우고 보낸다 (D-66 점검 반영)
      activityLogs: db.activityLogs.filter((l) => l.by === m.id).map((l) => (hasMoney(l.summary) ? { ...l, summary: stripMoney(l.summary) } : l)),
      // 출퇴근은 본인 기록만
      attendance: (db.attendance ?? []).filter((r) => r.userId === m.id && r.workDate >= since),
      consents: (db.consents ?? []).filter((c) => c.userId === m.id),
      deviceChecks: (db.deviceChecks ?? []).filter((c) => c.userId === m.id),
      feedback: (db.feedback ?? []).filter((f) => f.userId === m.id),
      // 작업 인원은 담당 현장 것만
      crewChecks,
      materialMoves,
      attendanceRequests: (db.attendanceRequests ?? []).filter((q) => q.userId === m.id && (q.workDate >= since || q.status === "pending")),
      workOrders,
      // 팀별 단가(협력업체 단가)는 현장에 보내지 않는다 — 노무비 입력에 쓰는 기본 일당만
      settings: db.settings ? { ...db.settings, teamRates: undefined } : db.settings,
      thresholds: hideMarginTargets(db.thresholds),
    };
  }

  // 발주처·협력사: 허용된 현장의 공정 정보와 본인 요청만
  const sites = new Set(m.partnerSiteIds);
  const myRequests = db.partnerRequests.filter((r) => sites.has(r.siteId) && r.partnerUserId === m.id);
  const myRequestIds = new Set(myRequests.map((r) => r.id));
  // 다른 발주처의 하자보수 회신 사진은 같은 현장이어도 보내지 않는다 (D-68)
  const mine = new Set(myRequests.flatMap((r) => r.replyPhotoIds ?? []));
  const othersReply = new Set([...replyPhotoIds(db)].filter((id) => !mine.has(id)));
  return {
    ...base,
    ...empty,
    scope: "partner",
    users: users.filter((u) => u.role !== "partner" || u.id === m.id).map((u) => (u.id === m.id ? { ...u, partnerSiteIds: m.partnerSiteIds } : u)),
    // 자재 품목·설계 수량(내부 운영 정보)은 빼고 보낸다 (D-62)
    // 하자보증은 기간·준공일만 — 본사 메모·입력한 사람은 빼고 (D-70)
    sites: db.sites.filter((s) => sites.has(s.id)).map(({ materials: _m, warranty, ...s }) => (void _m, warranty ? { ...s, warranty: { months: warranty.months, ...(warranty.completedDate ? { completedDate: warranty.completedDate } : {}), setAt: "", setBy: "" } } : s)),
    contracts: [...sites].map(zeroContract),
    // 작업지시 번호(내부)는 빼고, 보수 진행은 partnerRepairs로 단계·기한만 (D-68)
    partnerRequests: myRequests.map(({ linkedWorkOrderId: _w, ...r }) => (void _w, r)),
    partnerRepairs: Object.fromEntries(myRequests.flatMap((r) => {
      const v = partnerRepairView(db, r);
      return v ? [[r.id, v]] : [];
    })),
    photos: [
      // 본사가 공개한 사진만 — 내부 설명·연결된 보고/조치·찍은 사람은 빼고 공개 설명만 (D-67)
      ...db.photos
        .filter((p) => sites.has(p.siteId) && p.shared && !othersReply.has(p.id) && !photoWithdrawn(db, p))
        .map((p) => ({ id: p.id, siteId: p.siteId, dataUrl: p.dataUrl, caption: p.shared!.caption, createdAt: p.createdAt, createdBy: "", shared: { at: p.shared!.at, by: "", caption: p.shared!.caption } })),
      // 본인이 하자보수 요청에 첨부한 사진 (D-68)
      ...db.photos
        .filter((p) => !p.shared && !!p.partnerRequestId && myRequestIds.has(p.partnerRequestId))
        .map((p) => ({ id: p.id, siteId: p.siteId, dataUrl: p.dataUrl, caption: "첨부 사진", createdAt: p.createdAt, createdBy: m.id, partnerRequestId: p.partnerRequestId })),
    ],
    // 공정 변화 — 보고 원문 없이 공정·진척만 서버가 만들어 보낸다 (포털은 최근 14일, 월간 보고서는 지난달까지 · D-68)
    partnerFeed: Object.fromEntries([...sites].map((id) => [id, partnerProgressFeed(db, id, kstDate(now.toISOString()), PARTNER_FEED_KEEP_DAYS)])),
    // 내부 운영 설정(일당 등)은 숨기고, 가상 데이터 회사라는 표시만 전달
    settings: db.settings?.sampleData ? { costApproval: "immediate", laborDayRate: 0, sampleData: true } : undefined,
    thresholds: hideMarginTargets(db.thresholds),
  };
}

/** 명령 결과에서 금액 정보 제거 (현장직원·발주처) */
export function sanitizeResult(m: Member, result: unknown): unknown {
  if (canSeeMoney(m) || !result || typeof result !== "object") return result;
  const r = { ...(result as Record<string, unknown>) };
  delete r.before;
  delete r.after;
  return r;
}
