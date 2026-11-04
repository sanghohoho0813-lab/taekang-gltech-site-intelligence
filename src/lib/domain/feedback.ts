/**
 * 현장 의견·앱 오류 기록 (계약 4단계 ‘피드백 반영·오류 0건’ 근거 · D-47) — 순수 함수
 * - 의견: 현장이 누르기만으로 보냄 → 본사가 ‘반영함/보류’ + 답변 → 보낸 사람 휴대폰에 결과
 * - 오류: 화면 오류·서버 오류를 자동 기록 (운영 모드). 개인정보·값은 지우고 남긴다.
 */

export const FEEDBACK_CATEGORIES = ["small_text", "hard_to_find", "location", "photo", "slow", "error", "idea", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const FEEDBACK_LABEL: Record<FeedbackCategory, string> = {
  small_text: "글씨가 작아요",
  hard_to_find: "버튼을 찾기 어려워요",
  location: "위치가 잘 안 잡혀요",
  photo: "사진이 잘 안 올라가요",
  slow: "느려요",
  error: "오류가 났어요",
  idea: "이런 기능이 있으면 좋겠어요",
  other: "기타",
};

export type FeedbackStatus = "new" | "done" | "hold";
export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = { new: "확인 전", done: "반영함", hold: "보류" };

export interface Feedback {
  id: string;
  at: string;
  userId: string;
  category: FeedbackCategory;
  text: string;
  /** 보낸 화면 (주소만) */
  route?: string;
  status: FeedbackStatus;
  reply?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface ErrorEntry {
  id: string;
  at: string;
  lastAt: string;
  count: number;
  source: "client" | "server";
  userId: string;
  role: string;
  route: string;
  message: string;
  stack?: string;
  browser?: string;
}

/** 오류 문구에서 개인정보·값을 지운다 (이메일·전화·금액 같은 긴 숫자·토큰·데이터·주소 뒤 검색어) */
export function scrubText(s: unknown, max: number): string {
  // 긴 입력에서 정규식이 오래 걸리지 않도록 먼저 넉넉히 자른다 (리뷰 반영 D-49)
  return String(s ?? "")
    .slice(0, max * 4)
    .replace(/data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+/g, "[데이터]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[이메일]")
    .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, "$1")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[값]")
    .replace(/\d[\d,.-]{5,}\d/g, "[숫자]")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .slice(0, max);
}

/** 화면 주소: 경로만, 긴 번호는 지움 */
export function scrubRoute(s: unknown): string {
  const path = String(s ?? "").split(/[?#]/)[0];
  return (/^\/[\w\-/%.가-힣]*$/.test(path) ? path : "/").replace(/\/[\w-]{20,}/g, "/[id]").slice(0, 80);
}

/** 기간 요약 (오류·의견 화면, 4단계 검수 자료) */
export function qualitySummary(feedback: Feedback[], errors: ErrorEntry[], from: string, to: string) {
  const inRange = (iso: string) => {
    const d = kst(iso);
    return d >= from && d <= to;
  };
  const fb = feedback.filter((f) => inRange(f.at));
  const er = errors.filter((e) => inRange(e.lastAt) || inRange(e.at));
  const days = new Set(er.map((e) => kst(e.lastAt)));
  return {
    feedback: { total: fb.length, done: fb.filter((f) => f.status === "done").length, hold: fb.filter((f) => f.status === "hold").length, open: fb.filter((f) => f.status === "new").length },
    errors: {
      total: er.reduce((a, e) => a + e.count, 0),
      kinds: er.length,
      client: er.filter((e) => e.source === "client").reduce((a, e) => a + e.count, 0),
      server: er.filter((e) => e.source === "server").reduce((a, e) => a + e.count, 0),
      errorDays: days.size,
    },
  };
}

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
