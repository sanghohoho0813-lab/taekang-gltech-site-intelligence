"use client";

/**
 * 자재 반입·설치 수량 남기기 (D-62) — 반입/설치 → 자재 → 수량 → 사진(선택) → 보내기. 한 화면에 질문 하나.
 * 수량만 다룬다(금액 없음). 잘못 넣으면 오늘 내가 남긴 기록을 사유를 골라 취소할 수 있다.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Boxes, Camera, CircleCheck, HardHat, PackageCheck, Truck, Undo2, WifiOff, X } from "lucide-react";
import { run } from "@/lib/data/store";
import { useMe } from "@/lib/data/hooks";
import { IS_LIVE } from "@/lib/mode";
import { CommandError } from "@/lib/data/commands";
import type { MaterialMoveKind, Site } from "@/lib/domain/types";
import { activeItems, fmtQty, liveMoves, materialRows, MATERIAL_FLAG_LABEL, MOVE_LABEL } from "@/lib/domain/material";
import { todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { cx } from "@/components/ui/primitives";
import { outboxAdd } from "@/lib/browser/outbox";
import { Choice, EasyBar, EasyPageHead, EasyQuestion, SectionBar, easyTextareaCls } from "./ui";
import { downscalePhoto } from "./photo";
import { easyDate } from "./words";

type Step = "site" | "kind" | "item" | "qty" | "photo" | "confirm";
const KIND_Q: Record<MaterialMoveKind, { title: string; help: string; photo: string; photoHelp: string; icon: React.ReactNode }> = {
  in: { title: "들어온 자재", help: "현장에 실제로 내린 수량을 넣으세요. 송장 수량과 다르면 실제 수량으로.", photo: "송장이나 내린 자재 사진", photoHelp: "송장·납품서가 보이게 찍으면 본사가 대조하기 쉬워요.", icon: <Truck size={24} /> },
  install: { title: "설치한 자재", help: "오늘 실제로 설치(시공)한 수량만 넣으세요.", photo: "설치한 곳 사진", photoHelp: "어디에 설치했는지 보이게 한 장이면 됩니다.", icon: <PackageCheck size={24} /> },
};
const VOID_REASONS = ["수량을 잘못 넣었어요", "다른 자재였어요", "두 번 보냈어요"];

export function EasyMaterial() {
  const { db, role, userId } = useMe();
  // 품목이 정해진 담당 현장만 (DEMO의 현장 직원은 담당 현장, LIVE는 서버가 이미 담당 현장만 보냄)
  const sites = useMemo<Site[]>(() => {
    if (!db) return [];
    const mine = role === "field" && !IS_LIVE ? db.sites.filter((s) => s.fieldUserId === userId) : db.sites;
    return mine.filter((s) => s.status === "active" && activeItems(db, s.id).length > 0);
  }, [db, role, userId]);
  const [siteId, setSiteId] = useState(sites.length === 1 ? sites[0].id : "");
  const [stack, setStack] = useState<Step[]>([sites.length === 1 ? "kind" : "site"]);
  const [kind, setKind] = useState<MaterialMoveKind>("install");
  // 사람이 고르기 전에는 아무것도 선택돼 보이지 않게
  const [picked, setPicked] = useState(false);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [key, setKey] = useState(() => uid("idem"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; unit: string; qty: number; kind: MaterialMoveKind; inQty?: number; installQty?: number; onSite?: number; flags?: string[]; queued?: boolean; already?: boolean } | null>(null);
  const step = stack[stack.length - 1];
  // 내용(종류·자재·수량·사진·메모)이 바뀌면 새 기록 — 중복 방지 키도 새로 (같은 내용을 다시 누르면 같은 키 → 한 번만 들어감 · 리뷰 반영 D-63)
  useEffect(() => setKey(uid("idem")), [kind, itemId, qty, photo, note]);

  useEffect(() => {
    if (!siteId && sites.length === 1) {
      setSiteId(sites[0].id);
      setStack((s) => (s[0] === "site" && s.length === 1 ? ["kind"] : s));
    }
  }, [sites, siteId]);

  if (!db) return null;
  if (!sites.length)
    return (
      <div className="space-y-5" data-testid="easy-material">
        <EasyPageHead title="자재 반입·설치" sub="들어온 수량과 설치한 수량을 남겨요." icon={<Boxes size={26} aria-hidden />} />
        <p className="rounded-2xl border-2 border-line bg-surface p-4 text-[1.1rem] leading-relaxed" data-testid="material-none">
          아직 본사가 이 현장의 자재 품목을 정하지 않았어요. 본사에 ‘자재 품목’을 넣어 달라고 말해 주세요.
        </p>
        <Link href="/field" className="press flex h-[3.8rem] w-full items-center justify-center rounded-full border-2 border-line-strong bg-surface text-[1.12rem] font-bold">
          처음 화면으로
        </Link>
      </div>
    );

  const site = db.sites.find((s) => s.id === siteId);
  const items = site ? activeItems(db, site.id) : [];
  const rows = site ? materialRows(db, site.id) : [];
  const item = items.find((i) => i.id === itemId);
  const cur = rows.find((r) => r.item.id === itemId);
  const n = Number(qty.replace(/,/g, ""));
  const qtyOk = qty.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 1_000_000 && Math.abs(Math.round(n * 100) / 100 - n) < 1e-9;
  const today = todayIso();
  const mineToday = liveMoves(db, siteId).filter((m) => m.by === userId && m.workDate === today).sort((a, b) => b.at.localeCompare(a.at));
  const nameOf = (id: string) => items.find((i) => i.id === id) ?? site?.materials?.find((i) => i.id === id);

  const go = (s: Step) => {
    setErr(null);
    setStack((x) => [...x, s]);
  };
  const back = () => (stack.length > 1 ? setStack((x) => x.slice(0, -1)) : undefined);
  const sections = ["종류", "자재", "수량", "사진", "확인"];
  const secIdx = step === "site" || step === "kind" ? 0 : step === "item" ? 1 : step === "qty" ? 2 : step === "photo" ? 3 : 4;

  const send = async () => {
    if (!site || !item || !qtyOk || busy) return;
    setBusy(true);
    setErr(null);
    const args = { siteId: site.id, itemId: item.id, kind, qty: n, ...(note.trim() ? { note: note.trim() } : {}), ...(photo ? { photoDataUrl: photo } : {}), idempotencyKey: key };
    try {
      const r = await run("recordMaterial", args);
      setDone({ name: item.name, unit: item.unit, qty: n, kind, inQty: r.inQty, installQty: r.installQty, onSite: r.onSite, flags: r.flags });
    } catch (e) {
      if (e instanceof CommandError && e.code === "NETWORK" && IS_LIVE && userId) {
        // 지하·고층에서 신호가 없을 때: 사진까지 휴대폰에 보관 → 신호가 잡히면 자동으로 보낸다 (누른 시각으로 날짜를 정함 · D-63)
        const saved = await outboxAdd({ id: key, userId, name: "recordMaterial", args: { ...args, pressedAt: new Date().toISOString() }, label: `${site.shortName} · 자재 ${MOVE_LABEL[kind]} ${item.name} ${fmtQty(n, item.unit)}${photo ? " · 사진" : ""}` });
        if (saved) setDone({ name: item.name, unit: item.unit, qty: n, kind, queued: true });
        else setErr("인터넷이 연결되지 않아 보내지 못했어요. 신호가 잡히는 곳에서 다시 눌러 주세요.");
      } else if (e instanceof CommandError && e.code === "DUPLICATE") {
        // 끊기기 직전에 이미 저장된 기록
        setDone({ name: item.name, unit: item.unit, qty: n, kind, queued: false, already: true });
      } else {
        setErr(e instanceof CommandError || e instanceof Error ? e.message : "보내지 못했어요. 다시 눌러 주세요.");
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelMove = async (moveId: string, reason: string) => {
    setErr(null);
    try {
      await run("voidMaterialMove", { moveId, reason });
      setVoiding(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "취소하지 못했어요.");
    }
  };

  const again = () => {
    setPicked(false);
    setItemId("");
    setQty("");
    setNote("");
    setPhoto(null);
    setKey(uid("idem"));
    setDone(null);
    setStack(["kind"]);
  };

  if (done)
    return (
      <div className="anim-pop space-y-5 pt-4 text-center" data-testid="material-done">
        {done.queued ? <WifiOff size={64} className="mx-auto text-warn" aria-hidden /> : <CircleCheck size={64} className="mx-auto text-ok" aria-hidden />}
        <p className="text-[1.6rem] font-extrabold leading-snug">
          {done.name} {fmtQty(done.qty, done.unit)} {MOVE_LABEL[done.kind]} {done.queued ? "휴대폰에 보관했어요" : "남겼어요"}
        </p>
        {done.queued && (
          <p className="rounded-2xl bg-warn-bg px-4 py-3 text-[1.08rem] font-semibold text-ink" data-testid="material-queued">
            인터넷이 안 돼서 휴대폰에 그대로 보관했어요. 신호가 잡히면 자동으로 본사에 보내요. 날짜는 지금 누른 날로 들어가요.
          </p>
        )}
        {done.already && <p className="text-[1.05rem] text-ink-2">이미 본사에 도착해 있던 기록이에요.</p>}
        {done.inQty !== undefined && (
          <div className="space-y-1 rounded-2xl bg-surface-2 px-4 py-3 text-[1.1rem]" data-testid="material-done-totals">
            <p>
              들어온 누계 <b className="num">{fmtQty(done.inQty, done.unit)}</b> · 설치 누계 <b className="num">{fmtQty(done.installQty ?? 0, done.unit)}</b>
            </p>
            <p>
              현장에 남은 것 <b className="num">{fmtQty(done.onSite ?? 0, done.unit)}</b>
            </p>
          </div>
        )}
        {done.flags?.includes("install_over_in") && (
          <p className="rounded-2xl bg-warn-bg px-4 py-3 text-[1.05rem] font-semibold text-warn">설치가 들어온 수량보다 많아요. 빠진 반입 기록이 있으면 ‘들어온 자재’로 남겨 주세요.</p>
        )}
        <button type="button" onClick={again} className="press h-[4rem] w-full rounded-full bg-cta text-[1.2rem] font-extrabold text-cta-text shadow-card" data-testid="material-again">
          다른 자재도 남기기
        </button>
        <Link href="/field" className="press flex h-[3.8rem] w-full items-center justify-center rounded-full border-2 border-line-strong bg-surface text-[1.12rem] font-bold">
          처음 화면으로
        </Link>
      </div>
    );

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;
  switch (step) {
    case "site":
      body = (
        <EasyQuestion title="어느 현장인가요?">
          <div className="space-y-2.5">
            {sites.map((s) => (
              <Choice key={s.id} icon={<HardHat size={24} />} label={s.shortName} sub={s.workType} selected={siteId === s.id} onClick={() => (setSiteId(s.id), go("kind"))} testId={`material-site-${s.id}`} />
            ))}
          </div>
        </EasyQuestion>
      );
      break;
    case "kind":
      body = (
        <EasyQuestion title="무엇을 남길까요?" testId="material-kind">
          <div className="space-y-2.5">
            <Choice icon={KIND_Q.in.icon} label="자재가 들어왔어요" sub="반입 · 송장 수량 대조" selected={picked && kind === "in"} onClick={() => (setKind("in"), setPicked(true), go("item"))} testId="material-kind-in" />
            <Choice icon={KIND_Q.install.icon} label="자재를 설치했어요" sub="오늘 시공한 수량" selected={picked && kind === "install"} onClick={() => (setKind("install"), setPicked(true), go("item"))} testId="material-kind-install" />
          </div>
          {mineToday.length > 0 && (
            <div className="space-y-2" data-testid="material-today">
              <p className="text-[1.08rem] font-bold">오늘 내가 남긴 기록</p>
              {mineToday.map((m) => {
                const it = nameOf(m.itemId);
                return (
                  <div key={m.id} className="rounded-2xl border-2 border-line bg-surface p-3" data-testid="material-today-row">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 text-[1.05rem]">
                        <b>{MOVE_LABEL[m.kind]}</b> · {it?.name} <b className="num">{fmtQty(m.qty, it?.unit)}</b>
                      </p>
                      {voiding !== m.id && (
                        <button type="button" onClick={() => setVoiding(m.id)} className="press inline-flex min-h-[2.9rem] shrink-0 items-center gap-1 rounded-full border-2 border-line-strong px-3.5 text-[1rem] font-bold" data-testid="material-void">
                          <Undo2 size={18} aria-hidden /> 취소
                        </button>
                      )}
                    </div>
                    {voiding === m.id && (
                      <div className="mt-2 space-y-2">
                        <p className="text-[1rem] font-semibold text-ink-2">왜 취소하나요?</p>
                        {VOID_REASONS.map((r) => (
                          <button key={r} type="button" onClick={() => void cancelMove(m.id, r)} className="press flex min-h-[3.2rem] w-full items-center rounded-2xl bg-surface-3 px-4 text-left text-[1.05rem] font-bold" data-testid="material-void-reason">
                            {r}
                          </button>
                        ))}
                        <button type="button" onClick={() => setVoiding(null)} className="press flex min-h-[3rem] w-full items-center justify-center gap-1 text-[1rem] font-bold text-ink-2">
                          <X size={18} aria-hidden /> 그대로 두기
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {err && <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.05rem] font-semibold text-err">{err}</p>}
        </EasyQuestion>
      );
      footer = stack.length > 1 ? <EasyBar onBack={back} /> : null;
      break;
    case "item":
      body = (
        <EasyQuestion kicker={KIND_Q[kind].title} title="어떤 자재인가요?" testId="material-item">
          <div className="space-y-2.5">
            {items.map((it) => {
              const r = rows.find((x) => x.item.id === it.id);
              return (
                <Choice
                  key={it.id}
                  icon={<Boxes size={24} />}
                  label={it.name}
                  sub={`현장에 남은 것 ${fmtQty(r?.onSite ?? 0, it.unit)} · 설치 ${fmtQty(r?.installQty ?? 0)}${it.plannedQty ? ` / ${fmtQty(it.plannedQty, it.unit)}` : ` ${it.unit}`}`}
                  selected={itemId === it.id}
                  onClick={() => (setItemId(it.id), go("qty"))}
                  testId={`material-item-${it.id}`}
                />
              );
            })}
          </div>
        </EasyQuestion>
      );
      footer = <EasyBar onBack={back} />;
      break;
    case "qty":
      body = (
        <EasyQuestion kicker={`${KIND_Q[kind].title} · ${item?.name ?? ""}`} title={kind === "in" ? "얼마나 들어왔나요?" : "얼마나 설치했나요?"} help={KIND_Q[kind].help} testId="material-qty">
          <label htmlFor="material-qty-input" className="sr-only">
            수량 ({item?.unit})
          </label>
          <div className="flex items-center gap-3 rounded-2xl border-2 border-line-strong bg-surface px-4 py-2 focus-within:border-active focus-within:ring-4 focus-within:ring-active/20">
            <input
              id="material-qty-input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, "").slice(0, 10))}
              className="num min-w-0 flex-1 bg-transparent text-right text-[2.2rem] font-extrabold text-ink placeholder:text-ink-3 focus:outline-none"
              data-testid="material-qty-input"
            />
            <span className="shrink-0 text-[1.3rem] font-bold text-ink-2">{item?.unit}</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[1, 5, 10, 50].map((d) => (
              <button key={d} type="button" onClick={() => setQty((q) => String(Math.round(((Number(q.replace(/,/g, "")) || 0) + d) * 100) / 100))} className="press h-[3.4rem] rounded-2xl bg-surface-3 text-[1.1rem] font-extrabold" data-testid={`material-plus-${d}`}>
                +{d}
              </button>
            ))}
          </div>
          {cur && (
            <p className="text-[1.02rem] text-ink-2">
              지금까지 들어온 것 {fmtQty(cur.inQty, item?.unit)} · 설치 {fmtQty(cur.installQty, item?.unit)}
            </p>
          )}
        </EasyQuestion>
      );
      footer = <EasyBar onBack={back} onNext={() => go("photo")} nextDisabled={!qtyOk} hint={qty.trim() && !qtyOk ? "수량을 숫자로 넣어 주세요" : undefined} />;
      break;
    case "photo":
      body = (
        <EasyQuestion kicker={`${item?.name} ${fmtQty(n, item?.unit)}`} title={KIND_Q[kind].photo} help={KIND_Q[kind].photoHelp} testId="material-photo">
          {photo ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="자재 사진" className="max-h-72 w-full rounded-2xl object-cover" />
              <button type="button" onClick={() => setPhoto(null)} className="press flex h-12 w-full items-center justify-center gap-1 rounded-xl border-2 border-line-strong text-[1.02rem] font-bold">
                <X size={18} aria-hidden /> 다시 찍기
              </button>
            </div>
          ) : (
            <label className="press flex min-h-[7rem] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl bg-cta text-[1.2rem] font-extrabold text-cta-text">
              <Camera size={36} aria-hidden /> 사진 찍기
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                data-testid="material-photo-file"
                onChange={async (e) => {
                  const f = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (!f) return;
                  try {
                    setPhoto(await downscalePhoto(f));
                  } catch {
                    setErr("사진을 읽지 못했어요. 다시 찍어 주세요.");
                  }
                }}
              />
            </label>
          )}
          <div className="space-y-2">
            <label htmlFor="material-note" className="block text-[1.08rem] font-bold">
              더 적을 내용 <span className="font-semibold text-ink-2">(안 적어도 돼요)</span>
            </label>
            <input id="material-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "in" ? "예) 송장 120장 중 2장 파손" : "예) 3층 동측"} className={easyTextareaCls} data-testid="material-note" />
          </div>
          {err && <p className="text-[1.05rem] font-semibold text-err">{err}</p>}
        </EasyQuestion>
      );
      footer = <EasyBar onBack={back} onNext={() => go("confirm")} nextLabel={photo ? "다음" : "사진 없이 다음"} />;
      break;
    case "confirm": {
      const after = cur ? { inQty: cur.inQty + (kind === "in" ? n : 0), installQty: cur.installQty + (kind === "install" ? n : 0) } : null;
      body = (
        <EasyQuestion title="이렇게 보낼까요?" testId="material-confirm">
          <div className="space-y-2 rounded-2xl border-2 border-line bg-surface p-4 text-[1.15rem]">
            <p>
              <b>{site?.shortName}</b> · {easyDate(today)}
            </p>
            <p data-testid="material-confirm-text">
              {item?.name} <b className="num">{fmtQty(n, item?.unit)}</b> {MOVE_LABEL[kind]}
            </p>
            {after && item && (
              <p className="text-[1.02rem] text-ink-2">
                보내면 → 들어온 누계 {fmtQty(after.inQty, item.unit)} · 설치 누계 {fmtQty(after.installQty, item.unit)}
              </p>
            )}
            {after && item && after.installQty > after.inQty && <p className="text-[1.02rem] font-semibold text-warn">{MATERIAL_FLAG_LABEL.install_over_in}</p>}
            <p className={cx(photo ? "text-ok" : "text-ink-2")}>{photo ? "사진 있음" : "사진 없음"}</p>
            {note.trim() && <p className="text-[1.02rem] text-ink-2">메모: {note.trim()}</p>}
          </div>
          {err && <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.05rem] font-semibold text-err">{err}</p>}
        </EasyQuestion>
      );
      footer = <EasyBar onBack={back} onNext={send} nextLabel="본사로 보내기" loading={busy} nextTestId="material-send" />;
      break;
    }
  }

  return (
    <div className="space-y-6" data-testid="easy-material">
      <EasyPageHead title="자재 반입·설치">
        <SectionBar onBand sections={sections} current={secIdx} />
        {site && step !== "site" && (
          <p className="flex items-center gap-1.5 text-[1rem] font-semibold text-white">
            <HardHat size={18} aria-hidden /> {site.shortName} · 자재 수량
          </p>
        )}
      </EasyPageHead>
      <div key={step} className="anim-fade-up">
        {body}
      </div>
      {footer}
    </div>
  );
}
