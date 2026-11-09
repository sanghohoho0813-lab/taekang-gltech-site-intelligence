/**
 * 매일 한 번 도는 점검 (D-71) — 서버 예약 작업(/api/cron/daily)이 회사마다 부른다. 순수 함수: 바뀐 데이터와 보낼 알림만 돌려준다.
 * - 하자보증 만료 60·30·7일 전 → 본사(대표·공무)에게 한 번씩. 보낸 단계는 현장 하자보증 정보에 남겨 다시 보내지 않는다
 * - 아침 알림 (D-72): 본사 ‘오늘 아침 확인할 일’, 현장 직원 ‘오늘 할 일’ — 하루 한 번, 일요일 쉼, 회사 설정에서 끌 수 있음
 * - 알림·활동 이력에 금액은 넣지 않는다
 */
import type { DemoDB } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import type { Notice } from "@/lib/domain/notify";
import { hqUsers } from "@/lib/domain/notify";
import { fmtDate, todayIso } from "@/lib/domain/format";
import { WARRANTY_NOTICE_DAYS, warrantyNoticeDue } from "@/lib/domain/warranty";
import { briefRestDay, fieldBriefs, hqBrief } from "@/lib/domain/brief";
import { clone, log, touch } from "./commands";

export const SYSTEM_USER = "system";

export interface DailyResult {
  db: DemoDB;
  changed: boolean;
  notices: Notice[];
  /** 이번에 보낸 하자보증 만료 알림 (현장·단계) */
  warranty: { siteId: string; days: number }[];
  /** 아침 알림을 받을 사람 수 (본사·현장 · D-72) */
  brief: { hq: number; field: number };
}

/** 아침 알림을 오늘 보낼 차례인가 — 켜져 있고(기본 켬), 오늘 아직 안 보냈고, 일요일이 아닐 때 */
export function briefDueToday(db: Pick<DemoDB, "settings">, today: string): boolean {
  const s = db.settings ?? DEFAULT_SETTINGS;
  return s.morningBrief !== false && s.briefSentOn !== today && !briefRestDay(today);
}

/** live: 운영판 (공무 확인 대기 원가를 처리 대기에 넣는다) */
export function runDailyChecks(db0: DemoDB, now: Date, live = true): DailyResult {
  const today = todayIso(now);
  const none: DailyResult = { db: db0, changed: false, notices: [], warranty: [], brief: { hq: 0, field: 0 } };
  const hq0 = hqUsers(db0);
  // 받을 본사 사람이 없으면 ‘보냄’으로 남기지 않는다 (나중에 생기면 그때 보냄 · D-71 점검 반영)
  const due = hq0.length ? db0.sites.map((s) => ({ s, d: warrantyNoticeDue(s, today) })).filter((x) => x.d) : [];
  const briefOn = briefDueToday(db0, today);
  if (!due.length && !briefOn) return none;
  const db = clone(db0);
  const ctx = { userId: SYSTEM_USER, now };
  const at = now.toISOString();
  const hq = hqUsers(db);
  const notices: Notice[] = [];
  const warranty: DailyResult["warranty"] = [];
  const brief = { hq: 0, field: 0 };
  for (const { s: s0, d } of due) {
    const site = db.sites.find((x) => x.id === s0.id)!;
    const w = site.warranty!;
    // 이번 단계와 그보다 먼 단계는 보낸 것으로 (늦게 켠 경우 60일 알림이 30일 알림 뒤에 오지 않게)
    const sent = new Set((w.notices ?? []).map((n) => n.days));
    const add = WARRANTY_NOTICE_DAYS.filter((x) => x >= d!.days && !sent.has(x)).map((x) => ({ days: x, at }));
    site.warranty = { ...w, notices: [...(w.notices ?? []), ...add].sort((a, b) => b.days - a.days) };
    const left = d!.daysLeft === 0 ? "오늘 만료" : `${d!.daysLeft}일 남음`;
    log(db, ctx, "site", `${site.shortName} 하자보증 만료 알림 (${fmtDate(d!.endDate)}까지 · ${left}) — 본사에 보냄`, site.id, `/sites/${site.id}?tab=requests`);
    notices.push({
        to: hq,
        title: d!.daysLeft === 0 ? "하자보증 오늘 만료" : `하자보증 만료 ${d!.daysLeft}일 전`,
        body: `${site.shortName} · ${fmtDate(d!.endDate)}까지 — 발주처와 최종 점검을 잡고 남은 하자를 정리해 주세요`,
        url: `/sites/${site.id}?tab=requests`,
        tag: `warranty-${site.id}`,
      });
    warranty.push({ siteId: site.id, days: d!.days });
  }
  // 아침 알림 (D-72) — 하루 한 번, 할 일이 있는 사람에게만. 보낸 날은 회사 설정에 남겨 다시 보내지 않는다
  if (briefOn) {
    const h = hqBrief(db0, today, live);
    if (h.total && hq.length) {
      notices.push({ to: hq, title: h.title, body: h.body, url: "/dashboard", tag: "brief-hq" });
      brief.hq = hq.length;
    }
    for (const f of fieldBriefs(db0, today)) {
      notices.push({ to: [f.userId], title: f.title, body: f.body, url: f.lines[0].href, tag: "brief-field" });
      brief.field += 1;
    }
    db.settings = { ...(db.settings ?? DEFAULT_SETTINGS), briefSentOn: today };
  }
  touch(db, ctx);
  return { db, changed: true, notices, warranty, brief };
}
