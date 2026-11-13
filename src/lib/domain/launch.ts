/**
 * 시범 운영 준비 점검 (D-53) — 첫날 현장 직원이 막히지 않도록 회사·현장·사람별 준비 상태를 한 곳에 모은다.
 * 흩어져 있던 확인(운영 설정·개인위치정보·현장 위치·담당·공정·첫 로그인·휴대폰 점검·위치 동의·첫 출근)을 규칙으로 판정한다.
 * 법률 검토 여부는 판단하지 않는다(보관 기간을 ‘정했는지’만 본다).
 */
import { worksOnSite, type DemoDB, type DemoUser, type Site } from "./types";
import { deviceVerdict } from "./device";
import { consentState, locationPolicy, retentionText, viewersText } from "./privacy";

export type LaunchStatus = "ok" | "warn" | "missing";
/** 고치는 곳 — 화면이 운영/시연에 맞는 주소로 바꾼다 */
export type LaunchFix = "settings" | "privacy" | "members" | "sites" | "geo" | "usage";

export interface LaunchItem {
  key: string;
  label: string;
  status: LaunchStatus;
  text: string;
  fix?: LaunchFix;
}

/** 운영 모드의 사용자 목록(/api/admin/members)에서 쓰는 값 — 시연에는 없다 */
export interface MemberInfo {
  id: string;
  email: string;
  siteIds: string[];
  mustChangePassword: boolean;
  active: boolean;
}

export interface PersonLaunch {
  user: DemoUser;
  email?: string;
  sites: Site[];
  /** 첫 로그인(비밀번호 바꾸기) — 시연은 로그인이 없어 unknown */
  firstLogin: "done" | "pending" | "unknown";
  device: "ready" | "warn" | "fail" | "none";
  consent: "agreed" | "outdated" | "none";
  firstIn?: string;
  firstReport?: string;
  /** 첫날 준비 끝 — 담당 현장 있음 · 첫 로그인 끝(또는 알 수 없음) · 휴대폰 점검(고쳐야 함 없음) · 위치 동의 */
  ready: boolean;
  /** 아직 남은 것 (사람이 읽는 말) */
  todo: string[];
}

export interface LaunchReport {
  company: LaunchItem[];
  sites: { site: Site; items: LaunchItem[] }[];
  people: PersonLaunch[];
  /** 시작 전에 꼭 고칠 것 (missing) */
  blockers: string[];
  /** 고치면 좋은 것 (warn) */
  warnings: string[];
  peopleReady: number;
}

export function launchReport(db: DemoDB, members: MemberInfo[] | null): LaunchReport {
  const active = (u: DemoUser) => !u.inactive;
  const userById = new Map(db.users.map((u) => [u.id, u]));
  const crewOf = (site: Site) => db.users.filter((u) => u.role === "field" && active(u) && worksOnSite(u, site));
  const memberById = new Map((members ?? []).map((m) => [m.id, m]));
  const policy = locationPolicy(db);
  const hq = db.users.filter((u) => active(u) && (u.role === "ceo" || u.role === "manager")).length;
  const phone = db.settings?.helpPhone?.trim();

  const company: LaunchItem[] = [
    phone
      ? { key: "phone", label: "본사 전화번호", status: "ok", text: `${phone} — 현장 첫 화면 ‘본사에 전화하기’·로그인 쪽지·그림 안내에 나옵니다` }
      : { key: "phone", label: "본사 전화번호", status: "missing", text: "없음 — 현장 직원이 모를 때 누를 곳이 없습니다. ‘현장 문의 전화번호’를 넣으세요", fix: "settings" },
    policy.retentionDays != null
      ? { key: "privacy", label: "위치정보 보관 기간·열람 범위", status: "ok", text: `${retentionText(policy.retentionDays)} · 좌표 열람 ${viewersText(policy.viewers)}` }
      : { key: "privacy", label: "위치정보 보관 기간·열람 범위", status: "warn", text: "보관 기간 미정 — 직원에게 ‘정해지면 다시 알려드림’으로 안내됩니다. 법률·노무 확인 후 입력하면 직원에게 다시 동의를 받습니다 (계약 별지 제5호)", fix: "privacy" },
    hq >= 2
      ? { key: "hq", label: "본사 관리자", status: "ok", text: `${hq}명 (대표 포함)` }
      : { key: "hq", label: "본사 관리자", status: "warn", text: `${hq}명 — 휴가·퇴사 때 확인할 사람이 없습니다. 관리자 1명을 더 두세요`, fix: "members" },
  ];

  const running = db.sites.filter((s) => s.status === "active");
  const sites = running.map((site) => {
    const owner = userById.get(site.fieldUserId);
    const items: LaunchItem[] = [
      site.geo
        ? { key: "geo", label: "현장 위치·반경", status: "ok", text: `반경 ${site.geo.radiusM}m` }
        : { key: "geo", label: "현장 위치·반경", status: "missing", text: "미등록 — 출근해도 현장 안/밖을 판단할 수 없습니다. 현장에서 ‘지금 내 위치로’ 등록이 가장 정확합니다", fix: "geo" },
      owner && active(owner) && owner.role === "field"
        ? { key: "owner", label: "현장 담당", status: "ok", text: `${owner.name} ${owner.title}` }
        : crewOf(site).length
          ? // 사용자 화면에서 이 현장을 배정한 직원은 출근·보고·작업지시는 받는다 — 공정률을 올릴 담당만 없다 (D-77 리허설)
            { key: "owner", label: "현장 담당", status: "warn", text: `담당 미지정 — ${crewOf(site)[0].name}${crewOf(site).length > 1 ? ` 외 ${crewOf(site).length - 1}명` : ""}이 일하지만 공정률은 현장 담당만 올립니다. 한 명을 담당으로 정하세요`, fix: "sites" }
          : { key: "owner", label: "현장 담당", status: "missing", text: "현장 직원이 지정되지 않았습니다 — 보고·작업지시를 받을 사람이 없습니다", fix: "sites" },
      site.stages.length
        ? { key: "stages", label: "공정 단계", status: "ok", text: `${site.stages.length}개` }
        : { key: "stages", label: "공정 단계", status: "warn", text: "없음 — 공정 일정·보고의 ‘공정 진척’이 비어 보입니다", fix: "sites" },
    ];
    return { site, items };
  });

  const firstOf = (dates: string[]) => (dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : undefined);
  const people: PersonLaunch[] = db.users
    .filter((u) => active(u) && u.role === "field")
    .map((user) => {
      const m = memberById.get(user.id);
      const mySites = db.sites.filter((s) => s.status !== "completed" && (s.fieldUserId === user.id || !!m?.siteIds.includes(s.id)));
      const check = (db.deviceChecks ?? []).find((c) => c.userId === user.id);
      const device = check ? deviceVerdict(check) : "none";
      const consent = consentState(db, user.id).state;
      const firstLogin: PersonLaunch["firstLogin"] = !members ? "unknown" : m ? (m.mustChangePassword ? "pending" : "done") : "unknown";
      const firstIn = firstOf((db.attendance ?? []).filter((r) => r.userId === user.id).map((r) => r.workDate));
      const firstReport = firstOf(db.reports.filter((r) => r.createdBy === user.id && r.status !== "voided" && !r.importBatchId).map((r) => r.reportDate));
      const todo: string[] = [];
      if (!mySites.length) todo.push("담당 현장 지정");
      if (firstLogin === "pending") todo.push("첫 로그인(새 비밀번호)");
      if (device === "none") todo.push("내 휴대폰 점검");
      if (device === "fail") todo.push("휴대폰 설정 고치기");
      if (consent !== "agreed") todo.push(consent === "outdated" ? "위치 동의 다시" : "위치 동의(첫 출근 때)");
      const ready = !!mySites.length && firstLogin !== "pending" && (device === "ready" || device === "warn") && consent === "agreed";
      return { user, email: m?.email, sites: mySites, firstLogin, device, consent, firstIn, firstReport, ready, todo };
    });

  const blockers = [
    ...company.filter((i) => i.status === "missing").map((i) => i.label),
    ...(running.length ? [] : ["진행 중인 현장 없음"]),
    ...sites.flatMap((s) => s.items.filter((i) => i.status === "missing").map((i) => `${s.site.shortName} ${i.label}`)),
    ...(people.length ? [] : ["현장 직원 계정 없음"]),
    ...people.filter((p) => !p.sites.length).map((p) => `${p.user.name} 담당 현장`),
  ];
  const warnings = [...company.filter((i) => i.status === "warn").map((i) => i.label), ...sites.flatMap((s) => s.items.filter((i) => i.status === "warn").map((i) => `${s.site.shortName} ${i.label}`))];
  return { company, sites, people, blockers, warnings, peopleReady: people.filter((p) => p.ready).length };
}
