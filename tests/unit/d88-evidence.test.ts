/**
 * D-88 변경공사 증빙 파일 (변경계약서·공문·견적서 사진·PDF)
 * 1) 명령: 올리기·지우기·검사(종류·크기·가짜 PDF·개수)·기록, 승인 서면 상태, 가져오기 취소 막기, 월 마감 엑셀 칸
 * 2) 권한: 현장·발주처는 올리기·지우기 불가, 화면 데이터에 증빙이 없다
 * 3) 서버(실제 Postgres 또는 PGlite): 원본 저장(PDF), 본사만 열람(현장 담당이어도 주소로 못 받음), 지우면 원본도 지움,
 *    전체 백업 → 빈 시스템 복원 → 사진 백업으로 PDF 원본 채우기
 */
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabaseUrl } from "./testDb";

const SOURCE_URL = await testDatabaseUrl("d88src");
const TARGET_URL = await testDatabaseUrl("d88dst");
process.env.DATABASE_URL = SOURCE_URL;

const { getDb } = await import("@/server/sql");
const svc = await import("@/server/service");
const auth = await import("@/server/auth");
const { restoreCompany } = await import("@/server/restore");
const { photoBackupStatus, restorePhotos } = await import("@/server/photoBackup");
const { forgetState } = await import("@/server/stateCache");
const { authorize, viewFor, ForbiddenError } = await import("@/server/authz");
const { CommandError } = await import("@/lib/data/commands");
const { COMMANDS } = await import("@/lib/data/registry");
const { createSeed } = await import("@/lib/data/seed");
const { approvalBasisText, coBoard, coPaperState, EVIDENCE_MAX_PER_CO } = await import("@/lib/domain/changeOrders");
const { siteFinancials } = await import("@/lib/domain/calc");
const { monthWorkbook, verifyWorkbookFile } = await import("@/lib/domain/monthWorkbook");
const { readXlsx, writeXlsx } = await import("@/lib/domain/xlsx");

type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
type DemoDB = ReturnType<typeof createSeed>;

const PW = "Taekang2026!";
const NEW_PW = "Newowner2027";
const JPG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const JPG = `data:image/jpeg;base64,${JPG_B64}`;
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");
const PDF = `data:application/pdf;base64,${PDF_BYTES.toString("base64")}`;
const NOW = new Date("2026-11-17T03:00:00Z");
const ctx = (userId = "u-manager", now = NOW) => ({ userId, now });

const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });

function approved(basis: "contract" | "letter" | "verbal") {
  let db = createSeed(new Date("2026-11-10T03:00:00Z"));
  const co = db.changeOrders[0];
  db = COMMANDS.setChangeOrderStatus(db, { coId: co.id, status: "approved", note: "승인", date: "2026-11-16", basis }, ctx("u-ceo")).db;
  return { db, co: db.changeOrders.find((c) => c.id === co.id)! };
}

describe("D-88 명령 — 올리기·지우기·검사", () => {
  it("사진·PDF를 올리면 종류·이름·크기와 변경공사 기록·활동 이력이 남고, 금액·이익은 그대로", () => {
    const { db: db0, co } = approved("contract");
    const before = siteFinancials(db0, co.siteId);
    let db = COMMANDS.addChangeOrderEvidence(db0, { coId: co.id, docType: "contract", dataUrl: PDF, fileName: "C:\\fakepath\\변경계약서_날인.pdf", caption: "아트리움 유리 변경계약서 날인본", idempotencyKey: "idem-d88-a" }, ctx()).db;
    db = COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "estimate", dataUrl: JPG, fileName: "견적서.jpg", idempotencyKey: "idem-d88-b" }, ctx()).db;
    const ev = db.coEvidence!;
    expect(ev.map((e) => [e.kind, e.docType, e.fileName, e.siteId])).toEqual([
      ["pdf", "contract", "변경계약서_날인.pdf", co.siteId],
      ["image", "estimate", "견적서.jpg", co.siteId],
    ]);
    expect(ev[0].size).toBe(PDF_BYTES.length);
    expect(ev[0].createdBy).toBe("u-manager");
    const c = db.changeOrders.find((x) => x.id === co.id)!;
    expect(c.log!.filter((l) => l.kind === "evidence").map((l) => l.note)).toEqual(["변경계약서 (날인본) 올림 — 변경계약서_날인.pdf (아트리움 유리 변경계약서 날인본)", "견적·내역서 올림 — 견적서.jpg"]);
    expect(db.activityLogs[0].summary).toContain("변경공사 증빙 올림");
    expect(siteFinancials(db, co.siteId)).toEqual(before);
    // 같은 요청을 두 번 보내면 (연결이 끊겨 다시 누름) 두 번 저장되지 않는다
    expect(() => COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "estimate", dataUrl: JPG, fileName: "견적서.jpg", idempotencyKey: "idem-d88-b" }, ctx())).toThrow(/중복/);
  });

  it("가짜 PDF·다른 형식·큰 PDF·종류 없음·긴 설명·없는 변경공사는 거부", () => {
    const { db, co } = approved("letter");
    const add = (a: Record<string, unknown>) => () => COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "letter", dataUrl: PDF, ...a } as never, ctx());
    expect(add({ dataUrl: `data:application/pdf;base64,${Buffer.from("<html><script>alert(1)</script>").toString("base64")}` })).toThrow(CommandError);
    expect(add({ dataUrl: `data:text/html;base64,${Buffer.from("<b>x</b>").toString("base64")}` })).toThrow(CommandError);
    expect(add({ dataUrl: "/api/photos/someone-elses-photo" })).toThrow(CommandError);
    expect(add({ dataUrl: `data:image/jpeg;base64,${Buffer.from("%PDF-1.4 not a jpeg").toString("base64")}` })).toThrow(CommandError);
    const big = Buffer.alloc(3_100_000, 0x20);
    PDF_BYTES.copy(big);
    expect(add({ dataUrl: `data:application/pdf;base64,${big.toString("base64")}` })).toThrow(/3MB/);
    expect(add({ docType: "receipt" })).toThrow(CommandError);
    expect(add({ caption: "가".repeat(81) })).toThrow(CommandError);
    expect(() => COMMANDS.addChangeOrderEvidence(db, { coId: "co-none", docType: "letter", dataUrl: PDF }, ctx())).toThrow(/찾을 수 없/);
    // 파일 이름: 경로·제어 글자를 빼고, PDF는 .pdf로 끝나게
    const named = COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "letter", dataUrl: PDF, fileName: "../../etc/공문\u0007" }, ctx()).db;
    expect(named.coEvidence![0].fileName).toBe("공문.pdf");
  });

  it(`변경공사 하나에 ${EVIDENCE_MAX_PER_CO}개까지`, () => {
    let { db, co } = approved("contract");
    for (let i = 0; i < EVIDENCE_MAX_PER_CO; i++) db = COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "other", dataUrl: JPG, fileName: `p${i}.jpg` }, ctx()).db;
    expect(() => COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "other", dataUrl: JPG }, ctx())).toThrow(new RegExp(`${EVIDENCE_MAX_PER_CO}개까지`));
  });

  it("지우기는 이유가 있어야 하고, 지운 사람·이유가 변경공사 기록에 남는다", () => {
    const { db: db0, co } = approved("contract");
    const db1 = COMMANDS.addChangeOrderEvidence(db0, { coId: co.id, docType: "contract", dataUrl: PDF, fileName: "x.pdf" }, ctx()).db;
    const id = db1.coEvidence![0].id;
    expect(() => COMMANDS.removeChangeOrderEvidence(db1, { evidenceId: id, reason: "" }, ctx())).toThrow(/이유/);
    const db2 = COMMANDS.removeChangeOrderEvidence(db1, { evidenceId: id, reason: "다른 현장 서류를 잘못 올림" }, ctx("u-ceo")).db;
    expect(db2.coEvidence).toEqual([]);
    const last = db2.changeOrders.find((c) => c.id === co.id)!.log!.at(-1)!;
    expect([last.kind, last.by, last.note]).toEqual(["evidence", "u-ceo", "변경계약서 (날인본) 지움 — x.pdf (이유: 다른 현장 서류를 잘못 올림)"]);
    expect(() => COMMANDS.removeChangeOrderEvidence(db2, { evidenceId: id, reason: "다시" }, ctx())).toThrow(/찾을 수 없/);
  });
});

describe("D-88 점검 반영 — 기록·다시 보내기·파일 이름", () => {
  it("증빙을 많이 올리고 지워도 변경공사 기록의 등록·승인은 밀려나지 않는다 (50개 한도)", () => {
    let { db, co } = approved("contract");
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < EVIDENCE_MAX_PER_CO; i++) db = COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "other", dataUrl: JPG, fileName: `r${round}-${i}.jpg` }, ctx()).db;
      for (const e of [...db.coEvidence!]) db = COMMANDS.removeChangeOrderEvidence(db, { evidenceId: e.id, reason: "다시 정리" }, ctx()).db;
    }
    const log = db.changeOrders.find((c) => c.id === co.id)!.log!;
    expect(log.length).toBe(50);
    expect(log.map((l) => l.kind)).toEqual(expect.arrayContaining(["created", "submitted", "approved"]));
  });

  it("20번째 파일을 같은 요청 번호로 다시 보내면 ‘이미 저장됨’(실패처럼 보이지 않게) · 지우기도 같음", () => {
    let { db, co } = approved("contract");
    for (let i = 0; i < EVIDENCE_MAX_PER_CO; i++) db = COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "other", dataUrl: JPG, idempotencyKey: `idem-d88-k${i}` }, ctx()).db;
    expect(() => COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "other", dataUrl: JPG, idempotencyKey: "idem-d88-k19" }, ctx())).toThrow(expect.objectContaining({ code: "DUPLICATE" }));
    const id = db.coEvidence![0].id;
    db = COMMANDS.removeChangeOrderEvidence(db, { evidenceId: id, reason: "잘못 올림", idempotencyKey: "idem-d88-rm" }, ctx()).db;
    expect(() => COMMANDS.removeChangeOrderEvidence(db, { evidenceId: id, reason: "잘못 올림", idempotencyKey: "idem-d88-rm" }, ctx())).toThrow(expect.objectContaining({ code: "DUPLICATE" }));
  });

  it("파일 이름의 확장자는 실제 형식으로 (사진을 .html·.bat로 올려도 .jpg · PDF는 .pdf)", () => {
    const { db, co } = approved("contract");
    const a = COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "other", dataUrl: JPG, fileName: "계약서.html" }, ctx()).db;
    expect(a.coEvidence![0].fileName).toBe("계약서.jpg");
    const b = COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "other", dataUrl: PDF, fileName: "run.bat" }, ctx()).db;
    expect(b.coEvidence![0].fileName).toBe("run.pdf");
    const c = COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "other", dataUrl: JPG, fileName: "가".repeat(150) + ".jpeg" }, ctx()).db;
    expect(c.coEvidence![0].fileName.length).toBeLessThanOrEqual(100);
    expect(c.coEvidence![0].fileName).toMatch(/\.jpg$/);
  });
});

describe("D-88 승인 서면 상태 (표시용 — 처리 대기 수는 그대로)", () => {
  it("변경계약서·공문 근거 승인인데 파일 없음 → missing, 견적서만 → missing, 변경계약서·공문 파일 → ok", () => {
    const { db, co } = approved("contract");
    expect(coPaperState(co, [])).toBe("missing");
    expect(coPaperState(co, [{ docType: "estimate" }])).toBe("missing");
    expect(coPaperState(co, [{ docType: "letter" }])).toBe("ok");
    const b = coBoard(db, "2026-11-17");
    expect(b.totals.paperMissing).toBe(1);
    expect(b.decided[0].paper).toBe("missing");
    const db2 = COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "contract", dataUrl: PDF }, ctx()).db;
    const b2 = coBoard(db2, "2026-11-17");
    expect(b2.totals.paperMissing).toBe(0);
    expect(b2.decided[0].paper).toBe("ok");
    expect(b2.decided[0].evidence).toHaveLength(1);
    // 챙길 것(처리 대기) 수에는 넣지 않는다
    expect(b2.totals.attention).toBe(b.totals.attention);
  });

  it("구두 승인 → verbal (서면 받으면 ok) · 승인 전·반려 → 표시 없음", () => {
    const { co } = approved("verbal");
    expect(coPaperState(co, [])).toBe("verbal");
    expect(coPaperState(co, [{ docType: "contract" }])).toBe("ok");
    expect(coPaperState({ status: "submitted" }, [])).toBeNull();
    expect(coPaperState({ status: "rejected" }, [])).toBeNull();
  });
});

describe("D-88 사용성 점검 반영 — 종이 보관 · 고치기 · 대표만", () => {
  it("‘서면 원본 종이로 보관 중’(보관 위치)이면 경고가 꺼지고 엑셀에 위치가 남는다 · 승인 건만 · 서면 파일이 있으면 막음", async () => {
    const { db: db0, co } = approved("contract");
    const kept = COMMANDS.logChangeOrder(db0, { coId: co.id, kind: "paper_kept", date: "2026-11-17", note: "본사 캐비닛 2번 · 2026 변경계약 바인더" }, ctx()).db;
    const c = kept.changeOrders.find((x) => x.id === co.id)!;
    expect(c.paperKept?.note).toBe("본사 캐비닛 2번 · 2026 변경계약 바인더");
    expect(coBoard(kept, "2026-11-17").decided[0].paper).toBe("kept");
    expect(coBoard(kept, "2026-11-17").totals.paperMissing).toBe(0);
    const rows = (await readXlsx(writeXlsx(monthWorkbook(kept, "2026-11", "2026-11-17").sheets))).find((s) => s.name === "변경공사")!.rows;
    expect(rows.find((x) => x[1] === co.title)![12]).toBe("서면 원본 종이 보관: 본사 캐비닛 2번 · 2026 변경계약 바인더");
    // 진행 중인 건에는 못 적음 · 이미 서면 파일이 있으면 막음
    const open = createSeed(new Date("2026-11-10T03:00:00Z"));
    expect(() => COMMANDS.logChangeOrder(open, { coId: open.changeOrders[0].id, kind: "paper_kept", date: "2026-11-17", note: "캐비닛" }, ctx())).toThrow(CommandError);
    const withPdf = COMMANDS.addChangeOrderEvidence(db0, { coId: co.id, docType: "letter", dataUrl: PDF }, ctx()).db;
    expect(() => COMMANDS.logChangeOrder(withPdf, { coId: co.id, kind: "paper_kept", date: "2026-11-17", note: "캐비닛" }, ctx())).toThrow(CommandError);
  });

  it("종류·설명 고치기 — 견적으로 잘못 올린 계약서를 변경계약서로 (지우지 않고) · 기록에 남음 · 바뀐 것 없으면 거부", () => {
    const { db: db0, co } = approved("contract");
    const db1 = COMMANDS.addChangeOrderEvidence(db0, { coId: co.id, docType: "estimate", dataUrl: JPG, fileName: "계약서.jpg" }, ctx()).db;
    expect(coBoard(db1, "2026-11-17").decided[0].paper).toBe("missing");
    const id = db1.coEvidence![0].id;
    const db2 = COMMANDS.updateChangeOrderEvidence(db1, { evidenceId: id, docType: "contract", caption: "날인본 1쪽" }, ctx()).db;
    expect(db2.coEvidence![0]).toMatchObject({ docType: "contract", caption: "날인본 1쪽" });
    expect(coBoard(db2, "2026-11-17").decided[0].paper).toBe("ok");
    expect(db2.changeOrders.find((c) => c.id === co.id)!.log!.at(-1)!.note).toBe("증빙 고침 — 계약서.jpg: 종류 견적·내역서 → 변경계약서 (날인본) · 설명 ‘날인본 1쪽’");
    expect(() => COMMANDS.updateChangeOrderEvidence(db2, { evidenceId: id, docType: "contract", caption: "날인본 1쪽" }, ctx())).toThrow(/바뀐 것이 없/);
  });

  it("승인된 변경공사의 변경계약서·공문은 대표만 지우거나 종류를 바꾼다 (관리자는 설명만 · 견적서는 지울 수 있음)", () => {
    const { db: db0, co } = approved("contract");
    let db: DemoDB = COMMANDS.addChangeOrderEvidence(db0, { coId: co.id, docType: "contract", dataUrl: PDF }, ctx()).db;
    db = COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "estimate", dataUrl: JPG }, ctx()).db;
    const [contract, estimate] = db.coEvidence!;
    const MANAGER = member("u-manager", "manager");
    const CEO = member("u-ceo", "ceo");
    expect(() => authorize(MANAGER, "removeChangeOrderEvidence", { evidenceId: contract.id, reason: "x" }, db, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(MANAGER, "updateChangeOrderEvidence", { evidenceId: contract.id, docType: "other" }, db, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(MANAGER, "updateChangeOrderEvidence", { evidenceId: contract.id, caption: "날인본" }, db, NOW)).not.toThrow();
    expect(() => authorize(MANAGER, "removeChangeOrderEvidence", { evidenceId: estimate.id, reason: "x" }, db, NOW)).not.toThrow();
    expect(() => authorize(CEO, "removeChangeOrderEvidence", { evidenceId: contract.id, reason: "x" }, db, NOW)).not.toThrow();
  });

  it("구두 승인 뒤 공문 파일을 붙이면 승인 근거가 ‘구두 → 서면 받음’으로 (엑셀도)", () => {
    const { db: db0, co } = approved("verbal");
    expect(approvalBasisText(co, [])).toBe("구두 승인 (서면 대기)");
    const db = COMMANDS.addChangeOrderEvidence(db0, { coId: co.id, docType: "letter", dataUrl: PDF }, ctx()).db;
    expect(approvalBasisText(co, db.coEvidence!)).toBe("구두 승인 → 서면 받음 (발주처 공문·메일 · 11/17 올림)");
  });
});

describe("D-88 가져오기 취소 · 월 마감 엑셀", () => {
  it("가져온 변경공사에 증빙을 붙였으면 가져오기 통째 취소를 막는다 (파일까지 지워지지 않게)", () => {
    let db = createSeed(new Date("2026-11-10T03:00:00Z"));
    const site = db.sites[0];
    const r = COMMANDS.importData(db, { kind: "change", text: `현장,제목,금액,상태,요청일,승인금액,결정일,메모\n${site.shortName},가져온 변경,5000000,청구,2026-11-01,,,`, idempotencyKey: "idem-d88-imp-1" } as never, ctx("u-manager", NOW));
    db = r.db;
    const co = db.changeOrders.find((c) => c.title === "가져온 변경")!;
    const withEv = COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "estimate", dataUrl: JPG }, ctx()).db;
    expect(() => COMMANDS.undoImport(withEv, { batchId: r.result.batchId }, ctx())).toThrow(/증빙 파일/);
    // 증빙이 없으면 그대로 취소된다
    expect(COMMANDS.undoImport(db, { batchId: r.result.batchId }, ctx()).db.changeOrders.some((c) => c.id === co.id)).toBe(false);
  });

  it("변경공사 시트 끝에 ‘증빙 파일’ 칸 — 종류별 개수 · 승인 서면 없음 표시, 숫자 대조는 그대로 맞음", async () => {
    const { db: db0, co } = approved("contract");
    const db = COMMANDS.addChangeOrderEvidence(db0, { coId: co.id, docType: "estimate", dataUrl: JPG }, ctx()).db;
    const w = monthWorkbook(db, "2026-11", "2026-11-17");
    expect(w.ok, JSON.stringify(w.checks.filter((c) => !c.ok))).toBe(true);
    const bytes = writeXlsx(w.sheets);
    expect((await verifyWorkbookFile(bytes, w)).filter((c) => !c.ok)).toEqual([]);
    const rows = (await readXlsx(bytes)).find((s) => s.name === "변경공사")!.rows;
    expect(rows[0][12]).toMatch(/^증빙 파일/);
    expect(rows.find((x) => x[1] === co.title)![12]).toBe("견적·내역서 1 — 증빙.jpg(11/17) (승인 서면 없음)");
    const db2 = COMMANDS.addChangeOrderEvidence(db, { coId: co.id, docType: "contract", dataUrl: PDF }, ctx()).db;
    const rows2 = (await readXlsx(writeXlsx(monthWorkbook(db2, "2026-11", "2026-11-17").sheets))).find((s) => s.name === "변경공사")!.rows;
    expect(rows2.find((x) => x[1] === co.title)![12]).toBe("견적·내역서 1 · 변경계약서 1 — 증빙.jpg(11/17), 증빙.pdf(11/17)");
  });
});

describe("D-88 권한 — 본사만", () => {
  it("현장·발주처는 올리기·지우기 불가, 화면 데이터에 증빙이 없다 (본사는 있음)", () => {
    const { db: db0, co } = approved("contract");
    const db: DemoDB = COMMANDS.addChangeOrderEvidence(db0, { coId: co.id, docType: "contract", dataUrl: PDF }, ctx()).db;
    const FIELD = member("u-field", "field", { siteIds: [co.siteId] });
    const PARTNER = member("u-partner", "partner", { partnerSiteIds: [co.siteId] });
    for (const m of [FIELD, PARTNER]) {
      expect(() => authorize(m, "addChangeOrderEvidence", { coId: co.id, docType: "contract", dataUrl: PDF }, db, NOW)).toThrow(ForbiddenError);
      expect(() => authorize(m, "removeChangeOrderEvidence", { evidenceId: db.coEvidence![0].id, reason: "x" }, db, NOW)).toThrow(ForbiddenError);
      expect(viewFor(m, db, NOW).coEvidence).toEqual([]);
      expect(JSON.stringify(viewFor(m, db, NOW))).not.toContain(db.coEvidence![0].id);
    }
    expect(viewFor(member("u-manager", "manager"), db, NOW).coEvidence).toHaveLength(1);
  });
});

// ───────────── 서버 (실제 저장소) ─────────────

async function loginAs(email: string, pw = PW): Promise<Member> {
  const r = await auth.login(email, pw);
  if (!r.ok) throw new Error(r.error);
  const m = await auth.memberFromToken(r.token);
  if (!m) throw new Error("session");
  return m;
}

async function useDb(url: string) {
  await (await getDb()).close();
  process.env.DATABASE_URL = url;
  (globalThis as { __tkDb?: unknown }).__tkDb = undefined;
  forgetState();
}

let pdfId = "";
let imgId = "";
let coId = "";
let backupB64 = "";

afterAll(async () => {
  await (await getDb()).close();
  await dropTestDatabase(SOURCE_URL);
  await dropTestDatabase(TARGET_URL);
});

beforeAll(async () => {
  await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "대표", email: "ceo@taekang.test", password: PW, withDemoData: true });
}, 120_000);

describe("D-88 서버 — 원본 저장·열람 권한·지우기·백업", () => {
  it("본사가 올린 PDF·사진은 원본 저장소에 두고 기록에는 주소만 (원본 지문 · 캐시를 비워도 남음)", async () => {
    const ceo = await loginAs("ceo@taekang.test");
    const field = await loginAs("field@demo.local");
    const v0 = (await svc.getView(field)).db;
    const siteId = v0.sites[0].id;
    await svc.executeCommand(ceo, "createChangeOrder", { siteId, title: "현장 담당 현장의 변경", amount: 3_000_000, idempotencyKey: "idem-d88-s-co" });
    coId = (await svc.getView(ceo)).db.changeOrders.find((c) => c.title === "현장 담당 현장의 변경")!.id;
    await svc.executeCommand(ceo, "addChangeOrderEvidence", { coId, docType: "letter", dataUrl: PDF, fileName: "공문_11월.pdf", idempotencyKey: "idem-d88-s-1" });
    await svc.executeCommand(ceo, "addChangeOrderEvidence", { coId, docType: "estimate", dataUrl: JPG, fileName: "견적.jpg", idempotencyKey: "idem-d88-s-2" });
    forgetState();
    const ev = (await svc.getView(ceo)).db.coEvidence!;
    expect(ev).toHaveLength(2);
    pdfId = ev.find((e) => e.kind === "pdf")!.id;
    imgId = ev.find((e) => e.kind === "image")!.id;
    for (const e of ev) {
      expect(e.dataUrl).toBe(`/api/photos/${encodeURIComponent(e.id)}`);
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const pg = await getDb();
    const rows = await pg.query<{ id: string; mime: string }>(`select id, mime from photo_blobs where id = any($1::text[]) order by mime`, [[pdfId, imgId]]);
    expect(rows.map((r) => r.mime)).toEqual(["application/pdf", "image/jpeg"]);
    // 사진 기록(공사사진대장·발주처 공개)에는 섞이지 않는다
    expect((await svc.getView(ceo)).db.photos.some((p) => p.id === pdfId || p.id === imgId)).toBe(false);
  });

  it("열람: 본사는 PDF(올린 이름)·사진, 그 현장 담당 현장 직원·발주처는 주소를 알아도 못 받는다", async () => {
    const ceo = await loginAs("ceo@taekang.test");
    const field = await loginAs("field@demo.local");
    const partner = await loginAs("partner@demo.local");
    const pdf = await svc.getPhoto(ceo, pdfId);
    expect(pdf?.mime).toBe("application/pdf");
    expect(pdf?.fileName).toBe("공문_11월.pdf");
    expect(Buffer.from(pdf!.data).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect((await svc.getPhoto(ceo, imgId))?.mime).toBe("image/jpeg");
    for (const m of [field, partner]) {
      expect(await svc.getPhoto(m, pdfId)).toBeNull();
      expect(await svc.getPhoto(m, imgId)).toBeNull();
      expect((await svc.getView(m)).db.coEvidence ?? []).toEqual([]);
      await expect(svc.executeCommand(m, "addChangeOrderEvidence", { coId, docType: "letter", dataUrl: PDF })).rejects.toBeInstanceOf(ForbiddenError);
    }
    // 현장 직원의 자기 현장 사진은 그대로 열린다 (사진 기록이 있는 원본)
    const own = (await svc.getView(field)).db.photos[0];
    if (own) expect(await svc.getPhoto(field, own.id)).not.toBeNull();
  });

  it("서버도 가짜 PDF를 거부한다 (명령 검사를 건너뛴 값이 와도 저장 단계에서)", async () => {
    const ceo = await loginAs("ceo@taekang.test");
    await expect(svc.executeCommand(ceo, "addChangeOrderEvidence", { coId, docType: "letter", dataUrl: `data:application/pdf;base64,${Buffer.from("MZ not a pdf").toString("base64")}` })).rejects.toBeInstanceOf(CommandError);
  });

  it("전체 백업 → 빈 시스템 복원 → 증빙은 ‘원본 없음’ → 사진 백업으로 PDF 원본을 채운다 (종류·지문이 맞을 때만)", async () => {
    const ceo = await loginAs("ceo@taekang.test");
    // 지운 파일은 원본도 지워진다
    await svc.executeCommand(ceo, "addChangeOrderEvidence", { coId, docType: "other", dataUrl: JPG, fileName: "잘못.jpg", idempotencyKey: "idem-d88-s-3" });
    const wrong = (await svc.getView(ceo)).db.coEvidence!.find((e) => e.fileName === "잘못.jpg")!;
    await svc.executeCommand(ceo, "removeChangeOrderEvidence", { evidenceId: wrong.id, reason: "다른 현장 서류", idempotencyKey: "idem-d88-s-4" });
    const pg = await getDb();
    expect(await pg.query(`select id from photo_blobs where id = $1`, [wrong.id])).toEqual([]);
    const backup = JSON.parse((await svc.exportCompany(ceo)).body);
    expect(backup.data.coEvidence.map((e: { id: string }) => e.id).sort()).toEqual([pdfId, imgId].sort());
    backupB64 = gzipSync(Buffer.from(JSON.stringify(backup), "utf8")).toString("base64");

    await useDb(TARGET_URL);
    // 증빙 주소가 외부로 바뀐 백업은 받지 않는다
    const bad = { ...backup, data: { ...backup.data, coEvidence: [{ ...backup.data.coEvidence[0], dataUrl: "https://evil.example/x.pdf" }, ...backup.data.coEvidence.slice(1)] } };
    await expect(restoreCompany({ backup: gzipSync(Buffer.from(JSON.stringify(bad))).toString("base64"), email: "ceo@taekang.test", password: NEW_PW })).rejects.toBeInstanceOf(CommandError);
    // 손으로 고친 백업: 사진 기록과 증빙 기록이 같은 번호 · 증빙 주소가 다른 번호 · 종류가 이상함 → 받지 않는다 (D-88 점검)
    const b64 = (o: unknown) => gzipSync(Buffer.from(JSON.stringify(o))).toString("base64");
    const ev0 = backup.data.coEvidence[0];
    const tampered = [
      { ...backup, data: { ...backup.data, photos: [...backup.data.photos, { ...backup.data.photos[0], id: ev0.id, dataUrl: ev0.dataUrl }] } },
      { ...backup, data: { ...backup.data, coEvidence: [{ ...ev0, dataUrl: backup.data.coEvidence[1].dataUrl }, backup.data.coEvidence[1]] } },
      { ...backup, data: { ...backup.data, coEvidence: [{ ...ev0, docType: "<script>" }, ...backup.data.coEvidence.slice(1)] } },
    ];
    for (const t of tampered) await expect(restoreCompany({ backup: b64(t), email: "ceo@taekang.test", password: NEW_PW })).rejects.toBeInstanceOf(CommandError);
    const r = await restoreCompany({ backup: backupB64, email: "ceo@taekang.test", password: NEW_PW });
    expect(r.summary.counts.coEvidence).toBe(2);
    const owner = await loginAs("ceo@taekang.test", NEW_PW);
    const st = await photoBackupStatus(owner);
    expect(st.missing).toBe(st.total); // 사진·증빙 모두 원본 없음
    expect(st.total).toBe((await svc.getView(owner)).db.photos.length + 2);
    expect((await svc.getPhoto(owner, pdfId))?.missing).toBe(true);
    // 종류를 바꿔 넣기(PDF 자리에 사진) · 다른 PDF(지문 다름) · 사진 자리에 PDF는 받지 않는다
    const otherPdf = Buffer.concat([PDF_BYTES, Buffer.from("% other\n")]);
    expect(await restorePhotos(owner, [{ id: pdfId, mime: "image/jpeg", data: JPG_B64 }])).toMatchObject({ saved: 0, invalid: 1 });
    expect(await restorePhotos(owner, [{ id: pdfId, mime: "application/pdf", data: otherPdf.toString("base64") }])).toMatchObject({ saved: 0, mismatch: 1 });
    expect(await restorePhotos(owner, [{ id: imgId, mime: "application/pdf", data: PDF_BYTES.toString("base64") }])).toMatchObject({ saved: 0, invalid: 1 });
    expect(await restorePhotos(owner, [{ id: pdfId, mime: "application/pdf", data: PDF_BYTES.toString("base64") }, { id: imgId, mime: "image/jpeg", data: JPG_B64 }])).toEqual({ saved: 2, existed: 0, unknown: 0, invalid: 0, mismatch: 0 });
    const back = await svc.getPhoto(owner, pdfId);
    expect([back?.mime, back?.fileName, back?.missing]).toEqual(["application/pdf", "공문_11월.pdf", undefined]);
    expect((await photoBackupStatus(owner)).missing).toBe(st.missing - 2);
  });
});
