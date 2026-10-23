"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Search, ChevronDown, UserRound, ShieldAlert, Handshake, ListChecks } from "lucide-react";
import { useDb, useRole, setPrefs, usePrefs, isFrameContext } from "@/lib/data/store";
import { computeSignals } from "@/lib/domain/risk";
import { ROLE_LABEL } from "@/lib/domain/labels";
import { ROLE_DEFAULT_USER } from "@/lib/data/seed";
import { cx, SeverityBadge } from "@/components/ui/primitives";
import { fmtRelative } from "@/lib/domain/format";
import type { RoleId } from "@/lib/domain/types";
import { canAccess, homeFor } from "@/lib/nav";

function useOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}

export function GlobalSearch({ className }: { className?: string }) {
  const db = useDb();
  const role = useRole();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useOutside(box, open, () => setOpen(false));

  const results = useMemo(() => {
    if (!db || !q.trim()) return [];
    const k = q.trim().toLowerCase();
    const out: { href: string; label: string; sub: string; kind: string }[] = [];
    for (const s of db.sites)
      if ([s.name, s.code, s.region, s.workType, s.clientName, s.shortName].some((x) => x.toLowerCase().includes(k)))
        out.push({ href: `/sites/${s.id}`, label: s.name, sub: `${s.code} · ${s.workType}`, kind: "현장" });
    if (role === "ceo" || role === "manager") {
      for (const a of db.actions)
        if (a.title.toLowerCase().includes(k)) out.push({ href: "/insights", label: a.title, sub: db.sites.find((s) => s.id === a.siteId)?.shortName ?? "", kind: "조치" });
      for (const r of db.partnerRequests)
        if (r.title.toLowerCase().includes(k)) out.push({ href: "/insights#requests", label: r.title, sub: "발주처 요청", kind: "요청" });
    }
    for (const r of db.reports)
      if (r.status === "submitted" && (r.workDone + r.issues).toLowerCase().includes(k))
        out.push({ href: `/sites/${r.siteId}`, label: r.workDone.slice(0, 40), sub: `현장보고 · ${r.reportDate}`, kind: "보고" });
    return out.filter((o) => canAccess(role, o.href.split("#")[0])).slice(0, 8);
  }, [db, q, role]);

  return (
    <div ref={box} className={cx("relative", className)}>
      <label className="relative block">
        <span className="sr-only">현장·조치·보고 검색</span>
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              router.push(results[0].href);
              setOpen(false);
              setQ("");
            }
          }}
          placeholder="현장명, 조치, 보고 내용 검색"
          className="h-11 w-full rounded-xl border border-line bg-surface-2 pl-10 pr-3 text-[0.88rem] text-ink placeholder:text-ink-3 focus:border-active focus:bg-surface focus:outline-none focus:ring-3 focus:ring-active/15"
          data-testid="global-search"
        />
      </label>
      {open && q.trim() && (
        <div className="anim-pop absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
          {results.length === 0 ? (
            <p className="px-4 py-4 text-[0.85rem] text-ink-3">‘{q}’ 검색 결과가 없습니다.</p>
          ) : (
            <ul className="py-1.5">
              {results.map((r, i) => (
                <li key={r.href + i}>
                  <Link
                    href={r.href}
                    onClick={() => {
                      setOpen(false);
                      setQ("");
                    }}
                    className="row-hover flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[0.7rem] font-bold text-ink-2">{r.kind}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.88rem] font-semibold text-ink">{r.label}</span>
                      <span className="block truncate text-[0.75rem] text-ink-3">{r.sub}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function NotificationBell() {
  const db = useDb();
  const role = useRole();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useOutside(box, open, () => setOpen(false));

  const items = useMemo(() => {
    if (!db) return [];
    const out: { href: string; title: string; sub: string; at: string; icon: React.ReactNode; sev?: "high" | "medium" | "low" }[] = [];
    if (role === "ceo" || role === "manager") {
      for (const s of computeSignals(db).slice(0, 6))
        out.push({ href: `/sites/${s.siteId}`, title: s.title, sub: s.summary, at: s.detectedAt, icon: <ShieldAlert size={16} />, sev: s.severity });
      for (const r of db.partnerRequests.filter((x) => x.status === "received"))
        out.push({ href: "/insights#requests", title: `발주처 요청: ${r.title}`, sub: "신규 접수 — 검토 필요", at: r.createdAt, icon: <Handshake size={16} /> });
    }
    if (role === "field") {
      for (const a of db.actions.filter((x) => x.assigneeUserId === ROLE_DEFAULT_USER.field && ["assigned", "in_progress"].includes(x.status)))
        out.push({ href: "/my-actions", title: `배정된 조치: ${a.title}`, sub: db.sites.find((s) => s.id === a.siteId)?.shortName ?? "", at: a.createdAt, icon: <ListChecks size={16} /> });
    }
    if (role === "partner") {
      for (const r of db.partnerRequests.filter((x) => x.partnerUserId === ROLE_DEFAULT_USER.partner && x.status !== "received"))
        out.push({ href: "/partner", title: `요청 처리: ${r.title}`, sub: r.status === "answered" ? "회신 완료" : "검토 중", at: r.updatedAt, icon: <Handshake size={16} /> });
    }
    return out;
  }, [db, role]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="press relative grid size-11 place-items-center rounded-xl text-ink-2 hover:bg-surface-3"
        aria-label={`알림 ${items.length}건`}
        aria-expanded={open}
        data-testid="notifications"
      >
        <Bell size={21} />
        {items.length > 0 && <span className="num absolute right-1.5 top-1.5 grid min-w-[1.1rem] h-[1.1rem] place-items-center rounded-full bg-solid px-1 text-[0.62rem] font-bold text-white">{items.length}</span>}
      </button>
      {open && (
        <div className="anim-pop absolute right-0 top-[calc(100%+6px)] z-40 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
          <p className="border-b border-line px-4 py-3 text-[0.9rem] font-bold">알림 <span className="text-ink-3 font-medium">· 규칙 기반 감지</span></p>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-[0.85rem] text-ink-3">새 알림이 없습니다.</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1 scroll-thin">
              {items.map((n, i) => (
                <li key={i}>
                  <Link href={n.href} onClick={() => setOpen(false)} className="row-hover flex gap-3 px-4 py-3">
                    <span className="mt-0.5 text-ink-3">{n.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        {n.sev && <SeverityBadge severity={n.sev} />}
                        <span className="text-[0.72rem] text-ink-3">{fmtRelative(n.at)}</span>
                      </span>
                      <span className="mt-1 block text-[0.86rem] font-semibold text-ink">{n.title}</span>
                      <span className="block text-[0.78rem] text-ink-3">{n.sub}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const ROLE_OPTIONS: RoleId[] = ["ceo", "manager", "field", "partner"];

export function UserMenu() {
  const db = useDb();
  const role = useRole();
  const prefs = usePrefs();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useOutside(box, open, () => setOpen(false));
  const user = db?.users.find((u) => u.id === ROLE_DEFAULT_USER[role]);
  const personaLocked = isFrameContext() && prefs.deviceView === "dual" && prefs.mobilePersona !== "same";

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="press flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-surface-3"
        aria-expanded={open}
        aria-label="사용자 메뉴 · 역할 전환"
        data-testid="user-menu"
      >
        <span className="grid size-9 place-items-center rounded-full bg-surface-3 text-ink-2">
          <UserRound size={19} />
        </span>
        <span className="hidden text-left leading-tight whitespace-nowrap @4xl/shell:block">
          <span className="block text-[0.82rem] font-bold text-ink">{user ? `${user.name} · ${user.title}` : "—"}</span>
          <span className="block text-[0.72rem] text-ink-3">{ROLE_LABEL[role]} · 권한 프리뷰</span>
        </span>
        <ChevronDown size={16} className="text-ink-3" />
      </button>
      {open && (
        <div className="anim-pop absolute right-0 top-[calc(100%+6px)] z-40 w-72 overflow-hidden rounded-2xl border border-line bg-surface p-2 shadow-pop">
          <p className="px-2.5 pb-2 pt-1.5 text-[0.75rem] text-ink-3">Demo 역할 전환 — 실제 로그인·보안이 아닌 <b>화면 권한 프리뷰</b>입니다.</p>
          {personaLocked && <p className="mx-2.5 mb-2 rounded-lg bg-warn-bg px-2 py-1.5 text-[0.72rem] text-warn">이 모바일 화면은 시연 역할로 고정되어 있습니다 (PC 화면에서 변경).</p>}
          {ROLE_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              disabled={personaLocked}
              onClick={() => {
                setPrefs({ role: r });
                setOpen(false);
                if (!canAccess(r, window.location.pathname)) router.push(homeFor(r));
              }}
              className={cx("press flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[0.88rem] font-semibold disabled:opacity-50", r === role ? "bg-active-soft text-theme-ink" : "hover:bg-surface-2")}
              data-testid={`role-${r}`}
            >
              {ROLE_LABEL[r]}
              <span className="text-[0.72rem] font-medium text-ink-3">{db?.users.find((u) => u.id === ROLE_DEFAULT_USER[r])?.name}</span>
            </button>
          ))}
          <div className="mt-1 border-t border-line pt-1">
            <Link href="/settings" onClick={() => setOpen(false)} className="row-hover block rounded-xl px-3 py-2.5 text-[0.85rem] font-semibold text-ink-2">
              설정 · 권한 매트릭스 보기
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

