"use client";

/**
 * 검수 확인서 (D-51) — 계약 단계를 고르면 계약 기준·확인 방법·시스템에 쌓인 실사용 근거를 한 장으로 만든다.
 * - 합격 여부는 발주자가 판단한다: 화면에서 체크해 인쇄하거나, 인쇄 후 손으로 체크·서명
 * - 체크·보완 사항은 저장하지 않는다 (종이 확인서가 원본)
 * - 계약 금액은 넣지 않는다
 */
import { useEffect, useState, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { IS_LIVE } from "@/lib/mode";
import { acceptanceItems, STAGE_TITLE, type AcceptanceItem, type StageNo } from "@/lib/domain/acceptance";
import type { ErrorEntry } from "@/lib/domain/feedback";
import { fmtDate, todayIso } from "@/lib/domain/format";
import { monthBounds, previousMonth } from "@/lib/domain/monthClose";
import { shiftDate } from "@/lib/domain/attendance";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Button, Card, Field, Notice, PageSkeleton, Segmented, cx, inputCls } from "@/components/ui/primitives";

type Mark = "pass" | "fix";
const VENDOR = "미래AI랩";

export function AcceptanceBoard() {
  const { db } = useMe();
  const today = todayIso();
  const [stage, setStage] = useState<StageNo>(1);
  const [from, setFrom] = useState(shiftDate(today, -13));
  const [to, setTo] = useState(today);
  const [marks, setMarks] = useState<Record<string, Mark | undefined>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<ErrorEntry[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    if (!IS_LIVE || stage !== 4 || errors) return;
    let alive = true;
    fetch("/api/errors", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<{ errors: ErrorEntry[]; truncated?: boolean }>) : null))
      .then((j) => {
        if (!alive || !j) return;
        setTruncated(!!j.truncated);
        setErrors(j.errors);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [stage, errors]);
  if (!db) return <PageSkeleton />;
  const items = acceptanceItems(db, stage, from, to, new Date(), errors, truncated);
  const gaps = items.filter((i) => i.evidence.some((e) => !e.has));
  const markOf = (k: string) => marks[`${stage}:${k}`];
  const setMark = (k: string, m: Mark) => setMarks((x) => ({ ...x, [`${stage}:${k}`]: x[`${stage}:${k}`] === m ? undefined : m }));
  const overall = markOf("__overall");
  const note = notes[stage] ?? "";
  return (
    <PageBody>
      <PageHeader
        className="no-print"
        title="검수 확인서"
        desc="계약 단계를 고르면 계약 기준·확인 방법과 이 시스템에 쌓인 실사용 기록 수를 한 장으로 만듭니다. 합격 여부는 발주자가 판단합니다 — 화면에서 체크해 인쇄하거나, 인쇄 후 손으로 체크·서명하세요."
        right={
          <Button icon={<Printer size={17} />} onClick={() => window.print()} data-testid="acc-print">
            인쇄·PDF
          </Button>
        }
      />
      <Card className="no-print">
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <Segmented
            label="계약 단계"
            value={String(stage) as "1" | "2" | "3" | "4"}
            onChange={(v) => setStage(Number(v) as StageNo)}
            options={([1, 2, 3, 4] as const).map((n) => ({ value: String(n) as "1" | "2" | "3" | "4", label: `${n}단계`, testId: `acc-stage-${n}` }))}
          />
          {stage !== 1 && (
            <>
              <Field label="확인 기간 시작" htmlFor="acc-from">
                <input id="acc-from" type="date" className={cx(inputCls, "w-44")} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} data-testid="acc-from" />
              </Field>
              <Field label="확인 기간 끝" htmlFor="acc-to">
                <input id="acc-to" type="date" className={cx(inputCls, "w-44")} value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} data-testid="acc-to" />
              </Field>
              {/* 지난달 한 번에 — 기본 14일로 그대로 보내면 한 달 근거가 적게 나가던 문제 (D-78 첫 달 리허설) */}
              <Button
                size="sm"
                className="self-end"
                onClick={() => {
                  const b = monthBounds(previousMonth(today));
                  setFrom(b.from);
                  setTo(b.to);
                }}
                data-testid="acc-last-month"
              >
                지난달 ({Number(previousMonth(today).slice(5))}월)
              </Button>
            </>
          )}
        </div>
        <div className="px-5 pb-4">
          {gaps.length ? (
            <Notice tone="warn" title={`기록이 아직 없는 항목 ${gaps.length}개`}>
              <p className="text-[0.86rem]" data-testid="acc-gaps">
                {gaps.map((g) => g.title).join(" · ")} — 시범 사용으로 기록이 쌓인 뒤 검수하면 확인이 쉽습니다. 각 항목의 ‘확인 방법’ 순서대로 시연해도 됩니다.
              </p>
            </Notice>
          ) : !items.some((i) => i.evidence.some((e) => e.counted)) ? (
            <Notice tone="info" title="이 단계는 문서·화면으로 확인하는 항목입니다">
              <p className="text-[0.86rem]" data-testid="acc-doc-stage">운영 기록 수로 보는 항목이 없습니다. 각 항목의 ‘확인 방법’대로 문서와 화면을 직접 확인하세요.</p>
            </Notice>
          ) : (
            <Notice tone="ok" title="모든 항목에 확인할 기록이 있습니다">
              <p className="text-[0.86rem]">기록 수는 확인 거리일 뿐 합격 판단이 아닙니다. 발주자가 화면으로 직접 확인합니다.</p>
            </Notice>
          )}
          <p className="mt-2 text-[0.78rem] text-ink-3">이 화면의 체크·보완 사항은 저장되지 않습니다. 인쇄한 확인서(서명본)를 원본으로 보관하세요.</p>
        </div>
      </Card>

      <article className="mx-auto w-full max-w-[52rem] rounded-2xl border border-line bg-surface px-5 py-6 text-ink @min-[760px]:px-9 print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0" data-testid="acc-doc" data-stage={stage}>
        <h2 className="text-center text-[1.5rem] font-extrabold tracking-[0.3em]">검 수 확 인 서</h2>
        <p className="mt-1 text-center text-[0.9rem] font-semibold text-ink-2" data-testid="acc-stage-title">
          {STAGE_TITLE[stage]}
        </p>
        <table className="mt-4 w-full table-fixed border-collapse [overflow-wrap:anywhere]">
          <tbody>
            <tr>
              <th className={cx(th, "w-24")}>사업명</th>
              <td className={td} colSpan={3}>
                TAEKANG SITE INTELLIGENCE 구축 (계약 별지 제1호 기준)
              </td>
            </tr>
            <tr>
              <th className={th}>발주자</th>
              <td className={td} data-testid="acc-client">
                {db.company.name}
              </td>
              <th className={cx(th, "w-24")}>수행사</th>
              <td className={td}>{VENDOR}</td>
            </tr>
            <tr>
              <th className={th}>확인 기간</th>
              <td className={cx(td, "num")} data-testid="acc-period">
                {stage === 1 ? "작성일 현재 상태" : `${fmtDate(from)} ~ ${fmtDate(to)}`}
              </td>
              <th className={th}>작성일</th>
              <td className={cx(td, "num")}>{fmtDate(today)}</td>
            </tr>
          </tbody>
        </table>

        <ol className="mt-4 space-y-3 print:mt-3 print:space-y-2">
          {items.map((it, i) => (
            <ItemBlock key={it.key} no={i + 1} it={it} mark={markOf(it.key)} onMark={(m) => setMark(it.key, m)} />
          ))}
        </ol>

        <section className="mt-4 break-inside-avoid print:mt-3">
          <h3 className="mb-1.5 border-l-4 border-solid pl-2 text-[0.95rem] font-extrabold">보완 사항</h3>
          <label className="sr-only" htmlFor="acc-note">
            보완 사항
          </label>
          <textarea
            id="acc-note"
            rows={3}
            className={cx(inputCls, "no-print min-h-20 py-2")}
            placeholder="보완할 내용과 다시 확인할 날짜 (비워 두면 인쇄본에 빈 줄이 나옵니다)"
            value={note}
            onChange={(e) => setNotes((x) => ({ ...x, [stage]: e.target.value }))}
            data-testid="acc-note"
          />
          <div className="hidden print:block" data-testid="acc-note-print">
            {note.trim() ? <p className="text-[0.9rem] whitespace-pre-wrap">{note}</p> : <PaperLines n={3} />}
          </div>
        </section>

        {/* 종합 판정과 서명은 한 덩어리 — 인쇄 때 서명란만 다음 쪽에 혼자 찍히던 문제 (D-66) */}
        <div className="break-inside-avoid">
        <section className="mt-4 break-inside-avoid print:mt-3" data-testid="acc-overall">
          <h3 className="mb-1.5 border-l-4 border-solid pl-2 text-[0.95rem] font-extrabold">종합 판정</h3>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[0.92rem]">
            <Check label="합격 (이 단계 검수 완료)" on={overall === "pass"} onClick={() => setMark("__overall", "pass")} testId="acc-overall-pass" />
            <Check label="보완 후 다시 확인" on={overall === "fix"} onClick={() => setMark("__overall", "fix")} testId="acc-overall-fix" />
          </div>
        </section>

        <section className="mt-5 grid break-inside-avoid grid-cols-1 gap-3 @min-[560px]:grid-cols-2 print:grid-cols-2" data-testid="acc-sign">
          <Sign party="발주자" org={db.company.name} who="확인자" />
          <Sign party="수행사" org={VENDOR} who="대표" />
        </section>
        </div>

        <p className="mt-4 border-t border-line pt-2 text-[0.74rem] text-ink-3" data-testid="acc-foot">
          {IS_LIVE ? "" : "DEMO · 가상 시연 데이터 — 실제 검수에는 운영 화면에서 다시 만드세요. "}
          TAEKANG SITE INTELLIGENCE 자동 작성 — 시스템 근거는 확인 기간 중 기록을 센 값이며 합격 판단이 아닙니다. 계약 금액은 넣지 않습니다. 세부 기준은 계약 별지 제1호(검수 기준)를 따릅니다.
        </p>
      </article>
    </PageBody>
  );
}

const th = "border border-line-strong bg-surface-2 px-2.5 py-1.5 text-left text-[0.8rem] font-bold text-ink-2 print:bg-transparent";
const td = "border border-line-strong px-2.5 py-1.5 align-top text-[0.86rem]";

function ItemBlock({ no, it, mark, onMark }: { no: number; it: AcceptanceItem; mark: Mark | undefined; onMark: (m: Mark) => void }) {
  return (
    <li className="break-inside-avoid" data-testid="acc-item" data-key={it.key} data-mark={mark ?? ""}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-strong pb-1">
        <h3 className="mr-auto text-[0.98rem] font-extrabold">
          <span className="num">{no}.</span> {it.title}
        </h3>
        <Check label="합격" on={mark === "pass"} onClick={() => onMark("pass")} testId="acc-pass" />
        <Check label="보완" on={mark === "fix"} onClick={() => onMark("fix")} testId="acc-fix" />
      </div>
      <dl className="mt-1.5 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[0.86rem] [overflow-wrap:anywhere] print:gap-y-0.5 print:text-[0.8rem]">
        <dt className="font-semibold text-ink-3">계약 기준</dt>
        <dd>{it.criteria}</dd>
        <dt className="font-semibold text-ink-3">확인 방법</dt>
        <dd>{it.how}</dd>
        <dt className="font-semibold text-ink-3">시스템 근거</dt>
        <dd>
          <ul className="space-y-0.5 print:space-y-0" data-testid="acc-evidence">
            {it.evidence.map((e) => (
              <li key={e.label} data-has={e.has ? "1" : "0"}>
                <span className="text-ink-2">{e.label}</span> <b className={cx("num", !e.has && "font-semibold text-ink-3")}>{e.value}</b>
                {!e.has && <span className="ml-1.5 text-[0.76rem] text-warn">· {e.missing ?? "기록 없음"}</span>}
              </li>
            ))}
          </ul>
        </dd>
      </dl>
    </li>
  );
}

/** 종이 확인서처럼 보이는 체크 칸 (누르면 켜고, 다시 누르면 끔) */
function Check({ label, on, onClick, testId }: { label: ReactNode; on: boolean; onClick: () => void; testId: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onClick} className="press inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 font-semibold print:min-h-0" data-testid={testId}>
      <span aria-hidden className={cx("grid size-5 place-items-center rounded-[3px] border-2 text-[0.8rem] leading-none", on ? "border-ink bg-ink text-surface print:bg-transparent print:text-ink" : "border-ink-3")}>
        {on ? "✓" : ""}
      </span>
      {label}
    </button>
  );
}

function Sign({ party, org, who }: { party: string; org: string; who: string }) {
  return (
    <div className="rounded-lg border border-line-strong px-4 py-3 text-[0.88rem]">
      <p className="font-extrabold">
        {party} <span className="font-semibold text-ink-2">{org}</span>
      </p>
      <p className="mt-4 flex items-end gap-2">
        <span className="shrink-0 text-ink-3">{who}</span>
        <span className="flex-1 border-b border-ink-3" />
        <span className="shrink-0 text-ink-3">(서명 또는 인)</span>
      </p>
      <p className="mt-3 flex items-end gap-2">
        <span className="shrink-0 text-ink-3">일자</span>
        <span className="flex-1 border-b border-ink-3" />
      </p>
    </div>
  );
}

const PaperLines = ({ n }: { n: number }) => (
  <div aria-hidden>
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className="h-7 border-b border-ink-3" />
    ))}
  </div>
);
