"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GROUPS, navFor, type NavItem } from "@/lib/nav";
import { NavIcon } from "@/components/ui/Icon";
import { cx } from "@/components/ui/primitives";
import { Logo } from "./Logo";
import { useDb, useRole, usePrefs } from "@/lib/data/store";
import { THEMES } from "@/lib/theme/themes";
import { fmtTime } from "@/lib/domain/format";
import { computeSignals } from "@/lib/domain/risk";
import { useMemo } from "react";

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function GroupIcon({ item, active, size = 18 }: { item: Pick<NavItem, "icon" | "group">; active?: boolean; size?: number }) {
  const g = GROUPS.find((x) => x.id === item.group)!;
  return (
    <span
      className="grid size-[1.5rem] shrink-0 place-items-center rounded-lg transition-colors"
      style={{
        background: `color-mix(in srgb, ${g.color} ${active ? "30%" : "var(--t-icon-tint)"}, transparent)`,
        color: g.color,
      }}
      aria-hidden
    >
      <NavIcon name={item.icon} size={size} />
    </span>
  );
}

export function Sidebar({ compact }: { compact: boolean }) {
  const pathname = usePathname();
  const role = useRole();
  const db = useDb();
  const prefs = usePrefs();
  const items = navFor(role);
  const theme = THEMES.find((t) => t.id === prefs.theme);
  const openSignals = useMemo(() => (db ? computeSignals(db).length : 0), [db]);
  const newRequests = db?.partnerRequests.filter((r) => r.status === "received").length ?? 0;
  const myActions = db ? db.actions.filter((a) => a.assigneeUserId === "u-field" && ["assigned", "in_progress"].includes(a.status)).length : 0;

  const badgeFor = (href: string) => {
    if (href === "/insights" && openSignals + newRequests > 0) return openSignals + newRequests;
    if (href === "/my-actions" && role === "field" && myActions > 0) return myActions;
    return 0;
  };

  return (
    <aside
      className={cx(
        "hidden lg:flex shrink-0 flex-col bg-shell text-shell-text border-r border-shell-line",
        "sticky top-[var(--demo-bar-h)] h-[calc(100dvh-var(--demo-bar-h))]",
        compact ? "w-[4.6rem]" : "w-[14.2rem] 2xl:w-[15.2rem]",
      )}
      aria-label="주 메뉴"
      data-testid="sidebar"
    >
      <div className={cx("flex h-16 shrink-0 items-center border-b border-shell-line", compact ? "justify-center px-2" : "px-4")}>
        <Link href="/dashboard" className="press rounded-lg" aria-label="TAEKANG SITE INTELLIGENCE 홈">
          <Logo compact={compact} onDark={!theme?.shellLight} />
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto scroll-thin px-2.5 py-3 space-y-3">
        {GROUPS.map((g) => {
          const list = items.filter((i) => i.group === g.id);
          if (!list.length) return null;
          return (
            <div key={g.id}>
              {!compact ? (
                <p className="px-2.5 pb-1 text-[0.68rem] font-bold tracking-[0.14em] text-shell-muted">{g.label}</p>
              ) : (
                <div className="mx-3 mb-2 h-px bg-shell-line" aria-hidden />
              )}
              <ul className="space-y-0.5">
                {list.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  const badge = badgeFor(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={compact ? `${item.label} — ${item.desc}` : item.desc}
                        aria-current={active ? "page" : undefined}
                        data-testid={`nav-${item.href.slice(1)}`}
                        className={cx(
                          "press group relative flex items-center gap-2.5 rounded-xl py-[0.34rem] text-[0.86rem] font-semibold",
                          compact ? "justify-center px-1.5" : "px-2.5",
                          active ? "bg-shell-active text-shell-strong" : "text-shell-text hover:bg-shell-hover hover:text-shell-strong",
                        )}
                      >
                        {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-active" aria-hidden />}
                        <GroupIcon item={item} active={active} size={16} />
                        {!compact && <span className="truncate">{item.label}</span>}
                        {badge > 0 && (
                          <span
                            className={cx(
                              "num grid min-w-[1.25rem] h-5 place-items-center rounded-full bg-active px-1 text-[0.68rem] font-bold text-white",
                              compact ? "absolute -top-0.5 right-1" : "ml-auto",
                            )}
                            aria-label={`${badge}건`}
                          >
                            {badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      {!compact && (
        <div className="m-2.5 rounded-xl border border-shell-line bg-shell-card px-3 py-2.5 text-[0.7rem] leading-relaxed text-shell-muted" data-testid="data-freshness">
          <p><b className="text-shell-strong">DEMO</b> · 로컬 저장소 (운영 DB 아님)</p>
          <p>
            업데이트 <span className="num text-shell-text">{db ? fmtTime(db.updatedAt, true) : "—"}</span> · 규칙 기반 진단
          </p>
        </div>
      )}
    </aside>
  );
}
