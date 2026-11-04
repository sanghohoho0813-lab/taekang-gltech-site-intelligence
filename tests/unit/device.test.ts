/**
 * 휴대폰 점검 (D-46) — 브라우저 판별(실제 사용자 에이전트 문자열), 판정·안내, 결과 저장 검증, 역할별 데이터
 */
import { describe, expect, it } from "vitest";
import { deviceFix, deviceVerdict, summarizeUa } from "@/lib/domain/device";
import { reportDeviceCheck } from "@/lib/data/deviceCommands";
import { CommandError } from "@/lib/data/commands";
import { createSeed } from "@/lib/data/seed";
import { viewFor } from "@/server/authz";
import type { Member } from "@/server/auth";

const NOW = new Date("2026-11-04T03:00:00Z");
const UA = {
  iphone17: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  iphone16_1: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1",
  galaxySamsung: "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  galaxySamsungOld: "Mozilla/5.0 (Linux; Android 10; SM-G973N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/16.0 Chrome/92.0.4515.166 Mobile Safari/537.36",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; SM-A546N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  kakaoAndroid: "Mozilla/5.0 (Linux; Android 13; SM-G991N Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36;KAKAOTALK 2410300",
  kakaoIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.5",
  naverIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.3.1)",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

describe("브라우저 판별", () => {
  it("아이폰·갤럭시·앱 안 브라우저·오래된 버전", () => {
    expect(summarizeUa(UA.iphone17)).toEqual({ platform: "ios", browser: "Safari 17.4", inApp: false, old: false });
    expect(summarizeUa(UA.iphone16_1)).toMatchObject({ platform: "ios", browser: "Safari 16.1", old: true }); // 알림은 16.4부터
    expect(summarizeUa(UA.iphoneChrome)).toMatchObject({ platform: "ios", browser: "Chrome 122 (아이폰)", old: false });
    expect(summarizeUa(UA.galaxySamsung)).toEqual({ platform: "android", browser: "삼성 인터넷 25", inApp: false, old: false });
    expect(summarizeUa(UA.galaxySamsungOld)).toMatchObject({ browser: "삼성 인터넷 16", old: true });
    expect(summarizeUa(UA.androidChrome)).toMatchObject({ platform: "android", browser: "Chrome 124", old: false });
    expect(summarizeUa(UA.kakaoAndroid)).toMatchObject({ platform: "android", browser: "카카오톡 안 브라우저", inApp: true });
    expect(summarizeUa(UA.kakaoIos)).toMatchObject({ platform: "ios", inApp: true });
    expect(summarizeUa(UA.naverIos)).toMatchObject({ browser: "네이버 앱 안 브라우저", inApp: true });
    expect(summarizeUa(UA.desktop)).toMatchObject({ platform: "other", browser: "Chrome 124" });
  });
  it("판정과 고치는 방법: 앱 안 브라우저는 ‘다른 브라우저로 열기’, 아이폰·안드로이드 위치 설정 안내가 다름", () => {
    expect(deviceVerdict({ items: { network: "ok", location: "ok" } })).toBe("ready");
    expect(deviceVerdict({ items: { network: "ok", push: "warn", photo: "skip" } })).toBe("warn");
    expect(deviceVerdict({ items: { location: "fail", push: "warn" } })).toBe("fail");
    expect(deviceFix("location", "fail", "android", true)).toContain("다른 브라우저로 열기");
    expect(deviceFix("location", "fail", "ios")).toContain("Safari 웹 사이트");
    expect(deviceFix("location", "fail", "android")).toContain("자물쇠");
    expect(deviceFix("home", "warn", "ios")).toContain("홈 화면에 추가");
    expect(deviceFix("network", "ok", "ios")).toBe("");
  });
});

describe("점검 결과 보내기", () => {
  const ctx = { userId: "u-field", now: NOW };
  const good = { platform: "android" as const, browser: "삼성 인터넷 25", items: { network: "ok" as const, location: "ok" as const, storage: "ok" as const, photo: "ok" as const, push: "warn" as const, home: "warn" as const, browser: "ok" as const }, accuracyM: 14.6 };
  it("본인 결과만, 사람마다 마지막 1개, 정확도는 10m 단위, 좌표 없음, 활동 기록", () => {
    let db = createSeed(NOW);
    db = reportDeviceCheck(db, { ...good, items: { ...good.items, location: "fail" } }, ctx).db;
    const r = reportDeviceCheck(db, good, ctx);
    expect(r.result.verdict).toBe("warn");
    const mine = r.db.deviceChecks!.filter((c) => c.userId === "u-field");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ platform: "android", browser: "삼성 인터넷 25", accuracyM: 10, items: { location: "ok" } });
    expect(JSON.stringify(mine[0])).not.toMatch(/"lat"|"lng"/);
    expect(r.db.activityLogs[0]).toMatchObject({ type: "device", summary: expect.stringContaining("확인 권장 · 삼성 인터넷 25 · 확인: 휴대폰 알림, 홈 화면 아이콘") });
  });
  it("형식이 틀리면 거부 (모르는 항목·상태, 긴 이름, 태그, 이상한 정확도)", () => {
    const db = createSeed(NOW);
    const bad = [
      { ...good, platform: "windows" },
      { ...good, browser: "" },
      { ...good, browser: "x".repeat(41) },
      { ...good, browser: "<script>" },
      { ...good, items: { gps: "ok" } },
      { ...good, items: { network: "great" } },
      { ...good, items: {} },
      { ...good, items: [] },
      { ...good, accuracyM: -1 },
      { ...good, accuracyM: "10" },
    ];
    for (const b of bad) expect(() => reportDeviceCheck(db, b as never, ctx), JSON.stringify(b).slice(0, 60)).toThrow(CommandError);
  });
  it("역할별 데이터: 현장은 본인 것만, 발주처는 없음, 본사는 전부", () => {
    let db = reportDeviceCheck(createSeed(NOW), good, ctx).db;
    db = reportDeviceCheck(db, good, { userId: "u-field2", now: NOW }).db;
    const m = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c", email: `${id}@t`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
    expect(viewFor(m("u-field", "field", { siteIds: ["site-a"] }), db, NOW).deviceChecks!.map((c) => c.userId)).toEqual(["u-field"]);
    expect(viewFor(m("u-partner", "partner", { partnerSiteIds: ["site-a"] }), db, NOW).deviceChecks).toEqual([]);
    expect(viewFor(m("u-manager", "manager"), db, NOW).deviceChecks).toHaveLength(2);
  });
});
