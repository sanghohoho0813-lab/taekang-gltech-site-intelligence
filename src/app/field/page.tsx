"use client";

import { FieldHome } from "@/components/domain/FieldHome";
import { EasyHome } from "@/components/easy/EasyHome";
import { useRole } from "@/lib/data/store";

/** 현장 직원 = 쉬운 화면 / 대표·관리자 = 대리 입력 화면 */
export default function FieldPage() {
  const role = useRole();
  return role === "field" ? <EasyHome /> : <FieldHome />;
}
