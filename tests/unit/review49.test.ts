/**
 * 독립 검토(11/04 2차) 지적 회귀 방지 (D-49)
 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { checkIn, reportCrew } from "@/lib/data/attendanceCommands";
import { CommandError } from "@/lib/data/commands";
import { applyLocationRetention, setLocationPolicy, withdrawLocationConsent } from "@/lib/data/privacyCommands";
import { currentTerms, hasConsent, hasCoords, myLocationRows } from "@/lib/domain/privacy";
import { scrubText } from "@/lib/domain/feedback";
import { planImport } from "@/lib/domain/importers";
import { tsvToCsv } from "@/lib/domain/csv";
import { readXlsx, writeXlsx } from "@/lib/domain/xlsx";
import { viewFor } from "@/server/authz";
import type { Member } from "@/server/auth";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-04T03:00:00Z");
const CEO = { userId: "u-ceo", now: NOW };
const sample = { lat: 37.2637, lng: 127.0287, accuracy: 12 };
const m = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c", email: `${id}@t`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
const agree = (db: DemoDB, userId: string): DemoDB => ({ ...db, consents: [...(db.consents ?? []).filter((c) => c.userId !== userId), { userId, at: NOW.toISOString(), ...currentTerms(db) }] });

describe("① 작업 인원을 다른 사람이 다시 보내면 이전 사람의 좌표를 넘겨받지 않는다", () => {
  it("A가 좌표와 함께 보낸 팀을 B가 위치 없이 다시 보냄 → 좌표 없음, B 화면·내 위치 기록에 A 좌표 없음", () => {
    let db = agree(agree(createSeed(NOW), "u-field"), "u-field2");
    db = reportCrew(db, { siteId: "site-a", team: "Zeta팀", kind: "subcontract", headcount: 3, geo: { sample } }, { userId: "u-field", now: NOW }).db;
    expect(hasCoords(db.crewChecks!.find((c) => c.team === "Zeta팀")!.geo)).toBe(true);
    db = reportCrew(db, { siteId: "site-a", team: "Zeta팀", kind: "subcontract", headcount: 3 }, { userId: "u-field2", now: NOW }).db;
    const c = db.crewChecks!.find((x) => x.team === "Zeta팀")!;
    expect(c.by).toBe("u-field2");
    expect(c.geo).toBeUndefined();
    expect(myLocationRows(db, "u-field2").some((r) => hasCoords(r.geo))).toBe(myLocationRows(db, "u-field2").some((r) => r.kind !== "작업 인원" && hasCoords(r.geo)));
    expect(JSON.stringify(viewFor(m("u-field2", "field", { siteIds: ["site-a"] }), db, NOW).crewChecks!.find((x) => x.team === "Zeta팀"))).not.toMatch(/"lat"/);
  });
});

describe("② 규칙을 넓혀도 이미 모은 좌표는 그때 약속대로", () => {
  it("‘대표만’일 때 모은 좌표는 ‘대표·관리자’로 바꿔도 관리자에게 안 보이고, 그 뒤 모은 좌표만 보인다", () => {
    let db = setLocationPolicy(createSeed(NOW), { retentionDays: 365, viewers: "ceo" }, CEO).db;
    db = checkIn(db, { siteId: "site-a", sample, consent: true, consentTerms: currentTerms(db) }, { userId: "u-field", now: NOW }).db;
    const rec = db.attendance!.find((r) => r.userId === "u-field" && r.workDate === "2026-11-04")!;
    expect(rec.inGeo).toMatchObject({ ceoOnly: true, keepDays: 365 });
    db = setLocationPolicy(db, { retentionDays: 365, viewers: "hq" }, CEO).db;
    const mv = viewFor(m("u-manager", "manager"), db, NOW);
    expect(hasCoords(mv.attendance!.find((r) => r.id === rec.id)!.inGeo)).toBe(false);
    // 대표는 본다
    expect(hasCoords(viewFor(m("u-ceo", "ceo"), db, NOW).attendance!.find((r) => r.id === rec.id)!.inGeo)).toBe(true);
    // 넓힌 뒤(다시 동의) 모은 좌표는 관리자도 본다
    const later = new Date("2026-11-05T00:00:00Z");
    db = checkIn(db, { siteId: "site-a", sample, consent: true, consentTerms: currentTerms(db) }, { userId: "u-field2", now: later }).db;
    const rec2 = db.attendance!.find((r) => r.userId === "u-field2" && r.inAt === later.toISOString());
    if (rec2) expect(hasCoords(viewFor(m("u-manager", "manager"), db, later).attendance!.find((r) => r.id === rec2.id)!.inGeo)).toBe(true);
  });

  it("30일로 알리고 모은 좌표는 기간을 1년으로 늘려도 30일이 지나면 지운다", () => {
    let db = setLocationPolicy(createSeed(NOW), { retentionDays: 30, viewers: "hq" }, CEO).db;
    db = checkIn(db, { siteId: "site-a", sample, consent: true, consentTerms: currentTerms(db) }, { userId: "u-field", now: NOW }).db;
    const id = db.attendance!.find((r) => r.userId === "u-field" && r.workDate === "2026-11-04")!.id;
    db = setLocationPolicy(db, { retentionDays: 365, viewers: "hq" }, CEO).db;
    const after40 = new Date(NOW.getTime() + 40 * 86_400_000);
    const purged = applyLocationRetention(db, after40);
    expect(purged.attendance!.find((r) => r.id === id)!.inGeo).toMatchObject({ purged: true });
    expect(purged.rev).toBe(db.rev + 1); // 화면이 새로 받도록
    expect(applyLocationRetention(purged, after40)).toBe(purged); // 같은 날 다시는 안 함
  });
});

describe("③ 동의는 직원이 본 조건으로만", () => {
  it("화면에 보여준 조건과 지금 규칙이 다르면 동의로 기록하지 않고 다시 보여달라고 한다", () => {
    const db = createSeed(NOW);
    const shown = currentTerms(db); // 기간 미정·대표와 관리자
    const changed = setLocationPolicy(db, { retentionDays: 365, viewers: "hq" }, CEO).db;
    expect(() => checkIn(changed, { siteId: "site-a", sample, consent: true, consentTerms: shown }, { userId: "u-field", now: NOW })).toThrow(/방금 바뀌었어요/);
    expect(() => checkIn(changed, { siteId: "site-a", sample, consent: true }, { userId: "u-field", now: NOW })).toThrow(CommandError);
    expect(checkIn(changed, { siteId: "site-a", sample, consent: true, consentTerms: currentTerms(changed) }, { userId: "u-field", now: NOW }).result.geo.lat).toBeDefined();
  });
  it("기간 미정으로 동의 → 기간이 정해지면 한 번 다시 알린다 (‘정해지면 다시 알려드립니다’)", () => {
    const db = agree(createSeed(NOW), "u-field");
    expect(hasConsent(db, "u-field")).toBe(true);
    expect(hasConsent(setLocationPolicy(db, { retentionDays: 365, viewers: "hq" }, CEO).db, "u-field")).toBe(false);
  });
  it("철회는 예전 문구 동의도 가능", () => {
    const db = createSeed(NOW); // 최성민: 1판 동의
    expect(withdrawLocationConsent(db, {}, { userId: "u-field", now: NOW }).db.consents!.some((c) => c.userId === "u-field")).toBe(false);
  });
});

describe("⑥⑦⑧ 큰 입력에도 빠르게, 엑셀 서식 행·붙여넣기", () => {
  it("오류 문구 지우기: 20만 글자도 금방", () => {
    const t0 = performance.now();
    scrubText("a".repeat(200_000) + "@" + "b".repeat(200_000), 200);
    expect(performance.now() - t0).toBeLessThan(200);
  });
  it("가져오기: 아주 넓은 행(12만 칸 × 여러 줄)도 금방 거부", () => {
    const t0 = performance.now();
    const header = Array.from({ length: 120_000 }, (_, i) => `c${i}`).join(",");
    expect(header.length).toBeLessThan(1_000_000);
    const p = planImport(createSeed(NOW), "billing", `${header}\n${header}\n${header}`.slice(0, 999_000), "2026-11-04");
    expect(p.errors[0].message).toContain("필요한 열");
    expect(performance.now() - t0).toBeLessThan(1500);
  });
  it("엑셀: 값 없이 서식만 있는 행이 5,000행 아래까지 있어도 읽는다 / 값이 있으면 거부", async () => {
    const rowsFormattedOnly = writeXlsxWithRawRow(`<row r="9000"><c r="A9000" s="1"/></row>`);
    expect((await readXlsx(rowsFormattedOnly))[0].rows).toHaveLength(2);
    const rowsWithValue = writeXlsxWithRawRow(`<row r="9000"><c r="A9000" t="inlineStr"><is><t>값</t></is></c></row>`);
    await expect(readXlsx(rowsWithValue)).rejects.toThrow(/너무 깁니다/);
  });
  it("붙여넣기: 직접 쓴 CSV 줄 뒤에 엑셀 표(탭)를 붙여도 앞 줄은 그대로", () => {
    const mixed = "현장,구분,날짜,금액\nB현장\t기성\t2026-03-31\t10,000,000";
    const p = planImport(createSeed(NOW), "billing", tsvToCsv(mixed), "2026-11-04");
    expect(p.errors).toEqual([]);
    expect(p.rows).toHaveLength(1);
  });
});

/** 테스트용: 양식 시트 XML의 sheetData 끝에 원하는 행을 끼워 넣은 xlsx (압축 안 함) */
function writeXlsxWithRawRow(row: string): Uint8Array {
  const b = writeXlsx([{ name: "입력", rows: [["현장", "구분", "날짜", "금액"], ["B현장", "기성", "2026-03-31", "1000"]] }]);
  const sheet = new TextDecoder().decode(b).match(/<worksheet[\s\S]*?<\/worksheet>/)![0].replace("</sheetData>", `${row}</sheetData>`);
  return rebuildWithSheet(b, sheet);
}
function rebuildWithSheet(orig: Uint8Array, sheetXml: string): Uint8Array {
  // writeXlsx의 다른 부분은 그대로 쓰고 시트만 바꾼 store zip을 다시 만든다
  const enc = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [];
  const dv = new DataView(orig.buffer, orig.byteOffset, orig.byteLength);
  let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true);
    const nl = dv.getUint16(p + 26, true);
    const xl = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(orig.subarray(p + 30, p + 30 + nl));
    const data = orig.subarray(p + 30 + nl + xl, p + 30 + nl + xl + size);
    files.push({ name, data: name === "xl/worksheets/sheet1.xml" ? enc.encode(sheetXml) : data });
    p += 30 + nl + xl + size;
  }
  return storeZip(files);
}
function storeZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const crcT = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const parts: Uint8Array[] = [];
  const cds: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const n = enc.encode(f.name);
    const l = new Uint8Array(30 + n.length);
    const lv = new DataView(l.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc(f.data), true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, n.length, true);
    l.set(n, 30);
    const c = new Uint8Array(46 + n.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(16, crc(f.data), true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, off, true);
    c.set(n, 46);
    parts.push(l, f.data);
    cds.push(c);
    off += l.length + f.data.length;
  }
  const cdSize = cds.reduce((a, c) => a + c.length, 0);
  const e = new Uint8Array(22);
  const ev = new DataView(e.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, off, true);
  const all = [...parts, ...cds, e];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const x of all) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}
