import type { CompanySettings } from "./types";

/**
 * ‘모르면 본사로 전화’에 쓸 번호 — 현장 문의 번호가 없으면 첫 설정에서 넣은 회사 대표 번호.
 * D-77에서 첫 설정의 전화번호를 필수로 했지만 대표 번호(publicPhone)로만 저장돼
 * 현장 첫 화면·로그인 쪽지·그림 안내는 여전히 빈칸이던 문제 (D-78 첫 달 리허설에서 발견).
 */
export function helpPhoneOf(s: Pick<CompanySettings, "helpPhone" | "publicPhone"> | undefined | null): string | undefined {
  return s?.helpPhone?.trim() || s?.publicPhone?.trim() || undefined;
}
