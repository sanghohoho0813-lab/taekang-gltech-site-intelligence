/**
 * AX 상세설계서 (D-59) — 설계서에 적은 권한·데이터·화면·흐름이 실제 시스템과 같은지.
 * 시스템을 바꾸고 설계서를 안 고치면 여기서 실패한다.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authorize, ForbiddenError, viewFor } from "@/server/authz";
import type { Member } from "@/server/auth";
import { COLLECTIONS } from "@/server/state";
import { COMMANDS, type CommandName } from "@/lib/data/registry";
import { createSeed } from "@/lib/data/seed";
import { computeSignals } from "@/lib/domain/risk";
import { NAV } from "@/lib/nav";
import { COLLECTION_SPEC, COMMAND_SPEC, DATA_NONE, FIELD_SCREENS, FLOWS, MODULES, ROLE_ORDER } from "@/lib/design/spec";
import type { DemoDB, RoleId } from "@/lib/domain/types";

const NOW = new Date("2026-11-04T03:00:00Z");
const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
const WHO: Record<RoleId, Member> = { ceo: member("u-ceo", "ceo"), manager: member("u-manager", "manager"), field: member("u-field", "field"), partner: member("u-partner", "partner", { partnerSiteIds: ["site-a"] }) };

/** 각 명령을 ‘그 역할 본인 것·담당 현장’으로 실행해 보는 인자 */
function ownArgs(db: DemoDB, name: CommandName): Record<string, unknown> {
  const mineEntry = db.costEntries.find((e) => e.createdBy === "u-field" && !e.reviewedAt && e.siteId === "site-a")!;
  const mineReport = db.reports.find((r) => r.createdBy === "u-field" && !r.costEntryIds.some((id) => db.costEntries.find((e) => e.id === id)?.reviewedAt))!;
  return {
    siteId: "site-a",
    signal: name === "createAction" ? computeSignals(db, NOW)[0] : undefined,
    reportId: mineReport.id,
    entryId: mineEntry.id,
    actionId: db.actions.find((a) => a.assigneeUserId === "u-field")!.id,
    workOrderId: (db.workOrders ?? []).find((w) => w.assigneeUserId === "u-field")!.id,
    moveId: "mm-own-today",
    requestId: db.partnerRequests.find((r) => r.partnerUserId === "u-partner" && r.siteId === "site-a")!.id,
    to: "in_progress",
    input: {},
  };
}

function seedWithOwn(): DemoDB {
  const db = createSeed(NOW);
  // 현장 직원 본인이 올린, 본사 확인 전 비용이 하나는 있게
  const base = db.costEntries[0];
  db.costEntries = [...db.costEntries, { ...base, id: "ce-own-pending", siteId: "site-a", createdBy: "u-field", reviewedAt: undefined, reviewedBy: undefined, status: "pending" } as DemoDB["costEntries"][number]];
  // 현장 직원이 오늘 남긴 자재 기록도 하나 (현장은 오늘 것만 취소 · D-63)
  db.materialMoves = [...(db.materialMoves ?? []), { id: "mm-own-today", siteId: "site-a", itemId: "mat-a-unit", kind: "install", qty: 1, workDate: "2026-11-04", at: NOW.toISOString(), by: "u-field" }];
  // 현장 직원에게 배정된 조치도 하나
  db.actions = [...db.actions, { ...db.actions[0], id: "act-own", assigneeUserId: "u-field", status: "assigned" } as DemoDB["actions"][number]];
  return db;
}

describe("설계서 — 권한표 = 서버 권한 검사", () => {
  it("명령마다 역할별 허용(전부/본인·담당만/안 됨)이 서버 결과와 같다", () => {
    const db = seedWithOwn();
    const mismatch: string[] = [];
    for (const name of Object.keys(COMMANDS) as CommandName[]) {
      for (const role of ROLE_ORDER) {
        const want = COMMAND_SPEC[name].allow[role];
        let ok = true;
        try {
          authorize(WHO[role], name, ownArgs(db, name), db, NOW);
        } catch (e) {
          if (!(e instanceof ForbiddenError)) throw e;
          ok = false;
        }
        if (ok !== (want !== "no")) mismatch.push(`${name} · ${role}: 설계서 ${want} / 서버 ${ok ? "허용" : "거부"}`);
      }
    }
    expect(mismatch).toEqual([]);
  });

  it("‘본인·담당만’은 정말 남의 것·다른 현장을 막는다 (현장 직원)", () => {
    const db = seedWithOwn();
    const others = { siteId: "site-c", reportId: db.reports.find((r) => r.createdBy !== "u-field")!.id, entryId: db.costEntries.find((e) => e.createdBy !== "u-field")!.id, actionId: db.actions.find((a) => a.assigneeUserId !== "u-field")?.id ?? "x", workOrderId: "nope", to: "in_progress", input: {} };
    const own = (Object.keys(COMMANDS) as CommandName[]).filter((n) => COMMAND_SPEC[n].allow.field === "own" && !["withdrawLocationConsent", "reportDeviceCheck", "sendFeedback"].includes(n));
    for (const n of own) expect(() => authorize(WHO.field, n, others, db, NOW), n).toThrow(ForbiddenError);
  });
});

describe("설계서 — 데이터 표 = 역할별로 실제 보내는 데이터", () => {
  it("모든 데이터 묶음이 설계서에 있다", () => {
    expect(Object.keys(COLLECTION_SPEC).sort()).toEqual(Object.keys(COLLECTIONS).sort());
  });

  it("‘—(보내지 않음)’으로 적은 것은 현장 직원·발주처에게 정말 비어 있고, 계약은 금액 0", () => {
    const db = createSeed(NOW);
    for (const role of ["field", "partner"] as const) {
      const v = viewFor(WHO[role], db, NOW) as unknown as Record<string, unknown[]>;
      for (const [name, spec] of Object.entries(COLLECTION_SPEC)) {
        const sent = v[name] ?? [];
        if (spec[role] === DATA_NONE) expect(sent, `${role}:${name}`).toHaveLength(0);
      }
      expect((v.contracts as { contractAmount: number }[]).every((c) => c.contractAmount === 0)).toBe(true);
    }
  });
});

describe("설계서 — 화면·흐름", () => {
  const ROOT = process.cwd();
  const routeExists = (href: string) => existsSync(join(ROOT, "src/app", href.replace(/^\//, ""), "page.tsx"));
  it("적은 화면 주소가 모두 실제로 있다 (메뉴·현장 전용·모듈 대응)", () => {
    for (const n of NAV) expect(routeExists(n.href), n.href).toBe(true);
    for (const s of FIELD_SCREENS) expect(routeExists(s.href), s.href).toBe(true);
    for (const m of MODULES) for (const r of m.routes) expect(routeExists(r), `${m.no} ${r}`).toBe(true);
  });

  it("업무 흐름에 적은 버튼·화면 이름(‘…’)이 실제 화면 코드에 있다", () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));
    const ui = [...files(join(ROOT, "src/components")), ...files(join(ROOT, "src/app")), join(ROOT, "src/lib/nav.ts")].map((f) => readFileSync(f, "utf8")).join("\n");
    const missing: string[] = [];
    for (const f of FLOWS) for (const s of f.steps) for (const m of s.text.matchAll(/‘([^’]+)’/g)) if (!ui.includes(m[1])) missing.push(`${f.key}: ${m[1]}`);
    expect(missing).toEqual([]);
  });
});
