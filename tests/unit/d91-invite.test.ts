/**
 * D-91 직원 가입 안내·시범 운영 준비 — 보낼 글, 누구용 주소, 준비 점검의 ‘회사 휴대폰 알림’·‘가입 신청’ 항목
 */
import { describe, expect, it } from "vitest";
import { INVITE_KINDS, eulReul, inviteMessage, inviteUrl, isInviteKind, whoQuoted } from "@/lib/domain/invite";
import { launchReport, type MemberInfo } from "@/lib/domain/launch";
import { createSeed } from "@/lib/data/seed";

describe("D-91 직원 가입 안내", () => {
  it("누구용은 세 가지뿐 (그 밖의 값은 무시)", () => {
    expect(INVITE_KINDS.map((k) => k.value)).toEqual(["field", "manager", "partner"]);
    for (const k of ["field", "manager", "partner"]) expect(isInviteKind(k)).toBe(true);
    for (const k of ["ceo", "other", "", null, undefined, "FIELD"]) expect(isInviteKind(k)).toBe(false);
    expect(inviteUrl("https://taekang.example", "manager")).toBe("https://taekang.example/signup?k=manager");
  });

  it("보낼 글: 회사 이름·주소·고를 항목·승인 뒤 로그인·문의 전화", () => {
    const url = inviteUrl("https://taekang.example", "field");
    const msg = inviteMessage("(주)태강지엘텍", "field", url, "02-1234-5678");
    expect(msg.split("\n")[0]).toBe("[(주)태강지엘텍] 현장 관리 앱 가입 안내");
    expect(msg).toContain(url);
    expect(msg).toContain("‘현장 직원’을 확인하고");
    expect(inviteMessage("A", "partner", url)).toContain("‘발주처·협력사’를 확인하고");
    expect(whoQuoted("manager")).toBe("‘본사 직원’을");
    expect([eulReul("사"), eulReul("원"), eulReul("A")]).toEqual(["를", "을", "를"]);
    expect(msg).toContain("본사가 승인하면");
    expect(msg).toContain("승인 대기");
    expect(msg.trim().endsWith("문의: 본사 02-1234-5678")).toBe(true);
    // 전화번호가 없으면 문의 줄을 넣지 않는다
    expect(inviteMessage("A", "partner", url)).not.toContain("문의");
    // 비밀번호·임시 비밀번호 같은 비밀값은 글에 없다
    expect(msg).not.toMatch(/임시 비밀번호|password/i);
  });
});

describe("D-91 시범 운영 준비 점검", () => {
  const members = (db: ReturnType<typeof createSeed>, extra: MemberInfo[] = []): MemberInfo[] => [
    ...db.users.map((u) => ({ id: u.id, email: `${u.id}@t.test`, siteIds: [], mustChangePassword: false, active: true, signupStatus: null })),
    ...extra,
  ];

  it("시연(서버 정보 없음)에는 알림 항목이 없다", () => {
    const r = launchReport(createSeed(), null);
    expect(r.company.find((i) => i.key === "push")).toBeUndefined();
    expect(r.company.find((i) => i.key === "signup")).toBeUndefined();
  });

  it("회사 알림이 꺼져 있으면 고치면 좋음(운영 설정으로), 켜지면 완료", () => {
    const db = createSeed();
    const off = launchReport(db, members(db), { push: false }).company.find((i) => i.key === "push")!;
    expect(off).toMatchObject({ status: "warn", fix: "settings" });
    expect(off.text).toContain("회사 휴대폰 알림 켜기");
    expect(launchReport(db, members(db), { push: true }).company.find((i) => i.key === "push")).toMatchObject({ status: "ok" });
    // 상태를 못 읽었으면(null) 항목을 빼고 본다
    expect(launchReport(db, members(db), { push: null }).company.find((i) => i.key === "push")).toBeUndefined();
  });

  it("승인 대기 가입 신청이 있으면 몇 명인지 알려 주고, 사람 목록에는 넣지 않는다", () => {
    const db = createSeed();
    const pending: MemberInfo[] = [
      { id: "u-new1", email: "a@t.test", siteIds: [], mustChangePassword: false, active: true, signupStatus: "pending" },
      { id: "u-new2", email: "b@t.test", siteIds: [], mustChangePassword: false, active: true, signupStatus: "pending" },
      { id: "u-no", email: "c@t.test", siteIds: [], mustChangePassword: false, active: true, signupStatus: "rejected" },
    ];
    const r = launchReport(db, members(db, pending), { push: true });
    const item = r.company.find((i) => i.key === "signup")!;
    expect(item).toMatchObject({ status: "warn", fix: "members" });
    expect(item.text).toMatch(/^2명 승인 대기/);
    expect(r.people.map((p) => p.user.id)).not.toContain("u-new1");
    expect(launchReport(db, members(db), { push: true }).company.find((i) => i.key === "signup")).toBeUndefined();
  });
});
