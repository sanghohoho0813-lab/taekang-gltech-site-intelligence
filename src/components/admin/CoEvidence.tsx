"use client";

/**
 * 변경공사 증빙 파일 (D-88) — 날인한 변경계약서·발주처 공문·견적서를 사진이나 PDF로 붙인다.
 * - 변경공사 줄: 붙인 파일(종류·이름) · 올리기 · 승인됐는데 서면 파일이 없으면 알림
 * - 올리기 창: 종류 고르기 · 설명 · 파일 여러 개 (사진은 글씨가 보이게 긴 변 2000px로 줄여서, PDF는 3MB까지 그대로)
 * - 보기 창: 사진은 크게, PDF는 내려받아 열기 · 지우기(이유 → 변경공사 기록에 남음)
 * 본사 화면에서만 쓴다 (현장·발주처에는 증빙 파일이 내려가지 않음 · 서버 권한).
 */
import { useState } from "react";
import { Download, FileText, ImageIcon, Paperclip, Trash2, Upload } from "lucide-react";
import { userLabel } from "@/lib/data/hooks";
import { Button, Field, Notice, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { downscalePhoto } from "@/components/easy/photo";
import { CommandError } from "@/lib/data/commands";
import { run } from "@/lib/data/store";
import { fmtDateTime } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { CO_PAPER_LABEL, EVIDENCE_DOC_LABEL, EVIDENCE_MAX_PER_CO, EVIDENCE_PDF_MAX_BYTES, coEvidenceOf, type CoPaper } from "@/lib/domain/changeOrders";
import type { ChangeOrder, ChangeOrderEvidence, DemoDB, EvidenceDocType } from "@/lib/domain/types";
import { IS_LIVE } from "@/lib/mode";

const DOC_SHORT: Record<EvidenceDocType, string> = { contract: "변경계약서", letter: "공문·메일", estimate: "견적·내역서", other: "기타" };
const DOC_ORDER: EvidenceDocType[] = ["contract", "letter", "estimate", "other"];
/** 사진은 원본을 이 크기로 줄여 올린다 — 서류 글씨가 읽히도록 현장 사진(960px)보다 크게 */
const DOC_PHOTO_MAX = 2000;

const sizeText = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1000))}KB`);
const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const isImage = (f: File) => f.type.startsWith("image/");

/** 변경공사 줄 안의 증빙 — 붙인 파일 · 올리기 · 서면 파일 없음 알림 */
export function EvidenceRow({ db, c, paper, onAdd }: { db: DemoDB; c: ChangeOrder; paper: CoPaper | null; onAdd: () => void }) {
  const list = coEvidenceOf(db, c.id);
  const [view, setView] = useState<ChangeOrderEvidence | null>(null);
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
            className="press inline-flex max-w-[14rem] items-center gap-1 rounded-lg border border-line px-2 py-0.5 hover:bg-surface-2"
            onClick={() => setView(e)}
            title={`${EVIDENCE_DOC_LABEL[e.docType]} · ${e.fileName}${e.caption ? ` · ${e.caption}` : ""}`}
            data-testid="co-evidence-file"
          >
            {e.kind === "pdf" ? <FileText size={13} aria-hidden className="shrink-0 text-ink-3" /> : <ImageIcon size={13} aria-hidden className="shrink-0 text-ink-3" />}
            <b className="shrink-0">{DOC_SHORT[e.docType]}</b>
            <span className="min-w-0 truncate text-ink-3">{e.caption || e.fileName}</span>
          </button>
        ))}
        <button type="button" className="press inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 font-semibold text-theme-ink hover:bg-surface-2" onClick={onAdd} data-testid="co-evidence-add">
          <Upload size={13} aria-hidden />
          올리기
        </button>
      </span>
      {paper && paper !== "ok" && (
        <span className="basis-full text-[0.8rem] font-semibold text-warn" data-testid="co-paper" data-paper={paper}>
          {paper === "verbal" ? "구두 승인 — 서면(변경계약서·공문)을 받으면 ‘올리기’로 사진이나 PDF를 올려 두세요." : `${CO_PAPER_LABEL.missing} — 분쟁·정산 때 근거가 됩니다. 날인본·공문을 ‘올리기’로 올려 두세요.`}
        </span>
      )}
      {view && <EvidenceViewModal db={db} c={c} e={view} onClose={() => setView(null)} />}
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
  return downscalePhoto(f, DOC_PHOTO_MAX);
}

type Picked = { f: File; key: string; done?: boolean; error?: string };

/** 증빙 파일 올리기 — 종류 · 설명 · 파일(여러 개) */
export function EvidenceUploadModal({ db, coId, docType, after, onClose }: { db: DemoDB; coId: string; docType?: EvidenceDocType; after?: boolean; onClose: () => void }) {
  const toast = useToast();
  const c = db.changeOrders.find((x) => x.id === coId);
  const have = coEvidenceOf(db, coId).length;
  const [kind, setKind] = useState<EvidenceDocType>(docType ?? (c?.status === "approved" ? "contract" : c?.status === "rejected" ? "letter" : "estimate"));
  const [caption, setCaption] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const room = EVIDENCE_MAX_PER_CO - have;
  const pending = files.filter((p) => !p.done && !p.error);
  const site = c ? db.sites.find((s) => s.id === c.siteId)?.shortName : "";

  const pick = (list: FileList | null) => {
    if (!list) return;
    setErr(null);
    const next: Picked[] = Array.from(list).map((f) => {
      let error: string | undefined;
      if (!isPdf(f) && !isImage(f)) error = "사진·PDF가 아님";
      else if (isPdf(f) && f.size > EVIDENCE_PDF_MAX_BYTES) error = `PDF ${sizeText(f.size)} — 3MB까지 (스캔 해상도를 낮추거나 쪽을 나누거나 사진으로 찍어 올리기)`;
      return { f, key: uid("idem"), error };
    });
    if (next.filter((p) => !p.error).length > room) setErr(`이 변경공사에는 파일을 ${room}개 더 올릴 수 있습니다 (최대 ${EVIDENCE_MAX_PER_CO}개).`);
    setFiles(next);
  };

  const upload = async () => {
    const todo = files.filter((p) => !p.done && !p.error).slice(0, room);
    if (!todo.length) {
      setErr("올릴 파일을 골라 주세요 (사진·PDF).");
      return;
    }
    setBusy(true);
    setErr(null);
    let ok = 0;
    try {
      for (let i = 0; i < todo.length; i++) {
        const p = todo[i];
        setProgress(`${i + 1}/${todo.length} 올리는 중 — ${p.f.name}`);
        try {
          const dataUrl = await toDataUrl(p.f);
          await run("addChangeOrderEvidence", { coId, docType: kind, dataUrl, fileName: p.f.name, ...(caption.trim() ? { caption } : {}), idempotencyKey: p.key });
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
      if (ok) toast.push({ tone: "ok", title: `증빙 파일 ${ok}개를 올렸습니다`, desc: `${DOC_SHORT[kind]} · 변경공사 기록에 남았습니다` });
      if (ok === todo.length) onClose();
    } catch (e) {
      setErr(e instanceof Error ? `${e.message} — 다시 누르면 남은 파일만 올립니다.` : "올리지 못했습니다. 다시 눌러 주세요.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  if (!c) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="증빙 파일 올리기"
      description={`${site} ${c.title}`}
      size="sm"
      testId="co-evidence-modal"
      footer={
        <>
          <Button onClick={onClose}>{after ? "나중에" : "닫기"}</Button>
          <Button variant="cta" icon={<Upload size={15} />} loading={busy} disabled={!pending.length || room <= 0} onClick={upload} data-testid="co-evidence-upload">
            {pending.length ? `${Math.min(pending.length, Math.max(room, 0))}개 올리기` : "올리기"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.88rem]">
        {after && (
          <Notice tone="ok" title="승인을 반영했습니다">
            받은 변경계약서·공문을 지금 올려 두면 정산·분쟁 때 바로 찾습니다. 나중에 이 변경공사의 ‘올리기’로 올려도 됩니다.
          </Notice>
        )}
        <fieldset data-testid="co-evidence-kind">
          <legend className="mb-1.5 text-[0.84rem] font-semibold">무슨 자료인가요?</legend>
          <div className="flex flex-wrap gap-1.5">
            {DOC_ORDER.map((k) => (
              <label key={k} className={cx("cursor-pointer rounded-lg border px-3 py-1.5 text-[0.84rem] font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-active/40", kind === k ? "border-active bg-active-soft text-theme-ink" : "border-line")}>
                <input type="radio" name="co-evidence-kind" className="sr-only" checked={kind === k} onChange={() => setKind(k)} data-testid={`co-evidence-kind-${k}`} />
                {EVIDENCE_DOC_LABEL[k]}
              </label>
            ))}
          </div>
          {kind === "estimate" && c.status === "approved" && <p className="mt-1 text-[0.78rem] text-ink-3">견적·내역서는 우리가 낸 자료라 승인 증빙으로 세지 않습니다 — 승인 서면은 ‘변경계약서’나 ‘공문·메일’로 올려 주세요.</p>}
        </fieldset>
        <Field label="설명 (선택)" htmlFor="co-evidence-caption" counter={`${Array.from(caption).length}/80`}>
          <input id="co-evidence-caption" className={inputCls} value={caption} maxLength={80} onChange={(e) => setCaption(e.target.value)} placeholder="예: 3층 방수 변경계약서 날인본 (11/14 수령)" data-testid="co-evidence-caption" />
        </Field>
        <Field label="파일 (사진 또는 PDF · 여러 개 가능)" htmlFor="co-evidence-file" hint={`사진은 글씨가 보이게 줄여 올립니다 · PDF는 3MB까지 · 이 건에 ${have}/${EVIDENCE_MAX_PER_CO}개`}>
          <input id="co-evidence-file" type="file" accept="image/*,application/pdf,.pdf" multiple className={cx(inputCls, "py-2")} disabled={busy || room <= 0} onChange={(e) => pick(e.target.files)} data-testid="co-evidence-input" />
        </Field>
        {files.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[0.82rem]" data-testid="co-evidence-picked">
            {files.map((p) => (
              <li key={p.key} className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="min-w-0 truncate">
                  {isPdf(p.f) ? "PDF" : "사진"} · {p.f.name} <span className="text-ink-3">({sizeText(p.f.size)})</span>
                </span>
                <span className={cx("shrink-0 font-semibold", p.done ? "text-ok" : p.error ? "text-err" : "text-ink-3")}>{p.done ? "올림" : p.error ? p.error : "대기"}</span>
              </li>
            ))}
          </ul>
        )}
        {room <= 0 && <Notice tone="warn">이 변경공사에는 파일이 {EVIDENCE_MAX_PER_CO}개 있습니다. 필요 없는 파일을 지우고 올려 주세요.</Notice>}
        {progress && <p className="text-[0.8rem] font-semibold text-ink-2">{progress}</p>}
        {err && <Notice tone="err">{err}</Notice>}
        <p className="text-[0.76rem] text-ink-3">본사만 봅니다 (현장 휴대폰·발주처 화면에는 나오지 않음). 금액·이익은 바뀌지 않습니다.{IS_LIVE ? "" : " DEMO에서는 이 브라우저에만 저장되어 큰 PDF는 저장 공간이 모자랄 수 있습니다."}</p>
      </div>
    </Modal>
  );
}

/** 증빙 보기 — 사진은 크게, PDF는 내려받아 열기 · 지우기 */
function EvidenceViewModal({ db, c, e, onClose }: { db: DemoDB; c: ChangeOrder; e: ChangeOrderEvidence; onClose: () => void }) {
  const toast = useToast();
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  const [key] = useState(() => uid("idem"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; fields?: Record<string, string> } | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${EVIDENCE_DOC_LABEL[e.docType]}${e.caption ? ` — ${e.caption}` : ""}`}
      description={`${db.sites.find((s) => s.id === c.siteId)?.shortName ?? ""} ${c.title} · ${e.fileName} (${sizeText(e.size)}) · ${userLabel(db, e.createdBy)} ${fmtDateTime(e.createdAt)}`}
      size={e.kind === "image" ? "lg" : "sm"}
      testId="co-evidence-view"
      footer={
        removing ? (
          <>
            <Button onClick={() => setRemoving(false)}>취소</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await run("removeChangeOrderEvidence", { evidenceId: e.id, reason, idempotencyKey: key });
                  toast.push({ tone: "ok", title: "증빙 파일을 지웠습니다", desc: "누가·왜 지웠는지 변경공사 기록에 남았습니다" });
                  onClose();
                } catch (x) {
                  setErr(x instanceof CommandError ? { msg: x.message, fields: x.fieldErrors } : { msg: "지우지 못했습니다. 다시 눌러 주세요." });
                } finally {
                  setBusy(false);
                }
              }}
              data-testid="co-evidence-remove-confirm"
            >
              지우기
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => setRemoving(true)} data-testid="co-evidence-remove">
              지우기
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
      {removing ? (
        <div className="space-y-3 text-[0.88rem]">
          <p>파일을 지우면 원본도 지워져 되돌릴 수 없습니다. 지운 사람·이유는 변경공사 기록과 활동 이력에 남습니다.</p>
          <Field label="지우는 이유" htmlFor="co-evidence-reason" required error={err?.fields?.reason} counter={`${Array.from(reason).length}/200`}>
            <input id="co-evidence-reason" className={inputCls} value={reason} maxLength={200} onChange={(x) => setReason(x.target.value)} placeholder="예: 다른 현장 서류를 잘못 올림" data-testid="co-evidence-reason" />
          </Field>
          {err && <Notice tone="err">{err.msg}</Notice>}
        </div>
      ) : e.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={e.dataUrl} alt={e.caption || e.fileName} className="mx-auto max-h-[70vh] w-auto rounded-lg border border-line" data-testid="co-evidence-image" />
      ) : (
        <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-4 text-[0.88rem]">
          <FileText size={28} aria-hidden className="shrink-0 text-ink-3" />
          <p>
            PDF는 내려받아 PC·휴대폰의 PDF 보기로 엽니다. <span className="text-ink-3">(이 화면 안에서는 열지 않습니다 — 파일 안의 링크·스크립트가 시스템 화면에서 동작하지 않게)</span>
          </p>
        </div>
      )}
    </Modal>
  );
}
