"use client";

/**
 * 변경공사 증빙 파일 (D-88) — 날인한 변경계약서·발주처 공문·견적서를 사진이나 PDF로 붙인다.
 * - 변경공사 줄: 붙인 파일(종류·이름) · 증빙 첨부 · 승인됐는데 서면 파일이 없으면 알림(종이 원본 보관 중이면 그렇게 적기)
 * - 첨부 창: 파일마다 종류 · 설명 · 여러 개 (사진은 글씨가 보이게 긴 변 2400px로 줄여서, PDF는 3MB까지 그대로) · 올리는 동안 닫히지 않고 ‘멈추기’
 * - 보기 창: 사진은 크게(누르면 원래 크기), PDF는 내려받아 열기 · 종류·설명 고치기 · 지우기(이유 → 변경공사 기록에 남음)
 *   승인된 변경공사의 변경계약서·공문은 대표만 지우거나 종류를 바꾼다(서버도 같은 규칙).
 * 본사 화면에서만 쓴다 (현장·발주처에는 증빙 파일이 내려가지 않음 · 서버 권한).
 */
import { useRef, useState } from "react";
import { Download, ExternalLink, FileText, ImageIcon, Paperclip, Pencil, Trash2, Upload, ZoomIn, ZoomOut } from "lucide-react";
import { useMe, userLabel } from "@/lib/data/hooks";
import { Button, Field, Notice, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { downscalePhoto } from "@/components/easy/photo";
import { CommandError } from "@/lib/data/commands";
import { run } from "@/lib/data/store";
import { fmtDateTime, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { CO_PAPER_LABEL, EVIDENCE_DOC_LABEL, EVIDENCE_MAX_PER_CO, EVIDENCE_PDF_MAX_BYTES, WRITTEN_DOC_TYPES, coEvidenceOf, type CoPaper } from "@/lib/domain/changeOrders";
import type { ChangeOrder, ChangeOrderEvidence, DemoDB, EvidenceDocType } from "@/lib/domain/types";
import { IS_LIVE } from "@/lib/mode";

const DOC_SHORT: Record<EvidenceDocType, string> = { contract: "변경계약서", letter: "공문·메일", estimate: "견적·내역서", other: "기타" };
const DOC_ORDER: EvidenceDocType[] = ["contract", "letter", "estimate", "other"];
/** 사진은 원본을 이 크기로 줄여 올린다 — 서류의 작은 글씨(특약·금액 표)가 읽히도록 현장 사진(960px)보다 크고 선명하게 (D-88 점검) */
const DOC_PHOTO_MAX = 2400;
const DOC_PHOTO_QUALITY = 0.82;

const sizeText = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1000))}KB`);
const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const isHeic = (f: File) => /^image\/hei[cf]/.test(f.type) || /\.(heic|heif)$/i.test(f.name);
const isImage = (f: File) => f.type.startsWith("image/") && !isHeic(f);

/** 승인된 변경공사의 서면 증빙(변경계약서·공문) — 대표만 지우거나 종류를 바꾼다 */
const ceoOnly = (c: ChangeOrder, e: ChangeOrderEvidence) => c.status === "approved" && WRITTEN_DOC_TYPES.has(e.docType);

/** 변경공사 줄 안의 증빙 — 붙인 파일 · 증빙 첨부 · 서면 파일 없음 알림 */
export function EvidenceRow({ db, c, paper, onAdd, onPaperKept }: { db: DemoDB; c: ChangeOrder; paper: CoPaper | null; onAdd: () => void; onPaperKept: () => void }) {
  const list = coEvidenceOf(db, c.id);
  const [view, setView] = useState<string | null>(null);
  const viewing = list.find((e) => e.id === view);
  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-1.5 text-[0.78rem]" data-testid="co-evidence" data-count={list.length}>
        <span className="inline-flex items-center gap-1 font-semibold text-ink-2">
          <Paperclip size={14} aria-hidden />
          증빙 {list.length ? `${list.length}개` : "없음"}
        </span>
        {list.map((e) => (
          <button
            key={e.id}
            type="button"
            className="press inline-flex min-h-8 max-w-[15rem] items-center gap-1 rounded-lg border border-line px-2 py-0.5 hover:bg-surface-2"
            onClick={() => setView(e.id)}
            title={`${EVIDENCE_DOC_LABEL[e.docType]} · ${e.fileName}${e.caption ? ` · ${e.caption}` : ""}`}
            data-testid="co-evidence-file"
          >
            {e.kind === "pdf" ? <FileText size={13} aria-hidden className="shrink-0 text-ink-3" /> : <ImageIcon size={13} aria-hidden className="shrink-0 text-ink-3" />}
            <b className="shrink-0">{DOC_SHORT[e.docType]}</b>
            <span className="min-w-0 truncate text-ink-3">{e.fileName}</span>
          </button>
        ))}
        <button type="button" className="press inline-flex min-h-8 items-center gap-1 rounded-lg border border-dashed border-line px-2 py-0.5 font-semibold text-theme-ink hover:bg-surface-2" onClick={onAdd} data-testid="co-evidence-add">
          <Upload size={13} aria-hidden />
          증빙 첨부
        </button>
      </span>
      {paper === "kept" && (
        <span className="basis-full text-[0.8rem] text-ink-2" data-testid="co-paper" data-paper="kept">
          {CO_PAPER_LABEL.kept}: {c.paperKept?.note} ({userLabel(db, c.paperKept?.by)})
        </span>
      )}
      {(paper === "verbal" || paper === "missing") && (
        <span className="flex basis-full flex-wrap items-center gap-x-2 text-[0.8rem] font-semibold text-warn" data-testid="co-paper" data-paper={paper}>
          {paper === "verbal" ? "구두 승인 — 서면(변경계약서·공문)을 받으면 ‘증빙 첨부’로 사진이나 PDF를 올려 두세요." : `${CO_PAPER_LABEL.missing} — 분쟁·정산 때 근거가 됩니다. 날인본·공문을 ‘증빙 첨부’로 올려 두세요.`}
          <button type="button" className="press rounded-md px-1 font-semibold text-ink-2 underline underline-offset-2 hover:bg-surface-2" onClick={onPaperKept} data-testid="co-paper-kept">
            종이로 보관 중
          </button>
        </span>
      )}
      {viewing && <EvidenceViewModal db={db} c={c} e={viewing} only={list.filter((x) => WRITTEN_DOC_TYPES.has(x.docType)).length === 1 && WRITTEN_DOC_TYPES.has(viewing.docType)} onClose={() => setView(null)} />}
    </>
  );
}

/** 내려받을 이름 — 확장자는 늘 실제 형식(PDF·사진)으로 (백업에서 온 이름이어도) */
function downloadName(e: ChangeOrderEvidence): string {
  const base = e.fileName.replace(/\.[A-Za-z0-9]{1,8}$/, "") || "증빙";
  if (e.kind === "pdf") return `${base}.pdf`;
  const ext = /\.(jpe?g|png|webp)$/i.exec(e.fileName)?.[0];
  return ext ? `${base}${ext.toLowerCase()}` : `${base}.jpg`;
}

/** 파일 하나 → data: 주소 (사진은 줄여서 JPEG, PDF는 그대로) */
async function toDataUrl(f: File): Promise<string> {
  if (isPdf(f)) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        const v = String(r.result ?? "");
        // 브라우저가 형식을 몰라 data:application/octet-stream으로 읽는 경우가 있다 — PDF로 고쳐 보낸다(서버가 앞 바이트로 다시 확인)
        res(v.replace(/^data:[^;,]*;base64,/, "data:application/pdf;base64,"));
      };
      r.onerror = () => rej(new Error("파일을 읽을 수 없습니다."));
      r.readAsDataURL(f);
    });
  }
  try {
    return await downscalePhoto(f, DOC_PHOTO_MAX, DOC_PHOTO_QUALITY);
  } catch {
    throw new Error("이 사진을 읽을 수 없습니다 — 휴대폰으로 다시 찍거나 PDF로 올려 주세요.");
  }
}

type Picked = { f: File; key: string; kind: EvidenceDocType | null; custom?: boolean; done?: boolean; error?: string };

/** 증빙 첨부 — 파일마다 종류 · 설명 · 여러 개 */
export function EvidenceUploadModal({ db, coId, docType, after, onClose }: { db: DemoDB; coId: string; docType?: EvidenceDocType; after?: boolean; onClose: () => void }) {
  const toast = useToast();
  const c = db.changeOrders.find((x) => x.id === coId);
  const have = coEvidenceOf(db, coId).length;
  // 승인하며 연 창은 그 근거로 미리 고른다. 그 밖에는 직접 고른다 (진행 중 건의 계약서 사진이 ‘견적’으로 들어가던 문제 · D-88 점검)
  const [kind, setKind] = useState<EvidenceDocType | null>(docType ?? null);
  const [caption, setCaption] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const stop = useRef(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const room = Math.max(0, EVIDENCE_MAX_PER_CO - have);
  const waiting = files.filter((p) => !p.done && !p.error);
  const overIds = new Set(waiting.slice(room).map((p) => p.key));
  const todo = waiting.filter((p) => !overIds.has(p.key));
  const untyped = todo.filter((p) => !p.kind).length;
  const site = c ? db.sites.find((s) => s.id === c.siteId)?.shortName : "";

  const pick = (list: FileList | null) => {
    if (!list) return;
    setErr(null);
    setFiles(
      Array.from(list).map((f) => {
        let error: string | undefined;
        if (isHeic(f)) error = "아이폰 HEIC 사진 — 카카오톡으로 보낸 사진을 받거나, 아이폰 ‘설정 → 카메라 → 포맷 → 높은 호환성’으로 다시 찍거나, PDF로 올려 주세요";
        else if (!isPdf(f) && !isImage(f)) error = "사진·PDF가 아님";
        else if (isPdf(f) && f.size > EVIDENCE_PDF_MAX_BYTES) error = `PDF ${sizeText(f.size)} — 3MB까지 (스캔 해상도를 낮추거나 쪽을 나누거나 종이를 사진으로 찍어 올리기)`;
        return { f, key: uid("idem"), kind, error };
      }),
    );
  };
  const setAll = (k: EvidenceDocType) => {
    setKind(k);
    // 파일마다 따로 고른 것은 그대로, 나머지는 같이 바꾼다
    setFiles((cur) => cur.map((p) => (p.custom || p.done ? p : { ...p, kind: k })));
  };
  const setOne = (key: string, k: EvidenceDocType) => setFiles((cur) => cur.map((p) => (p.key === key ? { ...p, kind: k, custom: true } : p)));

  const upload = async () => {
    if (!todo.length) {
      setErr("올릴 파일을 골라 주세요 (사진·PDF).");
      return;
    }
    if (untyped) {
      setErr("파일마다 무슨 자료인지 골라 주세요.");
      return;
    }
    setBusy(true);
    setErr(null);
    stop.current = false;
    let ok = 0;
    let stopped = 0;
    try {
      for (let i = 0; i < todo.length; i++) {
        const p = todo[i];
        if (stop.current) {
          stopped = todo.length - i;
          break;
        }
        setProgress(`${i + 1}/${todo.length} 올리는 중 — ${p.f.name}`);
        try {
          const dataUrl = await toDataUrl(p.f);
          await run("addChangeOrderEvidence", { coId, docType: p.kind!, dataUrl, fileName: p.f.name, ...(caption.trim() ? { caption } : {}), idempotencyKey: p.key });
          ok += 1;
          setFiles((cur) => cur.map((x) => (x.key === p.key ? { ...x, done: true } : x)));
        } catch (e) {
          // 중복 저장 방지에 걸림 = 이미 올라감 (연결이 끊겨 다시 누른 경우)
          if (e instanceof CommandError && e.code === "DUPLICATE") {
            ok += 1;
            setFiles((cur) => cur.map((x) => (x.key === p.key ? { ...x, done: true } : x)));
            continue;
          }
          // 인터넷 문제면 멈추고 그 파일은 ‘대기’로 둔다 — 다시 누르면 같은 요청 번호로 다시 보낸다(이미 저장됐으면 두 번 저장되지 않음 · D-88 점검)
          if (e instanceof CommandError && e.code === "NETWORK") throw e;
          const msg = e instanceof CommandError ? e.message : e instanceof Error ? e.message : "올리지 못했습니다";
          setFiles((cur) => cur.map((x) => (x.key === p.key ? { ...x, error: msg } : x)));
        }
      }
      if (ok || stopped) toast.push({ tone: "ok", title: `증빙 파일 ${ok}개를 올렸습니다${stopped ? ` · ${stopped}개는 멈춤(올리지 않음)` : ""}`, desc: "변경공사 기록에 남았습니다" });
      if (ok === todo.length && !overIds.size) onClose();
    } catch (e) {
      setErr(e instanceof Error ? `${e.message} — 다시 누르면 남은 파일만 올립니다.` : "올리지 못했습니다. 다시 눌러 주세요.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  if (!c) return null;
  const leftPicked = waiting.length > 0;
  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      // 올리는 중·고른 파일이 있을 때는 바깥을 눌러 닫히지 않게 (고른 파일이 말없이 사라지던 문제 · D-88 점검)
      dismissible={!busy && !leftPicked}
      title="증빙 첨부"
      description={`${site} ${c.title}`}
      size="sm"
      testId="co-evidence-modal"
      footer={
        busy ? (
          <Button
            onClick={() => {
              stop.current = true;
              setProgress("지금 파일까지 올리고 멈춥니다…");
            }}
            data-testid="co-evidence-stop"
          >
            멈추기
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{after ? "나중에" : leftPicked ? "올리지 않고 닫기" : "닫기"}</Button>
            <Button variant="cta" icon={<Upload size={15} />} disabled={!todo.length || room <= 0} onClick={upload} data-testid="co-evidence-upload">
              {todo.length ? `${todo.length}개 올리기` : "올리기"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3 text-[0.88rem]">
        {after && (
          <Notice tone="ok" title="승인을 반영했습니다">
            받은 변경계약서·공문을 지금 올려 두면 정산·분쟁 때 바로 찾습니다. 나중에 이 변경공사의 ‘증빙 첨부’로 올려도 됩니다.
          </Notice>
        )}
        <fieldset data-testid="co-evidence-kind" disabled={busy}>
          <legend className="mb-1.5 text-[0.84rem] font-semibold">
            무슨 자료인가요? <span className="font-normal text-ink-3">(파일마다 아래에서 바꿀 수 있음)</span>
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {DOC_ORDER.map((k) => (
              <label key={k} className={cx("cursor-pointer rounded-lg border px-3 py-1.5 text-[0.84rem] font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-active/40", kind === k ? "border-active bg-active-soft text-theme-ink" : "border-line")}>
                <input type="radio" name="co-evidence-kind" className="sr-only" checked={kind === k} onChange={() => setAll(k)} data-testid={`co-evidence-kind-${k}`} />
                {EVIDENCE_DOC_LABEL[k]}
              </label>
            ))}
          </div>
          {kind === "estimate" && c.status === "approved" && <p className="mt-1 text-[0.78rem] text-ink-3">견적·내역서는 우리가 낸 자료라 승인 증빙으로 세지 않습니다 — 승인 서면은 ‘변경계약서’나 ‘공문·메일’로 올려 주세요.</p>}
        </fieldset>
        <Field label="설명 (선택 · 이번에 올리는 파일 모두)" htmlFor="co-evidence-caption" counter={`${Array.from(caption).length}/80`}>
          <input id="co-evidence-caption" className={inputCls} value={caption} maxLength={80} disabled={busy} onChange={(e) => setCaption(e.target.value)} placeholder="예: 3층 방수 변경계약서 날인본 (11/14 수령)" data-testid="co-evidence-caption" />
        </Field>
        <Field label="파일 (사진 또는 PDF · 여러 개 가능)" htmlFor="co-evidence-file" hint={`사진은 글씨가 보이게 줄여 올립니다 · PDF는 3MB까지 · 이 건에 ${have}/${EVIDENCE_MAX_PER_CO}개`}>
          <input id="co-evidence-file" type="file" accept="image/*,application/pdf,.pdf" multiple className={cx(inputCls, "py-2")} disabled={busy || room <= 0} onChange={(e) => pick(e.target.files)} data-testid="co-evidence-input" />
        </Field>
        {files.length > 0 && (
          <ul className="divide-y divide-line rounded-xl bg-surface-2 px-3.5 py-1 text-[0.82rem]" data-testid="co-evidence-picked">
            {files.map((p) => {
              const over = overIds.has(p.key);
              return (
                <li key={p.key} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1.5" data-testid="co-evidence-picked-row">
                  <span className="min-w-0 flex-1 basis-[10rem] truncate">
                    {isPdf(p.f) ? "PDF" : isImage(p.f) ? "사진" : "파일"} · {p.f.name} <span className="text-ink-3">({sizeText(p.f.size)})</span>
                  </span>
                  {!p.error && !p.done && !over && (
                    <select
                      className={cx("max-w-full rounded-lg border bg-surface px-2 py-1.5 text-[0.84rem] text-ink focus:border-active focus:ring-3 focus:ring-active/20 focus:outline-none disabled:bg-surface-3", p.kind ? "border-line-strong" : "border-warn")}
                      value={p.kind ?? ""}
                      disabled={busy}
                      onChange={(e) => setOne(p.key, e.target.value as EvidenceDocType)}
                      aria-label={`${p.f.name} 종류`}
                      data-testid="co-evidence-row-kind"
                    >
                      <option value="" disabled>
                        종류 고르기
                      </option>
                      {DOC_ORDER.map((k) => (
                        <option key={k} value={k}>
                          {EVIDENCE_DOC_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className={cx("font-semibold", p.error ? "basis-full text-err" : "shrink-0", p.done ? "text-ok" : over ? "text-warn" : !p.error && "text-ink-3")}>{p.done ? "올림" : p.error ? p.error : over ? "한도 초과 — 올리지 않음" : "대기"}</span>
                </li>
              );
            })}
          </ul>
        )}
        {(room <= 0 || overIds.size > 0) && <Notice tone="warn">{room <= 0 ? `이 변경공사에는 파일이 ${EVIDENCE_MAX_PER_CO}개 있습니다. 필요 없는 파일을 지우고 올려 주세요.` : `이 건에는 ${room}개만 더 올릴 수 있습니다 (최대 ${EVIDENCE_MAX_PER_CO}개) — ‘한도 초과’ 파일은 올리지 않습니다.`}</Notice>}
        {progress && <p className="text-[0.8rem] font-semibold text-ink-2">{progress}</p>}
        {err && <Notice tone="err">{err}</Notice>}
        <p className="text-[0.76rem] text-ink-3">본사만 봅니다 (현장 휴대폰·발주처 화면에는 나오지 않음). 금액·이익은 바뀌지 않습니다.{IS_LIVE ? "" : " DEMO에서는 이 브라우저에만 저장되어 큰 PDF는 저장 공간이 모자랄 수 있습니다."}</p>
      </div>
    </Modal>
  );
}

/** 증빙 보기 — 사진은 크게(누르면 원래 크기), PDF는 내려받아 열기 · 고치기 · 지우기 */
function EvidenceViewModal({ db, c, e, only, onClose }: { db: DemoDB; c: ChangeOrder; e: ChangeOrderEvidence; only: boolean; onClose: () => void }) {
  const toast = useToast();
  const { role } = useMe();
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const [zoom, setZoom] = useState(false);
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<EvidenceDocType>(e.docType);
  const [caption, setCaption] = useState(e.caption);
  const [key, setKey] = useState(() => uid("idem"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; fields?: Record<string, string> } | null>(null);
  const locked = ceoOnly(c, e) && role !== "ceo";
  const save = async (name: "removeChangeOrderEvidence" | "updateChangeOrderEvidence") => {
    setBusy(true);
    try {
      if (name === "removeChangeOrderEvidence") await run(name, { evidenceId: e.id, reason, idempotencyKey: key });
      else await run(name, { evidenceId: e.id, docType: kind, caption, idempotencyKey: key });
      toast.push({ tone: "ok", title: name === "removeChangeOrderEvidence" ? "증빙 파일을 지웠습니다" : "증빙 파일을 고쳤습니다", desc: "누가·무엇을 했는지 변경공사 기록에 남았습니다" });
      if (name === "removeChangeOrderEvidence") onClose();
      else {
        setMode("view");
        setKey(uid("idem"));
      }
    } catch (x) {
      setErr(x instanceof CommandError ? { msg: x.message, fields: x.fieldErrors } : { msg: "저장하지 못했습니다. 다시 눌러 주세요." });
    } finally {
      setBusy(false);
    }
  };
  const back = () => {
    setMode("view");
    setErr(null);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${EVIDENCE_DOC_LABEL[e.docType]}${e.caption ? ` — ${e.caption}` : ""}`}
      description={`${db.sites.find((s) => s.id === c.siteId)?.shortName ?? ""} ${c.title} · ${e.fileName} (${sizeText(e.size)}) · ${userLabel(db, e.createdBy)} ${fmtDateTime(e.createdAt)}`}
      size={e.kind === "image" ? "xl" : "sm"}
      testId="co-evidence-view"
      footer={
        mode === "remove" ? (
          <>
            <Button onClick={back}>취소</Button>
            <Button variant="danger" loading={busy} onClick={() => save("removeChangeOrderEvidence")} data-testid="co-evidence-remove-confirm">
              지우기
            </Button>
          </>
        ) : mode === "edit" ? (
          <>
            <Button onClick={back}>취소</Button>
            <Button variant="cta" loading={busy} onClick={() => save("updateChangeOrderEvidence")} data-testid="co-evidence-edit-confirm">
              저장
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => setMode("remove")} disabled={locked} title={locked ? "승인된 변경공사의 변경계약서·공문은 대표만 지울 수 있습니다" : undefined} data-testid="co-evidence-remove">
              지우기
            </Button>
            <Button variant="ghost" icon={<Pencil size={15} />} onClick={() => setMode("edit")} data-testid="co-evidence-edit">
              종류·설명 고치기
            </Button>
            <a href={e.dataUrl} download={downloadName(e)} className="press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3.5 text-[0.88rem] font-semibold hover:bg-surface-2" data-testid="co-evidence-download">
              <Download size={15} aria-hidden />
              {e.kind === "pdf" ? "PDF 내려받아 열기" : "내려받기"}
            </a>
            <Button variant="cta" onClick={onClose}>
              닫기
            </Button>
          </>
        )
      }
    >
      {mode === "remove" ? (
        <div className="space-y-3 text-[0.88rem]">
          {only && <Notice tone="warn">이 변경공사의 하나뿐인 서면 증빙입니다. 지우면 ‘서면 증빙 파일 없음’으로 돌아갑니다.</Notice>}
          <p>파일을 지우면 원본도 지워져 되돌릴 수 없습니다. 지운 사람·이유는 변경공사 기록과 활동 이력에 남습니다. 종류만 틀렸으면 지우지 말고 ‘종류·설명 고치기’를 쓰세요.</p>
          <Field label="지우는 이유" htmlFor="co-evidence-reason" required error={err?.fields?.reason} counter={`${Array.from(reason).length}/200`}>
            <input id="co-evidence-reason" className={inputCls} value={reason} maxLength={200} onChange={(x) => setReason(x.target.value)} placeholder="예: 다른 현장 서류를 잘못 올림" data-testid="co-evidence-reason" />
          </Field>
          {err && !err.fields?.reason && <Notice tone="err">{err.msg}</Notice>}
        </div>
      ) : mode === "edit" ? (
        <div className="space-y-3 text-[0.88rem]">
          <fieldset>
            <legend className="mb-1.5 text-[0.84rem] font-semibold">무슨 자료인가요?</legend>
            <div className="flex flex-wrap gap-1.5">
              {DOC_ORDER.map((k) => {
                const off = locked && k !== e.docType;
                return (
                  <label key={k} className={cx("rounded-lg border px-3 py-1.5 text-[0.84rem] font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-active/40", off ? "cursor-not-allowed opacity-50" : "cursor-pointer", kind === k ? "border-active bg-active-soft text-theme-ink" : "border-line")}>
                    <input type="radio" name="co-evidence-edit-kind" className="sr-only" checked={kind === k} disabled={off} onChange={() => setKind(k)} data-testid={`co-evidence-edit-kind-${k}`} />
                    {EVIDENCE_DOC_LABEL[k]}
                  </label>
                );
              })}
            </div>
            {locked && <p className="mt-1 text-[0.78rem] text-ink-3">승인된 변경공사의 변경계약서·공문은 대표만 종류를 바꿀 수 있습니다 (설명은 고칠 수 있음).</p>}
          </fieldset>
          <Field label="설명" htmlFor="co-evidence-edit-caption" error={err?.fields?.caption} counter={`${Array.from(caption).length}/80`}>
            <input id="co-evidence-edit-caption" className={inputCls} value={caption} maxLength={80} onChange={(x) => setCaption(x.target.value)} data-testid="co-evidence-edit-caption" />
          </Field>
          {err && !err.fields?.caption && <Notice tone="err">{err.msg}</Notice>}
        </div>
      ) : e.kind === "image" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[0.8rem]">
            <button type="button" className="press inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 font-semibold hover:bg-surface-2" onClick={() => setZoom((z) => !z)} data-testid="co-evidence-zoom">
              {zoom ? <ZoomOut size={14} aria-hidden /> : <ZoomIn size={14} aria-hidden />}
              {zoom ? "화면에 맞추기" : "원래 크기로 크게"}
            </button>
            {IS_LIVE && (
              <a href={e.dataUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-theme-ink">
                <ExternalLink size={14} aria-hidden />새 창에서 보기
              </a>
            )}
          </div>
          <div className={cx("rounded-lg border border-line", zoom ? "max-h-[72vh] overflow-auto" : "")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={e.dataUrl} alt={e.caption || e.fileName} onClick={() => setZoom((z) => !z)} className={cx("mx-auto cursor-zoom-in", zoom ? "max-w-none cursor-zoom-out" : "max-h-[70vh] w-auto")} data-testid="co-evidence-image" />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-4 text-[0.88rem]">
          <FileText size={28} aria-hidden className="shrink-0 text-ink-3" />
          <p>
            PDF는 내려받아 PC·휴대폰의 PDF 보기로 엽니다. <span className="text-ink-3">(보안을 위해 이 화면 안에서는 열지 않습니다)</span>
          </p>
        </div>
      )}
    </Modal>
  );
}

/** 승인 서면 원본을 종이로 보관 중이라고 적기 — 보관 위치 (시스템 전에 받은 서면 · D-88 점검) */
export function PaperKeptModal({ db, c, onClose }: { db: DemoDB; c: ChangeOrder; onClose: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [key] = useState(() => uid("idem"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; fields?: Record<string, string> } | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title="서면 원본을 종이로 보관 중"
      description={`${db.sites.find((s) => s.id === c.siteId)?.shortName ?? ""} ${c.title}`}
      size="sm"
      testId="co-paper-kept-modal"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await run("logChangeOrder", { coId: c.id, kind: "paper_kept", date: todayIso(), note, idempotencyKey: key });
                toast.push({ tone: "ok", title: "종이 원본 보관으로 적었습니다", desc: "파일을 올리면 ‘서면 증빙 있음’으로 바뀝니다" });
                onClose();
              } catch (x) {
                setErr(x instanceof CommandError ? { msg: x.message, fields: x.fieldErrors } : { msg: "저장하지 못했습니다. 다시 눌러 주세요." });
              } finally {
                setBusy(false);
              }
            }}
            data-testid="co-paper-kept-confirm"
          >
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.88rem]">
        <p>시스템을 쓰기 전에 받은 변경계약서·공문을 종이로 보관하고 있으면 보관 위치를 적어 두세요. ‘서면 증빙 파일 없음’ 알림이 꺼지고, 변경공사 기록·월 마감 엑셀에 남습니다. 나중에 스캔해 ‘증빙 첨부’로 올리면 더 좋습니다.</p>
        <Field label="보관 위치" htmlFor="co-paper-note" required error={err?.fields?.note} counter={`${Array.from(note).length}/200`}>
          <input id="co-paper-note" className={inputCls} value={note} maxLength={200} onChange={(x) => setNote(x.target.value)} placeholder="예: 본사 캐비닛 2번 · 2026 변경계약 바인더" data-testid="co-paper-note" />
        </Field>
        {err && !err.fields?.note && <Notice tone="err">{err.msg}</Notice>}
      </div>
    </Modal>
  );
}
