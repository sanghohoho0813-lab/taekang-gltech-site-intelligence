import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";

/**
 * 주소가 ‘/s’까지만 남은 경우 (메신저가 뒤를 잘라 먹음) — 내부 로그인 화면으로 보내지 않고 받는 사람에게 할 일을 알려 준다 (D-73 점검 9차)
 */
export const metadata: Metadata = {
  title: "공정 보고서 (읽기 전용)",
  description: "보낸 곳에서 공유한 읽기 전용 보고서입니다. 로그인 없이 볼 수 있습니다.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  manifest: null,
};

export default function ShareRoot() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-[#F6F5F3] px-5 py-10" data-testid="share-page" data-state="notfound">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 text-center shadow-card">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-3 text-ink-2">
          <CircleAlert size={24} aria-hidden />
        </span>
        <h1 className="mt-4 text-[1.2rem] font-extrabold leading-snug" data-testid="share-gone-title">열 수 없는 주소입니다</h1>
        <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-2">주소가 끝까지 복사됐는지 확인해 주세요. 계속 열리지 않으면 보내 주신 분께 새 주소를 요청해 주세요.</p>
      </div>
    </main>
  );
}
