"use client";

/**
 * 앱 첫 주소(/) — 역할별 첫 화면으로 보낸다 (홈 화면 앱의 시작 주소도 /).
 * 예전에는 모두 /dashboard로 보내 발주처·현장 직원이 ‘권한 없음’을 먼저 봤다 (D-65 점검 반영).
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDb, useRole } from "@/lib/data/store";
import { homeFor } from "@/lib/nav";
import { IS_LIVE } from "@/lib/mode";
import { PageSkeleton } from "@/components/ui/primitives";

export default function Home() {
  const router = useRouter();
  const role = useRole();
  const db = useDb();
  useEffect(() => {
    if (IS_LIVE) {
      if (!db) return; // 로그인 사용자를 확인한 뒤에
      const me = db.users.find((u) => u.id === db.me);
      router.replace(homeFor(me?.role ?? role));
    } else router.replace(homeFor(role));
  }, [db, role, router]);
  return <PageSkeleton />;
}
