"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Lock, Menu, MoreHorizontal, X } from "lucide-react";
import { GROUPS, bottomNavFor, canAccess, homeFor, navFor } from "@/lib/nav";
import { useDb, usePrefs, useRole, currentUserId } from "@/lib/data/store";
import { ROLE_LABEL } from "@/lib/domain/labels";
import { NavIcon } from "@/components/ui/Icon";
import { Button, cx, DemoBadge, PageSkeleton } from "@/components/ui/primitives";
import { IS_LIVE } from "@/lib/mode";
import { Sidebar, GroupIcon, isActivePath } from "./Sidebar";
import { Clock } from "./Clock";
import { GlobalSearch, NotificationBell, UserMenu } from "./HeaderTools";
import { LogoMark } from "./Logo";

/** 내부(Business AX) Surface 셸. /partner는 별도 Customer Surface 셸을 사용한다. */
export function AppShell({ children, compactSidebar }: { children: ReactNode; compactSidebar: boolean }) {
  const pathname = usePathname();
  const isPartnerSurface = pathname === "/partner" || pathname.startsWith("/partner/");
  // 로그인·최초 설정 화면은 메뉴 없이
  if (isPartnerSurface || pathname === "/login" || pathname === "/setup" || pathname === "/account") return <>{children}</>;
  return (
    <div className="flex min-h-[calc(100dvh-var(--demo-bar-h))] w-full min-w-0">
      <Sidebar compact={compactSidebar} />
      <div className="@container/shell flex min-w-0 flex-1 flex-col">
        <DesktopHeader />
        <MobileHeader />
        <main id="main" className="@container min-w-0 flex-1 pb-[calc(5.4rem+env(safe-area-inset-bottom))] lg:pb-10">
          <SampleDataBanner />
          <AccessGate>{children}</AccessGate>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}

/** 운영(LIVE) 서버인데 '가상 현장으로 시작'한 회사 — 실제 데이터로 오해하지 않도록 모든 화면·인쇄물에 표시 */
export function SampleDataBanner() {
  const db = useDb();
  if (!IS_LIVE || !db?.settings?.sampleData) return null;
  return (
    <div role="note" className="border-b border-[#E7C66A] bg-[#FFF6DA] px-4 py-2 text-center text-[0.8rem] font-semibold text-[#6B4E00]" data-testid="sample-data-banner">
      DEMO · 가상 시연 데이터로 시작한 회사입니다 — 현장·금액·인물은 실제가 아닙니다
    </div>
  );
}

function DesktopHeader() {
  return (
    <header className="no-print sticky top-[var(--demo-bar-h)] z-30 hidden h-16 items-center gap-3 border-b border-line bg-surface/92 px-5 backdrop-blur lg:flex">
      <GlobalSearch className="w-full min-w-[11rem] max-w-[26rem]" />
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden text-[0.85rem] text-ink-2 @3xl/shell:inline">
          <Clock />
        </span>
        <span className="text-[0.78rem] text-ink-2 @3xl/shell:hidden">
          <Clock compact />
        </span>
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}

function MobileHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <header className="no-print sticky top-[var(--demo-bar-h)] z-30 flex h-[3.6rem] items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur pt-[env(safe-area-inset-top)] lg:hidden" data-testid="mobile-header">
        <button type="button" onClick={() => setOpen(true)} className="press grid size-11 place-items-center rounded-xl text-ink hover:bg-surface-3" aria-label="전체 메뉴 열기" data-testid="mobile-menu-button">
          <Menu size={23} />
        </button>
        <Link href="/dashboard" className="flex items-center gap-2 min-w-0" aria-label="홈">
          <LogoMark size={26} />
          <span className="truncate text-[0.85rem] font-extrabold tracking-[0.06em] text-ink">TAEKANG</span>
        </Link>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex flex-col items-end leading-tight">
            <DemoBadge compact />
            <span className="mt-0.5 text-[0.7rem] text-ink-3">
              <Clock compact />
            </span>
          </div>
          <NotificationBell />
        </div>
      </header>
      <MobileDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** 모바일 전체 메뉴 — PC Sidebar와 같은 Group·색 체계 */
export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const role = useRole();
  const pathname = usePathname();
  const db = useDb();
  const items = navFor(role);
  const user = db?.users.find((u) => u.id === currentUserId());
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("tk-scroll-lock");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("tk-scroll-lock");
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="전체 메뉴" data-testid="mobile-drawer">
      <button type="button" className="absolute inset-0 bg-black/45 anim-fade-up" onClick={onClose} aria-label="메뉴 닫기" />
      <div className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col bg-shell text-shell-text shadow-pop [animation:tk-fade-up_200ms_ease-out_both]">
        <div className="flex h-[3.6rem] items-center justify-between border-b border-shell-line px-4 pt-[env(safe-area-inset-top)]">
          <span className="flex items-center gap-2 font-extrabold tracking-[0.06em] text-shell-strong">
            <LogoMark size={24} /> TAEKANG GLTECH
          </span>
          <button type="button" onClick={onClose} className="press grid size-10 place-items-center rounded-xl hover:bg-shell-hover" aria-label="메뉴 닫기">
            <X size={21} />
          </button>
        </div>
        <div className="border-b border-shell-line px-4 py-3 text-[0.8rem]">
          <p className="font-bold text-shell-strong">{user ? `${user.name} ${user.title}` : ""}</p>
          <p className="text-shell-muted">{ROLE_LABEL[role]}{IS_LIVE ? "" : " · 권한 프리뷰 (설정에서 전환)"}</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
          {GROUPS.map((g) => {
            const list = items.filter((i) => i.group === g.id);
            if (!list.length) return null;
            return (
              <div key={g.id}>
                <p className="px-2.5 pb-1.5 text-[0.7rem] font-bold tracking-[0.14em] text-shell-muted">{g.label}</p>
                {list.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={cx("press flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-[0.95rem] font-semibold", active ? "bg-shell-active text-shell-strong" : "hover:bg-shell-hover")}
                    >
                      <GroupIcon item={item} active={active} />
                      <span className="min-w-0">
                        <span className="block">{item.label}</span>
                        <span className="block text-[0.72rem] font-medium text-shell-muted">{item.desc}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <p className="border-t border-shell-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[0.72rem] text-shell-muted">{IS_LIVE ? "운영 DB · 규칙 기반 진단" : "DEMO · 가상 시연 데이터 · 규칙 기반 진단"}</p>
      </div>
    </div>
  );
}

function BottomNav() {
  const role = useRole();
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const items = bottomNavFor(role);
  return (
    <>
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/97 backdrop-blur pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="하단 메뉴"
        data-testid="bottom-nav"
      >
        <ul className="mx-auto flex max-w-xl">
          {items.map((it) => {
            const active = isActivePath(pathname, it.href);
            return (
              <li key={it.href} className="flex-1">
                <Link
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  className={cx("press flex h-[3.9rem] flex-col items-center justify-center gap-0.5 text-[0.7rem] font-semibold", active ? "text-theme-ink" : "text-ink-3")}
                >
                  <span className={cx("grid h-7 w-12 place-items-center rounded-full transition-colors", active && "bg-active-soft")}>
                    <NavIcon name={it.icon} size={21} />
                  </span>
                  {it.label}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button type="button" onClick={() => setMore(true)} className="press flex h-[3.9rem] w-full flex-col items-center justify-center gap-0.5 text-[0.7rem] font-semibold text-ink-3" aria-haspopup="dialog" data-testid="bottom-more">
              <span className="grid h-7 w-12 place-items-center rounded-full">
                <MoreHorizontal size={21} />
              </span>
              더보기
            </button>
          </li>
        </ul>
      </nav>
      {/* 더보기 = 전체 메뉴 Drawer (단일 화면 이동 금지 — Navigation Semantics Gate) */}
      <MobileDrawer open={more} onClose={() => setMore(false)} />
    </>
  );
}

/** 권한 프리뷰 게이트 — 실제 보안이 아니라 역할별 화면 노출 제어 */
function AccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const role = useRole();
  const prefs = usePrefs();
  const router = useRouter();
  const db = useDb();
  // LIVE: 로그인 사용자를 확인하기 전에는 '권한 없음'을 띄우지 않는다
  if (IS_LIVE && !db) return <PageSkeleton />;
  if (canAccess(role, pathname)) return <>{children}</>;
  const home = homeFor(role);
  return (
    <div className="mx-auto max-w-xl px-5 py-16 text-center" data-testid="access-denied">
      <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-surface-3 text-ink-2">
        <Lock size={26} />
      </div>
      <h1 className="text-[1.3rem] font-bold">{ROLE_LABEL[role]} 역할에서는 볼 수 없는 화면입니다</h1>
      <p className="mt-2 text-[0.9rem] text-ink-3">
        {IS_LIVE
          ? "현장 손익·이익률·정산 정보는 대표자·본사관리자만 볼 수 있습니다. 필요한 권한은 관리자에게 요청하세요."
          : "권한 프리뷰(DEMO): 현장 손익·이익률·정산 정보는 대표자·본사관리자에게만 표시됩니다. 실제 운영(LIVE)에서는 서버에서 동일하게 차단됩니다."}
      </p>
      {prefs.mobilePersona !== "same" && prefs.deviceView === "dual" && (
        <p className="mt-2 text-[0.8rem] text-ink-3">PC+Mobile 시연 중 모바일 화면은 ‘{ROLE_LABEL[role]}’ 관점으로 표시됩니다.</p>
      )}
      <Button variant="cta" size="lg" className="mt-6" onClick={() => router.push(home)}>
        {ROLE_LABEL[role]} 화면으로 이동
      </Button>
    </div>
  );
}

export function PageHeader({ eyebrow, title, desc, right, className }: { eyebrow?: ReactNode; title: ReactNode; desc?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-3 @min-[760px]:flex-row @min-[760px]:items-end @min-[760px]:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-[0.82rem] font-semibold text-ink-3">{eyebrow}</p>}
        <h1 className="mt-0.5 text-[1.55rem] @min-[760px]:text-[1.85rem] font-extrabold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
        {desc && <p className="mt-1.5 max-w-3xl text-[0.9rem] text-ink-3">{desc}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-[1680px] px-4 py-5 @min-[760px]:px-7 @min-[760px]:py-7 space-y-5 anim-fade-up", className)}>{children}</div>;
}
