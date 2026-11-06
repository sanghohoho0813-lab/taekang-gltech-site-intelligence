"use client";

/** 공사사진대장 — 현장 사진을 날짜순으로 모아 일자·공종·내용·촬영자를 붙이고, 고른 사진만 인쇄 (A4 한 장에 6장) */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Eye, EyeOff, Printer } from "lucide-react";
import { dispatch, run } from "@/lib/data/store";
import { samplePhotos } from "@/lib/domain/samplePhotos";
import { errorMessage } from "@/lib/data/commands";
import { useToast } from "@/components/ui/Toast";
import { useMe } from "@/lib/data/hooks";
import { PHOTO_KIND_LABEL, photoLedger, type LedgerEntry } from "@/lib/domain/photoLedger";
import { shiftDate } from "@/lib/domain/attendance";
import { fmtDate, todayIso } from "@/lib/domain/format";
import { IS_LIVE } from "@/lib/mode";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, EmptyState, Notice, PageSkeleton, Segmented, cx, inputCls } from "@/components/ui/primitives";

const PER_PAGE = 6;
const SCREEN_LIMIT = 240;

export function PhotoLedgerBoard() {
  const { db } = useMe();
  const toast = useToast();
  const [sharing, setSharing] = useState<string | null>(null);
  const sites = db?.sites ?? [];
  const [siteId, setSiteId] = useState("");
  const [range, setRange] = useState<"30" | "month" | "all">("30");
  const [stage, setStage] = useState("");
  const [crew, setCrew] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set());
  const site = sites.find((s) => s.id === siteId) ?? sites.find((s) => s.status === "active") ?? sites[0];
  const to = todayIso();
  const from = range === "30" ? shiftDate(to, -29) : range === "month" ? `${to.slice(0, 8)}01` : (site?.startDate ?? "2000-01-01");
  const entries = useMemo(() => (db && site ? photoLedger(db, site.id, from, to, { includeCrew: crew, stage: stage || undefined }) : []), [db, site, from, to, crew, stage]);
  if (!db) return <PageSkeleton />;
  if (!site)
    return (
      <PageBody>
        <PageHeader title="사진대장" />
        <Card>
          <EmptyState title="현장이 없습니다" />
        </Card>
      </PageBody>
    );
  const shown = entries.slice(0, SCREEN_LIMIT);
  const chosen = shown.filter((e) => !off.has(e.photo.id)).map((e, i) => ({ ...e, no: i + 1 }));
  const pages = Array.from({ length: Math.ceil(chosen.length / PER_PAGE) }, (_, i) => chosen.slice(i * PER_PAGE, (i + 1) * PER_PAGE));
  const stages = [...new Set([...site.stages.map((s) => s.name), site.workType])];
  const toggle = (id: string) => setOff((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <PageBody>
      <PageHeader
        className="no-print"
        title="사진대장"
        desc="현장 보고·보완·작업지시 완료·조치 사진을 날짜순으로 모아 공사사진대장을 만듭니다. 뺄 사진은 눌러서 제외하고 인쇄하세요 (A4 한 장에 6장)."
        right={
          <Button icon={<Printer size={17} />} onClick={() => window.print()} disabled={!chosen.length} data-testid="ledger-print">
            인쇄·PDF ({chosen.length}장)
          </Button>
        }
      />
      <div className="no-print flex flex-wrap items-center gap-2">
        <span className="block w-full max-w-sm">
          <label className="sr-only" htmlFor="ledger-site">
            현장
          </label>
          <select id="ledger-site" className={cx(inputCls, "h-10 py-1")} value={site.id} onChange={(e) => (setSiteId(e.target.value), setOff(new Set()), setStage(""))} data-testid="ledger-site">
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shortName} · {s.name}
              </option>
            ))}
          </select>
        </span>
        <Segmented
          label="기간"
          value={range}
          onChange={(v) => (setRange(v), setOff(new Set()))}
          options={[
            { value: "30", label: "최근 30일", testId: "ledger-30" },
            { value: "month", label: "이번 달", testId: "ledger-month" },
            { value: "all", label: "착공부터", testId: "ledger-all" },
          ]}
        />
        <label className="inline-flex items-center">
          <span className="sr-only">공종</span>
          <select className={cx(inputCls, "h-10 w-auto py-1")} value={stage} onChange={(e) => setStage(e.target.value)} data-testid="ledger-stage">
            <option value="">전체 공종</option>
            {stages.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-[0.86rem]">
          <input type="checkbox" checked={crew} onChange={(e) => setCrew(e.target.checked)} className="size-4 accent-[var(--t-active)]" data-testid="ledger-crew" />
          작업 인원 단체 사진 포함
        </label>
      </div>
      {entries.length > SCREEN_LIMIT && <Notice tone="warn" className="no-print">사진이 {entries.length}장입니다. 앞의 {SCREEN_LIMIT}장만 보여요 — 기간이나 공종을 좁혀 주세요.</Notice>}

      {shown.length === 0 ? (
        <Card className="no-print">
          <EmptyState
            title="이 기간에 사진이 없습니다"
            desc="현장소장이 ‘사진만 보내기’나 보고에서 사진을 올리면 여기에 쌓입니다."
            action={
              !IS_LIVE ? (
                <Button
                  size="sm"
                  onClick={() => {
                    // 시연판 전용 — ‘예시’라고 적힌 그림을 넣어 사진대장·발주처 공개를 보여 준다 (D-67)
                    dispatch((d) => {
                      const add = samplePhotos(site, todayIso(), "u-field").filter((p) => !d.photos.some((x) => x.id === p.id));
                      return { db: { ...d, photos: [...d.photos, ...add], updatedAt: new Date().toISOString(), rev: d.rev + 1 }, result: add.length };
                    });
                    setRange("30");
                  }}
                  data-testid="ledger-sample"
                >
                  시연용 예시 사진 6장 넣기
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card className="no-print" data-testid="ledger-pick">
          <p className="px-5 pt-4 text-[0.84rem] text-ink-2">
            전체 {shown.length}장 · 인쇄 <b data-testid="ledger-count">{chosen.length}</b>장 — 사진을 누르면 빼고 넣습니다
          </p>
          {/* 발주처 공개 (D-67): 고른 사진만 발주처 포털 ‘공정 사진’에 보인다 — 내부 설명·찍은 사람은 보내지 않음 */}
          <p className="px-5 pt-1 text-[0.8rem] text-ink-3" data-testid="ledger-shared-count">
            발주처 공개 <b className="text-ink">{shown.filter((e) => e.photo.shared).length}</b>장 · 사진 아래 ‘발주처 공개’를 누르면 고객 화면에 보입니다 ·{" "}
            <Link href="/partner#photos" className="font-bold text-theme-ink underline">
              발주처 포털에서 보기
            </Link>
          </p>
          <ul className="grid grid-cols-2 gap-2 p-4 @min-[700px]:grid-cols-4 @min-[1100px]:grid-cols-6">
            {shown.map((e) => {
              const out = off.has(e.photo.id);
              return (
                <li key={e.photo.id}>
                  <button type="button" onClick={() => toggle(e.photo.id)} className={cx("press block w-full overflow-hidden rounded-xl border-2 text-left", out ? "border-line opacity-40" : "border-active")} aria-pressed={!out} data-testid="ledger-thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={e.photo.dataUrl} alt={e.text} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                    <span className="block truncate px-1.5 py-1 text-[0.72rem] text-ink-2">
                      <span className="num">{e.date.slice(5).replace("-", "/")}</span> · {PHOTO_KIND_LABEL[e.kind]}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={sharing === e.photo.id}
                    onClick={async () => {
                      setSharing(e.photo.id);
                      try {
                        await run("setPhotoShare", { photoIds: [e.photo.id], shared: !e.photo.shared, caption: e.stage });
                        toast.push({ tone: "ok", title: e.photo.shared ? "발주처 공개를 껐습니다" : "발주처 포털에 공개했습니다", desc: e.photo.shared ? undefined : `설명: ${e.stage}` });
                      } catch (err) {
                        toast.push({ tone: "err", title: errorMessage(err, "바꾸지 못했습니다") });
                      } finally {
                        setSharing(null);
                      }
                    }}
                    className={cx("press mt-1 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border text-[0.76rem] font-bold", e.photo.shared ? "border-active bg-active-soft text-theme-ink" : "border-line text-ink-2")}
                    aria-pressed={!!e.photo.shared}
                    data-testid="ledger-share"
                  >
                    {e.photo.shared ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />}
                    {e.photo.shared ? "발주처 공개 중" : "발주처 공개"}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {pages.map((p, i) => (
        <article key={i} className="ledger-page mx-auto w-full max-w-[52rem] rounded-2xl border border-line bg-surface px-5 py-5 @min-[760px]:px-8 print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0" data-testid="ledger-page">
          <header className="mb-3 flex items-end justify-between gap-2 border-b-2 border-ink pb-1.5">
            <h2 className="shrink-0 whitespace-nowrap text-[1.2rem] font-extrabold tracking-[0.12em]">공사사진대장</h2>
            <p className="min-w-0 text-right text-[0.78rem] text-ink-2">
              {site.name} · <span className="num">{fmtDate(from)} ~ {fmtDate(to)}</span> · {i + 1}/{pages.length}
            </p>
          </header>
          <div className="grid grid-cols-2 gap-3 print:gap-2">
            {p.map((e) => (
              <LedgerCell key={e.photo.id} e={e} />
            ))}
          </div>
          <p className="mt-3 text-[0.7rem] text-ink-3">{IS_LIVE ? "" : "DEMO · 가상 시연 데이터 — "}TAEKANG SITE INTELLIGENCE 자동 작성 — 현장에서 올린 사진·보고 기준</p>
        </article>
      ))}
    </PageBody>
  );
}

function LedgerCell({ e }: { e: LedgerEntry }) {
  const th = "w-14 border border-line-strong bg-surface-2 px-1.5 py-0.5 text-left font-bold text-ink-2 print:bg-transparent";
  const td = "border border-line-strong px-1.5 py-0.5";
  return (
    <figure className="break-inside-avoid" data-testid="ledger-cell">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={e.photo.dataUrl} alt={e.text} className="aspect-[4/3] w-full border border-line-strong object-cover print:aspect-auto print:h-[56mm]" />
      <table className="w-full border-collapse text-[0.74rem]">
        <tbody>
          <tr>
            <th className={th}>번호</th>
            <td className={cx(td, "num")}>{e.no}</td>
            <th className={th}>일자</th>
            <td className={cx(td, "num")}>{fmtDate(e.date)}</td>
          </tr>
          <tr>
            <th className={th}>공종</th>
            <td className={td} colSpan={3}>
              {e.stage} <Badge tone="neutral" className="ml-1 print:hidden">{PHOTO_KIND_LABEL[e.kind]}</Badge>
            </td>
          </tr>
          <tr>
            <th className={th}>내용</th>
            <td className={td} colSpan={3}>
              {e.text}
              {e.by && <span className="text-ink-3"> · {e.by}</span>}
            </td>
          </tr>
        </tbody>
      </table>
    </figure>
  );
}
