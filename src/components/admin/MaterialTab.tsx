"use client";

/**
 * 현장 상세 → 자재 (D-62) — 주요 자재 품목·설계 수량(본사), 반입·설치 누계, 현장 보관, 설치율, 확인 표시, 기록 목록·취소·CSV.
 * 수량만 다룬다(금액 없음). 설치율은 기록 합계이며 예측이 아니다.
 */
import { useState } from "react";
import { Archive, ArchiveRestore, Boxes, Download, PackagePlus, Plus, Trash2, Undo2 } from "lucide-react";
import { run } from "@/lib/data/store";
import { useMe, userLabel } from "@/lib/data/hooks";
import { CommandError } from "@/lib/data/commands";
import { downloadCsv } from "@/lib/browser/download";
import { toCsv } from "@/lib/domain/csv";
import type { DemoDB, MaterialMoveKind, Site } from "@/lib/domain/types";
import { activeItems, fmtQty, materialRows, MATERIAL_FLAG_LABEL, MOVE_LABEL, siteInstallPct } from "@/lib/domain/material";
import { fmtDate, fmtDateTime, fmtPct, todayIso } from "@/lib/domain/format";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Notice, ProgressBar, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { IS_LIVE } from "@/lib/mode";

type Draft = { id?: string; name: string; unit: string; planned: string; archived?: boolean };

export function MaterialTab({ db, site }: { db: DemoDB; site: Site }) {
  const { canSeeMoney: isHq, userId } = useMe();
  const toast = useToast();
  const [setup, setSetup] = useState(false);
  const [adding, setAdding] = useState(false);
  const [voidId, setVoidId] = useState<string | null>(null);
  const rows = materialRows(db, site.id);
  const install = siteInstallPct(db, site.id);
  const items = site.materials ?? [];
  const moves = (db.materialMoves ?? []).filter((m) => m.siteId === site.id).sort((a, b) => b.at.localeCompare(a.at));
  const itemOf = (id: string) => items.find((i) => i.id === id);

  const csv = () => {
    const head = ["날짜", "구분", "품목", "수량", "단위", "메모", "남긴 사람", "상태", "취소 사유"];
    const lines = [...moves].reverse().map((m) => {
      const it = itemOf(m.itemId);
      return [m.workDate, MOVE_LABEL[m.kind], it?.name ?? "", m.qty, it?.unit ?? "", m.note ?? "", userLabel(db, m.by), m.voided ? "취소" : "", m.voided?.reason ?? ""];
    });
    downloadCsv(`자재_${site.shortName}.csv`, toCsv([head, ...lines]));
  };

  return (
    <div className="space-y-5" data-testid="material-tab">
      <Card>
        <CardHeader
          title="주요 자재 수량"
          sub={IS_LIVE ? "현장이 남긴 반입·설치 기록의 합계 · 수량만 (금액 없음)" : "현장이 남긴 반입·설치 기록의 합계 · 수량만 (금액 없음) · DEMO"}
          right={
            isHq ? (
              <div className="flex flex-wrap gap-2">
                {activeItems(db, site.id).length > 0 && (
                  <Button size="sm" icon={<PackagePlus size={15} />} onClick={() => setAdding(true)} data-testid="material-add-move">
                    기록 넣기
                  </Button>
                )}
                <Button size="sm" variant="soft" icon={<Boxes size={15} />} onClick={() => setSetup(true)} data-testid="material-setup">
                  품목 정하기
                </Button>
              </div>
            ) : undefined
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={<Boxes size={28} />}
            title="아직 자재 품목이 없습니다."
            desc="커튼월 유닛·유리처럼 수량을 챙길 자재와 설계 수량을 넣으면, 현장 직원 휴대폰에 ‘자재 반입·설치 남기기’가 생깁니다."
            action={isHq ? <Button variant="cta" icon={<Plus size={16} />} onClick={() => setSetup(true)}>품목 정하기</Button> : undefined}
          />
        ) : (
          <>
            {install && (
              <p className="px-5 pb-3 text-[0.86rem] text-ink-2" data-testid="material-install-pct">
                주요 자재 설치율 <b className="num text-ink">{fmtPct(install.pct)}</b> (설계 수량이 있는 품목 {install.items}개 평균 · 품목마다 같은 비중)
                <span className="block text-[0.76rem] text-ink-3">현장 공정률(제작·설치·마감 전체)과는 기준이 달라 숫자가 다를 수 있습니다.</span>
              </p>
            )}
            <div tabIndex={0} role="region" aria-label="자재 수량 표 (가로 스크롤)" className="overflow-x-auto scroll-thin">
              <table className="stack-table w-full min-w-[44rem] text-[0.85rem]" data-testid="material-table">
                <thead>
                  <tr className="border-y border-line bg-surface-2 text-left text-[0.74rem] font-semibold text-ink-3">
                    <th className="px-5 py-2.5">품목</th>
                    <th className="px-3 py-2.5 text-right">설계 수량</th>
                    <th className="px-3 py-2.5 text-right">반입 누계</th>
                    <th className="px-3 py-2.5 text-right">설치 누계</th>
                    <th className="px-3 py-2.5 text-right">현장 보관</th>
                    <th className="px-5 py-2.5">설치율</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.item.id} className={cx("border-b border-line align-top", r.item.archived && "opacity-60")} data-testid="material-row" data-item={r.item.id}>
                      <td className="stack-full px-5 py-2.5">
                        <p className="font-bold">
                          {r.item.name} {r.item.archived && <Badge>숨김</Badge>}
                        </p>
                        {r.flags.map((fl) => (
                          <p key={fl} className="mt-1 text-[0.76rem] font-semibold text-warn" data-testid="material-flag">
                            ⚠ {MATERIAL_FLAG_LABEL[fl]}
                          </p>
                        ))}
                      </td>
                      <td className="px-3 py-2.5 text-right num" data-label="설계 수량">{r.item.plannedQty ? fmtQty(r.item.plannedQty, r.item.unit) : "—"}</td>
                      <td className="px-3 py-2.5 text-right num" data-label="반입 누계">{fmtQty(r.inQty, r.item.unit)}</td>
                      <td className="px-3 py-2.5 text-right num font-semibold" data-label="설치 누계">{fmtQty(r.installQty, r.item.unit)}</td>
                      <td className="px-3 py-2.5 text-right num" data-label="현장 보관">{fmtQty(r.onSite, r.item.unit)}</td>
                      <td className="stack-full px-5 py-2.5" data-label="설치율">
                        {r.installPct === null ? (
                          <span className="text-[0.78rem] text-ink-3">설계 수량 없음</span>
                        ) : (
                          <div className="flex min-w-[8rem] items-center gap-2">
                            <ProgressBar value={Math.min(100, r.installPct)} label={`${r.item.name} 설치율`} className="flex-1" />
                            <span className="num w-12 text-right text-[0.8rem] font-semibold">{fmtPct(r.installPct)}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 text-[0.76rem] text-ink-3">현장 보관 = 반입 누계 − 설치 누계 · 설치율 = 설치 누계 ÷ 설계 수량 · 취소한 기록은 빼고 셉니다.</p>
          </>
        )}
      </Card>

      {moves.length > 0 && (
        <Card>
          <CardHeader
            title="반입·설치 기록"
            sub={`${moves.filter((m) => !m.voided).length}건 · 최근 것부터`}
            right={
              <Button size="sm" icon={<Download size={15} />} onClick={csv} data-testid="material-csv">
                CSV
              </Button>
            }
          />
          <ul className="divide-y divide-line px-5 pb-3" data-testid="material-moves">
            {moves.slice(0, 40).map((m) => {
              const it = itemOf(m.itemId);
              const photo = m.photoId ? db.photos.find((p) => p.id === m.photoId) : undefined;
              // 현장 직원은 오늘 남긴 본인 기록만 (서버도 같은 규칙)
              const canVoid = !m.voided && (isHq || (m.by === userId && m.workDate === todayIso()));
              return (
                <li key={m.id} className={cx("flex flex-wrap items-center gap-3 py-2.5", m.voided && "opacity-60")} data-testid="material-move" data-voided={m.voided ? "1" : "0"}>
                  {photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.dataUrl} alt={photo.caption} className="size-12 shrink-0 rounded-lg border border-line object-cover" />
                  )}
                  <div className="min-w-0 flex-1 basis-[14rem]">
                    <p className={cx("text-[0.88rem]", m.voided && "line-through")}>
                      <Badge tone={m.kind === "in" ? "neutral" : "ok"}>{MOVE_LABEL[m.kind]}</Badge> <b>{it?.name}</b> <span className="num font-semibold">{fmtQty(m.qty, it?.unit)}</span>
                      {m.imported && (
                        <Badge tone="info" className="ml-1.5">
                          엑셀 가져옴
                        </Badge>
                      )}
                      {m.sentLater && (
                        <Badge tone="warn" className="ml-1.5">
                          통신 불량 · 늦게 도착
                        </Badge>
                      )}
                    </p>
                    <p className="text-[0.75rem] text-ink-3">
                      {m.imported ? fmtDate(m.workDate) : fmtDateTime(m.sentLater?.pressedAt ?? m.at)} · {userLabel(db, m.by)}
                      {m.sentLater && ` · 받은 시각 ${fmtDateTime(m.at)}`}
                      {m.note && ` · ${m.note}`}
                    </p>
                    {m.voided && <p className="text-[0.75rem] font-semibold text-ink-2">취소 — {m.voided.reason} ({userLabel(db, m.voided.by)})</p>}
                  </div>
                  {canVoid && (
                    <Button size="sm" variant="ghost" icon={<Undo2 size={15} />} onClick={() => setVoidId(m.id)} data-testid="material-move-void">
                      취소
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {setup && <SetupModal site={site} db={db} onClose={() => setSetup(false)} onSaved={() => (setSetup(false), toast.push({ tone: "ok", title: "자재 품목을 저장했습니다" }))} />}
      {adding && <AddMoveModal site={site} db={db} onClose={() => setAdding(false)} />}
      {voidId && <VoidModal moveId={voidId} onClose={() => setVoidId(null)} />}
    </div>
  );
}

function SetupModal({ site, db, onClose, onSaved }: { site: Site; db: DemoDB; onClose: () => void; onSaved: () => void }) {
  const used = new Set((db.materialMoves ?? []).filter((m) => m.siteId === site.id).map((m) => m.itemId));
  const [rows, setRows] = useState<Draft[]>(() => {
    const now = (site.materials ?? []).map((i) => ({ id: i.id, name: i.name, unit: i.unit, planned: String(i.plannedQty || ""), archived: i.archived }));
    return now.length ? now : [{ name: "", unit: "EA", planned: "" }];
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<Draft>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true);
    setErrs({});
    try {
      // 비워 둔 새 줄은 보내지 않는다 — 서버 오류(items.N.…)는 화면의 원래 줄 번호로 되돌려 표시 (리뷰 반영 D-63)
      const sent = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.id || r.name.trim());
      const items = sent.map(({ r }) => ({ ...(r.id ? { id: r.id } : {}), name: r.name, unit: r.unit, plannedQty: r.planned.trim() ? Number(r.planned.replace(/,/g, "")) : 0, ...(r.archived ? { archived: true } : {}) }));
      try {
        await run("setSiteMaterials", { siteId: site.id, items });
      } catch (e) {
        if (!(e instanceof CommandError)) throw e;
        const mapped = Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k.replace(/^items\.(\d+)\./, (_, n) => `items.${sent[Number(n)]?.i ?? n}.`), v]));
        throw new CommandError(e.message, e.code, mapped);
      }
      onSaved();
    } catch (e) {
      if (e instanceof CommandError) setErrs({ _: e.message, ...e.fieldErrors });
      else setErrs({ _: e instanceof Error ? e.message : "저장하지 못했습니다" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${site.shortName} 주요 자재 품목`}
      description="수량을 챙길 자재만 넣으세요 (예: 커튼월 유닛 EA, 로이유리 장). 단가·금액은 넣지 않습니다. 기록이 있는 품목은 지우지 않고 숨깁니다."
      size="lg"
      testId="material-setup-modal"
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button variant="cta" loading={busy} onClick={save} data-testid="material-setup-save">
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className={cx("grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2 rounded-2xl border border-line p-3 @min-[560px]:grid-cols-[minmax(0,1fr)_5.5rem_7.5rem_auto]", r.archived && "opacity-60")} data-testid="material-setup-row">
            <Field label="품목 이름" htmlFor={`mat-name-${i}`} error={errs[`items.${i}.name`]}>
              <input id={`mat-name-${i}`} maxLength={40} value={r.name} onChange={(e) => set(i, { name: e.target.value })} className={inputCls} placeholder="예) 커튼월 유닛" data-testid="material-setup-name" />
            </Field>
            <Field label="단위" htmlFor={`mat-unit-${i}`} error={errs[`items.${i}.unit`]}>
              <input id={`mat-unit-${i}`} maxLength={10} value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} className={inputCls} placeholder="EA" data-testid="material-setup-unit" />
            </Field>
            <Field label="설계 수량" htmlFor={`mat-plan-${i}`} error={errs[`items.${i}.plannedQty`]}>
              <input id={`mat-plan-${i}`} inputMode="decimal" value={r.planned} onChange={(e) => set(i, { planned: e.target.value })} className={cx(inputCls, "num")} placeholder="모르면 비움" data-testid="material-setup-planned" />
            </Field>
            <div className="flex items-end gap-1">
              {r.id && used.has(r.id) ? (
                <Button size="sm" variant="ghost" icon={r.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />} onClick={() => set(i, { archived: !r.archived })} data-testid="material-setup-archive">
                  {r.archived ? "다시 쓰기" : "숨기기"}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label={`${r.name || "새 품목"} 빼기`}>
                  빼기
                </Button>
              )}
            </div>
          </div>
        ))}
        <Button icon={<Plus size={16} />} onClick={() => setRows((r) => [...r, { name: "", unit: "EA", planned: "" }])} disabled={rows.length >= 30} data-testid="material-setup-add">
          품목 추가
        </Button>
        {(errs._ || errs.items) && <Notice tone="err">{errs.items ?? errs._}</Notice>}
      </div>
    </Modal>
  );
}

function AddMoveModal({ site, db, onClose }: { site: Site; db: DemoDB; onClose: () => void }) {
  const toast = useToast();
  const items = activeItems(db, site.id);
  const [kind, setKind] = useState<MaterialMoveKind>("in");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await run("recordMaterial", { siteId: site.id, itemId, kind, qty: Number(qty.replace(/,/g, "")), ...(note.trim() ? { note: note.trim() } : {}) });
      toast.push({ tone: "ok", title: `자재 ${MOVE_LABEL[kind]} 기록을 넣었습니다` });
      onClose();
    } catch (e) {
      setErr(e instanceof CommandError ? Object.values(e.fieldErrors)[0] ?? e.message : e instanceof Error ? e.message : "실패");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="자재 기록 넣기"
      description="송장·납품서로 본사에서 직접 넣을 때 씁니다. 날짜는 오늘로 남습니다 (지난 누계는 메모에 ‘이전 누계’라고 적어 주세요)."
      size="sm"
      testId="material-add-modal"
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button variant="cta" loading={busy} onClick={save} disabled={!qty.trim() || !itemId} data-testid="material-add-save">
            넣기
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="구분" htmlFor="mat-add-kind">
          <select id="mat-add-kind" className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as MaterialMoveKind)}>
            <option value="in">반입 (들어옴)</option>
            <option value="install">설치</option>
          </select>
        </Field>
        <Field label="품목" htmlFor="mat-add-item">
          <select id="mat-add-item" className={inputCls} value={itemId} onChange={(e) => setItemId(e.target.value)} data-testid="material-add-item">
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.unit})
              </option>
            ))}
          </select>
        </Field>
        <Field label="수량" htmlFor="mat-add-qty">
          <input id="mat-add-qty" inputMode="decimal" className={cx(inputCls, "num")} value={qty} onChange={(e) => setQty(e.target.value)} data-testid="material-add-qty" />
        </Field>
        <Field label="메모 (선택)" htmlFor="mat-add-note">
          <input id="mat-add-note" maxLength={200} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {err && <Notice tone="err">{err}</Notice>}
      </div>
    </Modal>
  );
}

function VoidModal({ moveId, onClose }: { moveId: string; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await run("voidMaterialMove", { moveId, reason });
      toast.push({ tone: "ok", title: "기록을 취소했습니다", desc: "지우지 않고 취소 표시로 남깁니다." });
      onClose();
    } catch (e) {
      setErr(e instanceof CommandError ? Object.values(e.fieldErrors)[0] ?? e.message : e instanceof Error ? e.message : "실패");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="자재 기록 취소"
      description="기록은 지우지 않고 취소 표시와 사유를 남깁니다. 누계에서는 빠집니다."
      size="sm"
      testId="material-void-modal"
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button variant="danger" loading={busy} onClick={save} disabled={!reason.trim()} data-testid="material-void-save">
            취소하기
          </Button>
        </>
      }
    >
      <Field label="취소 사유" htmlFor="mat-void-reason" required error={err ?? undefined}>
        <input id="mat-void-reason" maxLength={100} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예) 수량 잘못 입력" data-testid="material-void-reason-input" />
      </Field>
    </Modal>
  );
}
