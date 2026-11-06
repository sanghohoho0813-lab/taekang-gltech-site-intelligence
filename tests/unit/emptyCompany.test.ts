/**
 * 시연 자료 없이 시작한 회사 (D-65 점검 반영) — 가상 자료(앱 의견·자재 기록·휴대폰 점검 등)가 하나도 섞이지 않는다.
 * 새 자료 묶음을 추가해도 이 시험이 자동으로 확인한다 (모든 묶음을 돈다).
 */
import { afterAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabaseUrl } from "./testDb";

process.env.DATABASE_URL = await testDatabaseUrl("emptyCompany");
const { getDb } = await import("@/server/sql");
const { loadState, COLLECTIONS } = await import("@/server/state");
const svc = await import("@/server/service");

const DB_URL = process.env.DATABASE_URL!;
afterAll(async () => {
  await dropTestDatabase(DB_URL);
});

describe("빈 회사로 시작", () => {
  it("모든 자료 묶음이 비어 있다", async () => {
    const r = await svc.setupCompany({ companyName: "(주)빈회사", name: "대표", email: "ceo@empty.test", password: "EmptyCo2026!", withDemoData: false });
    const companyId = r.member.companyId;
    expect(companyId).toBeTruthy();
    const db = await getDb();
    const state = await db.transaction((tx) => loadState(tx, companyId));
    const bag = state as unknown as Record<string, unknown[]>;
    const notEmpty = Object.keys(COLLECTIONS).filter((n) => (bag[n] ?? []).length > 0);
    expect(notEmpty).toEqual([]);
  });
});
