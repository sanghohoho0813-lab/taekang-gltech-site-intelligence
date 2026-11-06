/** D-67 발주처 포털 공개 사진·최근 공정 변화 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { submitFieldReport, voidReport, CommandError } from "@/lib/data/commands";
import { stripMoney } from "@/lib/domain/redact";
import { setPhotoShare } from "@/lib/data/portalCommands";
import { partnerProgressFeed, sharedPhotos } from "@/lib/domain/partnerFeed";
import { noticesFor } from "@/lib/domain/notify";
import { samplePhotos } from "@/lib/domain/samplePhotos";
import { authorize, viewFor, ForbiddenError } from "@/server/authz";
import type { Member } from "@/server/auth";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-04T03:00:00Z");
const ctx = (userId: string, now = NOW) => ({ userId, now });
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
const PARTNER = member("u-partner", "partner", { partnerSiteIds: ["site-a"] });
const FIELD = member("u-field", "field");

function withPhotos() {
  const r = submitFieldReport(createSeed(NOW), { idempotencyKey: "p1", siteId: "site-a", reportDate: "2026-11-04", workDone: "3층 유닛 설치 — 원청 담당과 단가 협의 중(내부)", photos: [{ dataUrl: JPG, caption: "내부 메모" }], stageProgress: [] }, ctx("u-field"));
  const r2 = submitFieldReport(r.db, { idempotencyKey: "p2", siteId: "site-b", reportDate: "2026-11-04", workDone: "B현장 작업", photos: [{ dataUrl: JPG }] }, ctx("u-field"));
  return r2.db;
}

describe("발주처 포털 공개 사진", () => {
  it("본사가 공개한 사진만 발주처에게 가고, 내부 설명·보고 연결·찍은 사람은 빠진다", () => {
    let db: DemoDB = withPhotos();
    const a = db.photos.find((p) => p.siteId === "site-a")!;
    expect(viewFor(PARTNER, db, NOW).photos).toHaveLength(0); // 공개 전에는 없음
    db = setPhotoShare(db, { photoIds: [a.id], shared: true, caption: "커튼월 유닛 설치" }, ctx("u-manager")).db;
    const v = viewFor(PARTNER, db, NOW);
    expect(v.photos).toHaveLength(1);
    expect(v.photos[0]).toMatchObject({ id: a.id, caption: "커튼월 유닛 설치", createdBy: "" });
    expect(v.photos[0]).not.toHaveProperty("reportId");
    expect(JSON.stringify(v.photos)).not.toContain("내부");
    expect(v.reports).toHaveLength(0);
    // 다른 현장(B) 사진은 공개해도 A현장 발주처에게 가지 않는다
    const b = db.photos.find((p) => p.siteId === "site-b")!;
    db = setPhotoShare(db, { photoIds: [b.id], shared: true }, ctx("u-manager")).db;
    expect(viewFor(PARTNER, db, NOW).photos.map((p) => p.siteId)).toEqual(["site-a"]);
    // 끄면 사라진다
    db = setPhotoShare(db, { photoIds: [a.id], shared: false }, ctx("u-manager")).db;
    expect(viewFor(PARTNER, db, NOW).photos).toHaveLength(0);
  });
  it("공개·비공개는 본사만 (현장·발주처 거부), 입력 검증", () => {
    const db = withPhotos();
    const id = db.photos[0].id;
    expect(() => authorize(FIELD, "setPhotoShare", { photoIds: [id], shared: true }, db, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(PARTNER, "setPhotoShare", { photoIds: [id], shared: true }, db, NOW)).toThrow(ForbiddenError);
    expect(() => setPhotoShare(db, { photoIds: [], shared: true }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => setPhotoShare(db, { photoIds: ["nope"], shared: true }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => setPhotoShare(db, { photoIds: [id], shared: true, caption: "가".repeat(61) }, ctx("u-manager"))).toThrow(CommandError);
  });
  it("새로 공개하면 그 현장을 보는 발주처에게만 알림이 간다", () => {
    const db = withPhotos();
    const a = db.photos.find((p) => p.siteId === "site-a")!;
    const next = setPhotoShare(db, { photoIds: [a.id], shared: true }, ctx("u-manager")).db;
    const n = noticesFor(db, next, "u-manager");
    expect(n).toEqual([expect.objectContaining({ to: ["u-partner"], title: "새 공정 사진", url: "/partner#photos" })]);
    // 이미 공개된 사진의 설명만 바꾸면 알림 없음
    const again = setPhotoShare(next, { photoIds: [a.id], shared: true, caption: "다시" }, ctx("u-manager")).db;
    expect(noticesFor(next, again, "u-manager")).toHaveLength(0);
  });
  it("시연용 예시 사진은 ‘예시’라고 적힌 그림이다", () => {
    const db = createSeed(NOW);
    const ps = samplePhotos(db.sites[0], "2026-11-04", "u-field");
    expect(ps).toHaveLength(6);
    expect(ps.every((p) => p.caption.startsWith("예시") && decodeURIComponent(p.dataUrl).includes("실제 사진 아님"))).toBe(true);
    expect(sharedPhotos({ ...db, photos: ps }, db.sites[0].id)).toHaveLength(0);
  });
});

describe("최근 공정 변화 (발주처용)", () => {
  it("보고의 공정 단계 진척만, 같은 날·같은 단계는 하나로, 취소한 보고는 빼고", () => {
    const db0 = createSeed(NOW);
    const st = db0.sites.find((s) => s.id === "site-a")!.stages.find((x) => x.progressPct > 0 && x.progressPct < 90)!;
    const r1 = submitFieldReport(db0, { idempotencyKey: "f1", siteId: "site-a", reportDate: "2026-11-04", workDone: "작업", stageProgress: [{ stageId: st.id, progressPct: st.progressPct + 3 }] }, ctx("u-field"));
    const r2 = submitFieldReport(r1.db, { idempotencyKey: "f2", siteId: "site-a", reportDate: "2026-11-04", workDone: "작업", stageProgress: [{ stageId: st.id, progressPct: st.progressPct + 6 }] }, ctx("u-field"));
    const feed = partnerProgressFeed(r2.db, "site-a", "2026-11-04");
    const row = feed.find((f) => f.stage === st.name)!;
    expect(row).toMatchObject({ date: "2026-11-04", from: st.progressPct, to: st.progressPct + 6 });
    expect(feed.filter((f) => f.stage === st.name)).toHaveLength(1);
    // 서버가 발주처에게 만들어 보내는 것도 같은 내용 (보고 원문은 없음)
    const v = viewFor(PARTNER, r2.db, NOW);
    expect(v.partnerFeed?.["site-a"]).toEqual(feed);
    expect(JSON.stringify(v.partnerFeed)).not.toContain("작업");
  });
});

describe("D-67 점검 반영", () => {
  it("취소한 보고의 사진은 발주처 공개가 꺼지고, 공개 중 표시가 남아 있어도 발주처에게 가지 않는다", () => {
    let db: DemoDB = withPhotos();
    const a = db.photos.find((p) => p.siteId === "site-a")!;
    db = setPhotoShare(db, { photoIds: [a.id], shared: true }, ctx("u-manager")).db;
    const voided = voidReport(db, a.reportId!, ctx("u-manager")).db;
    expect(voided.photos.find((p) => p.id === a.id)!.shared).toBeUndefined();
    expect(viewFor(PARTNER, voided, NOW).photos).toHaveLength(0);
    // 예전 데이터처럼 공개 표시가 남은 채 보고만 취소된 경우에도 빼고 보낸다
    const stale = { ...voided, photos: voided.photos.map((p) => (p.id === a.id ? { ...p, shared: { at: NOW.toISOString(), by: "u-manager", caption: "x" } } : p)) };
    expect(viewFor(PARTNER, stale, NOW).photos).toHaveLength(0);
    expect(sharedPhotos(stale, "site-a")).toHaveLength(0);
  });
  it("현장 직원은 원가 수정으로 1억 상한을 넘길 수 없다", () => {
    const db = createSeed(NOW);
    expect(() => authorize(FIELD, "editCostEntry", { entryId: "x", patch: { amount: 4_000_000_000 } }, { ...db, costEntries: [{ ...db.costEntries[0], id: "x", createdBy: "u-field", siteId: "site-a", reviewedAt: undefined }] }, NOW)).toThrow(ForbiddenError);
  });
  it("공정 변화는 처음 값 → 마지막 값 (되돌아오면 표시 안 함)", () => {
    const db0 = createSeed(NOW);
    const st = db0.sites.find((s) => s.id === "site-a")!.stages.find((x) => x.progressPct >= 10 && x.progressPct < 90)!;
    const p = st.progressPct;
    let db = submitFieldReport(db0, { idempotencyKey: "g1", siteId: "site-a", reportDate: "2026-11-04", workDone: "작업", stageProgress: [{ stageId: st.id, progressPct: p + 10 }] }, ctx("u-field")).db;
    db = submitFieldReport(db, { idempotencyKey: "g2", siteId: "site-a", reportDate: "2026-11-04", workDone: "정정", stageProgress: [{ stageId: st.id, progressPct: p + 5 }] }, ctx("u-field")).db;
    expect(partnerProgressFeed(db, "site-a", "2026-11-04").find((f) => f.stage === st.name)).toMatchObject({ from: p, to: p + 5 });
    db = submitFieldReport(db, { idempotencyKey: "g3", siteId: "site-a", reportDate: "2026-11-04", workDone: "원래대로", stageProgress: [{ stageId: st.id, progressPct: p }] }, ctx("u-field")).db;
    expect(partnerProgressFeed(db, "site-a", "2026-11-04").find((f) => f.stage === st.name)).toBeUndefined();
  });
  it("한 번 공개했던 사진을 다시 켜거나, 30분 안에 같은 현장 사진을 더 공개하면 알림을 또 보내지 않는다", () => {
    const base = withPhotos();
    const a = base.photos.find((p) => p.siteId === "site-a")!;
    const s1 = setPhotoShare(base, { photoIds: [a.id], shared: true }, ctx("u-manager")).db;
    const off = setPhotoShare(s1, { photoIds: [a.id], shared: false }, ctx("u-manager")).db;
    const on = setPhotoShare(off, { photoIds: [a.id], shared: true }, ctx("u-manager", new Date(NOW.getTime() + 60_000))).db;
    expect(noticesFor(off, on, "u-manager")).toHaveLength(0);
    // 같은 현장 두 번째 사진 (10분 뒤)
    const withSecond = { ...s1, photos: [...s1.photos, { ...a, id: "ph-2", sharedOnce: undefined, shared: undefined }] };
    const s2 = setPhotoShare(withSecond, { photoIds: ["ph-2"], shared: true }, ctx("u-manager", new Date(NOW.getTime() + 10 * 60_000))).db;
    expect(noticesFor(withSecond, s2, "u-manager")).toHaveLength(0);
  });
  it("금액을 지운 문장의 가운뎃점 띄어쓰기", () => {
    expect(stripMoney("A현장 현장보고 되돌리기 → 예상 총원가 8.5억 원 → 8.5억 원 · 공정률 45% → 40%")).toBe("A현장 현장보고 되돌리기 · 공정률 45% → 40%");
  });
});
