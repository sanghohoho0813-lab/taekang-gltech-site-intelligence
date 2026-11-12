import type { Metadata } from "next";
import { IS_LIVE } from "@/lib/mode";

/**
 * 하자 접수 화면의 주소 미리보기 (카카오톡·문자) — ‘하자 접수 · 회사 이름’.
 * 보낸 곳이 없으면 광고 문자처럼 보여 누르지 않는다 (점검 10차). 건물 이름·접수 내용은 미리보기에 넣지 않는다.
 * 없는 주소·닫힌 주소는 회사 이름 없이 중립 문구만.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  let company: string | null = null;
  if (IS_LIVE) {
    try {
      const { token } = await params;
      const { openIntake } = await import("@/server/intakeService");
      const r = await openIntake(decodeURIComponent(token).slice(0, 22));
      if (r.ok) company = r.view.company;
    } catch {
      // 미리보기 문구를 못 만들어도 화면은 열려야 한다
    }
  }
  const title = company ? `하자 접수 · ${company}` : "하자 접수";
  const description = company ? `${company}에 하자를 접수하는 화면입니다. 로그인 없이 바로 쓸 수 있습니다.` : "시공사에 하자를 접수하는 화면입니다. 로그인 없이 쓸 수 있습니다.";
  return {
    title,
    description,
    openGraph: { title, description, type: "website", locale: "ko_KR", ...(company ? { siteName: company } : {}) },
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
    manifest: null,
    appleWebApp: { capable: false, title: "하자 접수" },
  };
}

export default function IntakeFormLayout({ children }: { children: React.ReactNode }) {
  return children;
}
