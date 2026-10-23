"use client";

import Link from "next/link";
import { useState } from "react";
import { BadgeCheck, ChevronDown, FileJson } from "lucide-react";
import { useMe, userLabel } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, Notice, PageSkeleton, cx } from "@/components/ui/primitives";
import { MethodChip } from "@/components/domain/Widgets";
import { confirmProofEvent } from "@/lib/data/commands";
import { dispatch } from "@/lib/data/store";
import { useToast } from "@/components/ui/Toast";
import { fmtDateTime } from "@/lib/domain/format";
import type { ProofEvent } from "@/lib/domain/types";

const KPIS = [
  { type: "COST", name: "원가 초과 인지 리드타임", unit: "일", point: "원가 발생일(cost_entries.date) → 위험 감지 → 조치 생성(actions.created_at)", why: "월말·준공 무렵에야 알던 원가 초과를 며칠 만에 아는지" },
  { type: "REVENUE", name: "설계변경 추가원가 → 청구 검토 전환율", unit: "%", point: "사유=설계변경 원가 합계 대비 change_orders 등록 금액", why: "받을 수 있는 돈을 놓치지 않는지" },
  { type: "SCALE", name: "본사 관리자 1인당 관리 현장 수 · 월 손익 집계 시간", unit: "곳 · 시간", point: "사용자·현장 수, 월말 보고 작성 소요시간 (도입 전 인터뷰로 측정)", why: "인원을 늘리지 않고 관리 현장을 늘릴 수 있는지" },
];

const WEEKS = [
  { w: "Week 0", t: "Baseline Lock", d: "현장 1~2곳 선정, 현재 원가 집계 방식·소요시간·설계변경 청구 이력 인터뷰, KPI 3종 측정값 확보" },
  { w: "Week 1~4", t: "Adoption · First Proof Events", d: "현장소장 모바일 보고 습관화(주 3회+), 실제 원가 이벤트 입력, 첫 위험 감지→조치 기록" },
  { w: "Week 5~8", t: "Business Lift", d: "청구 검토 전환·원가 초과 조기 인지 사례 누적, 위험 기준값을 회사 실정에 맞게 보정" },
  { w: "Week 9~12", t: "Enterprise Value · Judge Pack", d: "Before/After 비교, Proof Event 묶음, 표준 Workflow 문서화, 확장(다현장·발주처 포털) 판단" },
];

export default function EvidencePage() {
  const { db, role } = useMe();
  const toast = useToast();
  if (!db) return <PageSkeleton />;
  const isManager = role === "ceo" || role === "manager";

  return (
    <PageBody>
      <PageHeader
        eyebrow="AX·성과"
        title="실증 Evidence"
        desc="‘좋아 보이는 화면’이 아니라 실제 행동과 결과가 바뀌었는지를 기록합니다. Trigger → Decision → 사람 승인 → Action → Result → KPI 전후."
        right={<DemoBadge />}
      />
      <Notice tone="warn" title="아래 Proof Event는 시연 중 클릭으로 생성된 DEMO 기록입니다">
        data_source = DEMO_LOCAL · 실제 현장 실증 성과가 아니며, 개선율은 Baseline 확보 전까지 산출하지 않습니다 (Baseline not yet established).
      </Notice>

      <Card data-testid="proof-list">
        <CardHeader title={`Proof Event ${db.proofEvents.length}건`} sub="조치 완료 시 자동 생성 · 결과 확인(관리자) 후 확정" right={<MethodChip />} />
        {db.proofEvents.length === 0 ? (
          <EmptyState
            icon={<BadgeCheck size={30} />}
            title="아직 기록이 없습니다"
            desc="‘위험 분석·조치’에서 조치를 완료하면 이곳에 Proof Event가 남습니다."
            action={
              <Link href="/insights">
                <Button size="sm">위험 분석·조치로</Button>
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3 px-5 pb-5">
            {db.proofEvents.map((p) => (
              <ProofItem
                key={p.proof_event_id}
                p={p}
                site={db.sites.find((s) => s.id === p.site_id)?.shortName ?? ""}
                approver={userLabel(db, p.human_approval.by)}
                user={userLabel(db, p.user_id)}
                canConfirm={isManager}
                onConfirm={() => {
                  try {
                    dispatch((d, ctx) => confirmProofEvent(d, p.proof_event_id, ctx));
                    toast.push({ tone: "ok", title: "결과를 확인했습니다" });
                  } catch (e) {
                    toast.push({ tone: "err", title: e instanceof Error ? e.message : "실패" });
                  }
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Money KPI 3 · Baseline 상태" sub="실제 값이 없으면 목표를 지어내지 않습니다 (TARGET: DO NOT INVENT)" />
        <div className="grid gap-3 px-5 pb-5 @min-[900px]:grid-cols-3">
          {KPIS.map((k) => (
            <div key={k.type} className="rounded-2xl border border-line bg-surface-2 p-4">
              <Badge tone={k.type === "COST" ? "err" : k.type === "REVENUE" ? "ok" : "info"}>{k.type} KPI</Badge>
              <p className="mt-2 text-[0.95rem] font-bold">{k.name}</p>
              <p className="mt-1 text-[0.78rem] text-ink-2">{k.why}</p>
              <dl className="mt-3 space-y-1 text-[0.76rem]">
                <div>
                  <dt className="font-semibold text-ink-3">Baseline</dt>
                  <dd className="font-bold text-warn">REQUIRED / UNKNOWN — Baseline not yet established</dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink-3">측정 지점</dt>
                  <dd className="text-ink-2">{k.point}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink-3">목표</dt>
                  <dd className="text-ink-2">미설정 (Baseline 확보 후 협의)</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 @min-[1000px]:grid-cols-2">
        <Card>
          <CardHeader title="12주 실증 계획 (안)" sub="PILOT 전환 시 적용 — 현재 단계는 DEMO" />
          <ol className="relative mx-5 mb-5 border-l-2 border-line pl-5">
            {WEEKS.map((w, i) => (
              <li key={w.w} className="relative pb-4 last:pb-0">
                <span className={cx("absolute -left-[1.72rem] top-0.5 grid size-5 place-items-center rounded-full text-[0.62rem] font-bold text-white", i === 0 ? "bg-active" : "bg-ink-3")}>{i}</span>
                <p className="text-[0.78rem] font-bold text-theme-ink">{w.w}</p>
                <p className="text-[0.9rem] font-bold">{w.t}</p>
                <p className="text-[0.8rem] text-ink-2">{w.d}</p>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <CardHeader title="Release 전 5가지 질문 — 현재 정직한 답" />
          <ul className="space-y-2.5 px-5 pb-5 text-[0.84rem]">
            {[
              ["실제 누가 반복적으로 사용하는가?", "아직 없음 — 미팅 후 현장소장 1~2명 Pilot 대상 확인 필요"],
              ["도입 전과 비교해 무엇이 얼마나 바뀌었는가?", "측정 전 — Baseline 미확보 (Week 0 필요)"],
              ["변화가 AX Decision → Action 때문이라는 근거가 있는가?", "구조는 준비됨 — Proof Event에 신호·승인·조치·결과·시각 기록"],
              ["12개월 후 남는 자산은?", "현장별 원가 이벤트·사유·조치·결과 이력, 회사 고유 위험 기준 (가설)"],
              ["추가 자본 투입 시 더 빨리 커지는 것은?", "미확정 — 실증 결과와 확장(다현장·발주처 포털) 수요 확인 후 판단"],
            ].map(([q, a]) => (
              <li key={q} className="rounded-xl bg-surface-2 px-3 py-2.5">
                <p className="font-bold">{q}</p>
                <p className="text-ink-2">{a}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </PageBody>
  );
}

function ProofItem({ p, site, approver, user, canConfirm, onConfirm }: { p: ProofEvent; site: string; approver: string; user: string; canConfirm: boolean; onConfirm: () => void }) {
  const [raw, setRaw] = useState(false);
  return (
    <li className="rounded-2xl border border-line bg-surface p-4" data-testid="proof-item" data-status={p.status}>
      <div className="flex flex-wrap items-center gap-1.5 text-[0.74rem] text-ink-3">
        <Badge tone={p.status === "confirmed" ? "ok" : "warn"} icon={<BadgeCheck size={13} />}>
          {p.status === "confirmed" ? "결과 확인" : "확인 대기"}
        </Badge>
        <Badge tone="demo">DEMO_LOCAL</Badge>
        <b className="text-ink-2">{site}</b> · {fmtDateTime(p.created_at)}
        {typeof p.response_minutes === "number" && <span>· 감지→완료 {p.response_minutes}분 (시연 측정값)</span>}
      </div>
      <div className="mt-2 grid gap-2 @min-[900px]:grid-cols-[1fr_1fr]">
        <dl className="space-y-1.5 text-[0.82rem]">
          <Row k="Trigger" v={p.trigger} />
          <Row k="Decision" v={p.decision} />
          <Row k="Method" v={p.decision_method} />
          <Row k="사람 승인" v={`${approver} · ${fmtDateTime(p.human_approval.at)}`} />
          <Row k="Action" v={p.action} />
          <Row k="Result" v={p.result} />
          <Row k="기록자" v={user} />
        </dl>
        <div className="rounded-xl bg-surface-2 p-3 text-[0.8rem]">
          <p className="mb-1.5 font-bold">KPI 전 → 후 (조치 시점 vs 완료 시점)</p>
          <table className="w-full">
            <tbody>
              {Object.keys(p.kpi_before).map((k) => (
                <tr key={k} className="border-t border-line">
                  <td className="py-1 text-ink-3">{k}</td>
                  <td className="py-1 text-right num">{String(p.kpi_before[k])}</td>
                  <td className="py-1 text-center text-ink-3">→</td>
                  <td className="py-1 text-right font-bold num">{String(p.kpi_after[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[0.7rem] text-ink-3">승인 전 변경공사 금액은 이익에 포함되지 않으므로 이익률은 그대로일 수 있습니다.</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {p.status === "recorded" && canConfirm && (
          <Button size="sm" variant="cta" icon={<BadgeCheck size={15} />} onClick={onConfirm}>
            결과 확인
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<FileJson size={15} />} onClick={() => setRaw((v) => !v)} aria-expanded={raw}>
          원본 필드 {raw ? "접기" : "보기"} <ChevronDown size={14} className={cx("transition-transform", raw && "rotate-180")} />
        </Button>
      </div>
      {raw && <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-[#111418] p-3 text-[0.72rem] leading-relaxed text-[#E5E7EB] scroll-thin">{JSON.stringify(p, null, 2)}</pre>}
    </li>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2">
      <dt className="font-semibold text-ink-3">{k}</dt>
      <dd className="text-ink">{v}</dd>
    </div>
  );
}
