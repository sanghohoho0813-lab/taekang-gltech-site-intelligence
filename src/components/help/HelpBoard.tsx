"use client";

/** 사용 안내 (계약 4단계 운영 매뉴얼) — 역할별 매뉴얼, 인쇄용. 현장 직원용은 큰 글씨 */
import { useState, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { manualsFor, type Manual, type ManualId } from "@/lib/help/manuals";
import { IS_LIVE } from "@/lib/mode";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Button, Card, Notice, PageSkeleton, Segmented, cx } from "@/components/ui/primitives";

const DEFAULT_FOR: Record<string, ManualId> = { field: "field", partner: "partner", ceo: "ceo", manager: "hq" };

/** ‘버튼 이름’을 눈에 띄게 */
function withLabels(text: string): ReactNode[] {
  return text.split(/(‘[^’]+’)/g).map((part, i) =>
    part.startsWith("‘") ? (
      <b key={i} className={cx("rounded-md bg-active-soft px-1 font-bold text-theme-ink [box-decoration-break:clone] print:bg-transparent print:px-0", part.length <= 14 && "whitespace-nowrap")}>
        {part}
      </b>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function HelpBoard() {
  const { db, role } = useMe();
  const list = manualsFor(role);
  const [id, setId] = useState<ManualId>(DEFAULT_FOR[role] ?? list[0].id);
  if (!db) return <PageSkeleton />;
  const cur = list.find((m) => m.id === id) ?? list[0];
  return (
    <PageBody>
      <PageHeader
        title="사용 안내"
        desc="화면에 보이는 버튼 이름 그대로 적은 운영 매뉴얼입니다. 인쇄해서 현장 사무실·차량에 두고 쓰세요."
        right={
          <Button icon={<Printer size={17} />} onClick={() => window.print()} className="no-print" data-testid="help-print">
            인쇄
          </Button>
        }
      />
      {!IS_LIVE && <Notice tone="info" className="no-print">실제 운영(로그인) 기준 안내입니다. 시연 화면에는 로그인·비밀번호 단계가 없습니다.</Notice>}
      {list.length > 1 && (
        <div className="no-print overflow-x-auto">
          <Segmented label="매뉴얼" value={cur.id} onChange={setId} options={list.map((m) => ({ value: m.id, label: m.title, testId: `help-tab-${m.id}` }))} />
        </div>
      )}
      <ManualView m={cur} />
    </PageBody>
  );
}

function ManualView({ m }: { m: Manual }) {
  return (
    <Card className={cx("px-5 py-5 @min-[760px]:px-8 print:border-0 print:shadow-none", m.large && "help-large")} data-testid="help-manual" data-manual={m.id}>
      <header className="border-b border-line pb-3">
        <p className="text-[0.8rem] font-semibold text-ink-3">TAEKANG SITE INTELLIGENCE · {m.audience}</p>
        <h2 className={cx("font-extrabold text-ink", m.large ? "text-[1.6rem]" : "text-[1.3rem]")}>{m.title}</h2>
      </header>
      <div className="mt-4 space-y-6">
        {m.sections.map((s) => (
          <section key={s.title} className="break-inside-avoid">
            <h3 className={cx("font-bold text-ink", m.large ? "text-[1.3rem]" : "text-[1.05rem]")}>{s.title}</h3>
            <ol className="mt-2 space-y-2.5">
              {s.steps.map((st, i) => (
                <li key={i} className="flex gap-3 break-inside-avoid">
                  <span className={cx("num grid shrink-0 place-items-center rounded-full bg-solid font-bold text-white print:border print:border-ink print:bg-transparent print:text-ink", m.large ? "size-9 text-[1.05rem]" : "size-7 text-[0.85rem]")}>{i + 1}</span>
                  <span className="min-w-0 break-keep [overflow-wrap:anywhere]">
                    <span className={cx("block font-semibold leading-relaxed text-ink", m.large ? "text-[1.18rem]" : "text-[0.95rem]")}>{withLabels(st.t)}</span>
                    {st.d && <span className={cx("mt-0.5 block leading-relaxed text-ink-2", m.large ? "text-[1.05rem]" : "text-[0.86rem]")}>{withLabels(st.d)}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      <p className="mt-6 border-t border-line pt-3 text-[0.78rem] text-ink-3">이 안내는 화면이 바뀌면 함께 고칩니다. 화면과 다르면 본사에 알려 주세요.</p>
    </Card>
  );
}
