"use client";

/** 본사 작업지시 카드 (현장 직원) — 확인했어요 → 시작했어요 → 다 했어요(한 일·작업량·사진) */
import { useState } from "react";
import { Camera, CircleCheck, Play, ThumbsUp, X } from "lucide-react";
import { run } from "@/lib/data/store";
import type { DemoDB, WorkOrder } from "@/lib/domain/types";
import { todayIso } from "@/lib/domain/format";
import { cx } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Chip, VoiceHint, easyTextareaCls } from "./ui";
import { dueText, easyDate } from "./words";
import { downscalePhoto } from "./photo";
import { errorMessage } from "@/lib/data/commands";

export const WO_STATUS: Record<WorkOrder["status"], string> = {
  sent: "새 지시 — 확인해 주세요",
  received: "확인함",
  in_progress: "하는 중",
  done: "본사 확인 기다리는 중",
  confirmed: "끝남 · 본사 확인",
  returned: "본사 보완 요청",
};

export const openWorkOrders = (db: DemoDB, userId: string) => (db.workOrders ?? []).filter((w) => w.assigneeUserId === userId && !["done", "confirmed"].includes(w.status));

const big = "press flex h-[3.9rem] w-full items-center justify-center gap-2 rounded-2xl text-[1.2rem] font-extrabold disabled:bg-surface-3 disabled:text-ink-2 disabled:shadow-none";

export function EasyWorkOrderCard({ db, wo }: { db: DemoDB; wo: WorkOrder }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [finish, setFinish] = useState(false);
  const site = db.sites.find((s) => s.id === wo.siteId);
  const [bigPhoto, setBigPhoto] = useState<string | null>(null);
  const refPhotos = (wo.refPhotoIds ?? []).map((id) => db.photos.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  const due = wo.dueDate && !["done", "confirmed"].includes(wo.status) ? dueText(wo.dueDate, todayIso()) : null;
  const step = async (action: "receive" | "start") => {
    setBusy(true);
    setErr(null);
    try {
      await run("workOrderStep", { workOrderId: wo.id, action });
    } catch (e) {
      setErr(errorMessage(e, "처리하지 못했어요."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={cx("rounded-3xl border-2 bg-surface p-4 shadow-card", wo.status === "returned" ? "border-err/40" : wo.urgent && wo.status === "sent" ? "border-warn/50" : "border-line")} data-testid="wo-card" data-status={wo.status} data-wo={wo.id}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[1.02rem] font-semibold text-ink-2">
        <b className="text-ink">{site?.shortName}</b>
        <span className="rounded-lg bg-active-soft px-2 py-0.5 text-[0.95rem] font-bold text-theme-ink">{wo.sourcePartnerRequestId ? "하자보수" : "본사 지시"}</span>
        {wo.urgent && <span className="rounded-lg bg-err-bg px-2 py-0.5 text-[0.95rem] font-bold text-err">긴급</span>}
        <span className={cx("rounded-lg px-2 py-0.5 text-[0.98rem] font-bold", wo.status === "returned" ? "bg-err-bg text-err" : wo.status === "confirmed" || wo.status === "done" ? "bg-ok-bg text-ok" : "bg-surface-3 text-ink-2")}>{WO_STATUS[wo.status]}</span>
      </p>
      <h2 className="mt-2 text-[1.3rem] font-extrabold leading-snug">{wo.title}</h2>
      {wo.detail && <p className="mt-1.5 text-[1.05rem] leading-relaxed text-ink-2">{wo.detail}</p>}
      {refPhotos.length > 0 && (
        <div className="mt-2.5" data-testid="wo-ref-photos">
          <p className="text-[0.98rem] font-bold text-ink-2">발주처가 보낸 하자 사진</p>
          <div className="mt-1.5 flex gap-2">
            {refPhotos.map((p) => (
              <button key={p.id} type="button" onClick={() => setBigPhoto(p.dataUrl)} className="press overflow-hidden rounded-xl border border-line" aria-label="하자 사진 크게 보기">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.dataUrl} alt="" className="size-20 object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
      {due && (
        <p className={cx("mt-2 text-[1.08rem] font-bold", due.late ? "text-err" : "text-ink")}>
          {easyDate(wo.dueDate!)}까지 · {due.text}
        </p>
      )}
      {wo.status === "returned" && wo.returnNote && (
        <p className="mt-2 rounded-2xl bg-err-bg px-3.5 py-2.5 text-[1.05rem] font-semibold text-err" data-testid="wo-return-note">
          보완 요청: {wo.returnNote}
        </p>
      )}
      {(wo.status === "done" || wo.status === "confirmed") && (wo.doneNote || wo.doneQty) && (
        <p className="mt-2 rounded-2xl bg-ok-bg px-3.5 py-2.5 text-[1.02rem]">
          <b>보낸 내용:</b> {[wo.doneQty, wo.doneNote].filter(Boolean).join(" · ")}
        </p>
      )}
      {err && <p className="mt-2 text-[1.02rem] font-semibold text-err">{err}</p>}
      <div className="mt-3.5 space-y-2.5">
        {wo.status === "sent" && (
          <button type="button" onClick={() => step("receive")} disabled={busy} className={cx(big, "bg-cta text-cta-text")} data-testid="wo-receive">
            <ThumbsUp size={22} aria-hidden /> 확인했어요
          </button>
        )}
        {(wo.status === "received" || wo.status === "returned") && (
          <button type="button" onClick={() => step("start")} disabled={busy} className={cx(big, "border-2 border-line-strong bg-surface text-ink")} data-testid="wo-start">
            <Play size={22} aria-hidden /> 시작했어요
          </button>
        )}
        {["received", "in_progress", "returned"].includes(wo.status) && (
          <button type="button" onClick={() => setFinish(true)} disabled={busy} className={cx(big, "bg-cta text-cta-text")} data-testid="wo-complete">
            <CircleCheck size={24} aria-hidden /> {wo.status === "returned" ? "보완해서 다시 보내기" : "다 했어요"}
          </button>
        )}
      </div>
      {finish && <FinishModal wo={wo} onClose={() => setFinish(false)} />}
      <Modal open={!!bigPhoto} onClose={() => setBigPhoto(null)} title="발주처가 보낸 하자 사진" size="lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {bigPhoto && <img src={bigPhoto} alt="하자 사진" className="w-full rounded-xl" />}
      </Modal>
    </article>
  );
}

const UNITS = ["개", "세트", "m", "㎡", "층", "곳"];
const RESULT_CHIPS = ["지시대로 끝냈어요", "일부만 끝냈어요 (남은 작업 있음)", "사진으로 확인해 주세요"];

function FinishModal({ wo, onClose }: { wo: WorkOrder; onClose: () => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [qtyN, setQtyN] = useState("");
  const [unit, setUnit] = useState("개");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const note = [...picked, text.trim()].filter(Boolean).join(", ");
  const qty = qtyN ? `${qtyN}${unit}` : "";
  const ok = !!note || !!qty || photos.length > 0;
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      await run("workOrderStep", { workOrderId: wo.id, action: "complete", note, qty, photoDataUrls: photos });
      // 보낸 뒤 카드가 말없이 사라지지 않게 (D-66)
      toast.push({ tone: "ok", title: "본사로 보냈어요", desc: `‘${wo.title}’ — 본사가 확인하면 알려 드려요.` });
      onClose();
    } catch (e) {
      setErr(errorMessage(e, "보내지 못했어요."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="다 했어요 · 본사로 보내기"
      size="md"
      testId="wo-finish"
      footer={
        <div className="w-full space-y-2">
        {!ok && <p className="text-center text-[0.98rem] font-semibold text-warn" data-testid="wo-finish-hint">한 일·수량·사진 중 하나는 넣어 주세요</p>}
        <div className="grid w-full grid-cols-[1fr_1.8fr] gap-2.5">
          <button type="button" onClick={onClose} className="press h-[3.8rem] rounded-full border-2 border-line-strong bg-surface text-[1.1rem] font-bold">
            닫기
          </button>
          <button type="button" onClick={save} disabled={!ok || busy} className="press h-[3.8rem] rounded-full bg-cta text-[1.15rem] font-extrabold text-cta-text disabled:bg-surface-3 disabled:text-ink-2" data-testid="wo-finish-send">
            본사로 보내기
          </button>
        </div>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[1.15rem] font-bold">{wo.title}</p>
        <div className="flex flex-wrap gap-2.5">
          {RESULT_CHIPS.map((c) => (
            <Chip key={c} selected={picked.includes(c)} onClick={() => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))} testId="wo-result-chip">
              {c}
            </Chip>
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-[1.1rem] font-bold">작업량 <span className="font-semibold text-ink-2">(있으면)</span></p>
          <div className="flex items-center gap-2">
            <input inputMode="numeric" value={qtyN} onChange={(e) => setQtyN(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))} aria-label="작업량 숫자" className="num h-[3.6rem] w-28 rounded-2xl border-2 border-line-strong px-3 text-right text-[1.4rem] font-extrabold" data-testid="wo-qty" />
            <div className="flex flex-wrap gap-1.5">
              {UNITS.map((u) => (
                <button key={u} type="button" onClick={() => setUnit(u)} aria-pressed={unit === u} className={cx("press h-12 min-w-12 rounded-xl border-2 px-2.5 text-[1.05rem] font-bold", unit === u ? "border-active bg-active-soft" : "border-line-strong")}>
                  {u}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt={`완료 사진 ${i + 1}`} className="size-20 rounded-xl object-cover" />
              <button type="button" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="press absolute -right-1 -top-1 grid size-8 place-items-center rounded-full bg-black/70 text-white" aria-label="사진 빼기">
                <X size={16} />
              </button>
            </div>
          ))}
          {photos.length < 3 && (
            <label className="press flex h-20 min-w-36 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-cta px-3 text-[1.05rem] font-extrabold text-cta-text">
              <Camera size={22} aria-hidden /> 사진 찍기
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                data-testid="wo-photo"
                onChange={async (e) => {
                  const input = e.currentTarget;
                  const f = input.files?.[0];
                  input.value = "";
                  if (!f) return;
                  try {
                    const u = await downscalePhoto(f);
                    setPhotos((x) => [...x, u].slice(0, 3));
                  } catch {
                    setErr("사진을 읽지 못했어요. 다시 찍어 주세요.");
                  }
                }}
              />
            </label>
          )}
        </div>
        <label htmlFor="wo-text" className="block text-[1.1rem] font-bold">
          더 적을 내용 <span className="font-semibold text-ink-2">(안 적어도 돼요)</span>
        </label>
        <textarea id="wo-text" rows={2} maxLength={400} value={text} onChange={(e) => setText(e.target.value)} className={easyTextareaCls} />
        <VoiceHint />
        {!ok && <p className="text-[1rem] font-semibold text-warn">한 일을 누르거나, 작업량·사진 중 하나는 넣어 주세요.</p>}
        {err && <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.05rem] font-semibold text-err">{err}</p>}
      </div>
    </Modal>
  );
}
