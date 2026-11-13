/**
 * LIVE 모드: 로그인 쿠키가 없으면 화면 요청을 /login 으로 보낸다 (낙관적 확인 — 실제 검증은 API가 DB로 한다).
 * DEMO 모드: 아무것도 하지 않는다.
 */
import { NextResponse, type NextRequest } from "next/server";

const LIVE = process.env.NEXT_PUBLIC_DATA_MODE === "live";
const PUBLIC = ["/login", "/setup"];
/** 로그인 없이 여는 화면 — 현장 QR 태블릿 (연결 코드·단말기 비밀값으로만 동작) */
const KIOSK = "/kiosk";

export default function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (!LIVE) {
    // 데모 빌드에는 로그인·설정 화면이 필요 없다
    if (PUBLIC.includes(pathname) || pathname === "/account") return NextResponse.redirect(new URL("/dashboard", req.url));
    return NextResponse.next();
  }
  // 보고서 링크(/s/비밀값, D-73) — 주소의 비밀값만으로 열리는 읽기 전용 화면 (내용은 /api/share가 비밀값을 확인하고 준다)
  // 하자 접수 링크(/r/비밀값 · /r/s/비밀값, D-74) — 접수 화면과 진행 확인 화면 (내용은 /api/intake가 확인하고 준다)
  if (PUBLIC.includes(pathname) || pathname === KIOSK || pathname === "/s" || pathname.startsWith("/s/") || pathname === "/r" || pathname.startsWith("/r/")) return NextResponse.next();
  if (!req.cookies.get("tk_session")?.value) {
    const url = new URL("/login", req.url);
    if (pathname !== "/" && pathname !== "/dashboard") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // API·정적 파일·아이콘은 제외 (API는 자체적으로 세션을 확인)
  matcher: ["/((?!api|_next/static|_next/image|icon.svg|favicon.ico|manifest.webmanifest|offline\\.html|.*\\.(?:png|jpg|svg|webp|ico|css|js|woff2?|webmanifest)$).*)"],
};
