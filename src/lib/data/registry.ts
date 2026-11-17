/**
 * 명령 목록 — DEMO(브라우저)와 LIVE(서버)가 같은 순수 함수를 같은 이름으로 실행한다.
 * 화면은 run(이름, 인자)만 호출하고, 어디서 실행·저장되는지는 저장소 모드가 결정한다.
 */
import type { ActionStatus, ChangeOrderStatus, CostCategory, DemoDB, PartnerRequest, RiskThresholds } from "@/lib/domain/types";
import type { RiskSignal } from "@/lib/domain/types";
import * as C from "./commands";
import { reconcileProfit } from "./profitLedger";
import { CATEGORY_LABEL } from "@/lib/domain/labels";
import { fmtMan } from "@/lib/domain/format";
import * as A from "./adminCommands";
import * as T from "./attendanceCommands";
import * as O from "./opsCommands";
import * as I from "./importCommands";
import * as P from "./privacyCommands";
import * as D from "./deviceCommands";
import * as F from "./feedbackCommands";
import * as M from "./materialCommands";
import * as PT from "./portalCommands";
import * as SH from "./shareCommands";
import * as IN from "./intakeCommands";
import * as MC from "./closeCommands";
import * as CO from "./changeOrderCommands";

type Ctx = C.Ctx;

const R = reconcileProfit;
const entrySite = (db: DemoDB, id: unknown) => db.costEntries.find((x) => x.id === id)?.siteId;
const entryLabel = (db: DemoDB, id: string) => {
  const e = db.costEntries.find((x) => x.id === id);
  return e ? `${CATEGORY_LABEL[e.category]} ${fmtMan(e.amount)}${e.note ? ` ${e.note.slice(0, 30)}` : ""}` : "원가";
};
const contractLabel = (db: DemoDB, siteId: string, a: A.SaveSiteInput) => {
  const before = db.contracts.find((c) => c.siteId === siteId)?.contractAmount;
  return before !== undefined && a.id === siteId && before !== a.contractAmount ? `원 계약 변경 ${fmtMan(before)} → ${fmtMan(a.contractAmount)}` : "현장 정보 수정";
};

export const COMMANDS = {
  // 돈이 움직이는 명령은 실행 뒤 ‘이익을 바꾼 일’로 설명되지 않는 이익 변화를 그때 기록한다 (D-85 · profitLedger)
  submitFieldReport: (db: DemoDB, a: C.FieldReportInput, ctx: Ctx) => R(db, C.submitFieldReport(db, a, ctx), ctx, "현장 보고 원가 반영 차이", undefined, [a?.siteId]),
  voidReport: (db: DemoDB, a: { reportId: string }, ctx: Ctx) => R(db, C.voidReport(db, a.reportId, ctx), ctx, "현장 보고 되돌림 — 그 보고의 원가 취소", undefined, [db.reports.find((r) => r.id === a?.reportId)?.siteId]),
  voidCostEntry: (db: DemoDB, a: { entryId: string; reason: string }, ctx: Ctx) => R(db, C.voidCostEntry(db, a.entryId, a.reason, ctx), ctx, `원가 취소 — ${entryLabel(db, a.entryId)}${typeof a.reason === "string" && a.reason.trim() ? ` (${a.reason.trim().slice(0, 40)})` : ""}`, a.entryId, [entrySite(db, a?.entryId)]),
  editCostEntry: (db: DemoDB, a: { entryId: string; patch: Parameters<typeof C.editCostEntry>[2] }, ctx: Ctx) => R(db, C.editCostEntry(db, a.entryId, a.patch, ctx), ctx, `원가 고침 — ${entryLabel(db, a.entryId)}`, a.entryId, [entrySite(db, a?.entryId)]),
  createAction: (db: DemoDB, a: { signal: RiskSignal; title: string; description: string; assigneeUserId: string; dueDate: string; idempotencyKey?: string }, ctx: Ctx) =>
    C.createAction(db, a, ctx),
  assignAction: (db: DemoDB, a: { actionId: string; assigneeUserId: string; dueDate?: string }, ctx: Ctx) => C.assignAction(db, a.actionId, a.assigneeUserId, a.dueDate, ctx),
  setActionStatus: (db: DemoDB, a: { actionId: string; to: ActionStatus; note?: string }, ctx: Ctx) => C.setActionStatus(db, a.actionId, a.to, a.note, ctx),
  addActionNote: (db: DemoDB, a: { actionId: string; text: string; photoDataUrl?: string }, ctx: Ctx) => C.addActionNote(db, a.actionId, a.text, a.photoDataUrl, ctx),
  completeAction: (db: DemoDB, a: { actionId: string; input: C.CompleteActionInput }, ctx: Ctx) => C.completeAction(db, a.actionId, a.input, ctx),
  confirmProofEvent: (db: DemoDB, a: { proofId: string }, ctx: Ctx) => C.confirmProofEvent(db, a.proofId, ctx),
  createPartnerRequest: (db: DemoDB, a: Parameters<typeof C.createPartnerRequest>[1], ctx: Ctx) => C.createPartnerRequest(db, a, ctx),
  updatePartnerRequest: (db: DemoDB, a: { requestId: string; patch: Parameters<typeof C.updatePartnerRequest>[2] }, ctx: Ctx) => C.updatePartnerRequest(db, a.requestId, a.patch, ctx),
  confirmPartnerRequest: (db: DemoDB, a: { requestId: string; note?: string }, ctx: Ctx) => C.confirmPartnerRequest(db, a, ctx),
  setChangeOrderStatus: (db: DemoDB, a: { coId: string; status: ChangeOrderStatus; approvedAmount?: number; addedCost?: { category: CostCategory; amount: number }; note?: string; followUp?: string; date?: string; basis?: "contract" | "letter" | "verbal" }, ctx: Ctx) =>
    R(db, C.setChangeOrderStatus(db, a.coId, a.status, a.approvedAmount, ctx, a.addedCost, { note: a.note, followUp: a.followUp, date: a.date, basis: a.basis }), ctx, "변경공사 반영 차이", undefined, [db.changeOrders.find((c) => c.id === a?.coId)?.siteId]),
  // 변경공사 회수 관리 (D-84) — 본사만
  createChangeOrder: (db: DemoDB, a: CO.CreateChangeOrderInput, ctx: Ctx) => CO.createChangeOrder(db, a, ctx),
  logChangeOrder: (db: DemoDB, a: CO.LogChangeOrderInput, ctx: Ctx) => CO.logChangeOrder(db, a, ctx),
  declineClaim: (db: DemoDB, a: CO.DeclineClaimInput, ctx: Ctx) => CO.declineClaim(db, a, ctx),
  // 변경공사 증빙 파일 (D-88) — 금액은 바뀌지 않는다
  addChangeOrderEvidence: (db: DemoDB, a: CO.AddEvidenceInput, ctx: Ctx) => CO.addChangeOrderEvidence(db, a, ctx),
  removeChangeOrderEvidence: (db: DemoDB, a: CO.RemoveEvidenceInput, ctx: Ctx) => CO.removeChangeOrderEvidence(db, a, ctx),
  updateChangeOrderEvidence: (db: DemoDB, a: CO.UpdateEvidenceInput, ctx: Ctx) => CO.updateChangeOrderEvidence(db, a, ctx),
  addBilling: (db: DemoDB, a: Parameters<typeof C.addBilling>[1], ctx: Ctx) => C.addBilling(db, a, ctx),
  addPayment: (db: DemoDB, a: Parameters<typeof C.addPayment>[1], ctx: Ctx) => C.addPayment(db, a, ctx),
  setThresholds: (db: DemoDB, a: RiskThresholds, ctx: Ctx) => C.setThresholds(db, a, ctx),
  importCostRows: (db: DemoDB, a: { rows: C.CsvCostRow[]; idempotencyKey: string }, ctx: Ctx) => R(db, C.importCostRows(db, a.rows, a.idempotencyKey, ctx), ctx, "원가 가져오기"),
  importData: (db: DemoDB, a: I.ImportDataInput, ctx: Ctx) => R(db, I.importData(db, a, ctx), ctx, "자료 가져오기"),
  undoImport: (db: DemoDB, a: { batchId: string }, ctx: Ctx) => R(db, I.undoImport(db, a, ctx), ctx, "가져오기 취소"),
  // 운영 관리 (현장·실행예산·설정·공무 확인)
  saveSite: (db: DemoDB, a: A.SaveSiteInput, ctx: Ctx) => R(db, A.saveSite(db, a, ctx), ctx, (siteId) => contractLabel(db, siteId, a), undefined, [a?.id]),
  updateForecast: (db: DemoDB, a: A.UpdateForecastInput, ctx: Ctx) => R(db, A.updateForecast(db, a, ctx), ctx, "잔여예상 재추정 차이", undefined, [a?.siteId]),
  // 월 마감 노무 정산 (D-79) — 본사만 (현장·발주처는 목록 밖이라 거절)
  settleLabor: (db: DemoDB, a: A.SettleLaborInput, ctx: Ctx) => R(db, A.settleLabor(db, a, ctx), ctx, "노무 정산 차이", undefined, [a?.siteId]),
  // 노무비·외주비에 팀 붙이기 (D-81) — 본사만
  setCostTeams: (db: DemoDB, a: A.SetCostTeamsInput, ctx: Ctx) => A.setCostTeams(db, a, ctx),
  // 월 마감 기록 (D-82) — 마감·다시 열기는 본사, 확인은 대표만
  closeMonth: (db: DemoDB, a: MC.CloseMonthInput, ctx: Ctx) => MC.closeMonth(db, a, ctx),
  confirmMonthClose: (db: DemoDB, a: MC.ConfirmMonthCloseInput, ctx: Ctx) => MC.confirmMonthClose(db, a, ctx),
  reopenMonthClose: (db: DemoDB, a: MC.ReopenMonthCloseInput, ctx: Ctx) => MC.reopenMonthClose(db, a, ctx),
  updateProgress: (db: DemoDB, a: A.UpdateProgressInput, ctx: Ctx) => A.updateProgress(db, a, ctx),
  setCompanySettings: (db: DemoDB, a: A.CompanySettingsInput, ctx: Ctx) => A.setCompanySettings(db, a, ctx),
  reviewCostEntry: (db: DemoDB, a: A.ReviewCostEntryInput, ctx: Ctx) => R(db, A.reviewCostEntry(db, a, ctx), ctx, `공무 확인 — ${entryLabel(db, a.entryId)}`, a.entryId, [entrySite(db, a?.entryId)]),
  // 출퇴근 (GPS)
  checkIn: (db: DemoDB, a: T.CheckInput, ctx: Ctx) => T.checkIn(db, a, ctx),
  checkOut: (db: DemoDB, a: T.CheckInput, ctx: Ctx) => T.checkOut(db, a, ctx),
  setSiteGeo: (db: DemoDB, a: T.SiteGeoInput, ctx: Ctx) => T.setSiteGeo(db, a, ctx),
  correctAttendance: (db: DemoDB, a: T.CorrectAttendanceInput, ctx: Ctx) => T.correctAttendance(db, a, ctx),
  // 출퇴근 여러 건 한 번에 정정 (D-80 겹침 정리) — 본사만
  correctAttendanceBatch: (db: DemoDB, a: T.CorrectAttendanceBatchInput, ctx: Ctx) => T.correctAttendanceBatch(db, a, ctx),
  confirmQr: (db: DemoDB, a: { siteId: string; qrToken: string }, ctx: Ctx) => T.confirmQr(db, a, ctx),
  reportCrew: (db: DemoDB, a: T.CrewInput, ctx: Ctx) => T.reportCrew(db, a, ctx),
  // 자재 반입·설치 수량 (D-62) — 품목은 본사, 기록은 현장(담당 현장)·본사, 취소는 현장 본인 것만
  setSiteMaterials: (db: DemoDB, a: { siteId: string; items: M.MaterialItemInput[] }, ctx: Ctx) => M.setSiteMaterials(db, a, ctx),
  setSiteWarranty: (db: DemoDB, a: A.WarrantyInput, ctx: Ctx) => A.setSiteWarranty(db, a, ctx),
  recordMaterial: (db: DemoDB, a: M.MaterialMoveInput, ctx: Ctx) => M.recordMaterial(db, a, ctx),
  voidMaterialMove: (db: DemoDB, a: { moveId: string; reason: string }, ctx: Ctx) => M.voidMaterialMove(db, a, ctx),
  // 발주처 포털 공개 사진 (D-67) — 본사만
  setPhotoShare: (db: DemoDB, a: PT.PhotoShareInput, ctx: Ctx) => PT.setPhotoShare(db, a, ctx),
  // 본사–현장 소통
  requestAttendanceFix: (db: DemoDB, a: O.FixRequestInput, ctx: Ctx) => O.requestAttendanceFix(db, a, ctx),
  reviewAttendanceFix: (db: DemoDB, a: Parameters<typeof O.reviewAttendanceFix>[1], ctx: Ctx) => O.reviewAttendanceFix(db, a, ctx),
  createWorkOrder: (db: DemoDB, a: O.WorkOrderInput, ctx: Ctx) => O.createWorkOrder(db, a, ctx),
  workOrderStep: (db: DemoDB, a: Parameters<typeof O.workOrderStep>[1], ctx: Ctx) => O.workOrderStep(db, a, ctx),
  reviewWorkOrder: (db: DemoDB, a: Parameters<typeof O.reviewWorkOrder>[1], ctx: Ctx) => O.reviewWorkOrder(db, a, ctx),
  reviewReport: (db: DemoDB, a: Parameters<typeof O.reviewReport>[1], ctx: Ctx) => O.reviewReport(db, a, ctx),
  supplementReport: (db: DemoDB, a: Parameters<typeof O.supplementReport>[1], ctx: Ctx) => O.supplementReport(db, a, ctx),
  createKiosk: (db: DemoDB, a: { siteId: string; name?: string }, ctx: Ctx) => T.createKiosk(db, a, ctx),
  revokeKiosk: (db: DemoDB, a: { kioskId: string }, ctx: Ctx) => T.revokeKiosk(db, a, ctx),
  // 개인위치정보 (D-43) — 규칙·정리는 대표만, 동의 철회는 본인
  setLocationPolicy: (db: DemoDB, a: P.LocationPolicyInput, ctx: Ctx) => P.setLocationPolicy(db, a, ctx),
  purgeLocationsNow: (db: DemoDB, a: Record<string, never>, ctx: Ctx) => P.purgeLocationsNow(db, a, ctx),
  purgeMemberLocations: (db: DemoDB, a: { userId: string; reason?: string }, ctx: Ctx) => P.purgeMemberLocations(db, a, ctx),
  withdrawLocationConsent: (db: DemoDB, a: Record<string, never>, ctx: Ctx) => P.withdrawLocationConsent(db, a, ctx),
  // 휴대폰 점검 (D-46) — 본인 결과만
  reportDeviceCheck: (db: DemoDB, a: D.DeviceCheckInput, ctx: Ctx) => D.reportDeviceCheck(db, a, ctx),
  // 앱 의견 (D-47) — 보내기는 본인, 확인은 본사
  sendFeedback: (db: DemoDB, a: F.FeedbackInput, ctx: Ctx) => F.sendFeedback(db, a, ctx),
  reviewFeedback: (db: DemoDB, a: Parameters<typeof F.reviewFeedback>[1], ctx: Ctx) => F.reviewFeedback(db, a, ctx),
  // 보고서 링크 (D-73) — 본사만. 링크를 열어 본 기록은 명령이 아니라 서버 전용 경로(/api/share)에서 남긴다
  createShare: (db: DemoDB, a: SH.CreateShareInput, ctx: Ctx) => SH.createShare(db, a, ctx),
  revokeShare: (db: DemoDB, a: { shareId: string }, ctx: Ctx) => SH.revokeShare(db, a, ctx),
  // 하자 접수 링크 (D-74) — 만들기·닫기·진행 확인 주소 다시 만들기는 본사만. 접수·확인(로그인 없는 사람)은 명령이 아니라 서버 전용 경로(/api/intake)
  createIntake: (db: DemoDB, a: { siteId: string; label?: string; place?: string }, ctx: Ctx) => IN.createIntake(db, a, ctx),
  closeIntake: (db: DemoDB, a: { intakeId: string }, ctx: Ctx) => IN.closeIntake(db, a, ctx),
  reopenIntakeLink: (db: DemoDB, a: { intakeId: string }, ctx: Ctx) => IN.reopenIntakeLink(db, a, ctx),
  renewIntakeStatus: (db: DemoDB, a: { requestId: string }, ctx: Ctx) => IN.renewIntakeStatus(db, a, ctx),
  discardIntakeRequests: (db: DemoDB, a: { requestIds: string[]; reason: IN.DiscardReason }, ctx: Ctx) => IN.discardIntakeRequests(db, a, ctx),
  registerPhoneDefect: (db: DemoDB, a: Parameters<typeof IN.registerPhoneDefect>[1], ctx: Ctx) => IN.registerPhoneDefect(db, a, ctx),
  reopenIntakeRequest: (db: DemoDB, a: { requestId: string; note: string }, ctx: Ctx) => IN.reopenIntakeRequest(db, a, ctx),
  // pairKiosk는 목록에 넣지 않는다 — 로그인하지 않은 태블릿 전용 경로(/api/kiosk/pair)에서만 실행
} as const;

export type CommandName = keyof typeof COMMANDS;
export type CommandArgs<N extends CommandName> = Parameters<(typeof COMMANDS)[N]>[1];
export type CommandResult<N extends CommandName> = ReturnType<(typeof COMMANDS)[N]>["result"];

export function isCommandName(x: unknown): x is CommandName {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(COMMANDS, x);
}

export type { PartnerRequest };
