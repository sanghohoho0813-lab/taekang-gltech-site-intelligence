"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, MessageCircle, FileSpreadsheet, Phone, Smartphone, Database, ShieldAlert, UserCheck, BadgeCheck, FileBarChart, Handshake, Building2, Layers, Truck, Wrench } from "lucide-react";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, DemoBadge, cx } from "@/components/ui/primitives";
import { Facade } from "@/components/domain/Facade";

function Section({ no, title, children, company, className }: { no: string; title: string; children: ReactNode; company?: ReactNode; className?: string }) {
  return (
    <Card as="section" className={cx("p-5 @min-[760px]:p-7", className)} aria-labelledby={`s-${no}`}>
      <div className="flex items-start gap-4">
        <span className="num grid size-10 shrink-0 place-items-center rounded-xl bg-active-soft text-[0.9rem] font-extrabold text-theme-ink">{no}</span>
        <div className="min-w-0 flex-1 space-y-3">
          <h2 id={`s-${no}`} className="text-[1.2rem] font-extrabold leading-snug text-ink @min-[760px]:text-[1.35rem]">
            {title}
          </h2>
          <div className="space-y-3 text-[0.92rem] leading-relaxed text-ink-2">{children}</div>
          {company && (
            <div className="rounded-xl border-l-4 border-active bg-surface-2 px-4 py-3 text-[0.9rem] text-ink">
              <p className="mb-0.5 text-[0.75rem] font-bold text-theme-ink">태강지엘텍이라면</p>
              {company}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function Flow({ steps }: { steps: { icon: ReactNode; label: string; tone?: "bad" | "good" }[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          <span className={cx("inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[0.82rem] font-semibold", s.tone === "bad" ? "border-err/25 bg-err-bg text-ink" : s.tone === "good" ? "border-ok/25 bg-ok-bg text-ink" : "border-line bg-surface")}>
            {s.icon}
            {s.label}
          </span>
          {i < steps.length - 1 && <ArrowRight size={16} className="text-ink-3" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

export default function WhyAxPage() {
  return (
    <PageBody className="max-w-[1100px]">
      <PageHeader eyebrow={<span className="inline-flex items-center gap-2">기획의도 · Why AX <DemoBadge compact /></span>} title="현장이 돈을 버는지, 지금 바로 알 수 있게" desc="(주)태강지엘텍 맞춤 AX 기획의도 — 미팅 전 가설과 시연 시나리오를 바탕으로 작성했으며, 실제 현장 수·매출·실적은 미팅에서 확인할 내용입니다." />

      <Card className="overflow-hidden">
        <div className="grid @min-[760px]:grid-cols-3">
          {(["logistics", "office", "civic"] as const).map((k, i) => (
            <div key={k} className="relative">
              <Facade kind={k} className="h-40" label={i === 0} />
              <span className="absolute left-3 top-3 rounded-lg bg-black/60 px-2 py-1 text-[0.72rem] font-bold text-white">{["① 지금: 흩어진 정보", "② 바뀌는 방향: 한 번 입력", "③ 성장: 데이터가 쌓이는 회사"][i]}</span>
            </div>
          ))}
        </div>
      </Card>

      <Section no="01" title="회사의 현재 — 현장 단위로 돈이 움직이는 사업" company={<p>유리·창호·커튼월·금속구조물 시공은 현장마다 계약금액·실행예산·자재 발주·인력·공정·기성청구가 따로 움직입니다. 그래서 ‘회사 전체’보다 ‘현장 하나하나’의 손익이 먼저 보여야 합니다.</p>}>
        <p>시공업의 이익은 계약할 때 정해지지 않습니다. 공사가 끝날 때까지 들어가는 원가, 중간에 생기는 설계변경, 제때 받지 못한 기성금에 따라 최종 이익이 결정됩니다.</p>
        <p className="text-[0.8rem] text-ink-3">※ 이 화면의 현장 3곳·금액은 모두 가상 시연 데이터입니다.</p>
      </Section>

      <Section no="02" title="왜 지금 바꿔야 하는가" company={<p>현장이 늘어날수록 대표가 직접 전화로 확인해야 하는 정보가 늘어납니다. 자재 단가 변동과 발주처 요청에 따른 사양 변경이 잦은 공종일수록 ‘늦게 아는 비용’이 커집니다.</p>}>
        <ul className="list-disc space-y-1 pl-5">
          <li>현장 수·공종이 늘어나면 엑셀과 메신저만으로는 같은 기준의 손익을 유지하기 어렵습니다.</li>
          <li>원가 초과는 보통 월말 집계나 준공 정산 때 드러나, 그때는 대응할 시간이 없습니다.</li>
          <li>모바일로 현장 보고를 바로 남기는 것은 이미 현장 직원에게 익숙한 행동입니다.</li>
        </ul>
      </Section>

      <Section no="03" title="AX란 무엇인가 — 한 문장으로">
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-ink">
          회사의 일을 <b>하나의 데이터 흐름</b>으로 연결하고, 반복 계산은 시스템이 하며, 중요한 판단에는 <b>근거와 다음 행동</b>을 함께 보여주는 것입니다.
        </p>
        <p>AI를 많이 넣는 것이 목표가 아닙니다. 계산할 수 있는 것은 정확하게 계산하고, 사람이 놓치기 쉬운 것을 먼저 알려주는 것이 목표입니다.</p>
      </Section>

      <Section no="04" title="창호·커튼월 공사에서 특히 중요한 이유" company={<p>유리·프레임은 선발주·제작 기간이 길고, 원청·건축주 요청으로 사양(로이복층 → 삼중유리 등)이 바뀌면 자재비와 추가 인력이 함께 늘어납니다. 구두 지시만 받고 시공한 변경분을 서면 근거와 함께 ‘변경공사’로 정리하지 않으면 그대로 현장 이익에서 빠집니다.</p>}>
        <div className="grid gap-2 @min-[600px]:grid-cols-3">
          {[
            ["긴 공기", "착공~준공 사이 원가가 계속 바뀜"],
            ["설계변경", "추가 원가 발생 → 청구 근거 필요"],
            ["단계별 기성", "청구액과 입금액이 다르고 미수 발생"],
          ].map(([t, d]) => (
            <div key={t} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
              <p className="font-bold text-ink">{t}</p>
              <p className="text-[0.82rem]">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section no="05" title="현재 업무 흐름 (미팅 전 가설)">
        <Flow
          steps={[
            { icon: <Wrench size={15} />, label: "현장 작업·추가 비용" },
            { icon: <MessageCircle size={15} />, label: "카톡·문자 보고", tone: "bad" },
            { icon: <FileSpreadsheet size={15} />, label: "공무 엑셀 재입력", tone: "bad" },
            { icon: <Phone size={15} />, label: "본사 전화 확인", tone: "bad" },
            { icon: <UserCheck size={15} />, label: "월말 대표 보고" },
          ]}
        />
        <p className="text-[0.82rem] text-ink-3">실제 흐름은 미팅에서 확인 후 수정합니다.</p>
      </Section>

      <Section no="06" title="반복되는 문제 — 돈·시간·매출이 새는 곳">
        <div className="grid gap-2 @min-[760px]:grid-cols-3">
          {[
            ["돈이 새는 곳", "원가 초과를 늦게 인지 / 설계변경 추가원가 미청구 / 미수금 장기화", "err"],
            ["시간이 새는 곳", "같은 내용 재입력 / 전화로 현황 확인 / 월말 손익 수작업 집계", "warn"],
            ["판단이 늦는 곳", "대표가 ‘지금 무엇을 조치해야 하는지’를 바로 알기 어려움", "info"],
          ].map(([t, d, tone]) => (
            <div key={t} className={cx("rounded-xl px-3.5 py-3", tone === "err" ? "bg-err-bg" : tone === "warn" ? "bg-warn-bg" : "bg-info-bg")}>
              <p className="text-[0.78rem] font-extrabold tracking-wide text-ink">{t}</p>
              <p className="mt-1 text-[0.85rem] text-ink-2">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section no="07" title="지금까지 vs 바뀌는 방향">
        <div tabIndex={0} role="region" aria-label="지금까지 vs 바뀌는 방향 표 (가로 스크롤)" className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[0.86rem]">
            <thead>
              <tr className="border-b border-line text-left text-[0.76rem] text-ink-3">
                <th className="py-2">구분</th>
                <th className="py-2">지금까지 (가설)</th>
                <th className="py-2">TAEKANG SITE INTELLIGENCE</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["원가 입력", "현장 메시지 → 본사 재입력", "모바일 1회 입력 → 공통 데이터 저장"],
                ["손익 확인", "월말 엑셀 집계", "입력 즉시 EAC·예상이익·이익률 재계산"],
                ["위험 발견", "사람이 직접 비교", "규칙 기반으로 자동 감지 + 근거 표시"],
                ["조치", "구두 지시, 결과 추적 어려움", "담당자 배정 → 진행 → 완료 → 기록"],
                ["발주처 소통", "전화·메일", "포털 요청 → 요청함 → 회신 상태 공유"],
              ].map(([a, b, c]) => (
                <tr key={a} className="border-b border-line">
                  <td className="py-2 font-bold">{a}</td>
                  <td className="py-2 text-ink-3">{b}</td>
                  <td className="py-2 font-semibold text-ink">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section no="08" title="업무효율보다 중요한 것 — 이익을 지키는 구조 (시연 시나리오)" company={<p>시연의 A현장(가상)에서 4,000만 원 추가원가가 생기면 이익률은 15%에서 11%로 떨어집니다. 그 원인이 발주처 요청 설계변경이라면, 빨리 알고 근거를 남길수록 변경공사로 청구를 검토할 수 있습니다. 승인 전 금액은 이익에 넣지 않고 따로 보여줍니다.</p>}>
        <div className="grid gap-2 @min-[760px]:grid-cols-4">
          {[
            ["계약", "10억"],
            ["총예상원가 8.5억 → 8.9억", "+4,000만"],
            ["예상이익 1.5억 → 1.1억", "−4,000만"],
            ["이익률", "15% → 11%"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
              <p className="text-[0.75rem] text-ink-3">{k}</p>
              <p className="text-[1.15rem] font-extrabold num">{v}</p>
            </div>
          ))}
        </div>
        <p className="text-[0.8rem] text-ink-3">※ 가상 시연 수치입니다. 실제 효과 금액은 Baseline 확보 후에만 산출합니다.</p>
      </Section>

      <Section no="09" title="AI는 실제로 무엇을 하나 — 정직한 구분">
        <div tabIndex={0} role="region" aria-label="AI 역할 구분 표 (가로 스크롤)" className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[0.85rem]">
            <thead>
              <tr className="border-b border-line text-left text-[0.76rem] text-ink-3">
                <th className="py-2">기능</th>
                <th className="py-2">방식</th>
                <th className="py-2">현재 상태</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["EAC·예상이익·이익률 계산", "결정론적 코드", "LIVE (DEMO 데이터)"],
                ["이익률 하락·예산 초과·미수·미승인 감지", "규칙 기반 (RULE v1)", "LIVE (DEMO 데이터)"],
                ["설계변경 청구 검토 제안", "규칙 기반 + 사람 승인", "LIVE (DEMO 데이터)"],
                ["위험요인 자연어 요약", "LLM (1개 기능만)", "NEXT · 미연결"],
              ].map(([a, b, c]) => (
                <tr key={a} className="border-b border-line">
                  <td className="py-2 font-semibold">{a}</td>
                  <td className="py-2">{b}</td>
                  <td className="py-2">
                    <Badge tone={c.startsWith("NEXT") ? "neutral" : "ok"}>{c}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>숫자 계산은 AI에 맡기지 않습니다. AI가 연결되더라도 실행은 사람이 승인합니다.</p>
      </Section>

      <Section no="10" title="판단 → 실행 → 결과 → 기록 (Closed Loop)">
        <Flow
          steps={[
            { icon: <Smartphone size={15} />, label: "모바일 원가 입력", tone: "good" },
            { icon: <Database size={15} />, label: "공통 데이터" },
            { icon: <ShieldAlert size={15} />, label: "위험 감지" },
            { icon: <UserCheck size={15} />, label: "담당자 조치" },
            { icon: <BadgeCheck size={15} />, label: "Proof Event", tone: "good" },
            { icon: <FileBarChart size={15} />, label: "대표 보고서" },
          ]}
        />
        <p>‘추천을 보여주는 앱’이 아니라, 추천 → 사람의 결정 → 행동 → 결과가 시간과 함께 남는 시스템입니다. 이 기록이 나중에 실증 자료가 됩니다.</p>
      </Section>

      <Section no="11" title="데이터가 회사 자산이 되는 구조" company={<p>12개월 동안 현장별 원가 이벤트·사유·조치·결과가 쌓이면, 공종별 원가 편차, 설계변경이 자주 생기는 공정, 발주처별 승인 소요일 같은 ‘다음 견적과 계약에 쓸 수 있는 판단 근거’가 생깁니다 (가설 — 실제 데이터로 검증 필요).</p>}>
        <Flow
          steps={[
            { icon: <Wrench size={15} />, label: "업무 발생" },
            { icon: <Database size={15} />, label: "기록" },
            { icon: <Layers size={15} />, label: "축적·비교" },
            { icon: <ShieldAlert size={15} />, label: "패턴·기준" },
            { icon: <UserCheck size={15} />, label: "더 나은 판단" },
          ]}
        />
      </Section>

      <Section no="12" title="발주처·협력사와의 연결 — 작은 플랫폼부터">
        <p>발주처가 전화 없이 변경공사 검토를 요청하고, 본사가 검토·회신하면 포털 상태가 바뀝니다. 발주처에는 진행률과 승인된 정보만 보이고, 내부 원가·이익·미수금은 보이지 않습니다.</p>
        <Flow
          steps={[
            { icon: <Handshake size={15} />, label: "발주처 요청" },
            { icon: <Database size={15} />, label: "본사 요청함" },
            { icon: <UserCheck size={15} />, label: "검토·회신" },
            { icon: <Handshake size={15} />, label: "포털 상태 갱신", tone: "good" },
          ]}
        />
      </Section>

      <Section no="13" title="실증 전 / 후를 구분합니다">
        <div className="grid gap-2 @min-[760px]:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
            <Badge tone="demo">지금 · DEMO</Badge>
            <p className="mt-1.5">가상 현장 3곳으로 흐름과 계산 구조를 보여주는 단계. 성과 수치 없음.</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
            <Badge tone="info">다음 · PILOT 12주</Badge>
            <p className="mt-1.5">실제 현장 1~2곳 Baseline 확보 → 실사용 → Proof Event 누적 → 전후 비교.</p>
          </div>
        </div>
      </Section>

      <Section no="14" title="기술사업화·정책 관점 — 검토 관점일 뿐, 보장하지 않습니다">
        <p>실제 현장 데이터와 Proof Event가 쌓이면 ‘기존 업무가 어떻게 데이터·자동화·성과로 바뀌었는지’를 설명할 근거가 생깁니다. 다만 정책자금·보증·지원사업의 적합성과 결과는 각 기관의 독립적인 심사이며, 구체 제도는 최신 공고를 확인한 뒤 별도로 검토해야 합니다.</p>
      </Section>

      <Section no="15" title="향후 확장 (NEXT · 현재 미구현)">
        <div className="grid gap-2 @min-[600px]:grid-cols-2">
          {[
            [<Building2 key="b" size={16} />, "다현장 통합 관리", "현장 수가 늘어도 같은 기준으로 손익 비교"],
            [<Handshake key="h" size={16} />, "건축주 기성 확인 요청", "직발주 현장의 기성 내역·사진 공유"],
            [<Truck key="t" size={16} />, "협력사 자재 납품 일정", "유리·프레임 반입 일정 공유"],
            [<Wrench key="w" size={16} />, "하자보수 요청·이력", "준공 후 고객 관리"],
          ].map(([i, t, d]) => (
            <div key={String(t)} className="flex gap-3 rounded-xl border border-dashed border-line-strong px-3.5 py-3">
              <span className="mt-0.5 text-ink-3">{i}</span>
              <span>
                <b className="text-ink">{t}</b> <Badge tone="neutral">NEXT</Badge>
                <span className="block text-[0.82rem]">{d}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section no="16" title="정리 — 미팅에서 함께 확인할 것">
        <ol className="list-decimal space-y-1 pl-5">
          <li>현재 진행 중인 현장 수와 현장별 원가를 어디에·어떻게 관리하는지</li>
          <li>최근 1년간 설계변경 추가원가 중 청구하지 못한 사례가 있는지</li>
          <li>월말 손익 집계에 걸리는 시간과 담당자</li>
          <li>현장소장이 모바일로 보고할 수 있는 환경과 의지</li>
          <li>Pilot으로 시작할 현장 1~2곳</li>
        </ol>
        <div className="flex flex-wrap gap-2 pt-2">
          <Link href="/dashboard">
            <Button variant="cta" icon={<ArrowRight size={17} />}>대시보드로 돌아가기</Button>
          </Link>
          <Link href="/presentation">
            <Button>시연 모드</Button>
          </Link>
        </div>
      </Section>
    </PageBody>
  );
}
