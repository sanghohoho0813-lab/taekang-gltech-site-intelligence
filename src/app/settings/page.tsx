"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Check, Download, Upload, RotateCcw, Presentation, GraduationCap, FileSpreadsheet, Database, Sparkles, ShieldCheck, Gauge } from "lucide-react";
import { dispatch, resetDemo, setPrefs, usePrefs, type FontScale } from "@/lib/data/store";
import { useMe } from "@/lib/data/hooks";
import { THEMES } from "@/lib/theme/themes";
import { PERMISSION_MATRIX, canAccess, homeFor } from "@/lib/nav";
import { ROLE_LABEL } from "@/lib/domain/labels";
import type { RiskThresholds, RoleId } from "@/lib/domain/types";
import { CSV_FIELD_GUIDE, sampleCsv, toCsv, validateCostCsv, type CsvValidation } from "@/lib/domain/csv";
import { importCostRows, setThresholds, CommandError } from "@/lib/data/commands";
import { fmtDateTime, fmtMan } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, DemoBadge, Field, Notice, PageSkeleton, Segmented, cx, inputCls } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { useTour } from "@/components/tour/Tour";
import { ResetDialog } from "@/components/device/DemoBar";
import { AiReadyButton } from "@/components/domain/Widgets";

function download(name: string, text: string) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SettingsPage() {
  const prefs = usePrefs();
  const { db, role } = useMe();
  const router = useRouter();
  const toast = useToast();
  const tour = useTour();
  const [reset, setReset] = useState(false);
  if (!db) return <PageSkeleton />;
  const isManager = role === "ceo" || role === "manager";

  return (
    <PageBody>
      <PageHeader eyebrow="관리" title="설정" desc="화면·권한 프리뷰·데모·데이터·AI 상태를 관리합니다. 모든 변경은 이 브라우저에만 저장됩니다." right={<DemoBadge />} />

      <Card data-tour="theme-picker" data-testid="theme-picker">
        <CardHeader title="화면 · 테마 (Canonical 7)" sub="테마는 메뉴·강조색·차트 분위기만 바꾸고 본문·표·폼의 가독성은 고정합니다 · PC와 모바일 화면이 같은 테마를 공유" />
        <div className="grid grid-cols-1 gap-3 px-5 pb-5 @min-[600px]:grid-cols-2 @min-[1080px]:grid-cols-4" role="radiogroup" aria-label="테마 선택">
          {THEMES.map((t) => {
            const on = prefs.theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPrefs({ theme: t.id })}
                className={cx("lift rounded-2xl border p-3 text-left", on ? "border-active ring-2 ring-active/30" : "border-line")}
                data-testid={`theme-${t.id}`}
              >
                <div className="flex h-14 overflow-hidden rounded-xl ring-1 ring-black/5" aria-hidden>
                  <span className="w-[34%]" style={{ background: t.core.shell }} />
                  {(["primary", "secondary", "accent", "highlight", "soft"] as const).map((k) => (
                    <span key={k} className="flex-1" style={{ background: t.core[k] }} />
                  ))}
                </div>
                <p className="mt-2 flex items-center justify-between text-[0.86rem] font-bold">
                  <span>
                    {t.no} {t.name}
                  </span>
                  {on && <Check size={17} className="text-theme-ink" />}
                </p>
                {t.note && <p className="text-[0.72rem] text-ink-3">{t.note}</p>}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="text-[0.86rem] font-semibold">글자 크기</span>
            <Segmented<FontScale>
              label="글자 크기"
              value={prefs.fontScale}
              onChange={(v) => setPrefs({ fontScale: v })}
              options={[
                { value: "sm", label: "작게", testId: "font-sm" },
                { value: "md", label: "기본", testId: "font-md" },
                { value: "lg", label: "크게", testId: "font-lg" },
              ]}
            />
          </div>
          <label className="flex items-center gap-2.5 text-[0.86rem] font-semibold">
            <input type="checkbox" className="size-4 accent-[var(--t-active)]" checked={prefs.reduceMotion} onChange={(e) => setPrefs({ reduceMotion: e.target.checked })} data-testid="reduce-motion" />
            모션 줄이기 (상태 표시는 유지)
          </label>
        </div>
      </Card>

      <Card>
        <CardHeader title="사용자 · 권한 프리뷰" sub="실제 로그인·보안이 아닙니다 — 역할별 화면 노출을 미리 보여주는 DEMO 기능입니다" right={<Badge tone="warn" icon={<ShieldCheck size={13} />}>RLS 미적용 (READY)</Badge>} />
        <div className="flex flex-wrap gap-2 px-5" role="radiogroup" aria-label="Demo 역할">
          {(["ceo", "manager", "field", "partner"] as RoleId[]).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={prefs.role === r}
              onClick={() => {
                setPrefs({ role: r });
                if (!canAccess(r, "/settings")) router.push(homeFor(r));
              }}
              className={cx("press rounded-xl border px-4 py-2.5 text-[0.88rem] font-bold", prefs.role === r ? "border-active bg-active-soft text-theme-ink" : "border-line bg-surface hover:bg-surface-2")}
              data-testid={`settings-role-${r}`}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <div className="mt-3 overflow-x-auto scroll-thin px-5 pb-5">
          <table className="w-full min-w-[40rem] text-[0.82rem]">
            <thead>
              <tr className="border-b border-line text-left text-[0.74rem] text-ink-3">
                <th className="py-2">기능</th>
                {(["ceo", "manager", "field", "partner"] as RoleId[]).map((r) => (
                  <th key={r} className={cx("py-2 text-center", prefs.role === r && "text-theme-ink")}>
                    {ROLE_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_MATRIX.map((row) => (
                <tr key={row.feature} className="border-b border-line">
                  <td className="py-2 font-semibold">{row.feature}</td>
                  {(["ceo", "manager", "field", "partner"] as const).map((r) => (
                    <td key={r} className={cx("py-2 text-center", prefs.role === r && "bg-active-soft font-bold")}>
                      {row[r]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="데모" sub="미팅 직전 초기화로 시나리오를 처음 상태로 되돌립니다" />
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          <Button variant="cta" icon={<RotateCcw size={17} />} onClick={() => setReset(true)} data-testid="settings-reset">
            데모 초기화
          </Button>
          <Button icon={<GraduationCap size={17} />} onClick={() => tour.start("tutorial")} data-testid="tutorial-replay">
            튜토리얼 다시 보기
          </Button>
          {isManager && (
            <Button icon={<Presentation size={17} />} onClick={() => router.push("/presentation")}>
              시연 모드
            </Button>
          )}
        </div>
        <p className="px-5 pb-5 text-[0.78rem] text-ink-3">데이터 시드 생성: {fmtDateTime(db.seededAt)} · 저장 버전 rev {db.rev}</p>
      </Card>

      {isManager && <DataSection />}

      <div className="grid gap-5 @min-[1000px]:grid-cols-2">
        <Card>
          <CardHeader title="AI 연결 상태" right={<AiReadyButton />} />
          <div className="space-y-2 px-5 pb-5 text-[0.85rem] text-ink-2">
            <p className="flex items-center gap-2">
              <Sparkles size={17} className="text-ink-3" /> <b>규칙 기반 진단 (RULE v1)</b> 사용 중 — 외부 AI API 미연결
            </p>
            <p>금액·이익률 계산과 위험 감지는 결정론적 코드입니다. AI를 연결하더라도 ‘현장 위험요인 요약·우선조치 제안’ 1개 기능만 서버 API로 연결하고, 결과 실행은 사람이 승인합니다.</p>
            <p className="text-[0.78rem] text-ink-3">연결 지점: <code className="rounded bg-surface-3 px-1">src/lib/ai/provider.ts</code> (인터페이스 준비 · 실제 호출 코드 없음)</p>
          </div>
        </Card>
        {isManager && <ThresholdCard thresholds={db.thresholds} />}
      </div>

      <ResetDialog
        open={reset}
        onClose={() => setReset(false)}
        onConfirm={() => {
          resetDemo();
          setReset(false);
          toast.push({ tone: "ok", title: "데모를 초기 상태로 되돌렸습니다" });
        }}
      />
    </PageBody>
  );
}

function DataSection() {
  const { db } = useMe();
  const toast = useToast();
  const [text, setText] = useState("");
  const [result, setResult] = useState<CsvValidation | null>(null);
  const [key, setKey] = useState(() => uid("idem"));
  const fileRef = useRef<HTMLInputElement>(null);
  if (!db) return null;
  const codes = db.sites.map((s) => s.code);

  const validate = (t: string) => {
    setText(t);
    setResult(t.trim() ? validateCostCsv(t, codes) : null);
  };

  return (
    <Card data-testid="data-section">
      <CardHeader title="데이터 · 실데이터 전환 경로" sub="Demo Seed → Repository Layer → CSV / Supabase 교체 지점" right={<Badge tone="demo">DEMO · 브라우저 로컬 저장소</Badge>} />
      <div className="grid gap-5 px-5 pb-5 @min-[1000px]:grid-cols-2">
        <div className="space-y-3">
          <p className="text-[0.9rem] font-bold">원가 CSV 가져오기</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Download size={15} />} onClick={() => download("taekang_cost_sample.csv", sampleCsv())} data-testid="csv-sample">
              샘플 내려받기
            </Button>
            <Button
              size="sm"
              icon={<FileSpreadsheet size={15} />}
              onClick={() =>
                download(
                  "taekang_cost_entries_export.csv",
                  toCsv([
                    ["site_code", "date", "category", "amount", "forecast_impact", "reason", "note", "status", "source"],
                    ...db.costEntries.map((e) => [db.sites.find((s) => s.id === e.siteId)?.code ?? "", e.date, e.category, e.amount, e.forecastImpact, e.reason, e.note, e.status, e.source]),
                  ]),
                )
              }
            >
              현재 원가 내보내기
            </Button>
            <Button size="sm" icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>
              파일 선택
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) validate(await f.text());
                e.target.value = "";
              }}
            />
          </div>
          <label htmlFor="csv-text" className="sr-only">
            CSV 붙여넣기
          </label>
          <textarea id="csv-text" rows={5} className={cx(inputCls, "font-mono text-[0.78rem]")} value={text} onChange={(e) => validate(e.target.value)} placeholder={sampleCsv()} data-testid="csv-input" />
          {result && (
            <div className="space-y-2" data-testid="csv-result">
              {result.errors.length > 0 ? (
                <Notice tone="err" title={`오류 ${result.errors.length}건 — 수정 후 다시 확인하세요`}>
                  <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-[0.78rem]">
                    {result.errors.slice(0, 30).map((e, i) => (
                      <li key={i}>
                        {e.line}행 · {e.field}: {e.message}
                      </li>
                    ))}
                  </ul>
                </Notice>
              ) : (
                <Notice tone="ok" title={`검증 통과 ${result.rows.length}행 · 합계 ${fmtMan(result.rows.reduce((s, r) => s + r.amount, 0))}`}>
                  가져오면 원가 이벤트(source=CSV)로 추가되고 손익이 즉시 재계산됩니다.
                </Notice>
              )}
              <Button
                variant="cta"
                size="sm"
                disabled={!result.rows.length || result.errors.length > 0}
                onClick={() => {
                  try {
                    const r = dispatch((d, ctx) => importCostRows(d, result.rows, key, ctx));
                    toast.push({ tone: "ok", title: `CSV 원가 ${r.count}건을 가져왔습니다`, desc: "현장 상세 > 원가 탭에서 확인·되돌리기 가능" });
                    setText("");
                    setResult(null);
                    setKey(uid("idem"));
                  } catch (e) {
                    toast.push({ tone: "err", title: e instanceof CommandError ? e.message : "가져오기 실패" });
                  }
                }}
                data-testid="csv-import"
              >
                가져오기
              </Button>
            </div>
          )}
          <details className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-[0.8rem]">
            <summary className="cursor-pointer font-bold">필드 구조 보기</summary>
            <table className="mt-2 w-full text-[0.76rem]">
              <tbody>
                {CSV_FIELD_GUIDE.map((f) => (
                  <tr key={f.name} className="border-t border-line align-top">
                    <td className="py-1 pr-2 font-mono font-bold">
                      {f.name}
                      {f.required && <span className="text-err">*</span>}
                    </td>
                    <td className="py-1 text-ink-2">
                      {f.desc}
                      <span className="block text-ink-3">예) {f.example}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-ink-3">현장코드: {codes.join(", ")}</p>
          </details>
        </div>
        <div className="space-y-3 text-[0.84rem]">
          <p className="text-[0.9rem] font-bold">실데이터 전환 경로</p>
          <ol className="space-y-2">
            {[
              ["지금", "DEMO Seed + 브라우저 로컬 Repository — 같은 브라우저의 PC·모바일 화면이 같은 데이터 공유", "LIVE"],
              ["다음", "CSV로 실제 현장 1곳의 원가·계약·기성 일부 반영 (실데이터 10~20%)", "READY"],
              ["전환", "Supabase 테이블·RLS·Auth 적용 (supabase/migrations 준비됨) → 기기 간 실시간 공유", "READY"],
              ["확장", "실제 AI API 1개 기능(위험요인 요약) — 대표 승인 후", "NEXT"],
            ].map(([k, v, st]) => (
              <li key={k} className="flex gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
                <Badge tone={st === "LIVE" ? "ok" : st === "READY" ? "info" : "neutral"}>{st}</Badge>
                <span>
                  <b>{k}</b> — {v}
                </span>
              </li>
            ))}
          </ol>
          <Notice tone="info" title="사용자 직접 작업 (USER ACTION QUEUE)">
            ① Supabase 프로젝트 생성 ② migrations 실행 ③ 환경변수 2개 등록 ④ Vercel 재배포 — 자세한 순서는 README의 ‘실데이터 전환’을 참고하세요.
          </Notice>
          <p className="flex items-center gap-1.5 text-[0.76rem] text-ink-3">
            <Database size={14} /> 저장 위치: 이 브라우저 localStorage · 운영 DB 연결 아님
          </p>
        </div>
      </div>
    </Card>
  );
}

function ThresholdCard({ thresholds }: { thresholds: RiskThresholds }) {
  const toast = useToast();
  const [t, setT] = useState(thresholds);
  const fields: { k: keyof RiskThresholds; label: string; unit: string }[] = [
    { k: "targetMarginPct", label: "목표 이익률", unit: "%" },
    { k: "marginDropPp", label: "이익률 하락 경고", unit: "%p" },
    { k: "overrunPct", label: "원가항목 예산 초과", unit: "%" },
    { k: "costProgressGapPp", label: "공정 대비 원가 차이", unit: "%p" },
    { k: "receivableDays", label: "장기 미수 기준", unit: "일" },
    { k: "changeOrderPendingDays", label: "변경공사 승인 대기", unit: "일" },
  ];
  return (
    <Card>
      <CardHeader title="위험 판단 기준 (DEMO 설정값)" sub="규칙 기반 진단의 기준 — 회사 실제 기준은 미팅 후 확정" right={<Gauge size={18} className="text-ink-3" />} />
      <div className="grid grid-cols-2 gap-3 px-5">
        {fields.map((f) => (
          <Field key={f.k} label={`${f.label} (${f.unit})`} htmlFor={`th-${f.k}`}>
            <input id={`th-${f.k}`} type="number" min={0} max={365} step={0.5} className={cx(inputCls, "num")} value={t[f.k]} onChange={(e) => setT({ ...t, [f.k]: Number(e.target.value) })} />
          </Field>
        ))}
      </div>
      <div className="flex justify-end gap-2 px-5 py-4">
        <Button onClick={() => setT(thresholds)}>되돌리기</Button>
        <Button
          variant="cta"
          onClick={() => {
            try {
              dispatch((d, ctx) => setThresholds(d, t, ctx));
              toast.push({ tone: "ok", title: "위험 판단 기준을 저장했습니다", desc: "모든 위험 신호가 새 기준으로 다시 계산됩니다." });
            } catch (e) {
              toast.push({ tone: "err", title: e instanceof Error ? e.message : "실패" });
            }
          }}
        >
          기준 저장
        </Button>
      </div>
    </Card>
  );
}
