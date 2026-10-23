"use client";

import Link from "next/link";
import { useMe, useFinancials, useSignals, siteHealth, userLabel } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { DemoBadge, PageSkeleton, ProgressBar } from "@/components/ui/primitives";
import { Facade } from "@/components/domain/Facade";
import { HealthPill } from "@/components/domain/Widgets";
import { fmtDate, fmtEok, fmtPct } from "@/lib/domain/format";

export default function SitesPage() {
  const { db, canSeeMoney, role, userId } = useMe();
  const fin = useFinancials(db);
  const signals = useSignals(db);
  if (!db) return <PageSkeleton />;
  const sites = role === "field" ? db.sites.filter((s) => s.fieldUserId === userId) : db.sites;
  return (
    <PageBody>
      <PageHeader eyebrow="운영" title={role === "field" ? "내 현장" : "현장 관리"} desc="가상 현장 3곳 — 카드를 누르면 손익·원가·공정 상세로 이동합니다." right={<DemoBadge />} />
      <div className="grid gap-4 @min-[760px]:grid-cols-2 @min-[1080px]:grid-cols-3">
        {sites.map((s) => {
          const f = fin[s.id];
          return (
            <Link key={s.id} href={`/sites/${s.id}`} className="lift block overflow-hidden rounded-2xl border border-line bg-surface shadow-card" data-testid={`site-card-${s.id}`}>
              <Facade kind={s.illustration} className="h-36" />
              <div className="space-y-2.5 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.75rem] font-semibold text-ink-3">{s.code} · {s.workType}</span>
                  <HealthPill health={siteHealth(signals, s.id)} />
                </div>
                <p className="text-[1rem] font-bold leading-snug text-ink">{s.name}</p>
                <p className="text-[0.78rem] text-ink-3">{s.region} · {fmtDate(s.startDate)} ~ {fmtDate(s.endDate)} · 담당 {userLabel(db, s.fieldUserId)}</p>
                <div className="flex items-center gap-2">
                  <ProgressBar value={s.progressPct} label={`${s.shortName} 공정률`} />
                  <b className="text-[0.8rem] num">{s.progressPct}%</b>
                </div>
                {canSeeMoney && (
                  <dl className="grid grid-cols-3 gap-2 border-t border-line pt-2.5 text-center">
                    <div>
                      <dt className="text-[0.7rem] text-ink-3">조정 계약</dt>
                      <dd className="text-[0.88rem] font-bold num">{fmtEok(f.adjustedContract)}</dd>
                    </div>
                    <div>
                      <dt className="text-[0.7rem] text-ink-3">EAC</dt>
                      <dd className="text-[0.88rem] font-bold num">{fmtEok(f.eac)}</dd>
                    </div>
                    <div>
                      <dt className="text-[0.7rem] text-ink-3">이익률</dt>
                      <dd className="text-[0.88rem] font-bold num">{fmtPct(f.marginPct)}</dd>
                    </div>
                  </dl>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </PageBody>
  );
}
