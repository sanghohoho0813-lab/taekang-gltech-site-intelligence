import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { PREFS_BOOT_SCRIPT } from "@/lib/data/keys";
import { themeCss, DEFAULT_THEME } from "@/lib/theme/themes";

export const metadata: Metadata = {
  title: "TAEKANG SITE INTELLIGENCE · 태강지엘텍 현장 수익·공정관리 AX (DEMO)",
  description: "AI 기반 창호·유리 공사 현장 수익·공정관리 플랫폼 — 시연용 MVP. 모든 수치는 가상 시연 데이터입니다.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
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
        <style dangerouslySetInnerHTML={{ __html: themeCss() + `\n@media (min-width:1024px){html:not([data-frame="1"]){--demo-bar-h:2.45rem}}` }} />
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
