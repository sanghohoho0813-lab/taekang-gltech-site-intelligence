/** D-67 발주처 포털 공개 사진·최근 공정 변화 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { submitFieldReport, CommandError } from "@/lib/data/commands";
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
