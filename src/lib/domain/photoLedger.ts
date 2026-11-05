/**
 * 공사사진대장 자동 작성 (D-38) — 현장 보고·보완·작업지시 완료·조치 사진을 날짜순으로 모으고,
 * 사진마다 일자·공종·내용·촬영자를 붙인다. 기성·준공 서류용. 금액은 넣지 않는다.
 * 작업 인원(출력) 단체 사진은 얼굴이 담길 수 있어 기본으로 뺀다.
 */
import type { DemoDB, SitePhoto } from "./types";

export type PhotoKind = "report" | "supplement" | "order" | "action" | "crew" | "other";

export const PHOTO_KIND_LABEL: Record<PhotoKind, string> = {
  report: "현장 보고",
  supplement: "보완",
  order: "작업지시 완료",
  action: "조치 확인",
  crew: "작업 인원",
  other: "기타",
};

export interface LedgerEntry {
  no: number;
  photo: SitePhoto;
  date: string;
  kind: PhotoKind;
  /** 공종 (공정 단계 또는 현장 공종) */
  stage: string;
  /** 내용 */
  text: string;
  by: string;
}

const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const clip = (s: string, n = 70) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function photoLedger(db: DemoDB, siteId: string, from: string, to: string, opts: { includeCrew?: boolean; stage?: string } = {}): LedgerEntry[] {
  const site = db.sites.find((s) => s.id === siteId);
  if (!site) return [];
  const reports = new Map(db.reports.map((r) => [r.id, r]));
  const orderOf = new Map<string, { title: string; doneNote?: string }>();
  for (const w of db.workOrders ?? []) for (const id of w.donePhotoIds ?? []) orderOf.set(id, { title: w.title, doneNote: w.doneNote });
  const supplementIds = new Set(db.reports.flatMap((r) => (r.supplements ?? []).flatMap((s) => s.photoIds)));
  const actions = new Map(db.actions.map((a) => [a.id, a]));
  // 취소한 자재 기록의 사진은 넣지 않는다 (D-62)
  const voidedMoves = new Set((db.materialMoves ?? []).filter((m) => m.voided).map((m) => m.id));
  const user = (id: string) => db.users.find((u) => u.id === id)?.name ?? "";

  const rows = db.photos
    .filter((p) => p.siteId === siteId)
    .map((p) => {
      const date = kstDate(p.createdAt);
      const r = p.reportId ? reports.get(p.reportId) : undefined;
      const isCrew = !!p.crewId || p.caption.startsWith("작업 인원");
      const kind: PhotoKind = isCrew ? "crew" : orderOf.has(p.id) ? "order" : supplementIds.has(p.id) ? "supplement" : p.actionId ? "action" : r ? "report" : "other";
      if (r?.status === "voided") return null;
      if (p.materialMoveId && voidedMoves.has(p.materialMoveId)) return null;
      // 공종: 그 보고가 바꾼 공정 단계 → 그날 진행 중인 단계 → 현장 공종
      const stage = r?.stages?.[0]?.name ?? site.stages.find((s) => s.startDate <= date && s.endDate >= date)?.name ?? site.workType;
      const caption = p.caption && !["현장 사진", "보완 사진"].includes(p.caption) ? p.caption : "";
      const text =
        kind === "order"
          ? clip(`${orderOf.get(p.id)!.title}${orderOf.get(p.id)!.doneNote ? ` — ${orderOf.get(p.id)!.doneNote}` : ""}`)
          : kind === "action"
            ? clip(`${actions.get(p.actionId!)?.title ?? "조치"} 확인`)
            : clip([caption, r?.workDone].filter(Boolean).join(" — ") || p.caption || "현장 사진");
      return { photo: p, date, kind, stage, text, by: user(p.createdBy) };
    })
    .filter((x): x is Omit<LedgerEntry, "no"> => !!x)
    .filter((x) => x.date >= from && x.date <= to && (opts.includeCrew || x.kind !== "crew") && (!opts.stage || x.stage === opts.stage))
    .sort((a, b) => a.photo.createdAt.localeCompare(b.photo.createdAt));
  return rows.map((x, i) => ({ ...x, no: i + 1 }));
}
