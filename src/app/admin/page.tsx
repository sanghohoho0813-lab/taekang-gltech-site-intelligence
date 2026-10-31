"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMe } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { PageSkeleton, Segmented } from "@/components/ui/primitives";
import { SitesAdmin } from "@/components/admin/SitesAdmin";
import { MembersAdmin } from "@/components/admin/MembersAdmin";
import { ReviewAdmin } from "@/components/admin/ReviewAdmin";
import { SettingsAdmin } from "@/components/admin/SettingsAdmin";

type Tab = "sites" | "members" | "review" | "settings";

function AdminInner() {
  const { db, role, userId } = useMe();
  const initial = useSearchParams().get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(initial && ["sites", "members", "review", "settings"].includes(initial) ? initial : "sites");
  if (!db) return <PageSkeleton />;
  const pending = db.costEntries.filter((e) => e.status === "pending").length;
  return (
    <PageBody>
      <PageHeader eyebrow="관리" title="운영 관리" desc="현장 등록, 직원·발주처 계정, 현장 입력 원가 확인, 회사 운영 방식을 관리합니다." />
      <Segmented
        label="운영 관리 메뉴"
        value={tab}
        onChange={setTab}
        options={[
          { value: "sites", label: "현장", testId: "admin-tab-sites" },
          { value: "members", label: "사용자", testId: "admin-tab-members" },
          { value: "review", label: pending ? `공무 확인 ${pending}` : "공무 확인", testId: "admin-tab-review" },
          { value: "settings", label: "운영 설정", testId: "admin-tab-settings" },
        ]}
      />
      {tab === "sites" && <SitesAdmin db={db} />}
      {tab === "members" && <MembersAdmin db={db} me={{ id: userId, role }} />}
      {tab === "review" && <ReviewAdmin db={db} />}
      {tab === "settings" && <SettingsAdmin db={db} />}
    </PageBody>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminInner />
    </Suspense>
  );
}
