/**
 * 하자보수 관리 (본사용 · D-69) — 발주처 하자보수 요청을 현장별로 모아 진행·처리 기간·본사 할 일을 계산하고,
 * 인쇄용 ‘하자보수 관리대장’을 만든다. 금액은 넣지 않는다.
 *
 * 단계는 발주처 포털·월간 보고서와 같은 말(defectProgress)을 쓰고, 본사 화면에는 ‘다음에 할 일’을 덧붙인다.
 */
import type { DemoDB, PartnerRepairView, PartnerRequest, Site, WorkOrder } from "./types";
import { defectProgress, partnerRepairView, repliedAfterDone } from "./partnerFeed";
import { defectWarranty, type DefectWarranty } from "./warranty";
import { intakeVia } from "./intake";

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const dayDiff = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

/** 본사가 다음에 할 일 */
export type DefectNext = "assign" | "repairing" | "reply" | "check" | "client" | "closed" | "reopened";
export const DEFECT_NEXT_LABEL: Record<DefectNext, string> = {
  assign: "작업지시 보내기 필요",
  repairing: "현장 보수 중",
  reply: "발주처 회신 필요",
  // 현장이 ‘일부만 끝냈어요’로 보내고 본사가 회신만 한 상태 — 완료 확인 또는 보완 요청이 남음 (점검 11차)
  check: "남은 보수 확인",
  client: "발주처 확인 대기",
  closed: "끝남",
  reopened: "다시 요청됨",
};
/** 현장 보수 중의 실제 단계 — ‘현장 미확인’을 ‘보수 중’으로 부풀리지 않는다 (D-69 점검 반영) */
export function repairingLabel(wo?: WorkOrder): string {
  if (!wo) return DEFECT_NEXT_LABEL.repairing;
  return wo.status === "sent" ? "현장 미확인" : wo.status === "received" ? "현장 확인함" : wo.status === "returned" ? "보완 요청 — 다시 보수" : "현장 보수 중";
}

/** 본사가 손댈 단계 — 메뉴 배지·‘본사 할 일’ 보기가 같은 목록을 쓴다 */
export const DEFECT_HQ_TODO: readonly DefectNext[] = ["assign", "reply", "check"];

export interface DefectRow {
  req: PartnerRequest;
  site?: Site;
  partnerName: string;
  wo?: WorkOrder;
  repair?: PartnerRepairView;
  /** 발주처에 보이는 단계 (포털·보고서와 같은 말) */
  stage: { step: number; label: string };
  next: DefectNext;
  receivedDate: string;
  /** 보수 완료일 — 본사가 확인(작업지시 확인 또는 완료 뒤 회신)한 날, 작업지시 없이 회신했으면 회신한 날 */
  repairedDate?: string;
  confirmedDate?: string;
  /** 다시 접수한 건이면 맨 처음 접수한 날 (점검 11차) */
  firstReceivedDate?: string;
  /** 접수 → 보수 완료(끝나지 않았으면 오늘)까지 일수 */
  days: number;
  /** 아직 본사·현장 일이 남았는데 발주처 희망일이나 작업지시 기한이 지남 */
  overdue: boolean;
  beforePhotoId?: string;
  afterPhotoId?: string;
  /** 하자보증 기간 안·밖 (접수일 기준 · 보증 정보가 없으면 없음 · D-70) */
  warranty?: DefectWarranty;
}

export function defectRows(db: DemoDB, today: string): DefectRow[] {
  const reopened = new Set(db.partnerRequests.map((r) => r.reopenedFrom).filter(Boolean));
  const rank = (r: DefectRow) => (r.overdue ? 0 : DEFECT_HQ_TODO.includes(r.next) ? 1 : r.next === "repairing" ? 2 : r.next === "client" ? 3 : 4);
  return db.partnerRequests
    .filter((r) => r.type === "defect")
    .map((r): DefectRow => {
      const wo = r.linkedWorkOrderId ? (db.workOrders ?? []).find((w) => w.id === r.linkedWorkOrderId) : undefined;
      const repair = partnerRepairView(db, r);
      const stage = defectProgress(r, repair);
      const firstAnswer = r.history.find((h) => h.status === "answered")?.at;
      // 보수 완료일: 본사가 확인한 날 · 작업지시 없이 ‘처리 끝’으로 회신했으면 그 회신일 (일정 안내 회신은 아님 · D-69 점검 반영)
      const repairedAt = repair ? (repair.stage === "done" ? repair.at : undefined) : r.closedWithoutRepair ? firstAnswer : undefined;
      const next: DefectNext = r.confirmedAt
        ? "closed"
        : reopened.has(r.id)
          ? "reopened"
          : repair && wo
            ? repair.stage === "done"
              ? repliedAfterDone(wo, r)
                ? "client"
                : "reply" // 보수는 끝났는데 그 뒤 회신이 없음 — 일정 안내 회신만 하고 작업지시 화면에서 완료 확인한 경우 포함 (D-69 · 점검 11차)
              : repair.stage === "checking"
                ? wo.status === "done" && repliedAfterDone(wo, r)
                  ? "check" // ‘일부만 끝냈어요’에 회신만 함 — 완료 확인·보완 요청이 남음 (점검 11차)
                  : "reply"
                : "repairing"
            : r.closedWithoutRepair
              ? "client"
              : "assign";
      const open = DEFECT_HQ_TODO.includes(next) || next === "repairing";
      const receivedDate = kst(r.createdAt);
      const repairedDate = repairedAt ? kst(repairedAt) : undefined;
      const limit = [r.desiredDate, wo && !["done", "confirmed"].includes(wo.status) ? wo.dueDate : undefined].filter((x): x is string => !!x).sort()[0];
      const woDone = !!wo && (wo.status === "done" || wo.status === "confirmed");
      return {
        req: r,
        site: db.sites.find((s) => s.id === r.siteId),
        // 접수 링크로 들어온 것은 소속·이름 대신 ‘링크 접수’와 접수 번호만 (관리대장은 인쇄해 밖으로 나가므로 사람 이름을 넣지 않는다 · D-74)
        partnerName: r.intake ? `${intakeVia(r.intake)} ${r.intake.no}${r.intake.org ? ` · ${r.intake.org}` : ""}` : (db.users.find((u) => u.id === r.partnerUserId)?.name ?? "발주처"),
        wo,
        repair,
        stage,
        next,
        receivedDate,
        repairedDate,
        confirmedDate: r.confirmedAt ? kst(r.confirmedAt) : undefined,
        ...(r.reopenedFrom ? { firstReceivedDate: firstReceived(db, r) } : {}),
        days: dayDiff(receivedDate, repairedDate ?? today),
        // 보수가 끝난 뒤(회신만 남음)에는 기한 지남으로 보지 않는다
        overdue: open && !repairedDate && !!limit && limit < today,
        warranty: defectWarranty(db.sites.find((s) => s.id === r.siteId), receivedDate),
        beforePhotoId: r.photoIds?.[0],
        // 보수 후 사진: 가장 최근에 회신으로 보낸 사진, 없으면 지금 끝난 작업지시의 사진 (되돌린 첫 시도 사진이 남던 문제 · D-69 점검 반영)
        afterPhotoId: r.replyPhotoIds?.at(-1) ?? (woDone ? wo!.donePhotoIds?.[0] : undefined),
      };
    })
    // 급한 것부터: 기한 지남 → 본사 할 일 → 현장 보수 중 → 발주처 확인 대기 → 끝남, 같은 무리는 오래된 것부터 (D-69 점검 반영)
    .sort((a, b) => rank(a) - rank(b) || (rank(a) >= 3 ? b.req.createdAt.localeCompare(a.req.createdAt) : a.req.createdAt.localeCompare(b.req.createdAt)));
}

export interface DefectStats {
  total: number;
  open: number;
  overdue: number;
  /** 본사가 지금 손댈 것: 작업지시 보내기 + 발주처 회신 + 남은 보수 확인 */
  hqTodo: number;
  assign: number;
  reply: number;
  check: number;
  /** 발주처 확인 대기 */
  waiting: number;
  /** 보수 완료까지 평균 일수 — 실제 보수한 것만 (작업지시 없이 끝낸 것·다시 요청된 것 제외) */
  avgDays: number | null;
  repaired: number;
  confirmed: number;
}

export function defectStats(rows: DefectRow[]): DefectStats {
  const repaired = rows.filter((r) => r.repairedDate && r.repair && r.next !== "reopened");
  const assign = rows.filter((r) => r.next === "assign").length;
  const reply = rows.filter((r) => r.next === "reply").length;
  const check = rows.filter((r) => r.next === "check").length;
  return {
    total: rows.length,
    open: rows.filter((r) => DEFECT_HQ_TODO.includes(r.next) || r.next === "repairing").length,
    overdue: rows.filter((r) => r.overdue).length,
    hqTodo: assign + reply + check,
    assign,
    reply,
    check,
    waiting: rows.filter((r) => r.next === "client").length,
    avgDays: repaired.length ? Math.round(repaired.reduce((a, r) => a + r.days, 0) / repaired.length) : null,
    repaired: repaired.length,
    confirmed: rows.filter((r) => r.next === "closed").length,
  };
}

/** 하자보수 관리대장: 현장·접수 기간으로 고른 줄 (오래된 것부터 번호) */
export function defectLedger(rows: DefectRow[], siteId: string, from: string, to: string): (DefectRow & { no: number })[] {
  return rows
    .filter((r) => r.req.siteId === siteId && r.receivedDate >= from && r.receivedDate <= to)
    .sort((a, b) => a.req.createdAt.localeCompare(b.req.createdAt))
    .map((r, i) => ({ ...r, no: i + 1 }));
}

/** 하자 한 건의 처리 이력 한 줄 (본사 화면 전용 — 담당자 이름이 들어가므로 인쇄물·발주처 화면에는 쓰지 않는다) */
export interface DefectEvent {
  at: string;
  /** 무엇이 있었는지 — ‘접수’, ‘작업지시’, ‘보수 완료 보고’, ‘회신’ … */
  label: string;
  /** 누가 (사람 이름 · 접수자 · 발주처 이름) */
  who?: string;
  /** 덧붙일 말 (회신 글·완료 메모·보완 사유·확인 메모 — 앞부분만) */
  detail?: string;
  tone: "info" | "ok" | "warn" | "neutral";
  /** 앞 접수(다시 접수하기 전)의 기록 — 흐리게 보여 준다 (점검 11차) */
  past?: true;
}

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * 하자 처리 이력 (D-75) — 요청 기록과 그 요청으로 만든 작업지시 기록을 시간순으로 한 줄씩.
 * ‘언제 접수했는데 왜 아직이냐’는 전화를 받았을 때 날짜로 답할 수 있게 한다.
 */
export function defectTimeline(db: Pick<DemoDB, "users" | "partnerRequests" | "workOrders">, req: PartnerRequest): DefectEvent[] {
  // 다시 접수한 건은 앞 접수의 기록부터 — ‘몇 주 전에 말했는데’라는 전화에 답할 수 있게 (점검 11차)
  const chain: PartnerRequest[] = [];
  for (let cur = req.reopenedFrom; cur && chain.length < 10; ) {
    const prev = db.partnerRequests.find((x) => x.id === cur);
    if (!prev) break;
    chain.unshift(prev);
    cur = prev.reopenedFrom;
  }
  const past = chain.flatMap((p) => oneTimeline(db, p).map((e) => ({ ...e, past: true as const })));
  return [...past, ...oneTimeline(db, req)];
}

/** 처음 접수한 날 — 다시 접수가 이어졌으면 맨 앞 접수 (한국 날짜) */
export function firstReceived(db: Pick<DemoDB, "partnerRequests">, req: PartnerRequest): string {
  let first = req;
  for (let i = 0; first.reopenedFrom && i < 10; i++) {
    const prev = db.partnerRequests.find((x) => x.id === first.reopenedFrom);
    if (!prev) break;
    first = prev;
  }
  return kst(first.createdAt);
}

function oneTimeline(db: Pick<DemoDB, "users" | "partnerRequests" | "workOrders">, req: PartnerRequest): DefectEvent[] {
  const name = (id: string) => {
    if (id === "system") return req.intake ? "접수자" : "시스템";
    const u = db.users.find((x) => x.id === id);
    return u ? `${u.name}${u.title ? ` ${u.title}` : ""}` : undefined;
  };
  const requester = req.intake ? "접수자" : (db.users.find((u) => u.id === req.partnerUserId)?.name ?? "발주처");
  const out: DefectEvent[] = [];
  const wo = req.linkedWorkOrderId ? (db.workOrders ?? []).find((w) => w.id === req.linkedWorkOrderId) : undefined;
  req.history.forEach((h, i) => {
    const note = (h.note ?? "").trim();
    if (i === 0) {
      // 발주처 포털에서 다시 요청 → ‘다시 요청’ (목록 표시와 같은 말) · 접수자가 화면에서 다시 접수 → ‘다시 접수’ · 본사가 전화로 듣고 대신 → ‘(전화로 알려 옴)’ (점검 11차)
      const byHq = !!req.intake && h.by !== "system";
      const how = req.reopenedFrom ? (req.intake ? (byHq ? "다시 접수 (전화로 알려 옴)" : "다시 접수") : "다시 요청") : req.intake ? (req.intake.id === "phone" ? "전화 접수" : "링크 접수") : "요청 접수";
      out.push({ at: h.at, label: how, who: byHq ? name(h.by) : requester, ...(note && req.intake?.id !== "phone" && !note.startsWith("전화 접수") ? { detail: note } : {}), tone: "info" });
      return;
    }
    // 작업지시 쪽 기록으로 따로 보여 주는 것은 건너뛴다
    if (note === "보수 작업 배정" || note.startsWith("추가 보수")) return;
    if (note.startsWith("발주처 확인")) {
      const memo = note.replace(/^발주처 확인\s*·?\s*/, "");
      out.push({ at: h.at, label: `${req.intake ? "접수자" : "발주처"} 확인`, who: req.intake ? "접수자" : requester, ...(memo ? { detail: clip(memo) } : {}), tone: "ok" });
      return;
    }
    if (note.startsWith("아직 문제가 있음")) {
      out.push({ at: h.at, label: "아직 문제가 있음 → 다시 접수", who: name(h.by), detail: note.replace(/^아직 문제가 있음 → (다시 접수\s*)?/, "접수 번호 "), tone: "warn" });
      return;
    }
    // 회신하면서 자동으로 남긴 ‘검토 중’ (같은 사람·같은 시각)은 누가 누른 것이 아니라 빼다 (점검 11차)
    if (h.status === "reviewing" && req.history.some((x, j) => j > i && x.status === "answered" && x.at === h.at && x.by === h.by)) return;
    if (h.status === "reviewing") {
      out.push({ at: h.at, label: "검토 시작", who: name(h.by), tone: "neutral" });
      return;
    }
    if (h.status === "answered") {
      const first = !req.history.slice(0, i).some((x) => x.status === "answered" && !(x.note ?? "").startsWith("발주처 확인"));
      const closing = req.closedWithoutRepair && (first || !req.history.slice(i + 1).some((x) => x.status === "answered" && !(x.note ?? "").startsWith("발주처 확인")));
      // 현장 완료 보고 뒤의 회신은 ‘보수 완료 회신’ (일정 안내 뒤의 두 번째 회신이 ‘추가 회신’으로만 보이던 문제 · 점검 11차)
      const afterDone = !!wo && wo.history.some((x) => x.to === "done" && x.at <= h.at);
      out.push({ at: h.at, label: closing && !wo ? "회신 (작업지시 없이 처리 끝)" : afterDone ? "보수 완료 회신" : first ? "회신" : "추가 회신", who: name(h.by), ...(note ? { detail: clip(note) } : {}), tone: "ok" });
    }
  });
  if (wo) {
    const WORD: Record<WorkOrder["status"], { label: string; tone: DefectEvent["tone"] }> = {
      sent: { label: "작업지시", tone: "info" },
      received: { label: "현장 확인", tone: "neutral" },
      in_progress: { label: "보수 시작", tone: "neutral" },
      done: { label: "보수 완료 보고", tone: "ok" },
      confirmed: { label: "본사 완료 확인", tone: "ok" },
      returned: { label: "보완 요청 (다시 보수)", tone: "warn" },
    };
    for (const h of wo.history) {
      const note = (h.note ?? "").trim();
      // 현장이 연결된 보고를 취소해 작업지시가 처음으로 돌아감 — 새 작업지시가 아니다 (점검 11차)
      if (note === "현장 보고 되돌리기") {
        out.push({ at: h.at, label: "현장 보고 취소 (진행 되돌림)", who: name(h.by), tone: "neutral" });
        continue;
      }
      const w = WORD[h.to];
      const detail = h.to === "sent" ? [`담당 ${name(wo.assigneeUserId) ?? "—"}`, wo.dueDate ? `기한 ${wo.dueDate.slice(5).replace("-", "/")}` : ""].filter(Boolean).join(" · ") : note && note !== "현장 보고 되돌리기" ? clip(note) : h.to === "done" && wo.doneQty ? wo.doneQty : "";
      out.push({ at: h.at, label: w.label, who: name(h.by), ...(detail ? { detail } : {}), tone: w.tone });
    }
  }
  const next = db.partnerRequests.find((x) => x.reopenedFrom === req.id);
  if (next && !out.some((e) => e.label.startsWith("아직 문제가 있음"))) out.push({ at: next.createdAt, label: "다시 요청됨", who: requester, ...(next.intake ? { detail: `접수 번호 ${next.intake.no}` } : { detail: clip(next.title, 40) }), tone: "warn" });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** 하자보수 메뉴 배지 — 본사가 지금 손댈 하자 수 (작업지시 보낼 것 + 회신할 것) */
export const defectTodoCount = (db: DemoDB, today: string) => defectStats(defectRows(db, today)).hqTodo;
