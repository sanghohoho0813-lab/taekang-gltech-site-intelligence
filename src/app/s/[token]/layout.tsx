import type { Metadata } from "next";
import { headers } from "next/headers";
import { IS_LIVE } from "@/lib/mode";

/**
 * 보고서 링크 (D-73) — 카카오톡·문자 미리보기.
 * - 내부 시스템 이름·설명·홈 화면 앱 정보 대신 ‘누가 보낸 무엇인지’만 보인다: 보낸 회사 이름 + ‘공정 보고서 (읽기 전용)’.
 *   보낸 곳이 없으면 광고 문자처럼 보여 누르지 않는다 (점검 9차). 현장 이름·공정률 같은 보고서 내용은 미리보기에 넣지 않는다.
 * - 없는 주소·기한 지난 주소·닫힌 주소는 회사 이름 없이 중립 문구만.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  let sender: string | null = null;
  if (IS_LIVE) {
    try {
      const { token } = await params;
      const h = await headers();
      const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim() || "local";
      const { shareSender } = await import("@/server/shareService");
      sender = await shareSender(token, ip);
    } catch {
      // 미리보기 문구를 못 만들어도 화면은 열려야 한다
    }
  }
  const title = sender ? `${sender} 공정 보고서 (읽기 전용)` : "공정 보고서 (읽기 전용)";
  const description = sender ? `${sender}에서 보낸 읽기 전용 공정 보고서입니다. 로그인 없이 바로 볼 수 있습니다.` : "보낸 곳에서 공유한 읽기 전용 보고서입니다. 로그인 없이 볼 수 있습니다.";
  return {
    title,
    description,
    openGraph: { title, description, type: "article", locale: "ko_KR" },
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
    // 받는 사람 화면은 ‘홈 화면에 추가’ 대상이 아니다 (내부 앱 이름이 보이지 않게)
    manifest: null,
    appleWebApp: { capable: false, title },
  };
}

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
