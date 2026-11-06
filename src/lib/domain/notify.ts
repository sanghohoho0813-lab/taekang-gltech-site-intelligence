/**
 * 휴대폰 알림 규칙 (D-37) — 명령 실행 전·후 데이터를 비교해 ‘누가 지금 무엇을 해야 하는지’만 알린다.
 * - 잠금화면에 보이므로 금액은 절대 넣지 않는다
 * - 확인·완료 같은 ‘끝난 일’은 알리지 않는다 (60~70대 직원이 알림에 지치지 않게)
 * - 본인이 한 일은 본인에게 알리지 않는다
 */
import type { DemoDB } from "./types";
import { PARTNER_TYPE_LABEL } from "./labels";

export interface Notice {
  /** 받을 사람 (사용자 id) */
  to: string[];
  title: string;
  body: string;
  /** 누르면 열 화면 */
  url: string;
  /** 같은 일에 대한 알림은 하나로 묶임 */
  tag: string;
}

const clip = (s: string, n = 60) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function hqUsers(db: DemoDB): string[] {
  return db.users.filter((u) => (u.role === "ceo" || u.role === "manager") && !u.inactive).map((u) => u.id);
}

export function noticesFor(before: DemoDB, after: DemoDB, actorId: string): Notice[] {
  const out: Notice[] = [];
  const site = (id: string) => after.sites.find((s) => s.id === id)?.shortName ?? "현장";
  const name = (id: string) => after.users.find((u) => u.id === id)?.name ?? "";
  const hq = hqUsers(after);
  const push = (n: Notice) => {
    const to = [...new Set(n.to)].filter((id) => id && id !== actorId);
    if (to.length) out.push({ ...n, to });
  };

  // 작업지시
  const woBefore = new Map((before.workOrders ?? []).map((w) => [w.id, w]));
  for (const w of after.workOrders ?? []) {
    const prev = woBefore.get(w.id);
    if (!prev) push({ to: [w.assigneeUserId], title: w.urgent ? "긴급 본사 작업지시" : "본사 작업지시", body: `${site(w.siteId)} · ${clip(w.title)} — 눌러서 확인해 주세요`, url: "/my-actions", tag: `wo-${w.id}` });
    else if (prev.status !== w.status && w.status === "returned") push({ to: [w.assigneeUserId], title: "작업지시 보완 요청", body: `${site(w.siteId)} · ${clip(w.title, 30)}${w.returnNote ? ` — ${clip(w.returnNote, 40)}` : ""}`, url: "/my-actions", tag: `wo-${w.id}` });
    else if (prev.status !== w.status && w.status === "done") push({ to: [w.createdBy], title: "작업지시 완료 보고", body: `${site(w.siteId)} · ${clip(w.title)} — ${name(w.assigneeUserId)}`, url: "/orders", tag: `wo-${w.id}` });
  }

  // 앱 의견: 본사가 반영·보류하면 보낸 사람에게
  const fbBefore = new Map((before.feedback ?? []).map((f) => [f.id, f]));
  for (const f of after.feedback ?? []) {
    const prev = fbBefore.get(f.id);
    if (prev && prev.status !== f.status && (f.status === "done" || f.status === "hold"))
      push({ to: [f.userId], title: f.status === "done" ? "보내 주신 의견을 반영했어요" : "보내 주신 의견 답변", body: f.reply ? clip(f.reply) : "내 정보에서 확인해 주세요", url: "/my", tag: `fb-${f.id}` });
  }

  // 현장 보고
  const repBefore = new Map(before.reports.map((r) => [r.id, r]));
  for (const r of after.reports) {
    const prev = repBefore.get(r.id);
    if (!prev && r.status !== "voided") {
      if (r.issues.trim()) push({ to: hq, title: "현장 문제 보고", body: `${site(r.siteId)} · ${clip(r.issues)} — ${name(r.createdBy)}`, url: "/orders?tab=reports", tag: `rep-${r.id}` });
      else if (r.costEntryIds.length) push({ to: hq, title: "추가 비용 보고", body: `${site(r.siteId)} · 비용 ${r.costEntryIds.length}건 — ${name(r.createdBy)}`, url: "/orders?tab=reports", tag: `rep-${r.id}` });
    } else if (prev) {
      if (r.review?.status === "returned" && prev.review?.at !== r.review.at) push({ to: [r.createdBy], title: "보고 보완 요청", body: `${site(r.siteId)} · ${r.review.note ? clip(r.review.note) : "사진·내용을 덧붙여 주세요"}`, url: "/field", tag: `rep-${r.id}` });
      if ((r.supplements?.length ?? 0) > (prev.supplements?.length ?? 0)) push({ to: r.review?.by ? [r.review.by] : hq, title: "보완 보고 도착", body: `${site(r.siteId)} · ${name(r.createdBy)}`, url: "/orders?tab=reports", tag: `rep-${r.id}` });
    }
  }

  // 근태 수정 요청
  const fixBefore = new Map((before.attendanceRequests ?? []).map((q) => [q.id, q]));
  for (const q of after.attendanceRequests ?? []) {
    const prev = fixBefore.get(q.id);
    if (!prev) push({ to: hq, title: "근태 수정 요청", body: `${name(q.userId)} · ${q.workDate.slice(5).replace("-", "/")} ${site(q.siteId)}`, url: "/orders?tab=fixes", tag: `fix-${q.id}` });
    else if (prev.status === "pending" && q.status !== "pending") push({ to: [q.userId], title: q.status === "approved" ? "근태 수정 승인" : "근태 수정 반려", body: `${q.workDate.slice(5).replace("-", "/")}${q.reviewNote ? ` — ${clip(q.reviewNote, 50)}` : ""}`, url: "/field", tag: `fix-${q.id}` });
  }

  // 위험 조치 배정
  const actBefore = new Map(before.actions.map((a) => [a.id, a]));
  for (const a of after.actions) {
    const prev = actBefore.get(a.id);
    if (a.assigneeUserId && a.assigneeUserId !== prev?.assigneeUserId && ["assigned", "in_progress"].includes(a.status)) push({ to: [a.assigneeUserId], title: "본사 요청", body: `${site(a.siteId)} · ${clip(a.title)}`, url: "/my-actions", tag: `act-${a.id}` });
  }

  // 고객(발주처) 요청
  const prBefore = new Map(before.partnerRequests.map((r) => [r.id, r]));
  for (const r of after.partnerRequests) {
    const prev = prBefore.get(r.id);
    if (!prev) push({ to: hq, title: `고객 요청 · ${PARTNER_TYPE_LABEL[r.type]}`, body: `${site(r.siteId)} · ${clip(r.title)}`, url: "/insights#requests", tag: `pr-${r.id}` });
    else if (prev.status !== "answered" && r.status === "answered") push({ to: [r.partnerUserId], title: "태강지엘텍 회신 도착", body: clip(r.title), url: "/partner", tag: `pr-${r.id}` });
  }

  // 발주처 포털 공정 사진 새로 공개 (D-67) — 그 현장을 볼 수 있는 발주처에게 현장마다 한 번
  const wasShared = new Set(before.photos.filter((p) => p.shared).map((p) => p.id));
  const newly = new Map<string, number>();
  for (const p of after.photos) if (p.shared && !wasShared.has(p.id)) newly.set(p.siteId, (newly.get(p.siteId) ?? 0) + 1);
  for (const [siteId, n] of newly) {
    const partners = after.users.filter((u) => u.role === "partner" && !u.inactive && (u.partnerSiteIds ?? []).includes(siteId)).map((u) => u.id);
    push({ to: partners, title: "새 공정 사진", body: `${site(siteId)} · 사진 ${n}장이 공개되었습니다`, url: "/partner#photos", tag: `ph-${siteId}` });
  }
  return out;
}
