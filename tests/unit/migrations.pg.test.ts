/**
 * 실제 Postgres 전용: 빈 DB에 서버 여러 대가 동시에 처음 뜰 때 스키마 적용이 충돌하지 않는다 (D-42)
 * Vercel은 첫 배포 직후 서버(함수)를 여러 개 동시에 띄울 수 있다.
 * TEST_DATABASE_URL=postgres://… 일 때만 실행 (테스트가 임시 DB를 만들고 지운다). PGlite는 연결이 1개라 해당 없음.
 */
import { describe, expect, it } from "vitest";
import { MIGRATIONS, runMigrations } from "@/server/migrations";
import { open } from "@/server/sql";

const base = process.env.TEST_DATABASE_URL ?? "";
const onPostgres = base.startsWith("postgres");

describe.skipIf(!onPostgres)("스키마 동시 적용 (실제 Postgres)", () => {
  it("빈 DB에 서버 4대가 동시에 처음 연결해도 모두 성공하고 적용 기록은 한 번씩", async () => {
    const name = `tk_race_${Date.now()}`;
    const admin = await open(base);
    await admin.query(`create database ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    const servers = await Promise.all([1, 2, 3, 4].map(() => open(url.toString())));
    try {
      const results = await Promise.allSettled(servers.map((s) => runMigrations(s)));
      expect(results.map((r) => (r.status === "rejected" ? String(r.reason) : "ok"))).toEqual(["ok", "ok", "ok", "ok"]);
      const rows = await servers[0].query<{ name: string }>(`select name from schema_migrations order by name`);
      expect(rows.map((r) => r.name)).toEqual(MIGRATIONS.map((m) => m.name).sort());
      const [rls] = await servers[0].query<{ on: boolean }>(`select relrowsecurity as on from pg_class where relname = 'schema_migrations'`);
      expect(rls.on).toBe(true);
      // 다시 시작(이미 적용된 DB)해도 그대로
      await runMigrations(servers[1]);
      expect((await servers[0].query(`select name from schema_migrations`)).length).toBe(MIGRATIONS.length);
    } finally {
      await Promise.all(servers.map((s) => s.close()));
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.close();
    }
  }, 60_000);
});
