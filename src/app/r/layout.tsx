import type { Metadata, Viewport } from "next";

/**
 * 하자 접수 링크 (D-74) — 접수 화면·진행 확인 화면. 주소 미리보기에 내부 시스템 이름·홈 화면 앱 정보가 나오지 않게 중립 문구만.
 * (접수 화면은 [token]/layout에서 보낸 회사 이름을 붙인다)
 */
export const metadata: Metadata = {
  title: "하자 접수",
  description: "시공사에 하자를 접수하고 보수 진행을 확인하는 화면입니다. 로그인 없이 쓸 수 있습니다.",
  openGraph: { title: "하자 접수", description: "시공사에 하자를 접수하고 보수 진행을 확인하는 화면입니다.", type: "website", locale: "ko_KR" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  manifest: null,
  appleWebApp: { capable: false, title: "하자 접수" },
};
/** 밝은 화면이라 주소창도 밝게 */
export const viewport: Viewport = { themeColor: "#F6F5F3" };

export default function IntakeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
