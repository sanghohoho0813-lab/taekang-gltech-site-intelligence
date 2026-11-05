/**
 * 시범 운영 준비 점검 (D-53)·임시 비밀번호 (D-54)
 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { launchReport, type MemberInfo } from "@/lib/domain/launch";
import { tempPassword } from "@/lib/domain/password";
import { passwordProblem } from "@/server/auth";
import { CONSENT_VERSION, currentTerms } from "@/lib/domain/privacy";
import type { DemoDB } from "@/lib/domain/types";
import type { DeviceCheck } from "@/lib/domain/device";

const NOW = new Date("2026-11-04T03:00:00Z");
const seed = () => createSeed(NOW);
const item = (r: ReturnType<typeof launchReport>, key: string) => r.company.find((i) => i.key === key)!;

describe("시범 운영 준비 점검", () => {
  it("시연 데이터: 본사 전화 없음은 시작 전 꼭, 보관 기간 미정은 고치면 좋음, 현장 3곳 위치·담당·공정은 완료", () => {
    const r = launchReport(seed(), null);
    expect(item(r, "phone").status).toBe("missing");
    expect(item(r, "privacy").status).toBe("warn");
    expect(item(r, "hq").status).toBe("ok");
    expect(r.sites.map((s) => s.site.id)).toEqual(["site-a", "site-b", "site-c"]);
    expect(r.sites.every((s) => s.items.every((i) => i.status === "ok"))).toBe(true);
    expect(r.blockers).toEqual(["본사 전화번호"]);
    expect(r.warnings).toContain("위치정보 보관 기간·열람 범위");
    // 시연에는 로그인이 없다 → 첫 로그인은 알 수 없음, 막지 않음
    expect(r.people.every((p) => p.firstLogin === "unknown")).toBe(true);
  });

  it("전화번호·보관 기간을 넣으면 회사 설정이 완료로, 관리자가 1명이면 경고", () => {
    const db = seed();
    db.settings = { ...db.settings!, helpPhone: "031-000-0000", location: { retentionDays: 90, viewers: "hq" } } as DemoDB["settings"];
    db.users = db.users.map((u) => (u.role === "manager" ? { ...u, inactive: true } : u));
    const r = launchReport(db, null);
    expect(item(r, "phone")).toMatchObject({ status: "ok", text: expect.stringContaining("031-000-0000") });
    expect(item(r, "privacy").status).toBe("ok");
    expect(item(r, "hq")).toMatchObject({ status: "warn", fix: "members" });
    expect(r.blockers).toEqual([]);
  });

  it("현장 위치 없음·담당 없음은 시작 전 꼭, 공정 단계 없음은 경고 · 진행 중 현장만 본다", () => {
    const db = seed();
    db.sites = db.sites.map((s) => (s.id === "site-a" ? { ...s, geo: undefined, stages: [] } : s.id === "site-b" ? { ...s, fieldUserId: "u-nobody" } : s.id === "site-c" ? { ...s, status: "completed" } : s));
    const r = launchReport(db, null);
    expect(r.sites.map((s) => s.site.id)).toEqual(["site-a", "site-b"]);
    const a = r.sites[0].items;
    expect(a.find((i) => i.key === "geo")).toMatchObject({ status: "missing", fix: "geo" });
    expect(a.find((i) => i.key === "stages")).toMatchObject({ status: "warn" });
    expect(r.sites[1].items.find((i) => i.key === "owner")).toMatchObject({ status: "missing", fix: "sites" });
    expect(r.blockers).toEqual(expect.arrayContaining(["A현장 현장 위치·반경", "B현장 현장 담당"]));
  });

  it("직원별: 첫 로그인(운영 모드)·휴대폰 점검·위치 동의가 모두 되어야 ‘준비 끝’", () => {
    const db = seed();
    const field = db.users.find((u) => u.id === "u-field")!;
    const members: MemberInfo[] = [{ id: field.id, email: "choi@taekang.test", siteIds: [], mustChangePassword: true, active: true }];
    let p = launchReport(db, members).people.find((x) => x.user.id === field.id)!;
    expect(p).toMatchObject({ firstLogin: "pending", device: "none", email: "choi@taekang.test", ready: false });
    expect(p.todo).toEqual(expect.arrayContaining(["첫 로그인(새 비밀번호)", "내 휴대폰 점검"]));
    expect(p.sites.map((s) => s.id)).toEqual(["site-a", "site-b"]);

    members[0].mustChangePassword = false;
    const check = (items: DeviceCheck["items"]): DeviceCheck => ({ userId: field.id, at: NOW.toISOString(), browser: "x", items }) as unknown as DeviceCheck;
    db.deviceChecks = [check({ gps: "fail" } as DeviceCheck["items"])];
    db.consents = [...(db.consents ?? []).filter((c) => c.userId !== field.id), { userId: field.id, at: NOW.toISOString(), ...currentTerms(db), version: CONSENT_VERSION }];
    p = launchReport(db, members).people.find((x) => x.user.id === field.id)!;
    expect(p).toMatchObject({ firstLogin: "done", device: "fail", consent: "agreed", ready: false });
    expect(p.todo).toEqual(["휴대폰 설정 고치기"]);

    db.deviceChecks = [check({ gps: "ok", camera: "warn" } as unknown as DeviceCheck["items"])];
    p = launchReport(db, members).people.find((x) => x.user.id === field.id)!;
    expect(p).toMatchObject({ device: "warn", ready: true, todo: [] });
    // 사용자 목록의 추가 담당 현장도 담당으로 본다
    db.sites = db.sites.map((s) => ({ ...s, fieldUserId: s.fieldUserId === field.id ? "u-field2" : s.fieldUserId }));
    members[0].siteIds = ["site-c"];
    expect(launchReport(db, members).people.find((x) => x.user.id === field.id)!.sites.map((s) => s.id)).toEqual(["site-c"]);
    members[0].siteIds = [];
    const none = launchReport(db, members);
    expect(none.people.find((x) => x.user.id === field.id)!.todo).toContain("담당 현장 지정");
    expect(none.blockers).toContain(`${field.name} 담당 현장`);
  });

  it("현장·직원이 없으면 시작 전 꼭 고칠 것으로", () => {
    const db = { ...seed(), sites: [] as DemoDB["sites"] };
    db.users = db.users.filter((u) => u.role !== "field");
    expect(launchReport(db, null).blockers).toEqual(expect.arrayContaining(["진행 중인 현장 없음", "현장 직원 계정 없음"]));
  });
});

describe("임시 비밀번호", () => {
  it("10자, 서버 규칙 통과, 헷갈리는 글자 없음, 매번 다름", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const pw = tempPassword();
      expect(pw).toHaveLength(10);
      expect(passwordProblem(pw)).toBeNull();
      expect(pw).not.toMatch(/[lIoO01]/);
      seen.add(pw);
    }
    expect(seen.size).toBe(500);
  });
});

describe("로그인 쪽지 QR", () => {
  it("쪽지에 그리는 QR을 다시 읽으면 접속 주소가 그대로 나온다", async () => {
    const { qrPath } = await import("@/lib/geo/qrClient");
    const jsQR = (await import("jsqr")).default;
    for (const url of ["https://taekang-site.vercel.app/login", "http://127.0.0.1:3100/login"]) {
      const { size, d } = qrPath(url);
      const scale = 8;
      const q = 4;
      const w = (size + q * 2) * scale;
      const px = new Uint8ClampedArray(w * w * 4).fill(255);
      for (const m of d.matchAll(/M(\d+) (\d+)/g)) {
        const c = Number(m[1]) + q;
        const r = Number(m[2]) + q;
        for (let y = r * scale; y < (r + 1) * scale; y++)
          for (let x = c * scale; x < (c + 1) * scale; x++) {
            const i = (y * w + x) * 4;
            px[i] = px[i + 1] = px[i + 2] = 0;
          }
      }
      expect(jsQR(px, w, w)?.data).toBe(url);
    }
  });
});
