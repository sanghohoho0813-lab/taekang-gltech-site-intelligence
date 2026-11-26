import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { PREFS_BOOT_SCRIPT } from "@/lib/data/keys";
import { themeCss, DEFAULT_THEME } from "@/lib/theme/themes";
import { IS_LIVE } from "@/lib/mode";

export const metadata: Metadata = {
  title: IS_LIVE ? "TAEKANG SITE INTELLIGENCE · 현장 업무" : "TAEKANG SITE INTELLIGENCE · 태강지엘텍 현장 수익·공정관리 AX (DEMO)",
  description: IS_LIVE ? "창호·유리 공사 현장 업무 — (주)태강지엘텍 업무 시스템" : "창호·유리 공사 현장 수익·공정관리 시연판 (규칙 기반 진단, AI 아님). 모든 수치는 가상 시연 데이터입니다.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: IS_LIVE ? "태강 현장" : "태강 DEMO", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#15171C",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-theme={DEFAULT_THEME} data-font="md" data-motion="full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT_SCRIPT }} />
        {/* 시연(DEMO) PC 화면 맨 위 검은 조작 바의 높이만큼 상단 띠·메뉴를 내린다. 운영(LIVE)에는 그 바가 없으므로 0 —
            예전에는 운영에도 2.45rem이 적용돼 상단 띠가 본문 위쪽을 덮었다 (D-92 긴급 수정) */}
        <style dangerouslySetInnerHTML={{ __html: themeCss() + (IS_LIVE ? "" : `\n@media (min-width:1024px){html:not([data-frame="1"]){--demo-bar-h:2.45rem}}`) }} />
      </head>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">
          본문으로 건너뛰기
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
