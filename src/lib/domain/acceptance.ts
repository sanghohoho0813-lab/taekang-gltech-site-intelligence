/**
 * 계약 단계별 검수 확인서 (D-51) — 계약 별지 제1호 시나리오·핵심 모듈 기준, 시스템에 쌓인 실사용 근거를 기간으로 센다.
 * 합격 여부는 발주자가 판단한다(종이에 체크·서명). 여기서는 ‘무엇으로 확인하는지’와 ‘근거 숫자’만 만든다.
 * 금액·계약 금액은 넣지 않는다.
 */
import type { DemoDB } from "./types";
import { deviceVerdict } from "./device";
import { FEEDBACK_STATUS_LABEL, qualitySummary, type ErrorEntry } from "./feedback";
import { consentState, locationPolicy, retentionText, viewersText } from "./privacy";
import { usageSummary } from "./usage";

export type StageNo = 1 | 2 | 3 | 4;

/** 오류 기록을 불러오지 못했거나 시연 화면일 때 */
const IS_LIVE_HINT = "그 화면에서 확인";

export const STAGE_TITLE: Record<StageNo, string> = {
  1: "1단계 — 업무분석·상세설계, 현장·사용자·권한·DB 구조",
  2: "2단계 — GPS 근태·현장 작업보고·작업지시·본사 승인 (사용 가능한 베타)",
  3: "3단계 — 공정·투입·원가·기성·변경공사 실제 자료 연결, 기본 고객 화면",
  4: "4단계 — 실사용 검증·오류 개선·인수인계·최종 검수",
};

export interface Evidence {
  label: string;
  value: string;
  /** 근거가 있는가 (0건이면 false — 합격 판단이 아니라 ‘확인할 거리가 있는지’ 표시) */
  has: boolean;
  /** 근거가 없을 때 붙이는 말 (기본 ‘기록 없음’) */
  missing?: string;
}

export interface AcceptanceItem {
  key: string;
  title: string;
  /** 계약 합격 판단 기준 (요약) */
  criteria: string;
  /** 검수 때 확인하는 방법 (화면·버튼) */
  how: string;
  evidence: Evidence[];
}

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const n = (x: number, unit = "건") => `${x.toLocaleString("ko-KR")}${unit}`;
const ev = (label: string, count: number, unit = "건", extra = ""): Evidence => ({ label, value: `${n(count, unit)}${extra}`, has: count > 0 });
const txt = (label: string, value: string, has = true, missing?: string): Evidence => ({ label, value, has, ...(missing ? { missing } : {}) });

/**
 * 단계별 검수 항목과 기간 내 근거.
 * errors: 운영 모드의 앱 오류 기록 (/api/errors) — 없으면(시연·불러오기 전) ‘오류·의견 화면에서 확인’으로 표시
 */
export function acceptanceItems(db: DemoDB, stage: StageNo, from: string, to: string, now: Date, errors?: ErrorEntry[] | null, errorsTruncated = false): AcceptanceItem[] {
  const inR = (iso: string | undefined) => !!iso && kst(iso) >= from && kst(iso) <= to;
  const inD = (d: string | undefined) => !!d && d >= from && d <= to;
  const field = db.users.filter((u) => u.role === "field" && !u.inactive);
  const att = (db.attendance ?? []).filter((r) => inD(r.workDate));
  const reports = db.reports.filter((r) => r.status !== "voided" && inR(r.createdAt));
  const orders = (db.workOrders ?? []).filter((w) => inR(w.createdAt));
  // 직원이 직접 낸 요청만 S2 근거로 센다 — 통신 불량 자동 요청은 따로 (리뷰 반영 D-55)
  const allFixes = (db.attendanceRequests ?? []).filter((q) => inR(q.createdAt));
  const fixes = allFixes.filter((q) => q.auto !== "offline");
  const autoFixes = allFixes.length - fixes.length;
  const crew = (db.crewChecks ?? []).filter((c) => inD(c.workDate));
  const partnerReq = db.partnerRequests.filter((r) => inR(r.createdAt));
  const imports = (db.importBatches ?? []).filter((b) => inR(b.at));
  const policy = locationPolicy(db);
  // 운영 모드는 최근 활동 이력 300건만 싣는다 — 기간 시작보다 뒤부터 실려 있으면 ‘이상’으로 표시
  const logs = db.activityLogs.filter((l) => inR(l.at));
  const oldestLog = db.activityLogs.reduce((m, l) => (l.at < m ? l.at : m), "9999");
  const logsMore = db.activityLogs.length >= 300 && kst(oldestLog) > from ? " 이상 (전체는 ‘활동 이력’ 화면)" : "";

  if (stage === 1) {
    const roles = (r: string) => db.users.filter((u) => u.role === r && !u.inactive).length;
    return [
      {
        key: "design",
        title: "업무분석·AX 상세설계",
        criteria: "현장 업무 흐름·화면·데이터 구조를 설계 문서로 확정",
        how: "설계 문서(PROJECT_SPEC·결정 기록 DECISIONS) 열람, 시연 화면으로 흐름 확인",
        evidence: [txt("설계·결정 기록", "PROJECT_SPEC.md · DECISIONS.md (D-01~)"), txt("검수 대응표", "docs/CONTRACT_ACCEPTANCE.md")],
      },
      {
        key: "structure",
        title: "현장·사용자 구조",
        criteria: "현장·직원·발주처 계정 구조와 담당 현장 지정",
        how: "‘운영 관리 → 현장·사용자’에서 등록 상태 확인",
        evidence: [ev("등록 현장", db.sites.length, "곳"), ev("대표·관리자", roles("ceo") + roles("manager"), "명"), ev("현장 직원", roles("field"), "명"), ev("발주처", roles("partner"), "명")],
      },
      {
        key: "authz",
        title: "권한·DB 구조",
        criteria: "역할별 화면·데이터 권한, 서버에서 권한 검사, DB 행 보안",
        how: "역할을 바꿔 로그인해 보이는 화면·금액 차이 확인 · 배포 전 점검(RLS) 결과",
        evidence: [txt("역할", "대표 · 본사 관리자 · 현장 직원 · 발주처 (4개)"), txt("자동 시험", "모든 명령 × 4개 역할 권한 표 · 현장·발주처 금액 비노출"), txt("DB", "모든 표 행 보안(RLS) 켬 · 배포 전 점검 스크립트")],
      },
      {
        key: "strategy",
        title: "특허·벤처·정책금융 전략 초안",
        criteria: "기술사업화 전략 초안 전달",
        how: "별도 문서(이 시스템 밖) 전달 확인",
        evidence: [txt("전달 문서", "별도 문서로 전달 (이 시스템 밖 · 컨설팅 산출물)")],
      },
    ];
  }

  if (stage === 2) {
    const usersIn = new Set(att.map((r) => r.userId));
    const sitesIn = new Set(att.map((r) => r.siteId));
    const inside = att.filter((r) => r.inGeo.status === "inside").length;
    const consented = field.filter((u) => consentState(db, u.id).state === "agreed").length;
    const corrections = att.reduce((a, r) => a + (r.corrections ?? []).filter((c) => inR(c.at)).length, 0);
    const checks = (db.deviceChecks ?? []).filter((c) => field.some((u) => u.id === c.userId));
    const v = (x: "ready" | "warn" | "fail") => checks.filter((c) => deviceVerdict(c) === x).length;
    return [
      {
        key: "S1",
        title: "S1 출퇴근",
        criteria: "모바일에서 현장 선택 후 출·퇴근 기록, 본사에서 날짜·장소·사용자별 확인",
        how: "현장 휴대폰 첫 화면 ‘출근’·‘퇴근’ → 본사 ‘출퇴근 현황’에서 날짜·현장·사람별 확인 → 월 CSV",
        evidence: [ev("출근 기록", att.length), ev("퇴근까지 기록", att.filter((r) => r.outAt).length), ev("출근한 직원", usersIn.size, "명"), ev("현장", sitesIn.size, "곳"), txt("현장 안 판정", att.length ? `${Math.round((inside / att.length) * 100)}%` : "—", att.length > 0)],
      },
      {
        key: "S2",
        title: "S2 예외 정정",
        criteria: "GPS 실패·누락·오등록 → 사유 입력·관리자 확인·수정 이력",
        how: "현장 ‘출퇴근이 잘못 찍혔나요? 수정 요청하기’ → 본사 ‘지시·확인 → 근태 수정 요청’ 승인/반려 → 출퇴근 현황 정정 이력",
        evidence: [
          ev("근태 수정 요청", fixes.length, "건", fixes.length ? ` (승인 ${fixes.filter((q) => q.status === "approved").length} · 반려 ${fixes.filter((q) => q.status === "rejected").length} · 대기 ${fixes.filter((q) => q.status === "pending").length})` : ""),
          ev("본사 정정(사유 기록)", corrections),
          ...(autoFixes ? [txt("통신 불량 자동 확인", `${n(autoFixes)} (위 요청 수에 넣지 않음)`)] : []),
        ],
      },
      {
        key: "S3",
        title: "S3 작업보고",
        criteria: "사진·작업량·진행상태·지연 사유가 작업지시와 연결, 본사 승인·보완 요청",
        how: "본사 ‘지시·확인’에서 작업지시 → 현장 ‘확인했어요’·‘다 했어요’(작업량·사진) → 현장 보고 → 본사 ‘확인’ 또는 ‘보완 요청’",
        evidence: [
          ev("작업지시", orders.length, "건", orders.length ? ` (완료 확인 ${orders.filter((w) => w.status === "confirmed").length})` : ""),
          ev("현장 보고", reports.length, "건", reports.length ? ` (사진 있는 보고 ${reports.filter((r) => r.photoIds.length).length})` : ""),
          ev("작업지시와 연결된 보고", reports.filter((r) => r.workOrderId).length),
          ev("보완 요청", reports.filter((r) => r.review?.status === "returned" || (r.supplements?.length ?? 0) > 0).length),
        ],
      },
      {
        key: "S6",
        title: "S6 권한·보안",
        criteria: "직원은 허용된 현장만, 관리자 승인·변경 이력·기본 내보내기",
        how: "현장 직원으로 로그인해 다른 현장·금액이 안 보이는지 확인 · ‘활동 이력’ 검색·CSV",
        evidence: [ev("활성 사용자", db.users.filter((u) => !u.inactive).length, "명"), ev("기간 중 활동 이력", logs.length, "건", logsMore), txt("자동 시험", "모든 명령 × 4개 역할 권한 표 · 금액 비노출 · 로그인 잠금·요청 제한")],
      },
      {
        key: "device",
        title: "실기기(아이폰·갤럭시) 확인",
        criteria: "현장 휴대폰에서 실제로 동작",
        how: "현장 직원 휴대폰 ‘내 정보 → 내 휴대폰 점검’ → 본사 ‘사용 현황’에서 사람별 결과",
        evidence: [ev("점검한 현장 직원", checks.length, "명", ` / ${field.length}명`), txt("결과", checks.length ? `준비됨 ${v("ready")} · 확인 권장 ${v("warn")} · 고쳐야 함 ${v("fail")}` : "아직 없음", checks.length > 0, "점검 전")],
      },
      {
        key: "privacy",
        title: "위치정보 고지·동의 (별지 제5호)",
        criteria: "위치정보 고지·처리 근거·보관 기간·열람 권한 확정",
        how: "‘운영 관리 → 개인위치정보’ 규칙·직원에게 알리는 내용 확인 · 직원별 동의 현황",
        evidence: [txt("보관 기간", retentionText(policy.retentionDays), policy.retentionDays != null, "아직 안 정함"), txt("좌표 열람", viewersText(policy.viewers)), ev("지금 조건으로 동의한 현장 직원", consented, "명", ` / ${field.length}명`)],
      },
    ];
  }

  if (stage === 3) {
    const teams = new Set(crew.map((c) => c.team.toLowerCase()));
    const costs = db.costEntries.filter((e) => e.status !== "voided" && inD(e.date));
    const answered = partnerReq.filter((r) => r.status === "answered").length;
    const byKind = (k: string) => imports.filter((b) => b.kind === k && !b.undoneAt).length;
    return [
      {
        key: "S4",
        title: "S4 원가집계",
        criteria: "투입시간·단가·자재·외주·기성으로 추정 원가와 실제 발생액 구분, 원천자료 누락 시 확인 필요 표시",
        how: "현장 ‘오늘 작업 인원 알리기’ → 본사 ‘투입·인건비’에서 추정 vs 실제·표시 확인 → 팀 단가 → CSV",
        evidence: [ev("작업 인원 보고", crew.length, "건", crew.length ? ` (${teams.size}팀)` : ""), ev("팀 단가 설정", (db.settings?.teamRates ?? []).length, "팀"), ev("원가 입력", costs.length, "건", costs.length ? ` (확인 대기 ${costs.filter((e) => e.status === "pending").length})` : "")],
      },
      {
        key: "S5",
        title: "S5 대표자 확인",
        criteria: "현장별 공정 진행률·초과투입·지연 이슈·검수 대기 조회",
        how: "‘대시보드’ 현장 손익·처리 대기 → ‘공정 일정’ → ‘대표 보고서’",
        evidence: [ev("진행 중 현장", db.sites.filter((s) => s.status === "active").length, "곳"), ev("공정 진척 기록", logs.filter((l) => l.type === "progress").length, "건", logsMore), ev("작업지시", orders.length)],
      },
      {
        key: "S7",
        title: "S7 고객 기초",
        criteria: "견적문의·주문요청·진행상태 기본 입력과 내부 확인 흐름",
        how: "발주처 포털 ‘견적 문의’·‘주문 요청’ → 본사 처리 대기 → 요청함 검토·회신 → 포털에 ‘회신 완료’",
        evidence: [ev("발주처 계정", db.users.filter((u) => u.role === "partner" && !u.inactive).length, "명"), ev("고객 요청", partnerReq.length, "건", partnerReq.length ? ` (회신 ${answered})` : "")],
      },
      {
        key: "S8",
        title: "S8 일부 프로그램 기능 (자료 입출력)",
        criteria: "합의한 기존 프로그램 기능·자료 입출력이 원가 집계에 연결",
        how: "‘자료 이관·점검’ 엑셀 양식 → 엑셀 파일 올리기 → 현장 손익·기성·인건비 반영 확인 → 필요하면 ‘가져오기 취소’",
        evidence: [
          ev("자료 가져오기", imports.filter((b) => !b.undoneAt).length, "번", ` (넣은 행 ${imports.filter((b) => !b.undoneAt).reduce((a, b) => a + b.count, 0)})`),
          txt("종류", `기성·입금 ${byKind("billing")} · 변경공사 ${byKind("change")} · 출력 ${byKind("crew")} · 팀 단가 ${byKind("rates")} · 원가 ${byKind("cost")}`, imports.length > 0),
        ],
      },
    ];
  }

  // 4단계
  const u = usageSummary(db, from, to, now);
  const fb = (db.feedback ?? []).filter((f) => inR(f.at));
  const st = (s: "new" | "done" | "hold") => fb.filter((f) => f.status === s).length;
  return [
    {
      key: "usage",
      title: "실사용 검증 (시범 운영)",
      criteria: "현장 1~2곳에서 2주 이상 실제 사용",
      how: "‘사용 현황’ 기간 선택 → 사람별 정착도·본사 응답 시간 → CSV 첨부",
      evidence: [ev("정착한 현장 직원", u.settled, "명", ` / ${u.field.length}명`), ev("기간 중 출근 기록", att.length), ev("기간 중 현장 보고", reports.length)],
    },
    {
      key: "feedback",
      title: "피드백 반영·오류",
      criteria: "실사용 피드백 반영, 오류 0건",
      how: "‘오류·의견’ 기간 선택 → 의견 반영·보류 처리 확인 → 앱 오류 기록 → CSV 첨부",
      evidence: [ev("앱 의견", fb.length, "건", fb.length ? ` (${FEEDBACK_STATUS_LABEL.done} ${st("done")} · ${FEEDBACK_STATUS_LABEL.hold} ${st("hold")} · ${FEEDBACK_STATUS_LABEL.new} ${st("new")})` : ""), errors
          ? (() => {
              const q = qualitySummary([], errors, from, to).errors;
              // 서버는 최근 300묶음만 보낸다 — 잘렸으면 ‘이상’ (0회로 잘못 보이지 않게 · 리뷰 반영)
              const more = errorsTruncated ? " 이상 (최근 기록만 셈 — ‘오류·의견’ 화면 확인)" : "";
              return txt("기록된 앱 오류", q.total ? `${n(q.total, "회")}${more} (${q.kinds}종류 · 오류 난 날 ${q.errorDays}일)` : `0회${more}`);
            })()
          : txt("앱 오류 기록", "‘오류·의견’ 화면 (운영 모드 자동 기록)", false, IS_LIVE_HINT),
      ],
    },
    {
      key: "handover",
      title: "인수인계·운영 매뉴얼",
      criteria: "계정 이전(회사 명의)·운영 매뉴얼·백업 실습",
      how: "인수인계서(docs/HANDOVER.md) 체크리스트 · ‘사용 안내’ 인쇄본 전달 · ‘전체 자료 내려받기’ 실습",
      evidence: [txt("확인", "계정 소유(회사 명의) · 관리자 2명 이상 · 매뉴얼 인쇄본 · 백업 실습 — 아래 체크"), ev("본사 관리자", db.users.filter((x) => (x.role === "ceo" || x.role === "manager") && !x.inactive).length, "명")],
    },
  ];
}
