/**
 * 자재 반입·설치 수량 명령 (D-62)
 * - setSiteMaterials: 본사가 현장의 주요 자재 품목·설계 수량을 정한다
 * - recordMaterial: 현장(담당 현장)·본사가 반입·설치 수량을 남긴다 (사진 선택)
 * - voidMaterialMove: 잘못 넣은 기록을 사유와 함께 취소 (지우지 않음) — 현장은 본인 기록만
 * 금액은 다루지 않는다.
 */
import type { DemoDB, MaterialItem, MaterialMove, MaterialMoveKind } from "@/lib/domain/types";
import { fmtQty, materialRows, MOVE_LABEL, roundQty } from "@/lib/domain/material";
import { todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { CommandError, claimKey, clone, log, nowIso, requireSite, touch, validPhoto, type Ctx } from "./commands";
import { sentLaterAt } from "./attendanceCommands";

export const MATERIAL_LIMITS = { items: 30, name: 40, unit: 10, note: 200, reason: 100, qty: 1_000_000, planned: 10_000_000 } as const;

/** 0보다 크고 소수 둘째 자리까지인 수 */
const qtyOk = (v: unknown, max: number, allowZero = false): v is number =>
  typeof v === "number" && Number.isFinite(v) && (allowZero ? v >= 0 : v > 0) && v <= max && Math.abs(roundQty(v) - v) < 1e-9;

export interface MaterialItemInput {
  id?: string;
  name: string;
  unit: string;
  plannedQty: number;
  archived?: boolean;
}

export function setSiteMaterials(db0: DemoDB, input: { siteId: string; items: MaterialItemInput[] }, ctx: Ctx) {
  const site0 = requireSite(db0, input.siteId);
  const items = Array.isArray(input.items) ? input.items : [];
  const errors: Record<string, string> = {};
  if (items.length > MATERIAL_LIMITS.items) errors.items = `품목은 ${MATERIAL_LIMITS.items}개까지`;
  const seen = new Set<string>();
  const seenIds = new Set<string>();
  const known = new Map((site0.materials ?? []).map((i) => [i.id, i]));
  // 기록이 있는 품목은 단위를 바꿀 수 없다 — 바꾸면 지난 ‘144 EA’가 ‘144 kg’으로 보인다 (리뷰 반영 D-63)
  const used = new Set((db0.materialMoves ?? []).filter((m) => m.siteId === site0.id).map((m) => m.itemId));
  items.forEach((it, i) => {
    const name = typeof it?.name === "string" ? it.name.trim() : "";
    const unit = typeof it?.unit === "string" ? it.unit.trim() : "";
    if (!name || name.length > MATERIAL_LIMITS.name) errors[`items.${i}.name`] = `품목 이름은 1~${MATERIAL_LIMITS.name}자`;
    if (!unit || unit.length > MATERIAL_LIMITS.unit) errors[`items.${i}.unit`] = `단위는 1~${MATERIAL_LIMITS.unit}자 (예: EA·장·m)`;
    if (!qtyOk(it?.plannedQty, MATERIAL_LIMITS.planned, true)) errors[`items.${i}.plannedQty`] = "설계 수량은 0 이상 숫자 (소수 둘째 자리까지)";
    if (it?.id !== undefined && !known.has(it.id)) errors[`items.${i}.id`] = "없는 품목입니다. 새로고침 후 다시 해주세요.";
    if (it?.id !== undefined && seenIds.has(it.id)) errors[`items.${i}.id`] = "같은 품목이 두 번 들어 있습니다. 새로고침 후 다시 해주세요.";
    if (it?.id !== undefined) seenIds.add(it.id);
    const prev = it?.id !== undefined ? known.get(it.id) : undefined;
    if (prev && used.has(prev.id) && unit && unit !== prev.unit) errors[`items.${i}.unit`] = `기록이 있는 품목은 단위를 바꿀 수 없습니다 (지금 ${prev.unit}) — 다른 단위면 새 품목으로 넣어 주세요`;
    const key = name.toLowerCase();
    if (name && !it?.archived && seen.has(key)) errors[`items.${i}.name`] = "같은 이름의 품목이 있습니다";
    if (name && !it?.archived) seen.add(key);
  });
  // 기록이 있는 품목은 목록에서 빼지 못한다 (숨기기만) — 지난 반입·설치 기록이 이름 없이 남지 않게
  const kept = new Set(items.map((it) => it?.id).filter(Boolean));
  const dropped = [...known.values()].filter((i) => !kept.has(i.id) && used.has(i.id));
  if (dropped.length) errors.items = `기록이 있는 품목은 지울 수 없습니다 — ‘숨기기’를 써 주세요 (${dropped.map((i) => i.name).join(", ")})`;
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);

  const db = clone(db0);
  const site = db.sites.find((s) => s.id === site0.id)!;
  const next: MaterialItem[] = items.map((it) => ({
    id: it.id ?? uid("mat"),
    name: it.name.trim(),
    unit: it.unit.trim(),
    plannedQty: roundQty(it.plannedQty),
    ...(it.archived ? { archived: true } : {}),
  }));
  site.materials = next;
  const added = next.filter((i) => !known.has(i.id)).length;
  // 바뀐 내용(이전 → 새 값)을 이력에 남긴다 — 설계 수량을 바꾸면 설치율이 달라지므로 (리뷰 반영 D-63)
  const changes = next.flatMap((i) => {
    const p = known.get(i.id);
    if (!p) return [];
    const c: string[] = [];
    if (p.name !== i.name) c.push(`이름 ${p.name} → ${i.name}`);
    if (p.unit !== i.unit) c.push(`단위 ${p.unit} → ${i.unit}`);
    if (p.plannedQty !== i.plannedQty) c.push(`${i.name} 설계 수량 ${fmtQty(p.plannedQty, p.unit)} → ${fmtQty(i.plannedQty, i.unit)}`);
    if (!!p.archived !== !!i.archived) c.push(`${i.name} ${i.archived ? "숨김" : "다시 씀"}`);
    return c;
  });
  const removed = [...known.values()].filter((p) => !next.some((i) => i.id === p.id)).map((p) => p.name);
  log(
    db,
    ctx,
    "material",
    `${site.shortName} 주요 자재 품목 ${next.filter((i) => !i.archived).length}개로 정리${added ? ` (새 품목 ${added})` : ""}${changes.length ? ` · ${changes.join(" · ")}` : ""}${removed.length ? ` · 뺀 품목 ${removed.join(", ")}` : ""}`.slice(0, 500),
    site.id,
    `/sites/${site.id}?tab=material`,
  );
  touch(db, ctx);
  return { db, result: { count: next.length } };
}

export interface MaterialMoveInput {
  siteId: string;
  itemId: string;
  kind: MaterialMoveKind;
  qty: number;
  note?: string;
  photoDataUrl?: string;
  idempotencyKey?: string;
  /** 통신이 끊겨 휴대폰에 보관했던 기록 — 누른 시각 (휴대폰 시계 · D-63) */
  pressedAt?: string;
}

export function recordMaterial(db0: DemoDB, input: MaterialMoveInput, ctx: Ctx) {
  const site = requireSite(db0, input.siteId);
  const item = (site.materials ?? []).find((i) => i.id === input.itemId);
  const errors: Record<string, string> = {};
  if (!item) errors.itemId = "이 현장에 없는 자재입니다. 본사에 품목을 확인해 주세요.";
  else if (item.archived) errors.itemId = "더 쓰지 않는 자재입니다.";
  if (input.kind !== "in" && input.kind !== "install") errors.kind = "반입 또는 설치를 골라 주세요.";
  if (!qtyOk(input.qty, MATERIAL_LIMITS.qty)) errors.qty = "수량은 0보다 큰 숫자 (소수 둘째 자리까지)";
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > MATERIAL_LIMITS.note) errors.note = `메모는 ${MATERIAL_LIMITS.note}자까지`;
  if (input.photoDataUrl !== undefined && !validPhoto(input.photoDataUrl)) errors.photo = "사진 형식을 확인해 주세요 (JPEG·PNG·WEBP, 2.5MB 이하)";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);

  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const at = nowIso(ctx);
  const id = uid("mm");
  const qty = roundQty(input.qty);
  let photoId: string | undefined;
  if (input.photoDataUrl) {
    photoId = uid("ph");
    db.photos.push({ id: photoId, siteId: site.id, materialMoveId: id, dataUrl: input.photoDataUrl, caption: `자재 ${MOVE_LABEL[input.kind]} · ${item!.name} ${fmtQty(qty, item!.unit)}`, createdAt: at, createdBy: ctx.userId });
  }
  // 늦게 도착한 기록: 누른 시각이 2분~12시간 전이면 그 날짜로 (출퇴근과 같은 범위 · 그 밖이면 받은 날짜) — 금액·근태와 무관한 수량이라 날짜만 맞춘다
  const pressed = sentLaterAt(input.pressedAt, at);
  const move: MaterialMove = {
    id,
    siteId: site.id,
    itemId: item!.id,
    kind: input.kind,
    qty,
    workDate: todayIso(new Date(pressed ?? at)),
    ...(photoId ? { photoId } : {}),
    ...(note ? { note } : {}),
    at,
    by: ctx.userId,
    ...(pressed ? { sentLater: { pressedAt: pressed } } : {}),
  };
  db.materialMoves = [...(db.materialMoves ?? []), move];
  const row = materialRows(db, site.id).find((r) => r.item.id === item!.id)!;
  log(db, ctx, "material", `${site.shortName} 자재 ${MOVE_LABEL[input.kind]} — ${item!.name} ${fmtQty(qty, item!.unit)}${photoId ? " · 사진" : ""}`, site.id, `/sites/${site.id}?tab=material`);
  touch(db, ctx);
  return { db, result: { moveId: id, inQty: row.inQty, installQty: row.installQty, onSite: row.onSite, flags: row.flags } };
}

export function voidMaterialMove(db0: DemoDB, input: { moveId: string; reason: string }, ctx: Ctx) {
  const m0 = (db0.materialMoves ?? []).find((m) => m.id === input.moveId);
  if (!m0) throw new CommandError("기록을 찾을 수 없습니다.", "NOT_FOUND");
  if (m0.voided) throw new CommandError("이미 취소한 기록입니다.", "STATE");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > MATERIAL_LIMITS.reason) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", { reason: `취소 사유를 1~${MATERIAL_LIMITS.reason}자로 적어 주세요` });
  const db = clone(db0);
  const at = nowIso(ctx);
  db.materialMoves = (db.materialMoves ?? []).map((m) => (m.id === m0.id ? { ...m, voided: { at, by: ctx.userId, reason } } : m));
  const site = db.sites.find((s) => s.id === m0.siteId);
  const item = site?.materials?.find((i) => i.id === m0.itemId);
  log(db, ctx, "material", `${site?.shortName ?? ""} 자재 ${MOVE_LABEL[m0.kind]} 기록 취소 — ${item?.name ?? ""} ${fmtQty(m0.qty, item?.unit)} (사유: ${reason})`, m0.siteId, `/sites/${m0.siteId}?tab=material`);
  touch(db, ctx);
  return { db, result: {} };
}
