/**
 * 개인위치정보 명령 — DEMO·LIVE 공용 순수 함수 (D-43)
 * - 보관 기간·볼 수 있는 사람 정하기 / 지금 정리 / 특정 직원 좌표 지우기: 대표만 (서버 권한 검사)
 * - 동의 철회: 본인만. 철회하면 본인 좌표를 바로 지우고, 다음 출근부터는 ‘위치 없이’ 기록된다.
 * - 자동 정리: 명령이 실행될 때 하루 한 번, 보관 기간이 지난 좌표를 지운다 (applyLocationRetention).
 *   판정(현장 안/밖)과 시각은 근무 기록으로 남는다.
 */
import type { DemoDB, LocationPolicy } from "@/lib/domain/types";
import { RETENTION_MAX, RETENTION_MIN, eraseCoordinates, kstToday, locationPolicy, retentionCutoff, retentionText, viewersText } from "@/lib/domain/privacy";
import { CommandError, clone, log, nowIso, touch, userName, type Ctx } from "./commands";

const SYSTEM: Pick<Ctx, "userId"> = { userId: "system" };

export interface LocationPolicyInput {
  retentionDays: number | null;
  viewers: LocationPolicy["viewers"];
}

export function setLocationPolicy(db0: DemoDB, input: LocationPolicyInput, ctx: Ctx) {
  const errors: Record<string, string> = {};
  const days = input?.retentionDays;
  if (days !== null && (!Number.isInteger(days) || days < RETENTION_MIN || days > RETENTION_MAX)) errors.retentionDays = `보관 기간은 ${RETENTION_MIN}~${RETENTION_MAX}일 사이로 정해주세요.`;
  if (input?.viewers !== "ceo" && input?.viewers !== "hq") errors.viewers = "볼 수 있는 사람을 골라주세요.";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  const db = clone(db0);
  const prev = locationPolicy(db);
  const next: LocationPolicy = { retentionDays: days, viewers: input.viewers, updatedAt: nowIso(ctx), ...(prev.purgedOn && days !== null ? { purgedOn: prev.purgedOn } : {}) };
  // 기간을 줄였으면 오늘 바로 다시 정리되도록
  if (prev.retentionDays !== days) delete next.purgedOn;
  db.settings = { ...(db.settings ?? { costApproval: "immediate", laborDayRate: 300_000 }), location: next };
  const reconsent = (prev.retentionDays !== null && (days === null || days > prev.retentionDays)) || (prev.viewers === "ceo" && input.viewers === "hq");
  log(
    db,
    ctx,
    "privacy",
    `개인위치정보 규칙 변경 — 보관 ${retentionText(days)} · 좌표 열람 ${viewersText(input.viewers)}${reconsent ? " · 직원에게 불리하게 바뀌어 다음 출근 때 다시 동의를 받음" : ""}`,
  );
  touch(db, ctx);
  return { db, result: { policy: next, reconsent } };
}

/** 보관 기간이 지난 좌표를 지금 지운다 (대표) */
export function purgeLocationsNow(db0: DemoDB, _input: Record<string, never>, ctx: Ctx) {
  void _input;
  const policy = locationPolicy(db0);
  const today = kstToday(ctx.now ?? new Date());
  if (!retentionCutoff(policy, today)) throw new CommandError("보관 기간을 먼저 정해주세요.", "STATE");
  const db = clone(db0);
  const count = eraseCoordinates(db, { expired: { today, policyDays: policy.retentionDays } });
  db.settings = { ...db.settings!, location: { ...policy, purgedOn: today } };
  log(db, ctx, "privacy", `보관 기간(${retentionText(policy.retentionDays)})이 지난 위치 좌표 ${count}건 삭제 (직접 실행)`);
  touch(db, ctx);
  return { db, result: { count } };
}

/** 특정 직원의 좌표를 모두 지운다 — 퇴사·본인 요청 처리 (대표) */
export function purgeMemberLocations(db0: DemoDB, input: { userId: string; reason?: string }, ctx: Ctx) {
  const u = db0.users.find((x) => x.id === input?.userId);
  if (!u) throw new CommandError("직원을 찾을 수 없습니다.", "NOT_FOUND");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 80) : "";
  const db = clone(db0);
  const count = eraseCoordinates(db, { userId: u.id });
  log(db, ctx, "privacy", `${userName(db, u.id)} 위치 좌표 ${count}건 삭제${reason ? ` — ${reason}` : ""}`);
  touch(db, ctx);
  return { db, result: { count } };
}

/** 본인 동의 철회 — 동의 기록을 지우고 본인 좌표를 바로 지운다 */
export function withdrawLocationConsent(db0: DemoDB, _input: Record<string, never>, ctx: Ctx) {
  void _input;
  const had = (db0.consents ?? []).some((c) => c.userId === ctx.userId);
  if (!had) throw new CommandError("위치 기록에 동의한 기록이 없습니다.", "STATE");
  const db = clone(db0);
  db.consents = (db.consents ?? []).filter((c) => c.userId !== ctx.userId);
  const count = eraseCoordinates(db, { userId: ctx.userId });
  log(db, ctx, "privacy", `${userName(db, ctx.userId)} 위치 기록 동의 철회 — 좌표 ${count}건 삭제`);
  touch(db, ctx);
  return { db, result: { count } };
}

/**
 * 자동 정리 (하루 한 번) — 명령을 실행하기 직전에 부른다. 할 일이 없으면 같은 객체를 그대로 돌려준다.
 * 명령이 실패하면 함께 되돌아가고, 다음 명령 때 다시 시도한다.
 */
export function applyLocationRetention(db: DemoDB, now: Date): DemoDB {
  const policy = locationPolicy(db);
  const today = kstToday(now);
  if (policy.purgedOn === today) return db;
  // 지금 규칙의 기간 또는 수집할 때 알린 기간(더 짧은 쪽)이 지난 좌표가 있을 때만 바꾼다.
  // eraseCoordinates는 바뀐 기록만 새 객체로 바꾸므로 얕은 복사로 충분하다 (명령마다 전체 복사하지 않게)
  const next: DemoDB = { ...db, activityLogs: [...db.activityLogs] };
  const count = eraseCoordinates(next, { expired: { today, policyDays: policy.retentionDays } });
  if (count === 0) return db;
  next.settings = { ...(next.settings ?? { costApproval: "immediate", laborDayRate: 300_000 }), location: { ...policy, purgedOn: today } };
  log(next, { ...SYSTEM, now }, "privacy", `보관 기간이 지난 위치 좌표 ${count}건 자동 삭제${policy.retentionDays != null ? ` (현재 ${retentionText(policy.retentionDays)})` : ""}`);
  // 화면이 새 데이터를 받도록 (명령이 아무것도 바꾸지 않아도)
  next.rev += 1;
  next.updatedAt = now.toISOString();
  return next;
}
