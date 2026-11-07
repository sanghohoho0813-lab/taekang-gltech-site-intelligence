/**
 * AX 상세설계서 (계약 1단계 산출물 · D-59) — 화면·권한·데이터 구조·업무 흐름.
 * 실제 시스템 정의(명령 목록·데이터 컬렉션·메뉴·화면 경로)를 기준으로 쓰고, 시험(tests/unit/designSpec.test.ts)이
 * 서버 권한 검사·역할별 전송 데이터·화면 코드와 맞는지 확인한다 → 시스템이 바뀌면 설계서도 함께 고쳐야 시험이 통과한다.
 * 금액·계약 조건은 넣지 않는다.
 */
import type { CommandName } from "@/lib/data/registry";
import type { CollectionName } from "@/server/state";
import type { RoleId } from "@/lib/domain/types";

/** all = 전부 · own = 담당 현장·본인 것만 · no = 안 됨 */
export type Allow = "all" | "own" | "no";
export type CmdGroup = "field" | "review" | "money" | "ops" | "privacy" | "partner";

export const ROLE_ORDER: RoleId[] = ["ceo", "manager", "field", "partner"];
export const ROLE_NAME: Record<RoleId, string> = { ceo: "대표", manager: "본사 관리자", field: "현장 직원", partner: "발주처" };
export const ROLE_DESC: Record<RoleId, string> = {
  ceo: "모든 화면·금액·설정. 개인위치정보 규칙(보관 기간·열람 범위)은 대표만 정한다.",
  manager: "현장·사용자 관리, 지시·확인, 원가·기성·수금. 대표 계정과 개인위치정보 규칙은 바꿀 수 없다.",
  field: "담당 현장의 출퇴근·보고·작업 인원·본사 요청 처리. 금액·이익률·다른 사람 위치는 받지 않는다.",
  partner: "공개된 현장의 공정 진행과 본인의 견적 문의·주문 요청만. 내부 원가·이익·미수는 받지 않는다.",
};

export const CMD_GROUP_LABEL: Record<CmdGroup, string> = {
  field: "현장 기록",
  review: "본사 지시·확인",
  money: "원가·기성·수금",
  ops: "운영 설정·자료",
  privacy: "개인위치정보",
  partner: "발주처",
};

const HQ: Record<RoleId, Allow> = { ceo: "all", manager: "all", field: "no", partner: "no" };
const FIELD: Record<RoleId, Allow> = { ceo: "all", manager: "all", field: "own", partner: "no" };
const CEO_ONLY: Record<RoleId, Allow> = { ceo: "all", manager: "no", field: "no", partner: "no" };
const PARTNER: Record<RoleId, Allow> = { ceo: "all", manager: "all", field: "no", partner: "own" };

/** 서버가 실행을 허락하는 일 — 모든 명령이 빠짐없이 들어가야 한다(타입으로 강제) */
export const COMMAND_SPEC: Record<CommandName, { label: string; group: CmdGroup; allow: Record<RoleId, Allow> }> = {
  checkIn: { label: "출근", group: "field", allow: FIELD },
  checkOut: { label: "퇴근", group: "field", allow: FIELD },
  confirmQr: { label: "현장 QR 확인", group: "field", allow: FIELD },
  submitFieldReport: { label: "현장 보고 보내기 (작업·사진·문제·비용)", group: "field", allow: FIELD },
  voidReport: { label: "보낸 보고 취소", group: "field", allow: FIELD },
  supplementReport: { label: "보완 요청에 보완 보고", group: "field", allow: FIELD },
  updateProgress: { label: "공정률·공정 진척 갱신", group: "field", allow: FIELD },
  reportCrew: { label: "작업 인원(출력) 알리기", group: "field", allow: FIELD },
  recordMaterial: { label: "자재 반입·설치 수량 남기기 (사진 선택)", group: "field", allow: FIELD },
  voidMaterialMove: { label: "잘못 넣은 자재 기록 취소 (사유 필수 · 현장은 본인 기록만)", group: "field", allow: FIELD },
  requestAttendanceFix: { label: "근태 수정 요청", group: "field", allow: FIELD },
  workOrderStep: { label: "작업지시 접수·진행·완료", group: "field", allow: FIELD },
  reportDeviceCheck: { label: "내 휴대폰 점검 결과 보내기", group: "field", allow: FIELD },
  sendFeedback: { label: "앱 의견 보내기", group: "field", allow: FIELD },
  setActionStatus: { label: "본사 요청(조치) 진행·보류", group: "review", allow: FIELD },
  addActionNote: { label: "본사 요청(조치)에 메모·사진", group: "review", allow: FIELD },
  completeAction: { label: "본사 요청(조치) 완료 보고 — 확정은 본사", group: "review", allow: FIELD },
  createWorkOrder: { label: "작업지시 보내기", group: "review", allow: HQ },
  reviewWorkOrder: { label: "작업지시 완료 확인·보완 요청", group: "review", allow: HQ },
  reviewReport: { label: "현장 보고 확인·보완 요청", group: "review", allow: HQ },
  reviewAttendanceFix: { label: "근태 수정 요청 승인·반려", group: "review", allow: HQ },
  correctAttendance: { label: "출퇴근 정정 (사유 필수·이력)", group: "review", allow: HQ },
  createAction: { label: "위험 신호 → 조치 만들기", group: "review", allow: HQ },
  assignAction: { label: "조치 담당자 배정", group: "review", allow: HQ },
  confirmProofEvent: { label: "조치 성과 기록 확인", group: "review", allow: HQ },
  reviewFeedback: { label: "앱 의견 반영·보류", group: "review", allow: HQ },
  editCostEntry: { label: "내가 올린 추가 비용 고치기 (본사 확인 전)", group: "money", allow: FIELD },
  voidCostEntry: { label: "추가 비용 취소", group: "money", allow: FIELD },
  reviewCostEntry: { label: "공무 확인 — 비용 금액 확정", group: "money", allow: HQ },
  updateForecast: { label: "잔여 예상 원가 수정", group: "money", allow: HQ },
  setChangeOrderStatus: { label: "변경공사 승인", group: "money", allow: HQ },
  addBilling: { label: "기성 청구 등록", group: "money", allow: HQ },
  addPayment: { label: "입금 등록", group: "money", allow: HQ },
  importCostRows: { label: "원가 엑셀 가져오기", group: "money", allow: HQ },
  saveSite: { label: "현장 등록·수정 (계약·실행예산·담당·공정 단계)", group: "ops", allow: HQ },
  setSiteGeo: { label: "현장 위치·반경 등록", group: "ops", allow: HQ },
  setSiteMaterials: { label: "현장 주요 자재 품목·설계 수량 정하기", group: "ops", allow: HQ },
  setSiteWarranty: { label: "현장 하자보증 기간·준공일 정하기 (계약서 기준 · 금액 없음)", group: "partner", allow: HQ },
  setPhotoShare: { label: "발주처 포털에 현장 사진 공개·비공개", group: "partner", allow: HQ },
  setCompanySettings: { label: "운영 설정 (본사 전화·기본 일당·반영 방식)", group: "ops", allow: HQ },
  setThresholds: { label: "위험 기준 (목표 이익률 등)", group: "ops", allow: HQ },
  importData: { label: "지난 자료 엑셀 가져오기 (기성·변경공사·출력·팀 단가·원가·자재 수량)", group: "ops", allow: HQ },
  undoImport: { label: "가져오기 취소 (7일 안)", group: "ops", allow: HQ },
  createKiosk: { label: "현장 QR 태블릿 등록", group: "ops", allow: HQ },
  revokeKiosk: { label: "현장 QR 태블릿 해제", group: "ops", allow: HQ },
  setLocationPolicy: { label: "위치정보 보관 기간·좌표 열람 범위", group: "privacy", allow: CEO_ONLY },
  purgeLocationsNow: { label: "기간 지난 좌표 지금 지우기", group: "privacy", allow: CEO_ONLY },
  purgeMemberLocations: { label: "직원 한 명의 좌표 지우기", group: "privacy", allow: CEO_ONLY },
  withdrawLocationConsent: { label: "위치 기록 동의 철회 (본인)", group: "privacy", allow: FIELD },
  createPartnerRequest: { label: "견적 문의·주문 요청·하자보수 요청 보내기 (사진 3장까지)", group: "partner", allow: PARTNER },
  updatePartnerRequest: { label: "고객 요청 검토·회신 (보수 완료 사진 함께)", group: "partner", allow: HQ },
  confirmPartnerRequest: { label: "회신·보수 완료 확인 (본인 요청만)", group: "partner", allow: PARTNER },
};

/** 화면 밖에서 하는 계정 관리 (명령 목록이 아닌 전용 서버 기능) */
export const ACCOUNT_SPEC: { label: string; allow: Record<RoleId, Allow> }[] = [
  { label: "사용자 추가·역할·담당 현장·비밀번호 초기화·비활성화·모든 기기 로그아웃 (대표 계정은 대표만)", allow: HQ },
  { label: "전체 자료 내려받기 (백업)", allow: CEO_ONLY },
  { label: "앱 오류 기록 보기", allow: HQ },
  { label: "회사 전체 활동 이력 검색·내려받기", allow: HQ },
];

/** 역할별로 받는 데이터. "—" = 아예 보내지 않음 */
export const DATA_NONE = "—";
export interface CollectionSpec {
  label: string;
  holds: string;
  field: string;
  partner: string;
  keep: string;
}
export const COLLECTION_SPEC: Record<CollectionName, CollectionSpec> = {
  sites: { label: "현장", holds: "현장명·발주처·공사 기간·공정률·공정 단계·담당·출퇴근 위치와 반경·주요 자재 품목(설계 수량)·하자보증 기간·준공일(금액 없음)", field: "담당 현장만 (하자보증 메모 빼고)", partner: "공개된 현장만 (자재 품목·하자보증 메모 빼고)", keep: "준공 뒤에도 보관" },
  contracts: { label: "계약", holds: "원 계약 금액·계약일·실행예산 합계", field: "금액 0으로 바꿔 보냄", partner: "금액 0으로 바꿔 보냄", keep: "보관" },
  budgets: { label: "실행예산", holds: "공종(자재·노무·외주·장비·경비)별 실행예산", field: DATA_NONE, partner: DATA_NONE, keep: "보관" },
  forecasts: { label: "잔여 예상 원가", holds: "공종별 앞으로 더 들 비용 (본사 추정)", field: DATA_NONE, partner: DATA_NONE, keep: "보관" },
  costEntries: { label: "원가·추가 비용", holds: "현장·공종·금액·내용·확인 상태·수정 이력", field: "본인이 올린 것 (최근 60일·확인 대기)", partner: DATA_NONE, keep: "보관 (무효 처리는 이력으로 남음)" },
  reports: { label: "현장 보고", holds: "작업 내용·사진·문제·공정 진척·본사 확인·보완", field: "담당 현장 최근 60일 (동료의 위치 좌표는 빼고)", partner: DATA_NONE, keep: "보관" },
  photos: { label: "사진", holds: "현장 보고·작업 인원·자재 반입·설치·작업지시·조치 사진·발주처 하자 사진 (원본은 별도 저장)", field: "담당 현장 관련 사진", partner: "본사가 공개한 공정 사진 · 본인이 보낸 하자 사진 · 본인 요청의 보수 완료 사진", keep: "보관" },
  changeOrders: { label: "변경공사", holds: "변경 내용·요청 금액·승인 금액·상태", field: DATA_NONE, partner: DATA_NONE, keep: "보관" },
  billings: { label: "기성 청구", holds: "회차·청구일·금액", field: DATA_NONE, partner: DATA_NONE, keep: "보관" },
  payments: { label: "입금", holds: "입금일·금액", field: DATA_NONE, partner: DATA_NONE, keep: "보관" },
  partnerRequests: { label: "발주처 요청", holds: "견적 문의·주문 요청(품목·수량·희망일)·하자보수(위치·사진·보수 작업지시)·회신·발주처 확인", field: DATA_NONE, partner: "본인이 보낸 것만 (작업지시 번호 없이 보수 단계·기한만)", keep: "보관" },
  actions: { label: "위험 조치 (본사 요청)", holds: "위험 신호에서 만든 할 일·담당·기한·진행·결과", field: "본인 배정분 (금액이 든 근거 문구는 빼고)", partner: DATA_NONE, keep: "보관" },
  proofEvents: { label: "조치 성과 기록", holds: "조치 전후 지표·확인 여부", field: "확인 여부만", partner: DATA_NONE, keep: "보관" },
  activityLogs: { label: "활동 이력", holds: "누가·언제·무엇을 했는지 (지워지지 않음)", field: "본인 것만", partner: DATA_NONE, keep: "지우지 않음 (화면에는 최근 300건, 전체는 검색)" },
  attendance: { label: "출퇴근", holds: "서버 시각·현장·판정(현장 안/밖)·위도·경도·오차·거리·기기 번호·정정 이력", field: "본인 것 최근 60일", partner: DATA_NONE, keep: "시각·판정은 보관 · 좌표는 회사가 정한 보관 기간 뒤 자동 삭제" },
  consents: { label: "위치 기록 동의", holds: "동의 시각·동의할 때 알린 보관 기간·열람 범위", field: "본인 것", partner: DATA_NONE, keep: "철회해도 이력 보관" },
  deviceChecks: { label: "휴대폰 점검 결과", holds: "위치·사진·알림·저장 공간 점검 결과 (좌표 없음)", field: "본인 것", partner: DATA_NONE, keep: "사람별 마지막 1건" },
  feedback: { label: "앱 의견", holds: "의견 종류·내용·반영/보류·답변", field: "본인 것", partner: DATA_NONE, keep: "보관" },
  kiosks: { label: "현장 QR 태블릿", holds: "현장·이름·연결 상태 (비밀값은 누구에게도 보내지 않음)", field: DATA_NONE, partner: DATA_NONE, keep: "해제 뒤에도 이력 보관" },
  crewChecks: { label: "작업 인원(출력)", holds: "팀·직영/외주·인원·단체 사진·위치 판정", field: "담당 현장 최근 60일", partner: DATA_NONE, keep: "보관" },
  attendanceRequests: { label: "근태 수정 요청", holds: "날짜·무엇이 잘못됐는지·요청 시각·사유·승인/반려", field: "본인 것", partner: DATA_NONE, keep: "보관" },
  workOrders: { label: "작업지시", holds: "지시 내용·받는 사람·기한·접수→진행→완료→확인 이력·작업량·사진", field: "본인에게 온 것", partner: DATA_NONE, keep: "보관" },
  importBatches: { label: "자료 가져오기 기록", holds: "종류·건수·건너뛴 행·취소 여부", field: DATA_NONE, partner: DATA_NONE, keep: "보관" },
  materialMoves: { label: "자재 반입·설치", holds: "품목·반입/설치·수량·날짜·사진·메모·취소 사유 (금액 없음)", field: "담당 현장 것 (누계가 맞도록 기간 제한 없음)", partner: DATA_NONE, keep: "보관 (취소는 지우지 않고 표시)" },
};

/** 회사 데이터 밖의 서버 표 */
export const SERVER_TABLES: { name: string; holds: string }[] = [
  { name: "회사", holds: "회사명·데이터 버전 (여러 서버가 같은 데이터를 보도록)" },
  { name: "사용자 계정", holds: "이메일·이름·역할·담당 현장. 비밀번호는 되돌릴 수 없는 방식(scrypt)으로만 저장" },
  { name: "로그인 세션", holds: "기기별 로그인 (쓰는 동안 30일 연장, 처음 로그인 후 180일 상한)" },
  { name: "사진 원본", holds: "사진 파일 (로그인하고 권한이 있는 사람만 열람)" },
  { name: "휴대폰 알림 구독·앱 오류 기록", holds: "알림을 켠 기기 주소, 개인정보를 지운 오류 기록 (본사만 열람)" },
];

/** 현장 직원 전용 화면 (메뉴 밖) */
export const FIELD_SCREENS: { href: string; label: string; desc: string }[] = [
  { href: "/field", label: "현장 홈", desc: "출근·퇴근, 오늘 보고 상태, 보고·작업 인원·사진·추가 비용·본사 요청 바로가기" },
  { href: "/field/report", label: "보고하기", desc: "현장 → 작업 → 사진 → 문제 → 비용 → 확인, 누르기만으로" },
  { href: "/field/crew", label: "작업 인원 알리기", desc: "팀별 인원과 단체 사진" },
  { href: "/field/material", label: "자재 반입·설치", desc: "들어온 수량·설치한 수량(사진 선택) — 본사가 품목을 정한 현장만, 금액 없음" },
  { href: "/field/fix", label: "근태 수정 요청", desc: "날짜 → 무엇이 잘못됐는지 → 시각 → 사유" },
  { href: "/field/check", label: "내 휴대폰 점검", desc: "위치·사진·알림·저장 공간 1분 점검" },
  { href: "/my-actions", label: "본사 요청", desc: "작업지시·조치 — ‘확인했어요’·‘다 했어요’" },
  { href: "/my", label: "내 정보", desc: "내가 보낸 보고, 내 위치 기록·동의 철회, 앱 의견, 글자 크기·비밀번호" },
  { href: "/help/quick", label: "그림 안내 1장", desc: "버튼을 그림으로 보는 사용법" },
];

/** 업무 흐름 — ‘…’ 안은 화면에 보이는 버튼 이름 그대로 (시험이 화면 코드와 대조) */
export interface FlowStep {
  who: RoleId;
  text: string;
}
export const FLOWS: { key: string; title: string; steps: FlowStep[] }[] = [
  {
    key: "day",
    title: "현장 직원의 하루",
    steps: [
      { who: "field", text: "현장에 도착해 ‘출근하기’ — 처음 한 번 위치 기록 동의, 서버가 시각·현장 안/밖 판정" },
      { who: "field", text: "아침에 ‘오늘 작업 인원 알리기’ — 팀별 인원·단체 사진" },
      { who: "field", text: "‘본사 요청’에 온 작업지시를 ‘확인했어요’ → 끝나면 ‘다 했어요’(작업량·사진)" },
      { who: "field", text: "자재가 들어오거나 설치하면 ‘자재 반입·설치 남기기’ — 수량·사진, 본사 공사일보와 현장 자재 현황에 바로 반영" },
      { who: "field", text: "일이 끝나면 ‘오늘 보고하기’ — 작업·사진·문제·추가 비용, 마지막에 ‘본사로 보내기’" },
      { who: "field", text: "‘퇴근하기’ — 잘못 찍혔으면 ‘출퇴근이 잘못 찍혔나요? 수정 요청하기’" },
    ],
  },
  {
    key: "hq",
    title: "본사 지시·확인",
    steps: [
      { who: "manager", text: "대시보드 ‘처리 대기’에서 확인할 것을 본다 (보고·근태 요청·작업지시·인건비·고객 요청)" },
      { who: "manager", text: "‘지시·확인’에서 작업지시를 보내고, 현장 보고를 ‘확인’ 또는 ‘보완 요청’" },
      { who: "manager", text: "근태 수정 요청을 승인·반려 — 승인하면 출퇴근 기록이 정정되고 이력이 남는다" },
      { who: "manager", text: "‘출퇴근 현황’에서 현장 밖·위치 없음·같은 휴대폰 등 확인할 항목을 본다" },
      { who: "manager", text: "‘공사일보’·‘사진대장’은 현장 기록으로 자동 작성되어 인쇄만 한다" },
    ],
  },
  {
    key: "money",
    title: "원가·기성 (대표·본사)",
    steps: [
      { who: "manager", text: "현장 등록 — 원 계약 금액·실행예산 5개 공종·현장 담당·공정 단계" },
      { who: "field", text: "현장 보고의 추가 비용이 ‘확인 대기’로 들어온다 (현장에는 금액 판단 정보가 가지 않음)" },
      { who: "manager", text: "공무 확인으로 금액을 확정하면 손익에 반영 (발생 원가 + 잔여 예상 원가 = 예상 총원가)" },
      { who: "manager", text: "‘투입·인건비’에서 작업 인원 × 팀 단가 추정과 실제 노무비를 비교" },
      { who: "ceo", text: "‘기성·수금’에서 변경공사·기성 청구·입금·미수를 보고, ‘대표 보고서’로 현장별 손익 변화를 본다" },
    ],
  },
  {
    key: "partner",
    title: "발주처",
    steps: [
      { who: "partner", text: "발주처 포털에서 공개된 현장의 공정 진행을 본다" },
      { who: "partner", text: "‘견적 문의’ 또는 ‘주문 요청’(품목·수량·희망일)을 보낸다" },
      { who: "manager", text: "본사 요청함에서 검토·회신 — 내부 원가·이익은 회신에 쓰지 않는다" },
      { who: "partner", text: "포털에 ‘회신 완료’와 답변이 보인다" },
    ],
  },
];

/** 계약 별지 핵심 모듈 → 화면 */
export const MODULES: { no: string; name: string; routes: string[]; note: string }[] = [
  { no: "01", name: "GPS 근태·현장 확인", routes: ["/field", "/field/fix", "/attendance", "/orders"], note: "출퇴근(동의·서버 판정)·근태 수정 요청·본사 승인·정정 이력·현장 QR(선택)" },
  { no: "02", name: "현장 업무보고", routes: ["/field/report", "/field/crew", "/field/material", "/orders", "/daily", "/photos"], note: "작업지시와 연결된 보고·사진·작업 인원·자재 반입·설치 수량·공사일보·사진대장 자동 작성" },
  { no: "03", name: "본사-현장 소통", routes: ["/orders", "/my-actions", "/audit"], note: "지시→접수→진행→완료→확인, 보완 요청, 휴대폰 알림, 활동 이력" },
  { no: "04", name: "공정·투입 원가", routes: ["/sites", "/schedule", "/labor", "/finance"], note: "현장 손익·공정 일정·투입 인건비 추정 vs 실제·기성·변경공사·자재 설치율·기성 청구 지연 표시" },
  { no: "05", name: "대표자 통합 현황판", routes: ["/dashboard", "/report", "/insights"], note: "처리 대기·현장별 손익·위험 신호(규칙 기반)·대표 보고서" },
  { no: "06", name: "고객·협력사 초기화면", routes: ["/partner", "/partner/report", "/defects"], note: "공개 현장 진행·공정 사진·견적 문의·주문 요청·하자보수(사진·보수 진행·확인·본사 하자보수 현황·관리대장)·월간 공정 보고서 (내부 금액 비노출)" },
  { no: "07", name: "기존 프로그램 일부 기능", routes: ["/data"], note: "엑셀 가져오기 6종(기성·입금 / 변경공사 / 출력 / 팀 단가 / 원가 / 자재 반입·설치)·내려받기 — 합의 항목은 계약에 따라 확정" },
];

/** 보안·개인정보 설계 */
export const SECURITY: { title: string; text: string }[] = [
  { title: "권한은 서버가 지킨다", text: "화면이 아니라 서버가 모든 요청의 역할·담당 현장·작성자를 다시 확인한다. 현장 직원·발주처에게는 계약·원가·이익·기성·미수가 아예 전송되지 않는다." },
  { title: "DB 직접 접근 차단", text: "모든 표에 행 수준 보안(RLS)을 켜고 공개 API로는 아무것도 읽을 수 없게 했다. 이 앱의 서버만 DB에 접근한다." },
  { title: "로그인", text: "비밀번호는 되돌릴 수 없는 방식으로 저장, 여러 번 틀리면 잠금, 첫 로그인 때 본인이 비밀번호를 바꾼다. 휴대폰을 잃어버리면 ‘모든 기기 로그아웃’." },
  { title: "출퇴근 시각·위치", text: "시각은 서버 시계로만 기록한다. 버튼을 누를 때 한 번만 위치를 확인하고 계속 추적하지 않는다. 현장 안/밖은 서버가 거리로 판정한다." },
  { title: "개인위치정보", text: "동의한 직원만 좌표를 저장한다. 보관 기간이 지나면 좌표를 자동 삭제하고, 좌표 열람 범위(대표만 / 대표·관리자)는 대표가 정한다. 직원은 자기 기록을 보고 동의를 철회할 수 있다." },
  { title: "이력", text: "누가·언제·무엇을 바꿨는지 활동 이력에 남고 지워지지 않는다. 출퇴근 정정·근태 승인·사용자 관리도 모두 남는다." },
  { title: "웹 보안", text: "보안 헤더(외부 스크립트·다른 사이트 안에 넣기 차단), 다른 사이트에서 보낸 쓰기 요청 차단, 로그인 실패·요청 횟수 제한." },
];
