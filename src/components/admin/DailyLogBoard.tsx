"use client";

/** 공사일보·주간 공정 보고 — 현장 보고·작업 인원·출퇴근·작업지시·사진으로 자동 작성 (인쇄용, 금액 없음) */
import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { dailyLog, weekStart, weeklyLog, weekdayOf, type DailyLog, type WeeklyLog } from "@/lib/domain/dailylog";
import { shiftDate } from "@/lib/domain/attendance";
import { CATEGORY_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtDateTime, todayIso } from "@/lib/domain/format";
import { IS_LIVE } from "@/lib/mode";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, Notice, PageSkeleton, Segmented, cx, inputCls } from "@/components/ui/primitives";

const WO_STATUS: Record<string, string> = { sent: "미접수", received: "접수", in_progress: "진행 중", done: "완료 보고(확인 대기)", returned: "보완 요청 중" };

export function DailyLogBoard() {
  const { db } = useMe();
  const sites = db?.sites.filter((s) => s.status !== "completed") ?? [];
  const [siteId, setSiteId] = useState<string>("");
  const [date, setDate] = useState(todayIso());
  const [mode, setMode] = useState<"day" | "week">("day");
  if (!db) return <PageSkeleton />;
  const site = sites.find((s) => s.id === siteId) ?? sites[0];
  if (!site)
    return (
      <PageBody>
        <PageHeader title="공사일보" />
        <Card>
          <EmptyState title="진행 중인 현장이 없습니다" />
        </Card>
      </PageBody>
    );
  const today = todayIso();
  const step = mode === "day" ? 1 : 7;
  return (
    <PageBody>
      <PageHeader
        className="no-print"
        title="공사일보"
        desc="현장이 보낸 보고·작업 인원·출퇴근·작업지시·사진으로 자동 작성합니다. 현장소장이 따로 쓰지 않아도 됩니다. 금액은 들어가지 않습니다."
        right={
          <Button icon={<Printer size={17} />} onClick={() => window.print()} data-testid="daily-print">
            인쇄·PDF
          </Button>
        }
      />
      <div className="no-print flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="daily-site">
          현장
        </label>
        <span className="block w-full max-w-sm">
          <select id="daily-site" className={cx(inputCls, "h-10 py-1")} value={site.id} onChange={(e) => setSiteId(e.target.value)} data-testid="daily-site">
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shortName} · {s.name}
              </option>
            ))}
          </select>
        </span>
        <Segmented
          label="종류"
          value={mode}
          onChange={setMode}
          options={[
            { value: "day", label: "공사일보", testId: "daily-mode-day" },
            { value: "week", label: "주간 보고", testId: "daily-mode-week" },
          ]}
        />
        <span className="inline-flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="이전" onClick={() => setDate(shiftDate(date, -step))} data-testid="daily-prev">
            <ChevronLeft size={18} />
          </Button>
          <label className="sr-only" htmlFor="daily-date">
            날짜
          </label>
          <input id="daily-date" type="date" className={cx(inputCls, "num h-10 w-auto py-1")} value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} data-testid="daily-date" />
          <Button size="sm" variant="ghost" aria-label="다음" disabled={shiftDate(date, step) > today && mode === "day"} onClick={() => setDate(shiftDate(date, step) > today ? today : shiftDate(date, step))} data-testid="daily-next">
            <ChevronRight size={18} />
          </Button>
        </span>
      </div>
      {mode === "day" ? <DayDoc d={dailyLog(db, site, date)} /> : <WeekDoc w={weeklyLog(db, site, weekStart(date))} today={today} />}
    </PageBody>
  );
}

function Doc({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <article className="mx-auto w-full max-w-[52rem] rounded-2xl border border-line bg-surface px-5 py-6 text-ink @min-[760px]:px-9 print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0" data-testid={testId}>
      {children}
    </article>
  );
}

const th = "border border-line-strong bg-surface-2 px-2.5 py-1.5 text-left text-[0.8rem] font-bold text-ink-2 print:bg-transparent";
const td = "border border-line-strong px-2.5 py-1.5 align-top text-[0.86rem]";

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="mt-4 break-inside-avoid" data-testid={testId}>
      <h3 className="mb-1.5 border-l-4 border-solid pl-2 text-[0.95rem] font-extrabold">{title}</h3>
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="text-[0.84rem] text-ink-3">{text}</p>;

function DayDoc({ d }: { d: DailyLog }) {
  return (
    <>
      {d.gaps.length > 0 && (
        <Notice tone="warn" title="빠진 자료" className="no-print">
          <ul className="list-disc pl-4 text-[0.84rem]" data-testid="daily-gaps">
            {d.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </Notice>
      )}
      <Doc testId="daily-doc">
        <h2 className="text-center text-[1.5rem] font-extrabold tracking-[0.3em]">공 사 일 보</h2>
        <table className="mt-4 w-full border-collapse">
          <tbody>
            <tr>
              <th className={th}>공사명</th>
              <td className={td} colSpan={3}>
                {d.site.name}
              </td>
            </tr>
            <tr>
              <th className={cx(th, "w-24")}>일자</th>
              <td className={cx(td, "num")} data-testid="daily-date-cell">
                {fmtDate(d.date)} ({d.weekday})
              </td>
              <th className={cx(th, "w-24")}>날씨</th>
              <td className={td}>
                <span className="text-ink-3 print:text-transparent">직접 기입</span>
              </td>
            </tr>
            <tr>
              <th className={th}>발주처</th>
              <td className={td}>{d.site.clientName}</td>
              <th className={th}>공정률</th>
              <td className={cx(td, "num")}>
                {d.site.progressPct}% <span className="text-[0.74rem] text-ink-3">(현재)</span>
              </td>
            </tr>
            <tr>
              <th className={th}>작성</th>
              <td className={td}>{d.writers.join(", ") || "—"}</td>
              <th className={th}>본사 확인</th>
              <td className={td} data-testid="daily-review">
                {d.review.status === "confirmed" ? `${d.review.by ?? ""} ${d.review.at ? fmtDateTime(d.review.at) : ""}` : d.review.status === "returned" ? "보완 요청" : "미확인"}
              </td>
            </tr>
          </tbody>
        </table>

        <Section title="금일 작업 내용" testId="daily-work">
          {d.work.length ? (
            <ol className="list-decimal space-y-0.5 pl-5 text-[0.9rem]">
              {d.work.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ol>
          ) : (
            <Empty text="보고된 작업 없음" />
          )}
          {d.stages.length > 0 && (
            <p className="mt-1.5 text-[0.84rem] text-ink-2" data-testid="daily-stages">
              공정 진척: {d.stages.map((s) => `${s.name} ${s.from}% → ${s.to}%`).join(" · ")}
            </p>
          )}
        </Section>

        <Section title={`투입 인원 (작업 인원 ${d.crewTotal}명 · 직원 ${d.staff.length}명)`} testId="daily-crew">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>팀·업체</th>
                <th className={cx(th, "w-20")}>구분</th>
                <th className={cx(th, "w-20 text-right")}>인원</th>
                <th className={cx(th, "w-28")}>비고</th>
              </tr>
            </thead>
            <tbody>
              {d.crew.length ? (
                d.crew.map((c) => (
                  <tr key={c.team}>
                    <td className={td}>{c.team}</td>
                    <td className={td}>{c.kind === "direct" ? "직영" : "외주"}</td>
                    <td className={cx(td, "num text-right")}>{c.headcount}명</td>
                    <td className={cx(td, "text-[0.78rem] text-ink-3")}>{c.imported ? "출력일보 이관" : c.photo ? "단체 사진" : "사진 없음"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className={cx(td, "text-ink-3")} colSpan={4}>
                    작업 인원 보고 없음
                  </td>
                </tr>
              )}
              {d.staff.map((s) => (
                <tr key={s.name + s.inAt}>
                  <td className={td}>
                    {s.name} <span className="text-[0.78rem] text-ink-3">{s.title}</span>
                  </td>
                  <td className={td}>직원</td>
                  <td className={cx(td, "num text-right")}>1명</td>
                  <td className={cx(td, "num text-[0.78rem] text-ink-3")}>
                    {s.inAt} ~ {s.outAt ?? "퇴근 미기록"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {d.materials.length > 0 && (
          <Section title="자재·장비·외주 (현장 보고 내용)" testId="daily-materials">
            <ul className="list-disc space-y-0.5 pl-5 text-[0.88rem]">
              {d.materials.map((m, i) => (
                <li key={i}>
                  <b>{CATEGORY_LABEL[m.category]}</b> · {m.note}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="특이사항·문제" testId="daily-issues">
          {d.issues.length ? (
            <ul className="list-disc space-y-0.5 pl-5 text-[0.9rem]">
              {d.issues.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <Empty text="없음" />
          )}
        </Section>

        {(d.orders.length > 0 || d.plans.length > 0) && (
          <Section title="본사 지시·명일 계획" testId="daily-orders">
            <ul className="list-disc space-y-0.5 pl-5 text-[0.88rem]">
              {d.orders.map((o, i) => (
                <li key={i}>
                  [{o.event}] {o.title}
                  {o.note ? ` — ${o.note}` : ""}
                </li>
              ))}
              {d.plans.map((p) => (
                <li key={p}>[명일] {p}</li>
              ))}
            </ul>
          </Section>
        )}

        <Section title={`현장 사진 (${d.photos.length}장)`} testId="daily-photos">
          {d.photos.length ? (
            <div className="grid grid-cols-2 gap-2 @min-[620px]:grid-cols-3">
              {d.photos.slice(0, 9).map((p) => (
                <figure key={p.id} className="break-inside-avoid">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.dataUrl} alt={p.caption || "현장 사진"} className="aspect-[4/3] w-full rounded-lg border border-line object-cover" />
                  {p.caption && <figcaption className="mt-0.5 text-[0.74rem] text-ink-3">{p.caption}</figcaption>}
                </figure>
              ))}
            </div>
          ) : (
            <Empty text="사진 없음" />
          )}
          {d.photos.length > 9 && <p className="mt-1 text-[0.76rem] text-ink-3">외 {d.photos.length - 9}장은 현장 상세 화면에서 볼 수 있습니다.</p>}
        </Section>

        <table className="mt-6 w-full border-collapse break-inside-avoid">
          <tbody>
            <tr>
              <th className={cx(th, "w-1/4 text-center")}>현장대리인</th>
              <td className={cx(td, "h-12 w-1/4")} />
              <th className={cx(th, "w-1/4 text-center")}>확인</th>
              <td className={cx(td, "h-12 w-1/4")} />
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-[0.72rem] text-ink-3">
          {IS_LIVE ? "" : "DEMO · 가상 시연 데이터 — "}TAEKANG SITE INTELLIGENCE 자동 작성 — 현장 보고·작업 인원·출퇴근·작업지시 기록 기준. 날씨·서명은 직접 기입.
        </p>
      </Doc>
    </>
  );
}

function WeekDoc({ w, today }: { w: WeeklyLog; today: string }) {
  return (
    <Doc testId="weekly-doc">
      <h2 className="text-center text-[1.4rem] font-extrabold tracking-[0.15em]">주간 공정 보고</h2>
      <p className="mt-1 text-center text-[0.9rem] text-ink-2">
        {w.site.name} · <span className="num">{fmtDate(w.from)} ({weekdayOf(w.from)}) ~ {fmtDate(w.to)} ({weekdayOf(w.to)})</span>
      </p>
      <p className="mt-2 text-center text-[0.84rem] text-ink-3" data-testid="weekly-summary">
        현장 보고 {w.reportDays}일 · 작업 인원 연 {w.crewTotal}명 · 현재 공정률 {w.site.progressPct}%
      </p>
      <Section title="일별 현황" testId="weekly-days">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={cx(th, "w-24")}>날짜</th>
              <th className={cx(th, "w-20 whitespace-nowrap text-right")}>작업 인원</th>
              <th className={cx(th, "w-14 text-right")}>직원</th>
              <th className={cx(th, "w-14 text-right")}>사진</th>
              <th className={th}>주요 작업</th>
            </tr>
          </thead>
          <tbody>
            {w.days.map((d) => (
              <tr key={d.date} className={d.weekday === "일" || d.date > today ? "text-ink-3" : ""} data-future={d.date > today ? "1" : "0"}>
                <td className={cx(td, "num")}>
                  {d.date.slice(5).replace("-", "/")} ({d.weekday})
                </td>
                <td className={cx(td, "num text-right")}>{d.crewTotal || "—"}</td>
                <td className={cx(td, "num text-right")}>{d.staff || "—"}</td>
                <td className={cx(td, "num text-right")}>{d.photos || "—"}</td>
                <td className={td}>{d.date > today ? <span className="text-ink-3">예정</span> : d.work || (d.reports ? "" : <span className="text-ink-3">보고 없음</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="공정 진척 (이번 주 보고 기준)" testId="weekly-stages">
        {w.stages.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-[0.9rem]">
            {w.stages.map((s) => (
              <li key={s.name}>
                {s.name}: {s.from}% → <b>{s.to}%</b>
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="이번 주 보고된 공정 변화 없음" />
        )}
      </Section>
      <Section title="특이사항·문제">
        {w.issues.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-[0.9rem]">
            {w.issues.map((x, i) => (
              <li key={i}>
                <span className="num text-ink-3">{x.date.slice(5).replace("-", "/")}</span> {x.text}
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="없음" />
        )}
      </Section>
      <Section title="진행 중인 본사 지시">
        {w.openOrders.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-[0.9rem]">
            {w.openOrders.map((o, i) => (
              <li key={i}>
                {o.title} — {WO_STATUS[o.status] ?? o.status}
                {o.dueDate ? ` · 기한 ${o.dueDate.slice(5).replace("-", "/")}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="없음" />
        )}
      </Section>
      <Section title="다음 주 예정 공정" testId="weekly-next">
        {w.nextStages.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-[0.9rem]">
            {w.nextStages.map((s) => (
              <li key={s.name}>
                {s.name} <span className="num text-ink-3">({s.startDate.slice(5).replace("-", "/")} ~ {s.endDate.slice(5).replace("-", "/")}, 현재 {s.progressPct}%)</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="등록된 공정 단계 기준 예정 없음" />
        )}
      </Section>
      <p className="mt-5 text-[0.72rem] text-ink-3">{IS_LIVE ? "" : "DEMO · 가상 시연 데이터 — "}TAEKANG SITE INTELLIGENCE 자동 작성 — 금액 정보 없음. 발주처 제출 전 내용을 확인하세요.</p>
    </Doc>
  );
}
