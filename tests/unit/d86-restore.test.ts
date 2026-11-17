/**
 * D-86 백업 → 빈 시스템 복원 (계정 이전) 왕복 시험 — 원본 DB에서 실제 명령으로 자료를 만들고 백업한 뒤,
 * 다른 빈 DB에 복원해서 금액·자료·사용자·권한·사진이 그대로인지 본다.
 * 실제 Postgres: TEST_DATABASE_URL=postgres://… (파일 전용 임시 DB 2개를 만들고 지운다). 없으면 PGlite 메모리 DB.
 */
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabaseUrl } from "./testDb";

const SOURCE_URL = await testDatabaseUrl("d86src");
const TARGET_URL = await testDatabaseUrl("d86dst");
process.env.DATABASE_URL = SOURCE_URL;

const { getDb } = await import("@/server/sql");
const svc = await import("@/server/service");
const auth = await import("@/server/auth");
const { restoreCompany, readBackup, prepareRestore } = await import("@/server/restore");
const { photoBackupStatus, restorePhotos } = await import("@/server/photoBackup");
const { forgetState } = await import("@/server/stateCache");
const { ForbiddenError } = await import("@/server/authz");
const { CommandError } = await import("@/lib/data/commands");
const { DEMO_SCENARIO } = await import("@/lib/data/seed");
const { siteFinancials, portfolioTotals } = await import("@/lib/domain/calc");
const { moneyIntegrity } = await import("@/lib/domain/integrity");
const { monthClose } = await import("@/lib/domain/monthClose");
const { zipStore, readZip, unzipEntry } = await import("@/lib/domain/zip");

type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
type DemoDB = Awaited<ReturnType<typeof svc.getView>>["db"];

const PW = "Taekang2026!";
const NEW_PW = "Newowner2027";
const JPG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

async function loginAs(email: string, pw = PW): Promise<Member> {
  const r = await auth.login(email, pw);
  if (!r.ok) throw new Error(r.error);
  const m = await auth.memberFromToken(r.token);
  if (!m) throw new Error("session");
  return m;
}

/** 다른 DB로 옮겨 탄다 (같은 프로세스에서 원본·대상 DB를 번갈아 쓴다) */
async function useDb(url: string) {
  await (await getDb()).close();
  process.env.DATABASE_URL = url;
  // 같은 주소(PGlite 메모리 DB)여도 새로 연다 — 닫힌 연결을 다시 쓰지 않게
  (globalThis as { __tkDb?: unknown }).__tkDb = undefined;
  forgetState();
}

let sourceView: DemoDB;
let sourceLogCount = 0;
let backupJson = "";
let backupB64 = "";
let photoId = "";
const today = "2026-11-17";

afterAll(async () => {
  await (await getDb()).close();
  await dropTestDatabase(SOURCE_URL);
  await dropTestDatabase(TARGET_URL);
});

beforeAll(async () => {
  // ── 원본 시스템: 가상 자료 + 실제 명령 몇 가지 ──
  await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "대표", email: "ceo@taekang.test", password: PW, withDemoData: true });
  const ceo = await loginAs("ceo@taekang.test");
  const field = await loginAs("field@demo.local");
  await svc.executeCommand(field, "submitFieldReport", {
    idempotencyKey: "d86-r1",
    siteId: "site-a",
    reportDate: "2026-11-16",
    workDone: DEMO_SCENARIO.workDone,
    costs: DEMO_SCENARIO.costs.map((c) => ({ category: c.category, amount: c.amount, forecastImpact: "additional", note: c.note })),
    reason: "design_change",
    photos: [{ dataUrl: `data:image/jpeg;base64,${JPG_B64}`, caption: "타설 전" }],
  });
  // 퇴사자 1명 (비활성) — 복원 뒤에도 비활성이어야 한다
  await svc.updateMember(ceo, "u-field2", { active: false });
  sourceView = (await svc.getView(ceo)).db;
  photoId = sourceView.photos.find((p) => p.caption === "타설 전")!.id;
  const db = await getDb();
  sourceLogCount = Number((await db.query<{ n: string }>(`select count(*) as n from records where collection = 'activityLogs'`))[0].n);
  backupJson = (await svc.exportCompany(ceo)).body;
  // 내려받는 파일은 gzip (/api/export와 같은 압축)
  backupB64 = gzipSync(Buffer.from(backupJson, "utf8")).toString("base64");
  await useDb(TARGET_URL);
}, 120_000);

describe("D-86 백업 파일로 시작 (빈 시스템 복원)", () => {
  it("압축 백업은 원문보다 훨씬 작다 (Vercel 응답 한도 4.5MB 대비)", () => {
    const gz = Buffer.from(backupB64, "base64");
    expect(gz.length).toBeLessThan(Buffer.byteLength(backupJson) / 4);
    expect(gz[0]).toBe(0x1f);
  });

  it("잘못된 파일·이메일·비밀번호는 거부하고 아무것도 만들지 않는다", async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
    const j = JSON.parse(backupJson);
    const cases: [string, unknown][] = [
      ["백업 아님", b64({ hello: 1 })],
      ["다른 버전", b64({ ...j, version: 2 })],
      ["DEMO 브라우저 백업(사용자 목록 없음)", b64({ ...j, members: undefined })],
      ["자료 손상(배열 아님)", b64({ ...j, data: { ...j.data, costEntries: { a: 1 } } })],
      ["같은 줄 두 번", b64({ ...j, data: { ...j.data, sites: [...j.data.sites, j.data.sites[0]] } })],
      ["사진 주소가 외부", b64({ ...j, data: { ...j.data, photos: [{ ...j.data.photos[0], dataUrl: "https://evil.example/x.jpg" }] } })],
      ["깨진 gzip", Buffer.from([0x1f, 0x8b, 1, 2, 3]).toString("base64")],
      ["금액 빠진 원가", b64({ ...j, data: { ...j.data, costEntries: [{ ...j.data.costEntries[0], amount: undefined }, ...j.data.costEntries.slice(1)] } })],
      ["이름 빠진 현장", b64({ ...j, data: { ...j.data, sites: [{ ...j.data.sites[0], name: "" }, ...j.data.sites.slice(1)] } })],
      ["날짜 깨진 사진", b64({ ...j, data: { ...j.data, photos: [{ ...j.data.photos[0], createdAt: "언젠가" }, ...j.data.photos.slice(1)] } })],
      ["JSON 아님", Buffer.from("not json").toString("base64")],
    ];
    for (const [label, backup] of cases) {
      await expect(restoreCompany({ backup: backup as string, email: "ceo@taekang.test", password: NEW_PW }), label).rejects.toBeInstanceOf(CommandError);
    }
    // 백업에 없는 이메일 · 대표가 아닌 사람의 이메일
    await expect(restoreCompany({ backup: backupB64, email: "who@else.test", password: NEW_PW })).rejects.toBeInstanceOf(CommandError);
    await expect(restoreCompany({ backup: backupB64, email: "field@demo.local", password: NEW_PW })).rejects.toBeInstanceOf(CommandError);
    // 약한 비밀번호
    await expect(restoreCompany({ backup: backupB64, email: "ceo@taekang.test", password: "short" })).rejects.toBeInstanceOf(CommandError);
    expect(await svc.needsSetup()).toBe(true);
  });

  it("복원: 회사·사용자 ID 그대로, 금액·월 마감·숫자 맞추기 점검이 원본과 같다", async () => {
    const r = await restoreCompany({ backup: backupB64, email: "CEO@taekang.test ", password: NEW_PW, publicPhone: "031-123-4567" });
    expect(r.member.role).toBe("ceo");
    expect(r.member.mustChangePassword).toBe(false);
    expect(r.summary.integrity.filter((c) => c.level === "err")).toEqual([]);
    expect(r.summary.photos).toBe(sourceView.photos.length);
    expect(r.summary.pendingMembers).toBe(3); // 관리자·현장 1·발주처 (퇴사자 제외)
    expect(r.summary.pending).toEqual({ field: 1, manager: 1, partner: 1 });
    const ceo = await loginAs("ceo@taekang.test", NEW_PW);
    expect(ceo.companyId).toBe(JSON.parse(backupJson).companyId);
    const v = (await svc.getView(ceo)).db;
    // 자료 묶음 건수 (활동 이력은 복원 기록 1건 추가 · 화면에는 최근 300건만)
    for (const k of ["sites", "contracts", "budgets", "forecasts", "costEntries", "reports", "photos", "changeOrders", "billings", "payments", "attendance", "crewChecks", "workOrders", "partnerRequests", "materialMoves", "monthCloses", "profitAdjustments", "forecastChanges"] as const) {
      expect((v[k] as unknown[] | undefined)?.length ?? 0, k).toBe((sourceView[k] as unknown[] | undefined)?.length ?? 0);
    }
    expect(JSON.stringify(v.costEntries)).toBe(JSON.stringify(sourceView.costEntries));
    expect(v.baseline).toEqual(sourceView.baseline);
    // 돈: 현장별 예상이익·누계, 회사 합계, 월 마감, 점검
    for (const s of sourceView.sites) expect(siteFinancials(v, s.id), s.id).toEqual(siteFinancials(sourceView, s.id));
    expect(portfolioTotals(v)).toEqual(portfolioTotals(sourceView));
    expect(monthClose(v, "2026-11", today)).toEqual(monthClose(sourceView, "2026-11", today));
    const lv = (c: { key: string; level: string }[]) => c.map(({ key, level }) => `${key}:${level}`);
    expect(lv(moneyIntegrity(v, today))).toEqual(lv(moneyIntegrity(sourceView, today)));
    // 회사 전화 · 활동 이력 전체(300건 제한 없이) + 복원 기록
    expect(v.settings?.publicPhone).toBe("031-123-4567");
    const db = await getDb();
    const logs = Number((await db.query<{ n: string }>(`select count(*) as n from records where collection = 'activityLogs'`))[0].n);
    expect(logs).toBe(sourceLogCount + 1);
    expect(v.activityLogs[0].summary).toMatch(/백업 파일로 복원/);
    // rev는 원본보다 크다 (열려 있던 화면이 무시하지 않게)
    expect(v.rev).toBeGreaterThan(sourceView.rev);
  });

  it("사용자: 대표만 새 비밀번호, 나머지는 첫 로그인 전(예전 비밀번호로는 못 들어옴), 퇴사자는 비활성 그대로", async () => {
    const ceo = await loginAs("ceo@taekang.test", NEW_PW);
    const list = await svc.listMembers(ceo);
    const src = JSON.parse(backupJson).members as { id: string; email: string; role: string; active: boolean }[];
    expect(list.map((m) => `${m.id}|${m.email}|${m.role}|${m.active}`).sort()).toEqual(src.map((m) => `${m.id}|${m.email}|${m.role}|${m.active}`).sort());
    for (const m of list.filter((x) => x.role !== "ceo")) expect(m.mustChangePassword, m.email).toBe(true);
    expect(list.find((m) => m.id === "u-field2")!.active).toBe(false);
    expect((await auth.login("field@demo.local", PW)).ok).toBe(false);
    expect((await auth.login("ceo@taekang.test", PW)).ok).toBe(false);
    // 대표가 로그인 쪽지용 임시 비밀번호를 새로 만들면 그 사람은 들어와서 비밀번호를 바꾼다 (/launch와 같은 길)
    await svc.updateMember(ceo, "u-field", { password: "kpqmt48273", onlyIfMustChange: true } as never);
    const field = await loginAs("field@demo.local", "kpqmt48273");
    expect(field.mustChangePassword).toBe(true);
  });

  it("QR 단말기는 비밀값 없이 ‘해제됨’으로 남고, 새 명령은 그대로 동작한다", async () => {
    const ceo = await loginAs("ceo@taekang.test", NEW_PW);
    const v = (await svc.getView(ceo)).db;
    expect((v.kiosks ?? []).length).toBe((sourceView.kiosks ?? []).length);
    expect((v.kiosks ?? []).every((k) => k.revokedAt && !k.secret && !k.pairHash)).toBe(true);
    const before = v.rev;
    const out = await svc.executeCommand(ceo, "setThresholds", v.thresholds);
    expect(out.rev).toBeGreaterThanOrEqual(before);
  });

  it("두 번째 복원·최초 설정은 거부 (이미 자료가 있는 시스템을 덮어쓰지 않음)", async () => {
    await expect(restoreCompany({ backup: backupB64, email: "ceo@taekang.test", password: NEW_PW })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.setupCompany({ companyName: "x", name: "x", email: "x@x.test", password: NEW_PW })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("사진: 원본이 없으면 ‘사진 원본 없음’ 그림, 사진 백업을 올리면 진짜 사진 (대표만, 없는 것만 채움)", async () => {
    const ceo = await loginAs("ceo@taekang.test", NEW_PW);
    const missing = await svc.getPhoto(ceo, photoId);
    expect(missing?.missing).toBe(true);
    expect(missing?.mime).toBe("image/svg+xml");
    expect(await svc.getPhoto(ceo, "no-such-photo")).toBeNull();
    const st = await photoBackupStatus(ceo);
    expect(st.total).toBe(sourceView.photos.length);
    expect(st.missing).toBe(st.total);
    expect(st.months.reduce((a, m) => a + m.count, 0)).toBe(st.total);
    const manager = await loginAs("manager@demo.local", "kpqmt48273").catch(() => null);
    expect(manager).toBeNull(); // 관리자는 아직 첫 로그인 전(비밀번호 모름)
    // 원래 원본과 다른 JPEG(지문 불일치)는 받지 않는다 — 증빙 사진을 바꿔 넣지 못하게
    expect(sourceView.photos.find((p) => p.id === photoId)!.sha256).toMatch(/^[0-9a-f]{64}$/);
    const other = Buffer.from(JPG_B64, "base64");
    other[other.length - 3] ^= 0x01;
    expect(await restorePhotos(ceo, [{ id: photoId, mime: "image/jpeg", data: other.toString("base64") }])).toEqual({ saved: 0, existed: 0, unknown: 0, invalid: 0, mismatch: 1 });
    const r = await restorePhotos(ceo, [
      // 사진이라 적고 다른 파일(그림 아닌 것)을 올리면 거부
      { id: photoId, mime: "image/jpeg", data: Buffer.from("<svg onload=alert(1)>").toString("base64") },
      { id: "no-such-photo", mime: "image/jpeg", data: JPG_B64 },
      { id: photoId, mime: "image/jpeg", data: JPG_B64 },
    ]);
    expect(r).toEqual({ saved: 1, existed: 0, unknown: 1, invalid: 1, mismatch: 0 });
    const real = await svc.getPhoto(ceo, photoId);
    expect(real?.missing).toBeUndefined();
    expect(real?.mime).toBe("image/jpeg");
    // 이미 있는 원본은 바꾸지 않는다
    expect(await restorePhotos(ceo, [{ id: photoId, mime: "image/jpeg", data: JPG_B64 }])).toEqual({ saved: 0, existed: 1, unknown: 0, invalid: 0, mismatch: 0 });
    // 채운 일은 활동 이력에 남는다
    const pg = await getDb();
    expect((await pg.query<{ s: string }>(`select data->>'summary' as s from records where collection = 'activityLogs' and data->>'summary' like '사진 백업 올리기%'`)).length).toBe(1);
    expect((await photoBackupStatus(ceo)).missing).toBe(st.missing - 1);
    // 현장 직원은 사진 백업을 올리거나 볼 수 없다
    const field = await loginAs("field@demo.local", "kpqmt48273");
    await expect(restorePhotos(field, [])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(photoBackupStatus(field)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("예전 백업(.json 원문)도 받는다 · 형식 검사는 저장 없이 따로 돈다 · 이력 바로 가기는 앱 안 주소만 · 이름의 NUL은 고친다", () => {
    const j = JSON.parse(backupJson);
    j.data.activityLogs[0].link = "https://evil.example/login";
    j.data.activityLogs[1].link = "//evil.example";
    const parsed = readBackup(Buffer.from(JSON.stringify(j).replace('"summary"', '"summ\\u0000ary"')).toString("base64"));
    const p = prepareRestore(parsed, "ceo@taekang.test", new Date("2026-11-17T00:00:00Z"));
    expect(p.owner.role).toBe("ceo");
    expect(p.state.idempotencyKeys).toEqual([]);
    expect((p.state as unknown as { users: unknown[] }).users.length).toBe(p.members.length);
    expect(p.state.activityLogs[0].link).toBeUndefined();
    expect(p.state.activityLogs[1].link).toBeUndefined();
    expect(p.state.activityLogs[2].link === undefined || p.state.activityLogs[2].link.startsWith("/")).toBe(true);
    expect(JSON.stringify(p.state)).not.toContain("\\u0000");
  });
});

describe("D-86 사진 백업 ZIP", () => {
  it("만든 ZIP을 다시 읽으면 같은 파일 (UTF-8 이름 · CRC 확인)", async () => {
    const files = [
      { name: "photos.json", data: new TextEncoder().encode(JSON.stringify({ a: 1 })) },
      { name: "2026-11/현장A_타설 전_p1.jpg", data: Buffer.from(JPG_B64, "base64") },
    ];
    const parts = zipStore(files);
    const buf = new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer());
    const read = readZip(buf);
    expect(read.map((f) => f.name)).toEqual(files.map((f) => f.name));
    for (let i = 0; i < files.length; i++) expect(Buffer.from(await unzipEntry(read[i])).equals(Buffer.from(files[i].data))).toBe(true);
    // 손상(내용 1바이트 변경) → CRC 불일치
    const bad = buf.slice();
    bad[read[1].raw.byteOffset - buf.byteOffset + 10] ^= 0xff;
    await expect(unzipEntry(readZip(bad)[1])).rejects.toThrow();
  });
});
