import type { Metadata } from "next";

/** 진행 확인 화면 — 접수 화면과 구분되게 제목을 따로 (대화방·방문 기록에서 헷갈리지 않게). 접수 내용은 미리보기에 넣지 않는다 */
const title = "하자 접수 진행 확인";
const description = "접수한 하자의 보수 진행과 시공사 답변을 확인하는 화면입니다.";
export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", locale: "ko_KR" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  manifest: null,
  appleWebApp: { capable: false, title },
};

export default function IntakeStatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
