import type { MetadataRoute } from "next";
import { IS_LIVE } from "@/lib/mode";

/** 휴대폰 ‘홈 화면에 추가’ 시 앱처럼 열리도록 (주소창 없이, 태강 아이콘·이름) */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: IS_LIVE ? "TAEKANG 현장" : "TAEKANG 현장 (DEMO)",
    short_name: IS_LIVE ? "태강 현장" : "태강 DEMO",
    description: "태강지엘텍 현장 출퇴근·보고·본사 소통",
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#15171C",
    theme_color: "#15171C",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
