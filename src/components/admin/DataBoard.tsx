"use client";

/** 본사 — 자료 이관·점검 (계약 3단계 ‘실제 자료 연결’): 현장별 준비 점검 + 엑셀(CSV) 가져오기 */
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, CircleDashed, Download, FileUp, Undo2, Upload } from "lucide-react";
import { useMe, userLabel } from "@/lib/data/hooks";
import { run } from "@/lib/data/store";
import { CommandError } from "@/lib/data/commands";
import { CSV_ENCODING_HINT, IMPORT_SPECS, importTemplate, importTemplateXlsx, planImport, type ImportKind } from "@/lib/domain/importers";
import { tsvToCsv } from "@/lib/domain/csv";
import { readinessAll, type ReadyFix, type ReadyItem, type ReadyStatus } from "@/lib/domain/readiness";
import { fmtDateTime, fmtMan, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { XLSX_MIME, downloadBytes, downloadCsv } from "@/lib/browser/download";
import { readImportFile } from "@/lib/browser/readSheet";
import { IS_LIVE } from "@/lib/mode";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, DemoBadge, Notice, PageSkeleton, Segmented, cx, inputCls } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";

const KINDS: ImportKind[] = ["billing", "change", "crew", "rates", "cost"];
const IMPORT_FIX: Partial<Record<ReadyFix, ImportKind>> = { billing: "billing", change: "change", crew: "crew", rates: "rates", cost: "cost" };
const STATUS_ICON: Record<ReadyStatus, React.ReactNode> = {
  ok: <CircleCheck size={16} className="text-ok" aria-label="준비됨" />,
  warn: <CircleAlert size={16} className="text-warn" aria-label="확인 권장" />,
  missing: <CircleDashed size={16} className="text-err" aria-label="빠짐" />,
};

export function DataBoard() {
  const { db } = useMe();
  const [kind, setKind] = useState<ImportKind>("billing");
  const importRef = useRef<HTMLDivElement>(null);
  if (!db) return <PageSkeleton />;
  const today = todayIso();
  const r = readinessAll(db, today);
  const goImport = (k: ImportKind) => {
    setKind(k);
    setTimeout(() => importRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  return (
    <PageBody>
      <PageHeader
        eyebrow={<DemoBadge compact />}
        title="자료 이관·점검"
        desc="진행 중 현장의 지난 기성·변경공사·출력·원가를 엑셀(CSV)로 한 번에 넣고, 현장별로 운영에 필요한 자료가 빠짐없이 들어왔는지 확인합니다."
      />
      <Card data-testid="ready-board">
        <CardHeader
          title={r.missing ? `빠진 자료 ${r.missing}건` : "필수 자료가 모두 들어왔습니다"}
          sub="현장마다 운영·검수에 필요한 자료 — 빠짐(빨강)은 먼저, 확인 권장(노랑)은 가능한 대로"
        />
        <div className="space-y-4 px-5 pb-5">
          <ul className="grid gap-2 @min-[900px]:grid-cols-3" data-testid="ready-company">
            {r.company.map((it) => (
              <ReadyRow key={it.key} it={it} />
            ))}
          </ul>
          {r.sites.map((s) => (
            <section key={s.site.id} className="rounded-2xl border border-line" data-testid="ready-site" data-site={s.site.id}>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <p className="text-[0.92rem] font-bold">
                  {s.site.shortName} <span className="text-[0.8rem] font-semibold text-ink-3">{s.site.code}</span>
                </p>
                <Badge tone={s.items.some((i) => i.status === "missing") ? "err" : s.ok === s.total ? "ok" : "warn"}>
                  준비 {s.ok}/{s.total}
                </Badge>
              </header>
              {s.items.some((i) => i.status !== "ok") && (
                <ul className="divide-y divide-line">
                  {s.items
                    .filter((i) => i.status !== "ok")
                    .sort((a, b) => (a.status === "missing" ? 0 : 1) - (b.status === "missing" ? 0 : 1))
                    .map((it) => (
                      <ReadyRow key={it.key} it={it} siteId={s.site.id} onImport={goImport} flat />
                    ))}
                </ul>
              )}
              <p className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[0.78rem] text-ink-3", s.items.some((i) => i.status !== "ok") && "border-t border-line")} data-testid="ready-ok">
                <CircleCheck size={14} className="text-ok" aria-hidden />
                {s.items
                  .filter((i) => i.status === "ok")
                  .map((i) => (
                    <span key={i.key} data-testid="ready-item" data-key={i.key} data-status="ok" title={i.text}>
                      {i.label}
                    </span>
                  ))}
              </p>
            </section>
          ))}
        </div>
      </Card>
      <div ref={importRef} className="scroll-mt-24">
        <ImportCard kind={kind} setKind={setKind} />
      </div>
      <BatchList />
      <BackupCard />
    </PageBody>
  );
}

function fixHref(fix: ReadyFix | undefined, siteId?: string): string | null {
  if (!fix) return null;
  if (fix === "rates") return "/labor";
  if (fix === "geo") return "/attendance";
  if (fix === "forecast") return IS_LIVE ? "/admin?tab=sites" : siteId ? `/sites/${siteId}` : null;
  if (fix === "site") return IS_LIVE ? "/admin?tab=sites" : siteId ? `/sites/${siteId}` : null;
  if (fix === "partner") return IS_LIVE ? "/admin?tab=members" : "/partner";
  if (fix === "settings") return IS_LIVE ? "/admin?tab=settings" : "/settings";
  return null;
}

function ReadyRow({ it, siteId, onImport, flat }: { it: ReadyItem; siteId?: string; onImport?: (k: ImportKind) => void; flat?: boolean }) {
  const importKind = it.fix ? IMPORT_FIX[it.fix] : undefined;
  const href = importKind ? null : fixHref(it.fix, siteId);
  const action = it.status !== "ok" && (importKind || href);
  return (
    <li className={cx("flex items-start gap-2.5 px-4 py-2.5", flat ? "bg-surface" : "rounded-xl border border-line bg-surface")} data-testid="ready-item" data-key={it.key} data-status={it.status}>
      <span className="mt-0.5 shrink-0">{STATUS_ICON[it.status]}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.84rem] font-semibold text-ink">{it.label}</span>
        <span className={cx("block text-[0.78rem]", it.status === "ok" ? "text-ink-3" : "text-ink-2")}>{it.text}</span>
      </span>
      {action &&
        (importKind && onImport ? (
          <button type="button" onClick={() => onImport(importKind)} className="press shrink-0 rounded-lg px-2 py-1 text-[0.78rem] font-bold text-theme-ink hover:bg-active-soft" data-testid="ready-import">
            가져오기
          </button>
        ) : href ? (
          <Link href={href} className="press shrink-0 rounded-lg px-2 py-1 text-[0.78rem] font-bold text-theme-ink hover:bg-active-soft">
            고치기
          </Link>
        ) : null)}
    </li>
  );
}

function ImportCard({ kind, setKind }: { kind: ImportKind; setKind: (k: ImportKind) => void }) {
  const { db } = useMe();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [rebaseline, setRebaseline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => uid("idem"));
  const [done, setDone] = useState<{ added: number; skipped: number; kind: ImportKind } | null>(null);
  const spec = IMPORT_SPECS[kind];
  const plan = useMemo(() => (db && text.trim() ? planImport(db, kind, text, todayIso()) : null), [db, kind, text]);
  if (!db) return null;
  const reset = () => {
    setText("");
    setFileName("");
    setKey(uid("idem"));
  };
  const switchKind = (k: ImportKind) => {
    setKind(k);
    reset();
    setDone(null);
  };
  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await run("importData", { kind, text, idempotencyKey: key, rebaseline });
      setDone({ added: r.added, skipped: r.skipped, kind });
      toast.push({ tone: "ok", title: `${spec.title} ${r.added}건을 넣었습니다`, desc: r.skipped ? `이미 있던 ${r.skipped}건은 건너뛰었습니다` : undefined });
      reset();
    } catch (e) {
      toast.push({ tone: "err", title: e instanceof CommandError ? e.message : "가져오지 못했습니다" });
    } finally {
      setBusy(false);
    }
  };
  const moneyKind = kind === "billing" || kind === "change" || kind === "cost";
  const after: Record<ImportKind, { href: string; label: string }> = {
    billing: { href: "/finance", label: "기성·수금에서 확인" },
    change: { href: "/finance", label: "기성·수금 → 변경공사에서 확인" },
    crew: { href: "/labor", label: "투입·인건비에서 확인" },
    rates: { href: "/labor", label: "투입·인건비에서 확인" },
    cost: { href: "/sites", label: "현장 관리 → 원가에서 확인" },
  };
  return (
    <Card data-testid="import-card">
      <CardHeader title="자료 가져오기" sub={`엑셀 양식 내려받기 → 엑셀에서 채우기 → 저장한 파일 그대로 올리기 → 확인 → 넣기. ${CSV_ENCODING_HINT}`} />
      <div className="space-y-4 px-5 pb-5">
        <div className="overflow-x-auto">
          <Segmented
            label="자료 종류"
            value={kind}
            onChange={switchKind}
            options={KINDS.map((k) => ({ value: k, label: IMPORT_SPECS[k].title, testId: `import-kind-${k}` }))}
          />
        </div>
        <p className="text-[0.86rem] text-ink-2">{spec.desc}</p>
        <div tabIndex={0} role="region" aria-label="양식 열 설명 (가로 스크롤)" className="relative overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[34rem] text-[0.8rem]">
            <thead>
              <tr className="bg-surface-2 text-left text-ink-3">
                <th className="px-3 py-2 font-semibold">열 (첫 줄)</th>
                <th className="px-3 py-2 font-semibold">설명</th>
                <th className="px-3 py-2 font-semibold">예</th>
              </tr>
            </thead>
            <tbody>
              {spec.columns.map((c) => (
                <tr key={c.key} className="border-t border-line">
                  <td className="px-3 py-1.5 font-bold">
                    {c.label}
                    {c.required ? <span className="text-err"> *</span> : <span className="font-normal text-ink-3"> (선택)</span>}
                  </td>
                  <td className="px-3 py-1.5 text-ink-2">{c.desc}</td>
                  <td className="num px-3 py-1.5 text-ink-3">{c.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Download size={15} />} onClick={() => downloadBytes(`양식_${spec.title.replace(/[^\w가-힣]/g, "")}.xlsx`, importTemplateXlsx(kind), XLSX_MIME)} data-testid="import-template">
            엑셀 양식 내려받기
          </Button>
          <Button size="sm" variant="ghost" onClick={() => downloadCsv(`양식_${spec.title.replace(/[^\w가-힣]/g, "")}.csv`, importTemplate(kind))} data-testid="import-template-csv">
            CSV 양식
          </Button>
          <Button size="sm" variant="soft" icon={<Upload size={15} />} onClick={() => fileRef.current?.click()} data-testid="import-file-btn">
            엑셀·CSV 파일 올리기
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={`.xlsx,.csv,text/csv,${XLSX_MIME}`}
            aria-label={`${spec.title} 엑셀·CSV 파일 선택`}
            tabIndex={-1}
            className="sr-only"
            data-testid="import-file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const r = await readImportFile(f, kind);
                setText(r.text);
                setFileName(r.note ? `${f.name} · ${r.note}` : f.name);
                setDone(null);
                setKey(uid("idem"));
              } catch (err) {
                toast.push({ tone: "err", title: err instanceof Error ? err.message : "파일을 읽지 못했습니다" });
              }
            }}
          />
          {fileName && <span className="self-center text-[0.8rem] text-ink-3">{fileName}</span>}
        </div>
        <div>
          <label htmlFor="import-text" className="text-[0.8rem] font-semibold text-ink-2">
            또는 엑셀에서 표를 복사해 붙여넣기 (쉼표로 구분)
          </label>
          <textarea
            id="import-text"
            rows={5}
            className={cx(inputCls, "mt-1 font-mono text-[0.78rem]")}
            value={text}
            onChange={(e) => {
              // 엑셀에서 복사한 표는 탭으로 나뉜다 → 셀 안 쉼표(10,000,000)가 열을 나누지 않게 변환
              setText(tsvToCsv(e.target.value));
              setDone(null);
              setKey(uid("idem"));
            }}
            placeholder={importTemplate(kind)}
            data-testid="import-text"
          />
        </div>

        {plan && (
          <div className="space-y-3" data-testid="import-preview">
            {(plan.skippedExamples?.length || (plan.headerLine ?? 1) > 1) && (
              <p className="rounded-xl bg-info-bg px-3.5 py-2 text-[0.82rem] text-ink-2" data-testid="import-notes">
                {(plan.headerLine ?? 1) > 1 && <>열 이름은 {plan.headerLine}행에서 찾았습니다 (위쪽 제목은 건너뜀). </>}
                {plan.skippedExamples?.length ? <>양식의 예시 줄 {plan.skippedExamples.length}개({plan.skippedExamples.join(", ")}행)는 넣지 않습니다.</> : null}
              </p>
            )}
            {plan.errors.length > 0 && (
              <Notice tone="err" title={`오류 ${plan.errors.length}건 — 고친 뒤 다시 올려주세요 (오류가 있으면 아무것도 넣지 않습니다)`}>
                <ul className="mt-1 space-y-0.5 text-[0.8rem]" data-testid="import-errors">
                  {plan.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>
                      <b className="num">{e.line}행</b> · {e.field} — {e.message}
                    </li>
                  ))}
                  {plan.errors.length > 20 && <li>… 외 {plan.errors.length - 20}건</li>}
                </ul>
              </Notice>
            )}
            {plan.duplicates.length > 0 && (
              <Notice tone="warn" title={`이미 있는 기록 ${plan.duplicates.length}건은 건너뜁니다`}>
                <ul className="mt-1 space-y-0.5 text-[0.8rem]" data-testid="import-dups">
                  {plan.duplicates.slice(0, 8).map((d) => (
                    <li key={d.line}>
                      <b className="num">{d.line}행</b> · {d.text}
                    </li>
                  ))}
                  {plan.duplicates.length > 8 && <li>… 외 {plan.duplicates.length - 8}건</li>}
                </ul>
              </Notice>
            )}
            {plan.errors.length === 0 && plan.rows.length > 0 && (
              <div className="rounded-xl border border-line bg-surface-2 px-4 py-3" data-testid="import-summary">
                <p className="text-[0.9rem] font-bold">새로 넣을 {plan.rows.length}건</p>
                <ul className="mt-1 space-y-0.5 text-[0.84rem] text-ink-2">
                  {plan.summary.map((s, i) => (
                    <li key={i}>
                      {s.label}
                      {kind === "billing" && ` · 기성 ${fmtMan(s.amount ?? 0)} / 입금 ${fmtMan(s.amount2 ?? 0)}`}
                      {kind === "change" && ` · 청구 ${fmtMan(s.amount ?? 0)}${s.amount2 ? ` / 승인 ${fmtMan(s.amount2)} → 계약금액에 더해짐` : ""}`}
                      {kind === "cost" && ` · ${fmtMan(s.amount ?? 0)}`}
                      {kind === "crew" && ` · ${s.amount}명·일`}
                    </li>
                  ))}
                </ul>
                {moneyKind && (
                  <label className="mt-3 flex items-start gap-2.5 text-[0.84rem]">
                    <input type="checkbox" checked={rebaseline} onChange={(e) => setRebaseline(e.target.checked)} className="mt-1 size-4 accent-[var(--t-active)]" data-testid="import-rebaseline" />
                    <span>
                      <b>지난 자료로 보고 손익 기준선을 다시 잡기 (권장)</b>
                      <span className="block text-[0.76rem] text-ink-3">끄면 이번에 넣은 금액이 대시보드·보고서에서 ‘운영 시작 후 변화’로 보입니다.</span>
                    </span>
                  </label>
                )}
                <Button className="mt-3" variant="cta" icon={<FileUp size={16} />} loading={busy} onClick={apply} data-testid="import-apply">
                  {plan.rows.length}건 넣기
                </Button>
              </div>
            )}
            {plan.errors.length === 0 && plan.rows.length === 0 && <Notice tone="info">새로 넣을 행이 없습니다 — 모두 이미 있는 기록입니다.</Notice>}
          </div>
        )}
        {done && (
          <Notice tone="ok" title={`${IMPORT_SPECS[done.kind].title} ${done.added}건을 넣었습니다${done.skipped ? ` (중복 ${done.skipped}건 건너뜀)` : ""}`}>
            <span data-testid="import-done">
              활동 이력에 남았습니다. 잘못 넣었다면 해당 화면에서 취소·수정하세요.{" "}
              <Link href={after[done.kind].href} className="font-bold text-theme-ink underline">
                {after[done.kind].label}
              </Link>
            </span>
          </Notice>
        )}
      </div>
    </Card>
  );
}

const UNDO_MS = 7 * 86_400_000;

function BatchList() {
  const { db } = useMe();
  const toast = useToast();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!db) return null;
  const list = (db.importBatches ?? []).slice(0, 12);
  if (!list.length) return null;
  const undo = async (id: string) => {
    setBusy(true);
    try {
      const r = await run("undoImport", { batchId: id });
      toast.push({ tone: "ok", title: `가져오기를 취소했습니다 (${r.removed}건 되돌림)` });
      setConfirm(null);
    } catch (e) {
      toast.push({ tone: "err", title: e instanceof CommandError ? e.message : "취소하지 못했습니다" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-testid="import-batches">
      <CardHeader title="최근 가져오기" sub="잘못 넣었으면 7일 안에 통째로 취소할 수 있습니다 (그 뒤 바뀐 기록이 없을 때)" />
      <ul className="divide-y divide-line px-5 pb-3">
        {list.map((b) => {
          const canUndo = !b.undoneAt && Date.now() - new Date(b.at).getTime() <= UNDO_MS;
          const names = b.siteIds.map((id) => db.sites.find((s) => s.id === id)?.shortName ?? id).join(", ");
          return (
            <li key={b.id} className="flex flex-wrap items-center gap-2 py-2.5 text-[0.84rem]" data-testid="import-batch" data-kind={b.kind} data-undone={b.undoneAt ? "1" : "0"}>
              <span className="min-w-0 flex-1">
                <b>{IMPORT_SPECS[b.kind].title}</b> {b.count}건{names ? ` · ${names}` : ""}
                {b.skipped ? <span className="text-ink-3"> · 중복 {b.skipped}건 건너뜀</span> : null}
                <span className="block text-[0.76rem] text-ink-3">
                  {fmtDateTime(b.at)} · {userLabel(db, b.by)}
                  {b.undoneAt ? ` · 취소됨 ${fmtDateTime(b.undoneAt)}` : ""}
                </span>
              </span>
              {b.undoneAt ? (
                <Badge tone="neutral">취소됨</Badge>
              ) : canUndo ? (
                confirm === b.id ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-[0.78rem] font-semibold text-err">정말 취소할까요?</span>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      아니요
                    </Button>
                    <Button size="sm" variant="danger" loading={busy} onClick={() => undo(b.id)} data-testid="import-undo-confirm">
                      취소하기
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" icon={<Undo2 size={15} />} onClick={() => setConfirm(b.id)} data-testid="import-undo">
                    가져오기 취소
                  </Button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** 전체 자료 백업 (대표 전용) — 고객이 자기 데이터를 직접 보관 (계약 4단계 인수인계) */
function BackupCard() {
  const { db, role } = useMe();
  if (!db || role !== "ceo") return null;
  const demoDownload = () => {
    const blob = new Blob([JSON.stringify({ format: "taekang-site-intelligence-backup", version: 1, exportedAt: new Date().toISOString(), note: "DEMO 브라우저 자료 (가상 데이터)", data: db }, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `taekang_backup_demo_${todayIso().replace(/-/g, "")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Card data-testid="backup-card">
      <CardHeader title="전체 자료 백업" sub="회사 자료는 태강지엘텍 소유입니다 — 월 1회 내려받아 회사 PC·클라우드에 보관하세요 (대표만)" />
      <div className="flex flex-wrap items-center gap-3 px-5 pb-5">
        {IS_LIVE ? (
          <a href="/api/export" download className="press inline-flex h-10 items-center gap-2 rounded-xl bg-solid px-4 text-[0.9rem] font-bold text-white" data-testid="backup-download">
            <Download size={16} aria-hidden /> 전체 자료 내려받기 (JSON)
          </a>
        ) : (
          <Button icon={<Download size={16} />} onClick={demoDownload} data-testid="backup-download">
            전체 자료 내려받기 (JSON)
          </Button>
        )}
        <p className="min-w-0 flex-1 text-[0.8rem] text-ink-3">
          현장·원가·기성·변경공사·출퇴근·보고·작업 인원·지시·요청·이력이 모두 들어갑니다. 비밀번호·로그인 정보·QR 단말기 비밀값은 넣지 않고, 사진 원본은 크기 때문에 빠집니다(사진은 DB 전체 백업으로 보관).
        </p>
      </div>
    </Card>
  );
}
