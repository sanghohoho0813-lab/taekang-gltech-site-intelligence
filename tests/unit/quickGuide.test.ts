/**
 * 현장 직원 그림 안내 1장 (D-52) — 그림 파일이 있고, 설명에 적은 버튼 이름이 실제 화면에 있는지
 * (화면 이름을 바꾸면 이 시험이 실패 → 안내 설명·그림을 함께 고친다: npm run guide:shots)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QUICK_STEPS, QUICK_TIPS } from "@/lib/help/quick";

const ROOT = process.cwd();
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(n) ? [readFileSync(p, "utf8")] : [];
  });
}
const UI = sources(join(ROOT, "src/components")).join("\n");

describe("그림 안내 1장", () => {
  it("하루 순서대로 1~6번, 그림·설명이 빠지지 않는다", () => {
    expect(QUICK_STEPS.map((s) => s.no)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const s of QUICK_STEPS) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.text.length).toBeGreaterThan(10);
      expect(s.alt.length).toBeGreaterThan(3);
    }
  });

  it("그림 파일이 public/guide에 있고 JPEG, 크기가 알맞다 (인쇄용으로 선명 · 너무 무겁지 않게)", () => {
    const imgs = [...QUICK_STEPS.map((s) => s.img), ...QUICK_TIPS.flatMap((t) => (t.img ? [t.img] : []))];
    for (const src of imgs) {
      const buf = readFileSync(join(ROOT, "public", src));
      expect(buf[0] === 0xff && buf[1] === 0xd8, src).toBe(true);
      expect(buf.length, src).toBeGreaterThan(2_000);
      expect(buf.length, src).toBeLessThan(200_000);
    }
  });

  it("설명에 적은 버튼 이름이 실제 화면 코드에 있다", () => {
    const labels = [...QUICK_STEPS.flatMap((s) => s.labels), ...QUICK_TIPS.flatMap((t) => t.labels)];
    for (const l of labels) expect(UI.includes(l), `화면에 ‘${l}’ 없음`).toBe(true);
    // 설명의 ‘…’ 안 이름도 labels에 적어 둔다 (빠뜨리면 화면이 바뀌어도 모름)
    for (const s of QUICK_STEPS) {
      for (const m of `${s.title} ${s.text}`.matchAll(/‘([^’]+)’/g)) expect(s.labels.some((l) => m[1].includes(l) || l.includes(m[1])), `${s.no}번 ‘${m[1]}’`).toBe(true);
    }
  });
});
