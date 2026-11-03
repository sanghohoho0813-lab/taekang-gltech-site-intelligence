/**
 * 운영 매뉴얼이 실제 화면과 어긋나지 않는지 — 매뉴얼에 ‘ ’로 적은 버튼·메뉴 이름이 화면 코드에 실제로 있어야 한다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MANUALS, manualsFor, quotedLabels } from "@/lib/help/manuals";

/** 휴대폰 OS 화면의 이름 (우리 코드에 없음) */
const OS_LABELS = new Set(["홈 화면에 추가", "앱을 사용하는 동안"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(tsx?|ts)$/.test(f) && !p.includes("lib/help/manuals.ts") ? [p] : [];
  });
}
const CODE = sources("src").map((p) => readFileSync(p, "utf8")).join("\n");

describe("운영 매뉴얼", () => {
  for (const m of MANUALS) {
    it(`${m.title}: 적힌 버튼·메뉴 이름이 화면에 있다`, () => {
      const parts = (l: string) => l.split(/\s*→\s*/);
      const missing = quotedLabels(m)
        .filter((l) => !OS_LABELS.has(l))
        .flatMap(parts)
        .filter((l) => !CODE.includes(l));
      expect(missing).toEqual([]);
    });
  }
  it("역할별로 보이는 매뉴얼 — 현장은 현장용·문제 해결, 발주처는 포털만, 본사는 전부", () => {
    expect(manualsFor("field").map((m) => m.id)).toEqual(["field", "faq"]);
    expect(manualsFor("partner").map((m) => m.id)).toEqual(["partner"]);
    expect(manualsFor("manager")).toHaveLength(MANUALS.length);
  });
});
