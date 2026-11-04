/**
 * 서버 테스트용 DB 주소.
 * - 기본: PGlite 메모리 DB (설치할 것 없음)
 * - TEST_DATABASE_URL=postgres://… 이면 실제 Postgres에 **테스트 파일마다 빈 임시 DB**를 만들어 쓴다.
 *   (회사 최초 설정은 DB당 한 번이라 파일끼리 DB를 같이 쓰면 안 된다. 끝나면 dropTestDatabase로 지운다)
 */
export async function testDatabaseUrl(tag: string): Promise<string> {
  const base = process.env.TEST_DATABASE_URL?.trim();
  if (!base?.startsWith("postgres")) return base || "pglite:memory";
  const name = `tk_test_${tag}_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/g, "_");
  const postgres = (await import("postgres")).default;
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

/** testDatabaseUrl이 만든 임시 DB를 지운다 (PGlite면 아무것도 안 함) */
export async function dropTestDatabase(url: string): Promise<void> {
  const base = process.env.TEST_DATABASE_URL?.trim();
  if (!base?.startsWith("postgres") || !url.startsWith("postgres")) return;
  const name = new URL(url).pathname.slice(1);
  if (!/^tk_test_[a-z0-9_]+$/.test(name)) return;
  const postgres = (await import("postgres")).default;
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
  } finally {
    await admin.end();
  }
}
