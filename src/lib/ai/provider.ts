/**
 * AI 연결 지점 (READY · 현재 실제 호출 없음)
 *
 * 원칙 (전용 프롬프트 5절):
 * - 금액·이익률 계산은 결정론적 코드(calc.ts). LLM에 산술을 맡기지 않는다.
 * - 실제 AI는 대표 명시 승인 + API Key가 있을 때 '현장 위험요인 요약·우선조치 제안' 1개 기능만 서버 Route로 연결한다.
 * - 입력 범위: 현장 약칭, 위험 신호 제목·근거 수치, 현장보고 요약. 발주처 실명·개인정보·도면은 보내지 않는다.
 * - 타임아웃·오류 시 규칙 기반 결과를 그대로 보여준다. 실행은 사람이 승인(L3)한다.
 */
import type { RiskSignal } from "@/lib/domain/types";

export interface RiskSummaryInput {
  siteShortName: string;
  signals: Pick<RiskSignal, "title" | "why" | "severity" | "recommendation">[];
  recentReportSummaries: string[];
}

export interface RiskSummaryOutput {
  method: "RULE" | "LLM";
  headline: string;
  priorities: { action: string; reason: string }[];
}

export interface RiskSummaryProvider {
  readonly method: "RULE" | "LLM";
  summarize(input: RiskSummaryInput): Promise<RiskSummaryOutput>;
}

/** 현재 사용 중인 구현 — 규칙 기반 (외부 호출 없음) */
export const ruleBasedProvider: RiskSummaryProvider = {
  method: "RULE",
  async summarize(input) {
    const order = { high: 0, medium: 1, low: 2 } as const;
    const sorted = [...input.signals].sort((a, b) => order[a.severity] - order[b.severity]);
    return {
      method: "RULE",
      headline: sorted[0] ? `${input.siteShortName}: ${sorted[0].title}` : `${input.siteShortName}: 감지된 위험 없음`,
      priorities: sorted.slice(0, 3).map((s) => ({ action: s.recommendation.actionTitle, reason: s.why[0] ?? "" })),
    };
  },
};

/**
 * [NEXT] LLM 구현은 서버 전용 Route(예: src/app/api/ai/risk-summary/route.ts)에서만 만든다.
 * API Key는 서버 환경변수(ANTHROPIC_API_KEY)로만 읽고 클라이언트 번들에 노출하지 않는다.
 * 이 MVP에는 해당 Route가 없으며, 화면에는 '규칙 기반 진단'으로 표시된다.
 */
