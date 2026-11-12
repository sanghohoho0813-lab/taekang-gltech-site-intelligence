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
    // 링크·전화 접수(D-74): 접수자가 적은 글을 알림에 넣지 않고(현장·접수 번호만), 같은 링크의 알림은 하나로 묶는다 — 잠금 화면 문구와 횟수를 밖에서 정하지 못하게 (점검 10차)
    if (r.intake) {
      const body = `${site(r.siteId)} · 접수 번호 ${r.intake.no}`;
      if (!prev) push({ to: hq, title: r.reopenedFrom ? "하자 다시 접수 (아직 문제가 있음)" : r.intake.id === "phone" ? "하자 접수 (전화)" : "하자 접수 (링크)", body, url: "/insights#requests", tag: `intake-${r.intake.id.slice(0, 12)}` });
      else if (!prev.confirmedAt && r.confirmedAt) push({ to: hq, title: "접수자 확인 완료", body, url: "/insights#requests", tag: `pr-${r.id}` });
      continue;
    }
    if (!prev) push({ to: hq, title: `고객 요청 · ${PARTNER_TYPE_LABEL[r.type]}`, body: `${site(r.siteId)} · ${clip(r.title)}`, url: "/insights#requests", tag: `pr-${r.id}` });
    else if (prev.status !== "answered" && r.status === "answered") push({ to: [r.partnerUserId], title: r.type === "defect" ? "하자보수 회신 도착" : "태강지엘텍 회신 도착", body: clip(r.title), url: "/partner#my-requests", tag: `pr-${r.id}` });
    // 하자보수를 작업지시로 보냈을 때 발주처에게 ‘보수 작업 배정’ (D-68)
    else if (!prev.linkedWorkOrderId && r.linkedWorkOrderId) push({ to: [r.partnerUserId], title: "하자보수 작업 배정", body: clip(r.title), url: "/partner#my-requests", tag: `pr-${r.id}` });
    // 일정 안내로 먼저 회신한 하자보수에 보수 사진을 더 보냄 (D-68 점검 반영)
    else if (prev.status === "answered" && (r.replyPhotoIds ?? []).some((id) => !(prev.replyPhotoIds ?? []).includes(id))) push({ to: [r.partnerUserId], title: "보수 완료 사진 도착", body: clip(r.title), url: "/partner#my-requests", tag: `pr-${r.id}` });
    else if (prev.status === "answered" && r.type === "defect" && r.reply !== prev.reply) push({ to: [r.partnerUserId], title: "하자보수 회신 도착", body: clip(r.title), url: "/partner#my-requests", tag: `pr-${r.id}` });
    // 발주처가 회신·보수 완료를 확인 (D-68)
    else if (!prev.confirmedAt && r.confirmedAt) push({ to: hq, title: "발주처 확인 완료", body: `${site(r.siteId)} · ${clip(r.title)}`, url: "/insights#requests", tag: `pr-${r.id}` });
  }
  // 하자 접수 링크가 하루 한도에 닿음 (D-74 점검 10차) — 그날 한 번
  const fullBefore = new Map((before.intakes ?? []).map((i) => [i.id, i.fullOn]));
  for (const i of after.intakes ?? []) {
    if (i.fullOn && fullBefore.get(i.id) !== i.fullOn) push({ to: hq, title: "하자 접수 링크 한도 도달", body: `${site(i.siteId)} · ${i.label} — 오늘은 더 접수되지 않습니다. 장난 접수면 버리고 링크를 닫아 주세요`, url: `/sites/${i.siteId}?tab=requests`, tag: `intake-full-${i.id.slice(0, 12)}` });
  }
  // 회신과 함께 보낸 보수 완료 사진은 ‘회신 도착’ 알림 하나로 (사진 알림을 따로 보내지 않는다 · D-68)
  const replyPhotos = new Set(after.partnerRequests.flatMap((r) => r.replyPhotoIds ?? []));

  // 발주처 포털 공정 사진 새로 공개 (D-67) — 처음 공개한 사진만, 같은 현장에서 30분 안에 이미 알렸으면 묶어서 다시 보내지 않는다 (D-67 점검 반영)
  const beforeById = new Map(before.photos.map((p) => [p.id, p]));
  const newly = new Map<string, number>();
  for (const p of after.photos) {
    const prev = beforeById.get(p.id);
    if (p.shared && !prev?.shared && !prev?.sharedOnce && !replyPhotos.has(p.id)) newly.set(p.siteId, (newly.get(p.siteId) ?? 0) + 1);
  }
  for (const [siteId, n] of newly) {
    // 회신으로 보낸 보수 사진은 ‘30분 안에 이미 알림’ 판단에 넣지 않는다 (D-68 점검 반영)
    const nowShared = after.photos.filter((p) => p.siteId === siteId && p.shared && !replyPhotos.has(p.id));
    const latest = nowShared.reduce((a, p) => (p.shared!.at > a ? p.shared!.at : a), "");
    const recentlyNotified = before.photos.some((p) => p.siteId === siteId && p.shared && !replyPhotos.has(p.id) && new Date(latest).getTime() - new Date(p.shared.at).getTime() < 30 * 60_000);
    if (recentlyNotified) continue;
    const partners = after.users.filter((u) => u.role === "partner" && !u.inactive && (u.partnerSiteIds ?? []).includes(siteId)).map((u) => u.id);
    push({ to: partners, title: "새 공정 사진", body: `${site(siteId)} · 사진 ${n}장이 공개되었습니다`, url: "/partner#photos", tag: `ph-${siteId}` });
  }
  return out;
}
