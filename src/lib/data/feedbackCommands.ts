/**
 * 현장 의견 (D-47) — 보내기: 본인 / 확인(반영함·보류 + 답변): 본사
 */
import type { DemoDB } from "@/lib/domain/types";
import { FEEDBACK_CATEGORIES, FEEDBACK_LABEL, FEEDBACK_STATUS_LABEL, scrubRoute, type Feedback, type FeedbackCategory, type FeedbackStatus } from "@/lib/domain/feedback";
import { uid } from "@/lib/domain/ids";
import { CommandError, claimKey, clone, log, nowIso, touch, userName, type Ctx } from "./commands";

export interface FeedbackInput {
  category: FeedbackCategory;
  text?: string;
  route?: string;
  idempotencyKey?: string;
}

export function sendFeedback(db0: DemoDB, input: FeedbackInput, ctx: Ctx) {
  if (!input || !FEEDBACK_CATEGORIES.includes(input.category)) throw new CommandError("어떤 점인지 골라 주세요.", "VALIDATION", { category: "종류" });
  if (input.text !== undefined && (typeof input.text !== "string" || input.text.length > 300)) throw new CommandError("내용은 300자까지 적을 수 있어요.", "VALIDATION", { text: "300자 이내" });
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const mine = (db.feedback ?? []).filter((f) => f.userId === ctx.userId && f.status === "new");
  if (mine.length >= 30) throw new CommandError("확인 전인 의견이 너무 많아요. 본사가 확인한 뒤 다시 보내 주세요.", "STATE");
  const f: Feedback = {
    id: uid("fb"),
    at: nowIso(ctx),
    userId: ctx.userId,
    category: input.category,
    text: (input.text ?? "").trim(),
    ...(input.route ? { route: scrubRoute(input.route) } : {}),
    status: "new",
  };
  db.feedback = [...(db.feedback ?? []), f];
  log(db, ctx, "feedback", `${userName(db, ctx.userId)} 앱 의견 — ${FEEDBACK_LABEL[f.category]}${f.text ? ` · ${f.text.slice(0, 40)}` : ""}`);
  touch(db, ctx);
  return { db, result: { feedbackId: f.id } };
}

export function reviewFeedback(db0: DemoDB, input: { feedbackId: string; status: FeedbackStatus; reply?: string }, ctx: Ctx) {
  const f = (db0.feedback ?? []).find((x) => x.id === input?.feedbackId);
  if (!f) throw new CommandError("의견을 찾을 수 없습니다.", "NOT_FOUND");
  if (!["new", "done", "hold"].includes(input.status)) throw new CommandError("상태를 골라 주세요.", "VALIDATION", { status: "상태" });
  if (input.reply !== undefined && (typeof input.reply !== "string" || input.reply.length > 300)) throw new CommandError("답변은 300자까지입니다.", "VALIDATION", { reply: "300자 이내" });
  const reply = (input.reply ?? "").trim();
  if (input.status === "hold" && !reply) throw new CommandError("보류할 때는 이유를 적어 주세요.", "VALIDATION", { reply: "보류 이유" });
  const db = clone(db0);
  db.feedback = (db.feedback ?? []).map((x) =>
    x.id === f.id ? { ...x, status: input.status, ...(reply ? { reply } : { reply: undefined }), reviewedAt: nowIso(ctx), reviewedBy: ctx.userId } : x,
  );
  log(db, ctx, "feedback", `앱 의견 ${FEEDBACK_STATUS_LABEL[input.status]} — ${userName(db, f.userId)} · ${FEEDBACK_LABEL[f.category]}${reply ? ` · ${reply.slice(0, 40)}` : ""}`);
  touch(db, ctx);
  return { db, result: { status: input.status } };
}
