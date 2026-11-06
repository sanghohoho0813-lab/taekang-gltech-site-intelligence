/** 로그인 뒤 돌아갈 주소 (D-65 점검 반영) — 외부 사이트로 보내는 주소는 모두 거부 */
import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/live/safeNext";

describe("safeNext", () => {
  it("같은 사이트 경로는 그대로 (쿼리·# 포함)", () => {
    expect(safeNext("/field")).toBe("/field");
    expect(safeNext("/sites/site-a?tab=material#x")).toBe("/sites/site-a?tab=material#x");
  });
  it("외부로 나가는 주소는 거부", () => {
    for (const bad of ["//evil.example", "/\\evil.example/phish", "/\\/evil.example", "https://evil.example", "evil.example", "/\tx", "/%0a", " /field", "javascript:alert(1)"])
      expect(safeNext(bad), JSON.stringify(bad)).toBe(bad === "/%0a" ? "/%0a" : null);
  });
  it("로그인 화면으로 되돌리는 주소·빈 값은 거부", () => {
    expect(safeNext("/login")).toBeNull();
    expect(safeNext("/login?next=/x")).toBeNull();
    expect(safeNext(null)).toBeNull();
    expect(safeNext("")).toBeNull();
  });
});
