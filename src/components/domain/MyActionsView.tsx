"use client";

import { useState } from "react";
import { ListChecks } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { DemoBadge, EmptyState, PageSkeleton, Segmented } from "@/components/ui/primitives";
import { ActionCard } from "./Actions";

/** /my-actions — 배정된 위험 조치 처리 (현장직원 역할의 /insights에서도 사용) */
export function MyActionsView() {
  const { db, role, userId, user } = useMe();
  const isManager = role === "ceo" || role === "manager";
  const [scope, setScope] = useState<"mine" | "all">(isManager ? "all" : "mine");
  const [status, setStatus] = useState<"open" | "done">("open");
  if (!db) return <PageSkeleton />;
  const list = db.actions
    .filter((a) => (scope === "mine" ? a.assigneeUserId === userId : !!a.assigneeUserId))
    .filter((a) => (status === "open" ? !["done", "dismissed"].includes(a.status) : a.status === "done"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <PageBody>
      <PageHeader
        eyebrow={<DemoBadge compact />}
        title="내 조치"
        desc={role === "field" ? `${user?.name} ${user?.title}님에게 배정된 위험 조치입니다. 진행 상황과 결과를 입력하면 본사 화면에 바로 반영됩니다.` : "담당자에게 배정된 조치 전체를 확인합니다."}
        right={
          <div className="flex flex-wrap gap-2">
            {isManager && (
              <Segmented
                label="범위"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "all", label: "배정 전체" },
                  { value: "mine", label: "내 담당" },
                ]}
              />
            )}
            <Segmented
              label="상태"
              value={status}
              onChange={setStatus}
              options={[
                { value: "open", label: "처리할 일" },
                { value: "done", label: "완료" },
              ]}
            />
          </div>
        }
      />
      {list.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState icon={<ListChecks size={30} />} title={status === "open" ? "처리할 조치가 없습니다." : "완료된 조치가 없습니다."} desc="본사에서 위험 조치를 배정하면 이곳에 즉시 표시됩니다." />
        </div>
      ) : (
        <div className="grid gap-4 @min-[900px]:grid-cols-2" data-testid="my-actions-list">
          {list.map((a) => (
            <ActionCard key={a.id} db={db} action={a} />
          ))}
        </div>
      )}
    </PageBody>
  );
}
