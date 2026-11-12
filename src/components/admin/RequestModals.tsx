"use client";

/**
 * 요청 처리 창 (본사) — 요청함과 하자보수 화면이 같은 창을 쓴다 (D-75).
 * - DefectOrderModal: 하자보수 요청 → 현장 작업지시 (요청에 붙은 사진이 그대로 현장 휴대폰에 간다 · D-68)
 * - ReplyModal: 회신 (하자보수는 보수 완료 사진을 함께 · 작업지시 완료 확인도 함께)
 * - PhotoStrip: 요청에 붙은 사진 줄 (누르면 크게)
 */
import { useState } from "react";
import { Send } from "lucide-react";
import { Button, Field, Notice, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { PARTNER_TYPE_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtDateTime, fmtMan, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { worksOnSite } from "@/lib/domain/types";
import { errorMessage } from "@/lib/data/commands";
import { run } from "@/lib/data/store";
import type { DemoDB, PartnerRequest } from "@/lib/domain/types";
import { IS_LIVE } from "@/lib/mode";
import { IntakeNotifyBox } from "@/components/admin/IntakeLinks";
import { woPartial } from "@/lib/domain/partnerFeed";

export const WO_STATE: Record<NonNullable<DemoDB["workOrders"]>[number]["status"], string> = { sent: "현장에 보냄", received: "현장이 확인함", in_progress: "보수 중", done: "완료 보고 · 본사 확인 전", confirmed: "완료 확인", returned: "보완 요청" };

export function PhotoStrip({ db, ids, label, testId }: { db: DemoDB; ids?: string[]; label: string; testId: string }) {
  const [big, setBig] = useState<string | null>(null);
  const list = (ids ?? []).map((id) => db.photos.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  if (!list.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid={testId}>
      <span className="text-[0.74rem] font-semibold text-ink-3">{label}</span>
      {list.map((p) => (
        <button key={p.id} type="button" onClick={() => setBig(p.dataUrl)} className="press overflow-hidden rounded-lg border border-line" aria-label={`${label} 크게 보기`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.dataUrl} alt="" loading="lazy" className="size-12 object-cover" />
        </button>
      ))}
      <Modal open={!!big} onClose={() => setBig(null)} title={label} size="lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {big && <img src={big} alt={label} className="w-full rounded-xl" />}
      </Modal>
    </div>
  );
}

/** 하자보수 요청 → 현장 작업지시 (발주처 사진이 그대로 현장 휴대폰에 간다 · D-68) */
export function DefectOrderModal({ db, req, onClose }: { db: DemoDB; req: PartnerRequest; onClose: () => void }) {
  const toast = useToast();
  const site = db.sites.find((s) => s.id === req.siteId);
  const people = db.users.filter((u) => !u.inactive && u.role !== "partner" && u.role !== "ceo" && !!site && worksOnSite(u, site));
  const [assignee, setAssignee] = useState(site?.fieldUserId && people.some((u) => u.id === site.fieldUserId) ? site.fieldUserId : (people[0]?.id ?? ""));
  const [due, setDue] = useState(req.desiredDate && req.desiredDate >= todayIso() ? req.desiredDate : "");
  const [urgent, setUrgent] = useState(false);
  // 현장 카드에 ‘하자보수’ 표시가 따로 붙으므로 제목에는 붙이지 않는다 (D-68 점검 반영)
  // 링크·전화 접수: ‘위치 — 문제’ (제목만 보고 어디의 무엇인지 알게 · D-74 점검 10차)
  const [title, setTitle] = useState((req.intake && req.location ? `${req.location} — ${req.title}` : req.title).slice(0, 80));
  const who = req.intake ? "접수자" : "발주처";
  const hasContact = !!req.intake && !!(req.intake.name || req.intake.phone);
  // 방문 약속을 잡으려면 보수 담당자가 접수자에게 전화해야 한다 — 기본으로 보여 준다 (접수 화면의 개인정보 안내에 ‘배정된 보수 담당자’가 적혀 있다)
  const [showContact, setShowContact] = useState(hasContact);
  const [memo, setMemo] = useState("");
  const [key] = useState(() => uid("idem"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // 링크·전화 접수는 제목에 ‘위치 — 문제’가 이미 들어 있다 — 제목에 다 담기지 않은 긴 내용만 덧붙인다 (현장 카드에 같은 글이 되풀이되지 않게)
  const base = req.intake ? (req.description.trim() === req.title ? "" : req.description.trim()) : [req.location ? `위치: ${req.location}` : "", req.description].filter(Boolean).join(" — ");
  const detail = [base.slice(0, memo.trim() ? 380 : 500), memo.trim() ? `본사 메모: ${memo.trim()}` : ""].filter(Boolean).join("\n").slice(0, 500);
  return (
    <Modal
      open
      onClose={onClose}
      title="하자보수 작업지시 보내기"
      description={`${site?.shortName ?? ""} · ${req.title}`}
      size="md"
      testId="defect-order-modal"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            icon={<Send size={16} />}
            disabled={busy || !assignee}
            data-testid="defect-order-send"
            onClick={async () => {
              setBusy(true);
              try {
                await run("createWorkOrder", { siteId: req.siteId, title, detail, assigneeUserId: assignee, dueDate: due || undefined, urgent, idempotencyKey: key, partnerRequestId: req.id, ...(hasContact && showContact ? { showContact: true } : {}) });
                toast.push({ tone: "ok", title: "작업지시를 보냈습니다", desc: req.intake ? "접수자의 진행 확인 화면에 ‘보수 배정’으로 표시됩니다 (알림은 가지 않습니다)." : "발주처 포털에 ‘보수 작업 배정’으로 표시됩니다." });
                onClose();
              } catch (e) {
                const fe = (e as { fieldErrors?: Record<string, string> }).fieldErrors;
                if (fe && Object.keys(fe).length) setErrors(fe);
                else toast.push({ tone: "err", title: errorMessage(e, "보내지 못했습니다.") });
              } finally {
                setBusy(false);
              }
            }}
          >
            작업지시 보내기
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {detail && (
          <p className="whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 text-[0.82rem] text-ink-2" data-testid="defect-order-detail">
            {detail}
          </p>
        )}
        {req.desiredDate && (
          <p className="text-[0.8rem] font-semibold text-ink-2" data-testid="defect-order-desired">
            발주처 보수 희망일: {fmtDate(req.desiredDate)}
            {req.desiredDate < todayIso() ? " (지남)" : ""}
          </p>
        )}
        <PhotoStrip db={db} ids={req.photoIds} label={`함께 가는 ${req.intake ? "접수" : "발주처"} 사진`} testId="defect-order-photos" />
        <Field label="지시 제목" htmlFor="do-title" required error={errors.title}>
          <input id="do-title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </Field>
        <Field label="받을 사람" htmlFor="do-assignee" required error={errors.assigneeUserId} hint={people.length ? undefined : "이 현장을 맡은 직원이 없습니다. 운영 관리에서 현장을 먼저 배정하세요."}>
          <select id="do-assignee" className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="defect-order-assignee">
            {people.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} {u.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="기한 (선택)" htmlFor="do-due" error={errors.dueDate} hint={req.intake ? "접수자 화면에 ‘보수 목표일’로 보입니다" : undefined}>
            <input id="do-due" type="date" min={todayIso()} className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2.5 self-end pb-2 text-[0.88rem] font-semibold">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="size-4 accent-[var(--t-active)]" /> 긴급
          </label>
        </div>
        <Field label="현장 전달 메모 (선택)" htmlFor="do-memo" hint={`보수 담당자만 봅니다 — ${who}에게는 보이지 않습니다`}>
          <input id="do-memo" className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={100} placeholder="예: 방문 전 관리사무소에 먼저 들를 것" data-testid="defect-order-memo" />
        </Field>
        {hasContact && (
          <label className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3 text-[0.85rem]">
            <input type="checkbox" checked={showContact} onChange={(e) => setShowContact(e.target.checked)} className="mt-1 size-4 accent-[var(--t-active)]" data-testid="defect-order-contact" />
            <span>
              <b>접수자 연락처를 보수 담당자에게 보여 주기</b>
              <span className="block text-[0.74rem] text-ink-3">방문 약속용입니다. 받을 사람의 작업지시 카드에만 보이고, 본사가 완료를 확인하면 가려집니다. 끄면 본사가 대신 연락해야 합니다.</span>
            </span>
          </label>
        )}
        <p className="text-[0.74rem] text-ink-3">{who}에게는 ‘보수 배정 → 보수 중 → 보수 완료’ 단계와 기한만 보입니다. 담당자 이름·현장 메모는 보이지 않습니다.</p>
      </div>
    </Modal>
  );
}

export function ReplyModal({ db, req, onClose, confirmDefault }: { db: DemoDB; req: PartnerRequest; onClose: () => void; confirmDefault?: boolean }) {
  const toast = useToast();
  const [text, setText] = useState("");
  // 링크·전화 접수는 회신해도 알림이 가지 않는다 — 보낸 뒤 이 창에서 바로 알린다 (점검 11차)
  const [sent, setSent] = useState(false);
  // 하자보수: 작업지시 완료 사진을 회신과 함께 보낼 수 있다 (D-68)
  const wo = req.linkedWorkOrderId ? (db.workOrders ?? []).find((w) => w.id === req.linkedWorkOrderId) : undefined;
  // 끝난 작업지시의 사진만 (보완 요청으로 되돌린 작업지시의 예전 사진은 고르지 않는다 · D-68 점검 반영)
  const woDone = !!wo && (wo.status === "done" || wo.status === "confirmed");
  const donePhotos = woDone ? (wo!.donePhotoIds ?? []).map((id) => db.photos.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p).slice(0, 3) : [];
  // 두 번째 회신은 보수가 끝난 뒤의 ‘보수 완료 회신’ — 작업지시 없이 일정만 안내한 건은 아니다 (점검 11차)
  const followUp = req.status === "answered" && !!wo;
  // 일정 안내만 하고 작업지시를 보내지 않은 하자: 여기서는 ‘작업지시 없이 처리 끝’ 회신만 (점검 11차)
  const closeOnly = req.type === "defect" && !wo && req.status === "answered";
  const [share, setShare] = useState<string[]>(() => donePhotos.filter((p) => !(req.replyPhotoIds ?? []).includes(p.id)).map((p) => p.id));
  // 현장이 끝냈다고 보낸 작업지시는 회신하면서 완료 확인도 함께 (요청함과 작업지시 화면 상태가 어긋나던 문제 · D-68 점검 반영)
  const partial = !!wo && woPartial(wo);
  // ‘일부만 끝냈어요’면 기본으로 완료 확인하지 않는다 (D-69 점검 반영) — ‘남은 보수 확인’에서 다 끝났다고 고르면 켠다 (점검 11차)
  const [confirmWo, setConfirmWo] = useState(wo?.status === "done" && (confirmDefault ?? !partial));
  const [closeNoRepair, setCloseNoRepair] = useState(closeOnly);
  const [busy, setBusy] = useState(false);
  const PH: Partial<Record<PartnerRequest["type"], string>> = {
    quote: "예) 실측 후 사양별 견적서를 별도로 보내드리겠습니다.",
    order: "예) 자재 입고 일정 확인 후 납품·시공일을 안내드리겠습니다.",
    change_review: "예) 변경 범위 확인했습니다. 단가 검토 후 11월 첫 주 변경견적 회신 드리겠습니다.",
    schedule: "예) 11월 12일 오전 점검 가능합니다.",
    defect: woDone ? "예) 보수를 마쳤습니다. 실리콘을 다시 시공하고 물을 뿌려 확인했습니다." : "예) 11월 10일 오전에 보수하러 방문하겠습니다.",
  };
  const [register, setRegister] = useState(req.type === "change_review");
  const [amountText, setAmountText] = useState("");
  const [err, setErr] = useState("");
  const amount = Number(amountText.replace(/[^\d]/g, ""));
  return (
    <Modal
      open
      onClose={onClose}
      title={sent ? "회신했습니다 — 접수자에게 알려 주세요" : closeOnly ? "작업지시 없이 처리 끝" : followUp ? "보수 완료 회신" : req.intake ? "접수자에게 회신" : "발주처 요청 회신"}
      description={req.title}
      size="md"
      testId="reply-modal"
      footer={
        sent ? (
          <Button variant="cta" onClick={onClose} data-testid="reply-done-close">
            닫기
          </Button>
        ) : (
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            icon={<Send size={16} />}
            data-testid="reply-confirm"
            disabled={busy}
            onClick={async () => {
              // 보내기 전에 빈칸부터 — 앞선 실패가 ‘검토 중’만 바꿔 두고 다음 보내기가 ‘이미 처리된 단계’로 막히던 문제 (D-68 점검 반영)
              if (!text.trim()) {
                setErr("회신 내용을 입력해주세요.");
                return;
              }
              setBusy(true);
              setErr("");
              try {
                await run("updatePartnerRequest", { requestId: req.id, patch: { status: "answered", reply: text, registerChangeOrder: register && amount > 0 ? { title: req.title, amount } : undefined, ...(share.length ? { sharePhotoIds: share } : {}), ...(closeNoRepair ? { closeWithoutRepair: true } : {}) } });
                if (wo && wo.status === "done" && confirmWo) await run("reviewWorkOrder", { workOrderId: wo.id, decision: "confirm" }).catch(() => {});
                if (req.intake) {
                  // 회신하면 줄이 ‘본사 할 일’에서 빠진다 — 알리기 단추를 찾으러 가지 않게 이 창에서 바로 (점검 11차)
                  setSent(true);
                  return;
                }
                toast.push({ tone: "ok", title: "회신했습니다", desc: req.type === "defect" && woDone ? "발주처 포털에 ‘보수 완료’와 회신이 표시됩니다." : "발주처 포털에 ‘회신 완료’와 회신 내용이 표시됩니다." });
                onClose();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "실패");
              } finally {
                setBusy(false);
              }
            }}
          >
            회신 보내기
          </Button>
        </>
        )
      }
    >
      {sent ? (
        <div className="space-y-3" data-testid="reply-notify">
          <Notice tone="info">링크·전화 접수는 회신해도 접수자에게 알림이 가지 않습니다. 아래 글을 문자나 카카오톡으로 보내 주세요. 나중에는 하자보수에서 그 줄의 ‘접수자에게 알리기·이력’으로 다시 볼 수 있습니다.</Notice>
          <IntakeNotifyBox db={db} req={db.partnerRequests.find((x) => x.id === req.id) ?? req} />
        </div>
      ) : (
      <div className="space-y-3">
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[0.82rem] text-ink-2">
          <b className="mr-1">[{PARTNER_TYPE_LABEL[req.type]}]</b>
          {req.item ? `${req.item}${req.qty ? ` · ${req.qty}` : ""} — ` : ""}
          {req.location ? `${req.location} — ` : ""}
          {req.description}
        </p>
        {wo && woDone && (wo.doneNote || wo.doneQty) && (
          <p className={cx("rounded-lg px-3 py-2 text-[0.82rem]", partial ? "bg-warn-bg text-ink" : "bg-ok-bg text-ink")} data-testid="reply-done-note">
            <b>현장 완료 보고:</b> {[wo.doneQty, wo.doneNote].filter(Boolean).join(" · ")}
            {partial && <span className="mt-0.5 block font-semibold text-warn">‘일부만 끝냈어요’로 보고됐습니다. 남은 작업을 확인한 뒤 회신하세요.</span>}
          </p>
        )}
        {req.type === "defect" && !wo && (
          <div className="rounded-xl border border-line bg-surface-2 p-3 text-[0.85rem]" data-testid="reply-no-wo">
            <p className="text-ink-2">{closeOnly ? "일정 안내 회신을 이미 보냈습니다. 여기서는 작업지시 없이 끝내는 회신만 보냅니다. 보수가 필요하면 이 창을 닫고 ‘작업지시 보내기’를 누르세요." : "아직 작업지시를 보내지 않았습니다. 보통은 일정 안내로 회신하고, 하자보수 화면의 ‘작업지시 보내기’로 현장에 보냅니다."}</p>
            <label className="mt-2 flex items-start gap-2.5">
              <input type="checkbox" checked={closeNoRepair} disabled={closeOnly} onChange={(e) => setCloseNoRepair(e.target.checked)} className="mt-1 size-4 accent-[var(--t-active)]" data-testid="reply-close-no-repair" />
              <span>
                <b>작업지시 없이 처리 끝</b>
                <span className="block text-[0.74rem] text-ink-3">
                  {req.intake ? "하자가 아니거나 전화로 해결한 경우만. 접수자 화면에 ‘답변 완료’로 보이고 확인을 받을 수 있습니다. 장난·중복 접수는 회신하지 말고 ‘자세히·이력’의 ‘버리기’를 쓰세요." : "하자가 아니거나 전화로 해결한 경우만. 발주처에 ‘처리 완료 (보수 없음)’로 보이고 확인을 받을 수 있습니다."}
                </span>
              </span>
            </label>
          </div>
        )}
        {(req.type === "quote" || req.type === "order") && (
          <p className="text-[0.76rem] text-ink-3">회신 내용은 발주처에 그대로 보입니다. 금액·내부 원가는 적지 말고, 견적서는 별도로 보내세요.</p>
        )}
        <Field label={req.intake ? "회신 내용 (접수자의 진행 확인 화면에 그대로 보입니다)" : "회신 내용 (발주처에 표시)"} htmlFor="rp-text" required>
          <textarea id="rp-text" rows={3} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} maxLength={400} placeholder={PH[req.type] ?? "예) 확인했습니다. 담당자가 곧 연락드리겠습니다."} />
        </Field>
        {!IS_LIVE && (
        <button
          type="button"
          onClick={() =>
            setText(
              req.type === "quote"
                ? "견적 문의 확인했습니다. 현장 실측 후 사양별 견적서를 별도로 보내드리겠습니다. (DEMO 회신)"
                : req.type === "order"
                  ? "주문 요청 확인했습니다. 자재 입고 일정 확인 후 납품·시공일을 확정해 안내드리겠습니다. (DEMO 회신)"
                  : req.type === "defect"
                    ? "보수를 마쳤습니다. 창틀 아래 실리콘을 다시 시공했고, 물을 뿌려 새는 곳이 없는 것을 확인했습니다. (DEMO 회신)"
                  : req.type === "schedule"
                    ? "일정 확인했습니다. 요청하신 날짜 오전에 점검하겠습니다. 변동이 있으면 미리 연락드리겠습니다. (DEMO 회신)"
                  : "서면 작업지시 접수했습니다. 변경 범위를 현장에서 확인했고, 계약 내역단가 기준으로 변경공사 견적을 회신드리겠습니다. (DEMO 회신)",
            )
          }
          className="press rounded-lg bg-[#FFF7D6] px-2 py-1 text-[0.75rem] font-bold text-[#7A5200]"
        >
          DEMO 회신 채우기
        </button>
        )}
        {req.type === "defect" && wo && wo.status !== "done" && wo.status !== "confirmed" && (
          <Notice tone="warn">현장 보수가 아직 끝나지 않았습니다 (지금: {WO_STATE[wo.status]}). 지금은 일정 안내로 회신하고, 현장이 ‘다 했어요’로 보내면 하자보수 화면의 ‘보수 완료 회신’으로 한 번 더 보내세요.</Notice>
        )}
        {donePhotos.length > 0 && (
          <fieldset className="rounded-xl border border-line bg-surface-2 p-3" data-testid="reply-share-photos">
            <legend className="px-1 text-[0.82rem] font-bold">보수 완료 사진 함께 보내기</legend>
            <div className="flex flex-wrap gap-2">
              {donePhotos.map((p) => (
                <label key={p.id} className="relative cursor-pointer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.dataUrl} alt="보수 완료 사진" className={cx("size-20 rounded-lg border-2 object-cover", share.includes(p.id) ? "border-active" : "border-line opacity-60")} />
                  <input type="checkbox" className="absolute left-1.5 top-1.5 size-4 accent-[var(--t-active)]" checked={share.includes(p.id)} onChange={(e) => setShare((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))} aria-label="이 사진 보내기" />
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[0.72rem] text-ink-3">
              {req.intake ? "고른 사진은 진행 확인 주소를 가진 사람이 볼 수 있습니다. 집 안·사람이 찍힌 사진은 빼 주세요." : "고른 사진은 요청한 발주처에게만 보입니다 (다른 발주처의 ‘공정 사진’에는 나오지 않음)."}
            </p>
          </fieldset>
        )}
        {wo && wo.status === "done" && (
          <label className="flex items-start gap-2.5 text-[0.85rem]">
            <input type="checkbox" checked={confirmWo} onChange={(e) => setConfirmWo(e.target.checked)} className="mt-1 size-4 accent-[var(--t-active)]" data-testid="reply-confirm-wo" />
            <span>
              <b>작업지시 완료 확인도 함께</b>
              <span className="block text-[0.74rem] text-ink-3">끄면 작업지시는 ‘완료 보고 · 본사 확인 전’으로 남습니다.</span>
            </span>
          </label>
        )}
        {req.type === "change_review" && (
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <label className="flex items-start gap-2.5 text-[0.85rem]">
              <input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} className="mt-1 size-4 accent-[var(--t-active)]" />
              <span>
                <b>내부 변경공사 검토 건으로 등록</b>
                <span className="block text-[0.74rem] text-ink-3">금액 입력 시 ‘청구 검토 중’으로 등록 — 승인 전 이익 미반영. 발주처에는 금액이 표시되지 않습니다.</span>
              </span>
            </label>
            {register && (
              <div className="mt-2">
                <Field label="예상 변경 금액 (원, 선택)" htmlFor="rp-amt" hint={amount ? `= ${fmtMan(amount)}` : "비워두면 등록하지 않음"}>
                  <input id="rp-amt" inputMode="numeric" className={cx(inputCls, "num text-right")} value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, "") ? Number(e.target.value.replace(/[^\d]/g, "")).toLocaleString("ko-KR") : "")} />
                </Field>
              </div>
            )}
          </div>
        )}
        {err && <Notice tone="err">{err}</Notice>}
        <p className="text-[0.72rem] text-ink-3">접수 {fmtDateTime(req.createdAt)}</p>
      </div>
      )}
    </Modal>
  );
}

/**
 * 남은 보수 확인 (점검 11차) — 현장이 ‘일부만 끝냈어요’로 보내고 본사가 회신만 한 하자.
 * 남은 작업까지 끝났으면 ‘보수 완료 회신’(작업지시 완료 확인 함께), 아니면 ‘보완 요청’으로 현장에 다시 보낸다.
 */
export function CheckModal({ db, req, onClose, onDone }: { db: DemoDB; req: PartnerRequest; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const wo = req.linkedWorkOrderId ? (db.workOrders ?? []).find((w) => w.id === req.linkedWorkOrderId) : undefined;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!wo) return null;
  const back = async () => {
    if (note.trim().length < 2) {
      setErr("현장에 다시 할 일을 적어 주세요.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await run("reviewWorkOrder", { workOrderId: wo.id, decision: "return", note });
      toast.push({ tone: "ok", title: "보완을 요청했습니다", desc: "현장이 다시 끝내면 ‘보수 완료 회신’으로 알려 드립니다." });
      onClose();
    } catch (e) {
      setErr(errorMessage(e, "보내지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="남은 보수 확인" description={req.title} size="md" testId="check-modal">
      <div className="space-y-3">
        <p className="rounded-lg bg-warn-bg px-3 py-2 text-[0.84rem] text-ink" data-testid="check-done-note">
          <b>현장 완료 보고:</b> {[wo.doneQty, wo.doneNote].filter(Boolean).join(" · ") || "—"}
          <span className="mt-0.5 block text-[0.78rem] text-ink-2">남은 작업이 있다고 보고된 건입니다. 회신은 보냈고, 작업지시는 아직 ‘완료 보고 · 본사 확인 전’입니다.</span>
        </p>
        <PhotoStrip db={db} ids={wo.donePhotoIds} label="현장 완료 사진" testId="check-photos" />
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <p className="text-[0.86rem] font-bold">남은 작업까지 끝났습니다</p>
          <p className="mt-0.5 text-[0.78rem] text-ink-3">작업지시 완료를 확인하고, {req.intake ? "접수자" : "발주처"}에게 보수 완료 회신을 보냅니다. 그 뒤에 ‘잘 고쳐졌습니다’ 확인을 받을 수 있습니다.</p>
          <Button className="mt-2" variant="cta" icon={<Send size={16} />} onClick={onDone} data-testid="check-finish">
            보수 완료 회신 쓰기
          </Button>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <label htmlFor="ck-note" className="text-[0.86rem] font-bold">
            아직 남았습니다 — 현장에 보완 요청
          </label>
          <textarea id="ck-note" rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예) 아래쪽 창틀 실리콘도 다시 시공해 주세요" className={cx(inputCls, "mt-1 h-auto resize-none py-1.5")} data-testid="check-note" />
          <Button className="mt-2" icon={<Send size={16} />} onClick={back} loading={busy} data-testid="check-return">
            보완 요청 보내기
          </Button>
        </div>
        {err && <Notice tone="err">{err}</Notice>}
      </div>
    </Modal>
  );
}
