"use client";

import Link from "next/link";

/** 대표·관리자 — 사용 현황 (계약 4단계 ‘실사용 검증’): 현장 직원 정착도 + 본사 응답 시간 */
import { MetricTile } from "@/components/domain/Widgets";
import { useState } from "react";
import { Download } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { shiftDate } from "@/lib/domain/attendance";
import { fmtDate, fmtRelative, todayIso } from "@/lib/domain/format";
import { ADOPTION_LABEL, fmtHours, usageSummary, type Adoption, type FieldUsage } from "@/lib/domain/usage";
import { DEVICE_CHECK_LABEL, VERDICT_LABEL, deviceVerdict, type DeviceCheck, type DeviceCheckKey } from "@/lib/domain/device";
import { downloadCsv } from "@/lib/browser/download";
import { toCsv } from "@/lib/domain/csv";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Notice, PageSkeleton, Segmented, cx } from "@/components/ui/primitives";

const TONE: Record<Adoption, "ok" | "warn" | "err"> = { settled: "ok", partial: "warn", none: "err" };
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export function UsageBoard() {
  const { db } = useMe();
  const [days, setDays] = useState<"14" | "30">("14");
  if (!db) return <PageSkeleton />;
  const to = todayIso();
  const from = shiftDate(to, -(Number(days) - 1));
  const u = usageSummary(db, from, to, new Date());
  const avgAttend = (() => {
    const xs = u.field.map((f) => f.attendRate).filter((x): x is number => x !== null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  })();
  const overdue = u.response.reduce((a, r) => a + r.overdue, 0);
  const report = u.response.find((r) => r.key === "report")!;
  const csv = () => {
    const head = ["이름", "직함", "상태", "집계 시작", "작업일(월~토)", "출근 기록일", "출근 기록률", "퇴근까지 찍은 날", "보고일", "보고율(출근일 중)", "보고 수", "사진 있는 보고", "작업 인원 보고일", "받은 작업지시", "끝낸 작업지시", "지시 확인까지(시간, 중앙값)", "근태 수정 요청", "마지막 기록", "확인할 점", "휴대폰 점검", "휴대폰 점검일", "휴대폰·브라우저"];
    const rows = u.field.map((f) => [f.user.name, f.user.title, ADOPTION_LABEL[f.status], f.since ?? "", f.workdays, f.attendDays, pct(f.attendRate), f.outDays, f.reportDays, pct(f.reportRate), f.reports, f.photoReports, f.crewDays, f.ordersAssigned, f.ordersDone, f.orderAckHours === null ? "" : Math.round(f.orderAckHours * 10) / 10, f.fixRequests, f.lastAt ?? "", f.notes.join(" / "), ...deviceCols(db.deviceChecks?.find((c) => c.userId === f.user.id))]);
    const resp = [[], ["본사 응답", "중앙값(시간)", "처리 건수", "미처리", "기준 초과 미처리", "기준(시간)"], ...u.response.map((r) => [r.label, r.medianHours === null ? "" : Math.round(r.medianHours * 10) / 10, r.n, r.open, r.overdue, r.targetHours])];
    downloadCsv(`사용현황_${from}_${to}.csv`, toCsv([[`기간 ${from} ~ ${to}`], head, ...rows, ...resp]));
  };
  return (
    <PageBody>
      <PageHeader
        title="사용 현황"
        desc="현장 직원이 실제로 쓰는지, 본사가 제때 답하는지 업무 기록(출퇴근·보고·작업 인원·지시)으로 봅니다. 시범 운영·최종 검수(실사용 검증)의 근거 자료입니다."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="기간"
              value={days}
              onChange={setDays}
              options={[
                { value: "14", label: "최근 14일", testId: "usage-14" },
                { value: "30", label: "최근 30일", testId: "usage-30" },
              ]}
            />
            <Button size="sm" icon={<Download size={15} />} onClick={csv} data-testid="usage-csv">
              CSV
            </Button>
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 @min-[900px]:grid-cols-4">
        <Tile label="정착한 현장 직원" value={`${u.settled} / ${u.field.length}명`} sub="출근 기록 80%↑ · 보고 60%↑" testId="usage-settled" />
        <Tile label="평균 출근 기록률" value={pct(avgAttend)} sub="월~토 작업일 기준" />
        <Tile label="현장 보고 확인까지" value={fmtHours(report.medianHours)} sub={`중앙값 · ${report.n}건 확인`} />
        <Link href="/orders" className="block rounded-2xl focus-visible:outline-2">
          <Tile label="기준 시간 넘긴 미처리" value={`${overdue}건`} sub="보고·근태 24시간, 고객 요청 48시간 · 눌러서 처리" tone={overdue ? "err" : undefined} testId="usage-overdue" />
        </Link>
      </div>

      <Card data-testid="usage-field">
        <CardHeader title="현장 직원별" sub={`${fmtDate(from)} ~ ${fmtDate(to)} · 그 사람의 첫 기록일부터 셉니다`} />
        {u.field.length === 0 ? (
          <EmptyState title="현장 직원 계정이 없습니다" />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {u.field.map((f) => (
              <FieldRow key={f.user.id} f={f} device={(db.deviceChecks ?? []).find((c) => c.userId === f.user.id)} />
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="usage-response">
        <CardHeader title="본사 응답 시간" sub="현장·고객이 보낸 것에 본사가 답하기까지 (중앙값)" />
        <ul className="grid gap-px border-t border-line bg-line @min-[900px]:grid-cols-4">
          {u.response.map((r) => (
            <li key={r.key} className="bg-surface px-5 py-3.5" data-testid="usage-resp" data-key={r.key}>
              <p className="text-[0.82rem] font-semibold text-ink-2">{r.label}</p>
              <p className={cx("num text-[1.3rem] font-extrabold", r.medianHours !== null && r.medianHours > r.targetHours ? "text-err" : "text-ink")}>{fmtHours(r.medianHours)}</p>
              <p className="text-[0.76rem] text-ink-3">
                기준 {r.targetHours}시간 · 처리 {r.n}건
                {r.open ? ` · 미처리 ${r.open}건` : ""}
                {r.overdue ? <b className="text-err"> (기준 초과 {r.overdue})</b> : null}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Notice tone="info" title="판단 기준 (규칙 기반 · 사람 평가용 아님)">
        정착 = 출근 기록률 80% 이상이면서 출근한 날의 60% 이상 보고. 일부 사용 = 출근 기록 40% 이상이거나 보고·작업 인원 기록이 있음. 작업일은 월~토와 실제로 일한 일요일(공휴일 미반영)이고, 그 사람의 첫 기록일부터 셉니다. 숫자가 낮으면 사용 교육·휴대폰 설정부터 확인하세요. 로그인 기록이 아니라 실제로 남긴 업무 기록만 봅니다.
      </Notice>
    </PageBody>
  );
}

const deviceCols = (d?: DeviceCheck) => (d ? [VERDICT_LABEL[deviceVerdict(d)], d.at.slice(0, 10), `${d.platform === "ios" ? "아이폰" : d.platform === "android" ? "안드로이드" : "기타"} · ${d.browser}`] : ["안 함", "", ""]);

/** 휴대폰 점검 결과 (계약 2단계 ③ 실기기 확인 근거 · D-46) */
function DeviceLine({ device }: { device?: DeviceCheck }) {
  if (!device)
    return (
      <p className="mt-1.5 text-[0.8rem] text-ink-3" data-testid="usage-device" data-verdict="none">
        휴대폰 점검: 아직 안 함 — 현장 휴대폰 ‘내 정보 → 내 휴대폰 점검’
      </p>
    );
  const v = deviceVerdict(device);
  const bad = (Object.entries(device.items) as [DeviceCheckKey, string][]).filter(([, s]) => s === "fail" || s === "warn");
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.8rem] text-ink-2" data-testid="usage-device" data-verdict={v}>
      휴대폰 점검 <Badge tone={v === "ready" ? "ok" : v === "warn" ? "warn" : "err"}>{VERDICT_LABEL[v]}</Badge>
      <span className="text-ink-3">
        {device.browser} · {fmtRelative(device.at)}
      </span>
      {bad.map(([k, s]) => (
        <span key={k} className={cx("rounded-md px-1.5 py-0.5", s === "fail" ? "bg-err-bg" : "bg-warn-bg")}>
          {DEVICE_CHECK_LABEL[k]}
        </span>
      ))}
    </p>
  );
}

function FieldRow({ f, device }: { f: FieldUsage; device?: DeviceCheck }) {
  return (
    <li className="px-5 py-3.5" data-testid="usage-user" data-user={f.user.id} data-status={f.status}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[0.95rem] font-bold">
          {f.user.name} <span className="text-[0.8rem] font-semibold text-ink-3">{f.user.title}</span>
        </p>
        <Badge tone={TONE[f.status]}>{ADOPTION_LABEL[f.status]}</Badge>
        <span className="ml-auto text-[0.78rem] text-ink-3">{f.lastAt ? `마지막 기록 ${fmtRelative(f.lastAt)}` : "기록 없음"}</span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[0.82rem] @min-[760px]:grid-cols-5">
        <Kv k="출근 기록" v={`${f.attendDays}/${f.workdays}일 · ${pct(f.attendRate)}`} />
        <Kv k="퇴근까지" v={`${f.outDays}일`} />
        <Kv k="보고" v={`${f.reports}건 · 출근일 중 ${pct(f.reportRate)}`} />
        <Kv k="작업 인원 보고" v={`${f.crewDays}일`} />
        <Kv k="작업지시" v={f.ordersAssigned ? `${f.ordersDone}/${f.ordersAssigned} 끝냄 · 확인까지 ${fmtHours(f.orderAckHours)}` : "없음"} />
      </dl>
      <DeviceLine device={device} />
      {f.notes.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" data-testid="usage-notes">
          {f.notes.map((n) => (
            <li key={n} className="rounded-lg bg-warn-bg px-2 py-0.5 text-[0.76rem] text-ink-2">
              {n}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.72rem] text-ink-3">{k}</dt>
      <dd className="num font-semibold text-ink">{v}</dd>
    </div>
  );
}

function Tile({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: "err"; testId?: string }) {
  return <MetricTile label={label} value={value} sub={sub} tone={tone} testId={testId} />;
}
