/** 발주처 포털 공개 — 본사가 고른 현장 사진만 발주처에 보인다 (D-67) */
import type { DemoDB } from "@/lib/domain/types";
import { CommandError, clone, log, nowIso, touch, type Ctx } from "./commands";
import { repairPhotoIds } from "@/lib/domain/partnerFeed";

export interface PhotoShareInput {
  photoIds: string[];
  shared: boolean;
  /** 발주처에 보일 설명 (내부 설명과 따로 · 60자) */
  caption?: string;
}

export const MAX_SHARE_PER_CALL = 30;

export function setPhotoShare(db0: DemoDB, input: PhotoShareInput, ctx: Ctx) {
  const ids = Array.isArray(input?.photoIds) ? [...new Set(input.photoIds.filter((x) => typeof x === "string"))] : [];
  if (!ids.length) throw new CommandError("사진을 골라 주세요.", "VALIDATION", { photoIds: "필수" });
  if (ids.length > MAX_SHARE_PER_CALL) throw new CommandError(`한 번에 ${MAX_SHARE_PER_CALL}장까지 바꿀 수 있습니다.`, "VALIDATION", { photoIds: "너무 많음" });
  const caption = typeof input.caption === "string" ? input.caption.trim() : "";
  if (caption.length > 60) throw new CommandError("발주처에 보일 설명은 60자 이내로 적어 주세요.", "VALIDATION", { caption: "60자 이내" });
  const db = clone(db0);
  const at = nowIso(ctx);
  const photos = ids.map((id) => db.photos.find((p) => p.id === id));
  if (photos.some((p) => !p)) throw new CommandError("사진을 찾을 수 없습니다.", "NOT_FOUND");
  // 발주처가 보낸 하자 사진은 다른 발주처에게 공개하지 않는다 (D-68)
  if (photos.some((p) => !!p?.partnerRequestId)) throw new CommandError("발주처가 보낸 하자 사진은 공개할 수 없습니다.", "STATE");
  // 하자보수 작업지시의 완료 사진은 요청한 발주처에게 회신으로만 — 같은 현장 다른 발주처에게 공개되지 않게 (D-68 점검 반영)
  const repair = repairPhotoIds(db0);
  if (input.shared && photos.some((p) => repair.has(p!.id))) throw new CommandError("하자보수 사진은 요청한 발주처에게 회신으로만 보냅니다.", "STATE");
  const sites = new Set(photos.map((p) => p!.siteId));
  let changed = 0;
  for (const p of photos) {
    if (input.shared) {
      p!.shared = { at, by: ctx.userId, caption: caption || p!.shared?.caption || "" };
      p!.sharedOnce = true;
      changed += 1;
    } else if (p!.shared) {
      delete p!.shared;
      changed += 1;
    }
  }
  const names = [...sites].map((id) => db.sites.find((s) => s.id === id)?.shortName ?? id).join("·");
  log(db, ctx, "partner", `발주처 포털 사진 ${input.shared ? "공개" : "비공개"} ${changed}장 — ${names}`, sites.size === 1 ? [...sites][0] : undefined, "/photos");
  touch(db, ctx);
  return { db, result: { changed } };
}
