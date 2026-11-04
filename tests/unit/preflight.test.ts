import { describe, expect, it } from "vitest";
import { checkDb, checkEnv, summarize } from "../../scripts/preflight-lib.mjs";
import { open } from "@/server/sql";
import { runMigrations } from "@/server/migrations";

const level = (cs: { key: string; level: string }[], key: string) => cs.filter((c) => c.key === key).map((c) => c.level);

describe("배포 전 자동 점검", () => {
  it("운영 배포에 맞는 설정이면 오류 없음 (풀러·SSL·설정 코드)", () => {
    const cs = checkEnv({ NEXT_PUBLIC_DATA_MODE: "live", DATABASE_URL: "postgresql://postgres.abc:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require", SETUP_CODE: "tk-setup-2026", VERCEL: "1" });
    expect(cs.filter((c) => c.level === "error")).toEqual([]);
    expect(level(cs, "db-pool")).toEqual(["ok"]);
    expect(level(cs, "db-ssl")).toEqual(["ok"]);
    // 결과에 비밀번호·연결 문자열이 나오지 않는다
    expect(JSON.stringify(cs)).not.toContain("pw@");
    expect(summarize(cs).errors).toBe(0);
  });

  it("흔한 실수를 잡는다 — DEMO로 배포·DB 없음·내장 DB·공개 변수에 비밀·SSL 없음·직접 연결", () => {
    expect(level(checkEnv({ VERCEL: "1" }), "mode")).toEqual(["error"]);
    expect(level(checkEnv({ VERCEL: "1", NEXT_PUBLIC_DATA_MODE: "live" }), "db-url")).toEqual(["error"]);
    expect(level(checkEnv({ VERCEL: "1", NEXT_PUBLIC_DATA_MODE: "live", DATABASE_URL: "pglite:./x" }), "db-url")).toEqual(["error"]);
    expect(level(checkEnv({ NEXT_PUBLIC_DATA_MODE: "live", DATABASE_URL: "pglite:./x" }), "db-url")).toEqual(["warn"]); // 로컬은 경고만
    const leak = checkEnv({ NEXT_PUBLIC_DATA_MODE: "live", NEXT_PUBLIC_SUPABASE_KEY: "x", NEXT_PUBLIC_DB: "postgres://a:b@c/d" });
    expect(level(leak, "public-leak")).toEqual(["error", "error"]);
    const direct = checkEnv({ NEXT_PUBLIC_DATA_MODE: "live", DATABASE_URL: "postgresql://postgres:pw@db.abc.supabase.co:5432/postgres" });
    expect(level(direct, "db-pool")).toEqual(["warn"]);
    expect(level(direct, "db-ssl")).toEqual(["warn"]);
    expect(level(checkEnv({ NEXT_PUBLIC_DATA_MODE: "live", SETUP_CODE: "abc" }), "setup-code")).toEqual(["warn"]);
  });

  it("DB 점검: 스키마·필요한 표·행 보안(RLS)·최초 설정 여부, RLS가 꺼지면 오류", async () => {
    const db = await open("pglite:memory");
    const q = (sql: string) => db.query<Record<string, unknown>>(sql);
    expect(level(await checkDb(q), "schema")).toEqual(["warn"]); // 아직 표 없음
    await runMigrations(db);
    const cs = await checkDb(q);
    expect(cs.filter((c) => c.level === "error")).toEqual([]);
    expect(level(cs, "rls")).toEqual(["ok"]);
    expect(cs.find((c) => c.key === "setup")?.text).toContain("최초 설정 전");
    await db.query("alter table records disable row level security");
    const bad = await checkDb(q);
    expect(bad.find((c) => c.key === "rls")).toMatchObject({ level: "error", text: expect.stringContaining("records") });
    await db.close();
  });
});
