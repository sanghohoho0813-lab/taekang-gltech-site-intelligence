/**
 * 명령 목록 — DEMO(브라우저)와 LIVE(서버)가 같은 순수 함수를 같은 이름으로 실행한다.
 * 화면은 run(이름, 인자)만 호출하고, 어디서 실행·저장되는지는 저장소 모드가 결정한다.
 */
import type { ActionStatus, ChangeOrderStatus, DemoDB, PartnerRequest, RiskThresholds } from "@/lib/domain/types";
import type { RiskSignal } from "@/lib/domain/types";
import * as C from "./commands";
import * as A from "./adminCommands";

type Ctx = C.Ctx;

export const COMMANDS = {
  submitFieldReport: (db: DemoDB, a: C.FieldReportInput, ctx: Ctx) => C.submitFieldReport(db, a, ctx),
  voidReport: (db: DemoDB, a: { reportId: string }, ctx: Ctx) => C.voidReport(db, a.reportId, ctx),
  voidCostEntry: (db: DemoDB, a: { entryId: string; reason: string }, ctx: Ctx) => C.voidCostEntry(db, a.entryId, a.reason, ctx),
  editCostEntry: (db: DemoDB, a: { entryId: string; patch: Parameters<typeof C.editCostEntry>[2] }, ctx: Ctx) => C.editCostEntry(db, a.entryId, a.patch, ctx),
  createAction: (db: DemoDB, a: { signal: RiskSignal; title: string; description: string; assigneeUserId: string; dueDate: string; idempotencyKey?: string }, ctx: Ctx) =>
    C.createAction(db, a, ctx),
  assignAction: (db: DemoDB, a: { actionId: string; assigneeUserId: string; dueDate?: string }, ctx: Ctx) => C.assignAction(db, a.actionId, a.assigneeUserId, a.dueDate, ctx),
  setActionStatus: (db: DemoDB, a: { actionId: string; to: ActionStatus; note?: string }, ctx: Ctx) => C.setActionStatus(db, a.actionId, a.to, a.note, ctx),
  addActionNote: (db: DemoDB, a: { actionId: string; text: string; photoDataUrl?: string }, ctx: Ctx) => C.addActionNote(db, a.actionId, a.text, a.photoDataUrl, ctx),
  completeAction: (db: DemoDB, a: { actionId: string; input: C.CompleteActionInput }, ctx: Ctx) => C.completeAction(db, a.actionId, a.input, ctx),
  confirmProofEvent: (db: DemoDB, a: { proofId: string }, ctx: Ctx) => C.confirmProofEvent(db, a.proofId, ctx),
  createPartnerRequest: (db: DemoDB, a: Parameters<typeof C.createPartnerRequest>[1], ctx: Ctx) => C.createPartnerRequest(db, a, ctx),
  updatePartnerRequest: (db: DemoDB, a: { requestId: string; patch: Parameters<typeof C.updatePartnerRequest>[2] }, ctx: Ctx) => C.updatePartnerRequest(db, a.requestId, a.patch, ctx),
  setChangeOrderStatus: (db: DemoDB, a: { coId: string; status: ChangeOrderStatus; approvedAmount?: number }, ctx: Ctx) => C.setChangeOrderStatus(db, a.coId, a.status, a.approvedAmount, ctx),
  addBilling: (db: DemoDB, a: Parameters<typeof C.addBilling>[1], ctx: Ctx) => C.addBilling(db, a, ctx),
  addPayment: (db: DemoDB, a: Parameters<typeof C.addPayment>[1], ctx: Ctx) => C.addPayment(db, a, ctx),
  setThresholds: (db: DemoDB, a: RiskThresholds, ctx: Ctx) => C.setThresholds(db, a, ctx),
  importCostRows: (db: DemoDB, a: { rows: C.CsvCostRow[]; idempotencyKey: string }, ctx: Ctx) => C.importCostRows(db, a.rows, a.idempotencyKey, ctx),
  // 운영 관리 (현장·실행예산·설정·공무 확인)
  saveSite: (db: DemoDB, a: A.SaveSiteInput, ctx: Ctx) => A.saveSite(db, a, ctx),
  updateForecast: (db: DemoDB, a: A.UpdateForecastInput, ctx: Ctx) => A.updateForecast(db, a, ctx),
  updateProgress: (db: DemoDB, a: A.UpdateProgressInput, ctx: Ctx) => A.updateProgress(db, a, ctx),
  setCompanySettings: (db: DemoDB, a: A.CompanySettingsInput, ctx: Ctx) => A.setCompanySettings(db, a, ctx),
  reviewCostEntry: (db: DemoDB, a: A.ReviewCostEntryInput, ctx: Ctx) => A.reviewCostEntry(db, a, ctx),
} as const;

export type CommandName = keyof typeof COMMANDS;
export type CommandArgs<N extends CommandName> = Parameters<(typeof COMMANDS)[N]>[1];
export type CommandResult<N extends CommandName> = ReturnType<(typeof COMMANDS)[N]>["result"];

export function isCommandName(x: unknown): x is CommandName {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(COMMANDS, x);
}

export type { PartnerRequest };
