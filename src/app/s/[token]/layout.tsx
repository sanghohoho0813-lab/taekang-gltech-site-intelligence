import type { Metadata } from "next";

/**
 * 보고서 링크 (D-73) — 카카오톡·문자 미리보기에 내부 시스템 이름·설명 대신 중립적인 제목만 보이게 한다.
 * 보고서 내용은 미리보기에 넣지 않는다 (주소를 받은 사람이 열었을 때만 화면이 불러온다).
 */
export const metadata: Metadata = {
  title: "공정 보고서 (읽기 전용)",
  description: "보낸 곳에서 공유한 읽기 전용 보고서입니다. 로그인 없이 볼 수 있습니다.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
