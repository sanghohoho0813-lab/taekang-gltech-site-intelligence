/**
 * 보고서 링크 (D-73) — 본사가 월간 공정 보고서·준공 보고서를 ‘로그인 없이 여는 읽기 전용 주소’로 만들어 발주처에 보낸다.
 * 주소의 비밀값은 이 명령의 결과로 한 번만 돌려주고 저장하지 않는다 (저장하는 것은 해시뿐).
 */
import type { DemoDB, ReportShare, ShareKind } from "@/lib/domain/types";
import { CommandError, clone, log, nowIso, requireSite, touch, type Ctx } from "./commands";
import { randomBytes } from "@/lib/domain/hmac";
import { todayIso } from "@/lib/domain/format";
import {
  SHARE_DAYS,
  SHARE_DEFAULT_DAYS,
  SHARE_KEEP_DAYS,
  SHARE_MAX_OPEN_PER_SITE,
  completionDoc,
  monthlyDoc,
  shareIdOf,
  shareMonths,
  shareState,
  newShareToken,
  shareExpiry,
  shareTitle,
  shareViewCounts,
  type ShareDoc,
} from "@/lib/domain/share";

export interface CreateShareInput {
  kind: ShareKind;
  siteId: string;
  /** 월간 보고서의 달 (YYYY-MM) — 착공한 달부터 이번 달까지 */
  month?: string;
  /** 열어 둘 기간 (7·14·30일) */
  days?: number;
  /** 받는 분 메모 (선택 · 본사 목록에만 보임 — 보고서·링크에는 들어가지 않는다) */
  to?: string;
}

/** 닫히거나 기한이 지난 지 오래된 링크 기록을 지운다 — 바꿀 것이 없으면 같은 객체를 그대로 돌려준다 */
export function applyShareRetention(db: DemoDB, now: Date): DemoDB {
  const list = db.shares ?? [];
  if (!list.length) return db;
  const cut = new Date(now.getTime() - SHARE_KEEP_DAYS * 86_400_000).toISOString();
  const keep = list.filter((s) => (s.revokedAt ?? s.expiresAt) > cut);
  // 기한이 지난 링크의 내용(스냅샷)은 바로 지운다 — 열리지 않는 보고서 내용을 계속 들고 있지 않게
  const nowIsoStr = now.toISOString();
  const trimmed = keep.map((s) => (s.snapshot && shareState(s, nowIsoStr) !== "open" ? withoutSnapshot(s) : s));
  if (keep.length === list.length && trimmed.every((s, i) => s === keep[i])) return db;
  return { ...db, shares: trimmed };
}

function withoutSnapshot(s: ReportShare): ReportShare {
  const { snapshot: _snap, ...rest } = s;
  void _snap;
  return rest;
}

/** 본사 — 보고서 링크 만들기. 지금 내용으로 고정하고, 주소(비밀값)는 이번 한 번만 돌려준다 */
export function createShare(db0: DemoDB, input: CreateShareInput, ctx: Ctx) {
  const kind = input?.kind;
  if (kind !== "monthly" && kind !== "completion") throw new CommandError("보고서 종류를 확인해주세요.", "VALIDATION", { kind: "월간 보고서 또는 준공 보고서" });
  const days = input.days === undefined ? SHARE_DEFAULT_DAYS : input.days;
  if (!(SHARE_DAYS as readonly number[]).includes(days)) throw new CommandError(`열어 둘 기간은 ${SHARE_DAYS.join("·")}일 중에서 골라 주세요.`, "VALIDATION", { days: "7·14·30일" });
  const to = typeof input.to === "string" ? input.to.replace(/\s+/g, " ").trim() : "";
  if (to.length > 30) throw new CommandError("받는 분 메모는 30자 이내로 적어 주세요.", "VALIDATION", { to: "30자 이내" });
  const now = ctx.now ?? new Date();
  const db = clone(applyShareRetention(db0, now));
  const site = requireSite(db, typeof input.siteId === "string" ? input.siteId : "");
  const at = nowIso(ctx);
  const today = todayIso(now);
  const open = (db.shares ?? []).filter((s) => s.siteId === site.id && shareState(s, at) === "open").length;
  if (open >= SHARE_MAX_OPEN_PER_SITE) throw new CommandError(`이 현장에 열려 있는 링크가 ${SHARE_MAX_OPEN_PER_SITE}개입니다. 현장 상세 ‘발주처·하자보증’의 ‘보낸 보고서 링크’에서 안 쓰는 링크를 닫고 다시 만들어 주세요.`, "STATE");

  let doc: ShareDoc | null;
  if (kind === "monthly") {
    const month = typeof input.month === "string" ? input.month : today.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !shareMonths(site, today).includes(month)) throw new CommandError("보고서 달을 확인해주세요 (착공한 달부터 이번 달까지).", "VALIDATION", { month: "착공한 달부터 이번 달까지" });
    doc = monthlyDoc(db, site.id, month, today);
  } else {
    doc = completionDoc(db, site.id, today);
  }
  if (!doc) throw new CommandError("현장을 찾을 수 없습니다.", "NOT_FOUND");

  const token = newShareToken(randomBytes);
  const share: ReportShare = {
    id: shareIdOf(token),
    kind,
    siteId: site.id,
    ...(doc.kind === "monthly" ? { month: doc.month } : {}),
    title: shareTitle(doc),
    createdAt: at,
    createdBy: ctx.userId,
    expiresAt: shareExpiry(now, days),
    ...(to ? { to } : {}),
    views: 0,
    snapshot: doc,
  };
  db.shares = [share, ...(db.shares ?? [])];
  log(db, ctx, "share", `보고서 링크 만듦 — ${share.title} (${days}일 동안 열림)`, site.id, `/sites/${site.id}?tab=requests`);
  touch(db, ctx);
  return { db, result: { shareId: share.id, token, title: share.title, expiresAt: share.expiresAt } };
}

/** 본사 — 링크 닫기. 바로 열리지 않게 되고 보고서 내용(스냅샷)도 지운다 */
export function revokeShare(db0: DemoDB, input: { shareId: string }, ctx: Ctx) {
  const s0 = (db0.shares ?? []).find((x) => x.id === input?.shareId);
  if (!s0) throw new CommandError("링크를 찾을 수 없습니다.", "NOT_FOUND");
  const at = nowIso(ctx);
  if (s0.revokedAt) throw new CommandError("이미 닫은 링크입니다.", "STATE");
  if (shareState(s0, at) === "expired") throw new CommandError("이미 기한이 지나 열리지 않는 링크입니다.", "STATE");
  const db = clone(applyShareRetention(db0, ctx.now ?? new Date()));
  db.shares = (db.shares ?? []).map((x) => (x.id === s0.id ? { ...withoutSnapshot(x), revokedAt: at, revokedBy: ctx.userId } : x));
  log(db, ctx, "share", `보고서 링크 닫음 — ${s0.title}`, s0.siteId, `/sites/${s0.siteId}?tab=requests`);
  touch(db, ctx);
  return { db, result: { shareId: s0.id } };
}

/**
 * 링크를 열어 봄 — 시연판(이 브라우저 안)에서만 쓰는 기록. 실제 운영에서는 서버가 링크 한 건만 고쳐 쓴다 (src/server/service.ts openShare).
 * 명령 목록(registry)에는 넣지 않는다 — 로그인한 사용자가 부르는 명령이 아니다.
 */
export function recordShareView(db0: DemoDB, input: { shareId: string }, ctx: Ctx) {
  const at = nowIso(ctx);
  const s0 = (db0.shares ?? []).find((x) => x.id === input?.shareId);
  if (!s0 || shareState(s0, at) !== "open") throw new CommandError("열 수 없는 링크입니다.", "NOT_FOUND");
  // 5분 안에 다시 연 것은 세지 않는다 (서버와 같은 규칙)
  if (!shareViewCounts(s0, at)) return { db: db0, result: { views: s0.views } };
  const db = clone(db0);
  db.shares = (db.shares ?? []).map((x) => (x.id === s0.id ? { ...x, views: x.views + 1, firstViewedAt: x.firstViewedAt ?? at, lastViewedAt: at } : x));
  touch(db, ctx);
  return { db, result: { views: s0.views + 1 } };
}
