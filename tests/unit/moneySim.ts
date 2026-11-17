/**
 * 돈 숫자 무작위 운영 시뮬레이션 (D-85 · D-87) — 실제 명령을 날마다 무작위로 돌리고 하루가 끝날 때마다 숫자 맞추기 점검(err)을 본다.
 * 시험 파일이 아니라 도우미 — d85·d87 시험이 함께 쓴다 (시험 파일끼리 가져오면 시험이 두 번 돈다).
 */
import { createSeed } from "@/lib/data/seed";
import { COMMANDS } from "@/lib/data/registry";
import { CommandError } from "@/lib/data/commands";
import { moneyIntegrity } from "@/lib/domain/integrity";
import { coBoard } from "@/lib/domain/changeOrders";
import { monthClose } from "@/lib/domain/monthClose";
import { changesAfterClose, currentClose } from "@/lib/domain/closeRecord";
import { siteFinancials } from "@/lib/domain/calc";
import { COST_CATEGORIES } from "@/lib/domain/labels";
import { todayIso } from "@/lib/domain/format";
import type { CostCategory, DemoDB } from "@/lib/domain/types";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Run = (name: string, args: unknown, userId: string) => void;

export function simulate(seed: number, days = 45, opts: { contractEdits?: boolean; eachOp?: boolean; imports?: boolean; close?: boolean } = {}) {
  const r = rng(seed);
  const pick = <T,>(xs: T[]): T | undefined => (xs.length ? xs[Math.floor(r() * xs.length)] : undefined);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const won = (lo: number, hi: number) => int(lo, hi) * 10_000;
  const start = new Date("2026-10-01T01:00:00Z");
  let db: DemoDB = createSeed(start);
  db.settings = { ...(db.settings ?? { laborDayRate: 300_000, costApproval: "immediate" }), costApproval: seed % 2 ? "review" : "immediate" } as DemoDB["settings"];
  const trail: string[] = [];
  const failures: { day: string; trail: string[]; errs: string[] }[] = [];
  let now = start;
  let k = 0;
  const run: Run = (name, args, userId) => {
    const fn = COMMANDS[name as keyof typeof COMMANDS] as unknown as (d: DemoDB, a: unknown, c: { userId: string; now: Date }) => { db: DemoDB };
    const before = db;
    try {
      db = fn(db, args, { userId, now }).db;
      trail.push(`${todayIso(now)} ${name} ${JSON.stringify(args).slice(0, 300)}`);
    } catch (e) {
      if (!(e instanceof CommandError)) throw e;
      return;
    }
    if (opts.eachOp && !failures.length) {
      const errs = moneyIntegrity(db, todayIso(now)).filter((c) => c.level === "err");
      if (errs.length) failures.push({ day: todayIso(now), trail: trail.slice(-3), errs: errs.map((e) => `${e.title}: ${e.detail}`), before } as never);
    }
  };
  for (let d = 0; d < days; d++) {
    now = new Date(start.getTime() + d * 86_400_000 + int(0, 9) * 3_600_000);
    const today = todayIso(now);
    const sites = db.sites.filter((s) => s.status === "active");
    // D-87: 10월에는 팀별 작업 인원(출력)을 보낸다 — 노무 정산의 기준
    if (opts.close && today <= "2026-10-31" && r() < 0.7) {
      const s = pick(sites);
      if (s) run("reportCrew", { siteId: s.id, team: pick(["철근팀", "형틀팀", "설비팀"])!, kind: "direct", headcount: int(2, 9), idempotencyKey: `idem-fz-cr-${seed}-${k++}` }, "u-field");
    }
    // D-87: 달이 끝난 뒤 — 노무 정산 · 월 마감 · 대표 확인 · 다시 열기를 섞는다
    if (opts.close && today > "2026-10-31" && r() < 0.6) {
      const m = "2026-10";
      const x = r();
      const cur = currentClose(db, m);
      const before = db;
      if (x < 0.3) {
        const s = pick(db.sites);
        if (s) run("settleLabor", { siteId: s.id, month: m, amount: won(10, 400), note: "10월 노무 명세 기준", idempotencyKey: `idem-fz-s-${seed}-${k++}` }, "u-manager");
      } else if (x < 0.55 && !cur) {
        const items = monthClose(db, m, today).items.length;
        run("closeMonth", { month: m, ackOpen: items, note: items ? "남긴 일 확인" : "", idempotencyKey: `idem-fz-c-${seed}-${k++}` }, "u-manager");
      } else if (x < 0.8 && cur) {
        run("confirmMonthClose", { month: m, ackChanges: changesAfterClose(db, cur, today).count }, "u-ceo");
      } else if (cur) {
        run("reopenMonthClose", { month: m, reason: "숫자 다시 봄" }, "u-ceo");
      }
      // 마감·확인 바로 뒤에는 ‘마감 뒤 바뀐 것’이 0이어야 한다 (거짓 알림 없음)
      const after = currentClose(db, m);
      if (db !== before && after && (after.closedAt === now.toISOString() || after.confirmedAt === now.toISOString())) {
        const c = changesAfterClose(db, after, today);
        if (c.count) failures.push({ day: today, trail: trail.slice(-6), errs: [`마감·확인 바로 뒤 바뀐 것 ${c.count}건 — ${JSON.stringify(c.diffs.slice(0, 3))} ${JSON.stringify(c.events.slice(0, 3))}`] });
      }
    }
    for (let n = int(1, 5); n > 0; n--) {
      const site = pick(sites);
      if (!site) break;
      const op = r();
      const dateBack = (max: number) => todayIso(new Date(now.getTime() - int(0, max) * 86_400_000));
      if (op < 0.3) {
        const field = r() < 0.5;
        const reason = pick(["design_change", "planned", "quantity_increase", "schedule", "rework"] as const)!;
        const cat = pick([...COST_CATEGORIES])! as CostCategory;
        run(
          "submitFieldReport",
          { idempotencyKey: `idem-fz-${seed}-${k++}`, siteId: site.id, reportDate: dateBack(3), workDone: "작업", kind: "cost", reason, source: field ? "FIELD" : "PC", costs: [{ category: cat, amount: won(10, 900), forecastImpact: reason === "planned" ? "within_forecast" : r() < 0.7 ? "additional" : "within_forecast", note: `무작위 ${k}` }] },
          field ? "u-field" : "u-manager",
        );
      } else if (op < 0.38) {
        const e = pick(db.costEntries.filter((x) => x.status === "pending"));
        if (e) run("reviewCostEntry", { entryId: e.id, decision: r() < 0.8 ? "approve" : "reject", ...(r() < 0.3 ? { amount: Math.max(10_000, Math.round(e.amount * (0.5 + r()) / 10_000) * 10_000) } : {}), note: "확인" }, "u-manager");
      } else if (op < 0.46) {
        const e = pick(db.costEntries.filter((x) => (x.status === "active" || x.status === "pending") && x.source !== "SEED" && !x.settle));
        if (e)
          run(
            "editCostEntry",
            { entryId: e.id, patch: { amount: Math.max(10_000, Math.round((e.amount * (0.3 + r() * 1.4)) / 10_000) * 10_000), category: r() < 0.2 ? pick([...COST_CATEGORIES])! : e.category, note: e.note || "고침", ...(r() < 0.3 ? { forecastImpact: pick(["additional", "within_forecast"] as const) } : {}), ...(r() < 0.2 ? { date: dateBack(20) } : {}) } },
            "u-manager",
          );
      } else if (op < 0.52) {
        const e = pick(db.costEntries.filter((x) => (x.status === "active" || x.status === "pending") && x.source !== "SEED"));
        if (e) run("voidCostEntry", { entryId: e.id, reason: "잘못 넣음" }, "u-manager");
      } else if (op < 0.58) {
        const f = siteFinancials(db, site.id);
        const remaining = Object.fromEntries(f.categories.map((c) => [c.category, Math.max(0, Math.round((c.remaining * (0.6 + r() * 0.8)) / 10_000) * 10_000)])) as Record<CostCategory, number>;
        run("updateForecast", { siteId: site.id, remaining, note: "재추정" }, "u-manager");
      } else if (op < 0.66) {
        const b = coBoard(db, today, site.id);
        const basis = b.unclaimed.slice(0, int(1, 2));
        run("createChangeOrder", { siteId: site.id, title: `변경 ${k++}`, amount: basis.length ? Math.round((basis.reduce((a, e) => a + e.amount, 0) * (0.9 + r() * 0.5)) / 10_000) * 10_000 : won(100, 2000), ...(basis.length && r() < 0.8 ? { entryIds: basis.map((e) => e.id) } : {}) }, "u-manager");
      } else if (op < 0.76) {
        const c = pick(db.changeOrders.filter((x) => x.siteId === site.id && (x.status === "review" || x.status === "submitted")));
        if (c) {
          const to = c.status === "review" && r() < 0.5 ? "submitted" : r() < 0.7 ? "approved" : "rejected";
          const amt = to === "approved" ? (r() < 0.5 ? Math.abs(c.amount) : Math.max(10_000, Math.round((Math.abs(c.amount) * (0.6 + r() * 0.4)) / 10_000) * 10_000)) : undefined;
          run(
            "setChangeOrderStatus",
            { coId: c.id, status: to, approvedAmount: amt, note: "사유", ...(to === "submitted" ? { followUp: todayIso(new Date(now.getTime() + 7 * 86_400_000)) } : {}), ...(to === "approved" && r() < 0.4 ? { addedCost: { category: "material", amount: won(10, 500) } } : {}), ...(to !== "submitted" && r() < 0.3 ? { date: dateBack(2) } : {}), ...(to === "approved" ? { basis: "letter" } : {}) },
            "u-ceo",
          );
        }
      } else if (op < 0.84) {
        run("addBilling", { siteId: site.id, amount: won(100, 4000), billedDate: dateBack(10), idempotencyKey: `idem-fz-b-${seed}-${k++}` }, "u-manager");
      } else if (op < 0.92) {
        const f = siteFinancials(db, site.id);
        if (f.outstanding > 0) run("addPayment", { siteId: site.id, amount: Math.max(10_000, Math.round((f.outstanding * (0.2 + r() * 0.8)) / 10_000) * 10_000), receivedDate: dateBack(10), idempotencyKey: `idem-fz-p-${seed}-${k++}` }, "u-manager");
      } else if (op < 0.96) {
        const e = pick(coBoard(db, today, site.id).otherExtra);
        if (e) run("declineClaim", { entryIds: [e.id], note: "우리 책임" }, "u-manager");
      } else if (opts.imports) {
        // 자료 가져오기(원가·기성·변경공사) · 가져오기 취소 · 현장 보고 되돌림
        const x = r();
        if (x < 0.4) {
          const kind = pick(["cost", "billing", "change"] as const)!;
          const text =
            kind === "cost"
              ? `현장,날짜,항목,금액,성격,사유,메모\n${site.shortName},${dateBack(40)},자재,${won(10, 900)},${r() < 0.5 ? "계획 내" : "추가"},${r() < 0.5 ? "계획" : "설계변경"},가져옴 ${k}`
              : kind === "billing"
                ? `현장,구분,날짜,금액,메모\n${site.shortName},${r() < 0.5 ? "기성" : "입금"},${dateBack(40)},${won(100, 2000)},가져옴 ${k}`
                : `현장,제목,금액,상태,요청일,승인금액,결정일,메모\n${site.shortName},가져온 변경 ${k},${won(100, 1500)},승인,${dateBack(40)},,${dateBack(5)},`;
          run("importData", { kind, text, idempotencyKey: `idem-fz-i-${seed}-${k++}` }, "u-manager");
        } else if (x < 0.7) {
          const b = pick((db.importBatches ?? []).filter((y) => !y.undoneAt));
          if (b) run("undoImport", { batchId: b.id }, "u-manager");
        } else {
          const rep = pick(db.reports.filter((y) => y.status !== "voided" && y.costEntryIds.length && !y.importBatchId && !y.id.startsWith("rpt-seed")));
          if (rep) run("voidReport", { reportId: rep.id }, "u-manager");
        }
      } else if (opts.contractEdits) {
        const c = db.contracts.find((x) => x.siteId === site.id)!;
        const budgets = Object.fromEntries(COST_CATEGORIES.map((cat) => [cat, Math.round(c.plannedCostTotal / COST_CATEGORIES.length)])) as Record<CostCategory, number>;
        run("saveSite", { id: site.id, name: site.name, shortName: site.shortName, workType: site.workType, region: site.region, clientName: site.clientName, status: site.status, startDate: site.startDate, endDate: site.endDate, managerUserId: site.managerUserId, fieldUserId: site.fieldUserId, contractAmount: c.contractAmount + won(-3000, 3000), signedDate: c.signedDate, budgets }, "u-ceo");
      }
    }
    if (failures.length) break;
    const errs = moneyIntegrity(db, today).filter((c) => c.level === "err");
    if (errs.length) {
      failures.push({ day: today, trail: trail.slice(-12), errs: errs.map((e) => `${e.title}: ${e.detail}`) });
      break;
    }
  }
  return { db, failures, ops: trail.length };
}

