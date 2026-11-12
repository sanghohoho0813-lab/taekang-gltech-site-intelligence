/**
 * 하자 접수 링크 (D-74) — 준공 뒤에는 발주처 담당이 바뀌고 관리사무소가 넘겨받는다. 계정을 만들어 줄 수 없는 사람이
 * 주소·QR로 하자를 접수하고(위치·내용·사진·연락처), 받은 ‘진행 확인 주소’로 보수 진행을 본다.
 *
 * 원칙
 * - 접수 주소로는 접수만 된다. 현장 이름과 접수 화면 말고는 아무것도 보이지 않는다.
 * - 진행 확인 주소는 그 접수 한 건만 보여 준다: 본인이 적은 내용, 진행 단계, 본사 회신, 보수 사진. 담당자 이름·내부 메모·금액은 없다.
 * - 접수자 이름·연락처는 본사(대표·공무)만 본다. 현장 휴대폰·발주처 계정·보고서·링크에는 가지 않는다.
 *   처리 끝난 뒤 90일이 지나면 이름·연락처를 지운다.
 * - 무상·유상, 법정 하자 기간은 화면이 말하지 않는다 (계약서 기준).
 */
import type { CompanySettings, DefectIntake, DemoDB, PartnerRequest, Site, WorkOrder } from "./types";
import { DEFECT_STEPS, defectProgress, partnerRepairView } from "./partnerFeed";
import { base64url } from "./share";
import { hex, sha256, utf8 } from "./hmac";
export { photoLooksReal } from "./photoSniff";

/** 접수 주소: 16바이트 난수 → 22자 (QR이 단순해지도록 짧게 · 접수만 되는 주소) */
export const INTAKE_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
/** 진행 확인 주소: 24바이트 난수 → 32자 (내용을 볼 수 있는 주소) */
export const INTAKE_STATUS_RE = /^[A-Za-z0-9_-]{32}$/;
/** 한 현장에 열어 둘 수 있는 접수 링크 수 */
export const INTAKE_MAX_OPEN_PER_SITE = 5;
/** 접수 링크 하나가 하루에 받는 접수 수 (장난·기계 접수 방지 — 넘으면 전화로) */
export const INTAKE_DAILY_LIMIT = 40;
/** 한 곳(같은 인터넷 주소)이 링크 하나로 하루에 보낼 수 있는 접수 수 — 한 곳이 하루 한도를 다 써서 다른 사람이 접수하지 못하게 되는 것을 줄인다 */
export const INTAKE_SOURCE_DAILY_LIMIT = 15;
/** 처리 끝난 뒤 접수자 이름·연락처를 보관하는 기간 (일) */
export const INTAKE_CONTACT_KEEP_DAYS = 90;
/** 끝내지 않은(회신·보수가 끝나지 않은) 접수의 이름·연락처를 보관하는 기간 (일) — 잊힌 접수에 남의 번호가 영원히 남지 않게 */
export const INTAKE_OPEN_KEEP_DAYS = 180;
export const INTAKE_MAX_PHOTOS = 3;
/** 접수 사진 한 장 크기 (글자 수 · 약 700KB) — 화면이 1280px JPEG로 줄여 보내므로 넉넉하다. 내부 사진(2.5MB)보다 작게 잡아 저장소를 채우지 못하게 */
export const INTAKE_MAX_PHOTO_CHARS = 950_000;
/** ‘아직 문제가 있습니다’로 다시 접수할 수 있는 횟수 (넘으면 전화로) */
export const INTAKE_MAX_REOPEN = 3;

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

/** 주소 비밀값 만들기 — 글자·숫자로 끝나게 (메신저·인쇄물에서 끝이 잘리지 않게) */
export function newToken(random: (n: number) => Uint8Array, bytes: number): string {
  for (;;) {
    const t = base64url(random(bytes));
    if (/^[A-Za-z0-9]/.test(t) && /[A-Za-z0-9]$/.test(t)) return t;
  }
}
export const tokenHash = (token: string) => hex(sha256(utf8(token)));

/** 접수 화면이 만든 번호(난수) — 응답을 못 받고 다시 보낼 때 같은 접수로 알아보는 데 쓴다 */
export const INTAKE_IDEM_RE = /^[A-Za-z0-9_-]{20,60}$/;
/**
 * 진행 확인 주소의 비밀값을 접수 주소와 화면 난수에서 만든다 (24바이트 → 32자, 글자·숫자로 시작하고 끝남).
 * 통신이 끊겨 응답을 못 받고 다시 보내도 같은 주소가 나오므로, 접수자가 접수 번호와 주소를 받지 못하는 일이 없다.
 * 화면 난수(그 휴대폰만 안다)를 모르면 접수 주소를 가진 다른 사람도 만들 수 없다.
 */
export function statusTokenFor(intakeToken: string, idem: string): string {
  for (let n = 0; ; n++) {
    const t = base64url(sha256(utf8(`intake-status:${intakeToken}:${idem}:${n}`)).slice(0, 24));
    if (/^[A-Za-z0-9]/.test(t) && /[A-Za-z0-9]$/.test(t)) return t;
  }
}

export type IntakeState = "open" | "closed";
export const intakeState = (i: Pick<DefectIntake, "closedAt">): IntakeState => (i.closedAt ? "closed" : "open");

/** 전화번호 — 숫자만 남기고 02-123-4567 · 010-1234-5678 꼴로. 맞지 않으면 null */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let d = raw.replace(/[^\d]/g, "");
  // +82 10-1234-5678 · 821012345678 (휴대폰 자동 완성이 넣는 꼴) → 010…
  if (/^82[1-9]\d{7,9}$/.test(d)) d = `0${d.slice(2)}`;
  if (!/^0\d{8,10}$/.test(d)) return null;
  if (d.startsWith("02")) return d.length === 9 ? `02-${d.slice(2, 5)}-${d.slice(5)}` : d.length === 10 ? `02-${d.slice(2, 6)}-${d.slice(6)}` : null;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return null;
}

/** 회사 대표전화 — 일반 번호(02·031·010·070…)와 대표번호(1588-1234 꼴)를 받는다. 맞지 않으면 null */
export function normalizeOfficePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.replace(/[^\d]/g, "");
  if (/^1[5-8]\d{6}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return normalizePhone(raw);
}
/** tel: 주소 — 숫자만 */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d]/g, "")}`;

/**
 * 접수 번호 — 그날(한국 날짜) 회사 전체에서 몇 번째 링크 접수인지: 1112-1.
 * 현장끼리 겹치지 않고(전화로 번호만 말해도 찾는다), 버린 접수의 번호를 다시 쓰지 않는다(일련번호를 따로 기억).
 */
export function nextIntakeSeq(settings: Pick<CompanySettings, "intakeSeq"> | undefined, atIso: string): { no: string; seq: { day: string; n: number } } {
  const day = kst(atIso);
  const n = (settings?.intakeSeq?.day === day ? settings.intakeSeq.n : 0) + 1;
  return { no: `${day.slice(5, 7)}${day.slice(8, 10)}-${n}`, seq: { day, n } };
}

/** 오늘 이 링크로 들어온 접수 수 (다시 접수한 건은 세지 않는다) */
export function intakeCountToday(db: Pick<DemoDB, "partnerRequests">, intakeId: string, atIso: string): number {
  const day = kst(atIso);
  return db.partnerRequests.filter((r) => r.intake?.id === intakeId && !r.reopenedFrom && kst(r.createdAt) === day).length;
}
/** 접수한 곳의 표시 — 그날·그 링크에서만 통하는 해시 (주소 자체는 저장하지 않는다) */
export function intakeSourceKey(intakeId: string, atIso: string, source: string): string {
  return hex(sha256(utf8(`intake-src:${intakeId}:${kst(atIso)}:${source}`))).slice(0, 16);
}
/** 오늘 이 링크로 같은 곳에서 들어온 접수 수 */
export function intakeSourceCountToday(db: Pick<DemoDB, "partnerRequests">, intakeId: string, atIso: string, srcKey: string): number {
  const day = kst(atIso);
  return db.partnerRequests.filter((r) => r.intake?.id === intakeId && r.intakeSrc === srcKey && !r.reopenedFrom && kst(r.createdAt) === day).length;
}
/** 오늘 이 링크는 한도에 닿았는가 — 접수 화면을 열 때 미리 알려 준다 */
export const intakeFullToday = (db: Pick<DemoDB, "partnerRequests">, intakeId: string, atIso: string) => intakeCountToday(db, intakeId, atIso) >= INTAKE_DAILY_LIMIT;


/** 접수 화면에 보이는 것 (주소로 열었을 때) — 회사·현장 이름뿐 */
export interface IntakeFormView {
  company: string;
  siteName: string;
  /** 회사 전화번호 (본사가 넣어 둔 경우) — 접수하는 사람이 전화할 곳 */
  phone?: string;
  /** 오늘 이 주소로 받을 수 있는 접수가 다 찼다 — 다 적은 뒤에 거절하지 않게 미리 알린다 */
  full?: true;
  /** 가상 시연 데이터 회사 */
  sample?: true;
}

/** 진행 확인 화면에 보이는 것 — 그 접수 한 건. 담당자·내부 메모·금액·작업지시 번호 없음 */
export interface IntakeStatusView {
  company: string;
  /** 회사 전화번호 (본사가 넣어 둔 경우) */
  phone?: string;
  siteName: string;
  no: string;
  location: string;
  description: string;
  createdAt: string;
  /** 단계 막대에서 지금 자리 (steps의 순번) */
  step: number;
  label: string;
  steps: readonly string[];
  /** 지금 단계를 풀어 쓴 한 문장 — 다음에 무슨 일이 있는지 */
  hint: string;
  /** 보수 없이 답변으로 끝낸 건 (하자 아님·전화로 처리 등) — ‘보수’라는 말을 쓰지 않는다 */
  noRepair?: true;
  /** 보수 목표일 (작업지시 기한) — 보수가 끝나기 전, 아직 지나지 않았을 때만 */
  dueDate?: string;
  reply?: string;
  repliedAt?: string;
  /** 접수할 때 보낸 사진 수 — 원본은 이 주소로 다시 내주지 않는다 (올린 파일이 공개 주소가 되지 않게) */
  sentPhotos: number;
  /** 본사가 회신에 붙인 보수 완료 사진 (번호만 — 원본은 진행 확인 주소로만 받는다) */
  photos: { id: string; kind: "repair" }[];
  confirmedAt?: string;
  confirmNote?: string;
  /** ‘확인했습니다’·‘아직 문제가 있습니다’를 누를 수 있는가 (보수가 끝나고 회신을 받은 뒤) */
  canConfirm: boolean;
  /** ‘아직 문제가 있습니다’로 다시 접수할 수 있는가 (횟수 안) */
  canReopen: boolean;
  /** 다시 접수한 건이면 앞 접수 번호와 그때 받은 답변 */
  prev?: { no: string; reply?: string };
  sample?: true;
}

/** 보수 없이 답변으로 끝낸 건의 단계 */
export const INTAKE_NO_REPAIR_STEPS = ["접수", "검토", "답변 완료", "확인 완료"] as const;

/** 확인할 수 있는가 — 발주처 계정의 확인과 같은 규칙 (회신 받음 · 보수 끝남 · 아직 확인 전) */
export function intakeCanConfirm(r: Pick<PartnerRequest, "status" | "confirmedAt" | "type" | "closedWithoutRepair" | "linkedWorkOrderId" | "history">, workOrders: WorkOrder[]): boolean {
  if (r.status !== "answered" || r.confirmedAt) return false;
  const repair = partnerRepairView({ workOrders }, r);
  if (repair) return repair.stage === "done";
  return !!r.closedWithoutRepair;
}

/** 이 접수가 몇 번째 다시 접수인지 (처음 = 0) */
export function intakeRound(db: Pick<DemoDB, "partnerRequests">, r: Pick<PartnerRequest, "reopenedFrom">): number {
  let n = 0;
  let cur = r.reopenedFrom;
  while (cur && n < 10) {
    n++;
    cur = db.partnerRequests.find((x) => x.id === cur)?.reopenedFrom;
  }
  return n;
}

/**
 * 처리가 끝난 때 — 접수자가 확인했거나, 보수가 끝났거나(본사 확인·회신), 보수 없이 ‘처리 끝’으로 회신한 때.
 * 일정만 안내한 회신은 끝이 아니다 (보수 전에 연락처가 지워지지 않게 · 점검 10차).
 */
export function intakeFinishedAt(r: PartnerRequest, workOrders: WorkOrder[]): string | undefined {
  if (r.confirmedAt) return r.confirmedAt;
  const repair = partnerRepairView({ workOrders }, r);
  if (repair) return repair.stage === "done" ? repair.at : undefined;
  if (r.closedWithoutRepair) return [...r.history].reverse().find((h) => h.status === "answered")?.at ?? r.updatedAt;
  return undefined;
}

/** 발주처에 나가는 문서(월간·준공 보고서)에 세는 접수인가 — 링크로 들어온 것은 본사가 손댄 뒤에만 센다 (장난 접수가 그대로 보고서 건수가 되지 않게) */
export const intakeCountable = (r: Pick<PartnerRequest, "intake" | "status" | "linkedWorkOrderId">) => !r.intake || r.status !== "received" || !!r.linkedWorkOrderId;

export function intakeStatusView(a: {
  company: string;
  phone?: string;
  sample?: boolean;
  site: Pick<Site, "name"> | undefined;
  req: PartnerRequest;
  workOrder?: WorkOrder;
  /** 다시 접수한 건이면 앞 접수 */
  prev?: Pick<PartnerRequest, "intake" | "reply">;
  /** 몇 번째 다시 접수인지 */
  round?: number;
  /** 오늘 (한국 날짜) — 지난 목표일은 보여 주지 않는다 */
  today?: string;
}): IntakeStatusView {
  const { req } = a;
  const workOrders = a.workOrder ? [a.workOrder] : [];
  const repair = partnerRepairView({ workOrders }, req);
  const prog = defectProgress(req, repair);
  const answered = [...req.history].reverse().find((h) => h.status === "answered" && !(h.note ?? "").startsWith("발주처 확인"))?.at;
  const canConfirm = intakeCanConfirm(req, workOrders);
  const noRepair = !repair && !!req.closedWithoutRepair;
  let step = prog.step;
  let label = prog.label;
  let hint: string;
  if (req.confirmedAt) {
    step = noRepair ? 3 : 4;
    hint = "확인해 주셔서 감사합니다.";
  } else if (noRepair) {
    step = 2;
    label = "답변 완료";
    hint = "시공사가 답변을 남겼습니다. 아래 답변을 확인해 주세요.";
  } else if (!repair) {
    label = req.status === "answered" ? "접수 · 답변 받음" : req.status === "reviewing" ? "접수 · 검토 중" : "접수";
    hint = req.status === "answered" ? "시공사가 답변을 남겼습니다. 보수 일정이 정해지면 여기에 표시됩니다." : a.prev ? "다시 접수되었습니다. 담당자가 다시 확인하고 있습니다." : "접수했습니다. 담당자가 내용을 확인하고 있습니다.";
  } else if (repair.stage === "done") hint = canConfirm ? "보수를 마쳤습니다. 아래 답변과 사진을 보시고 확인해 주세요." : "보수를 마쳤습니다. 곧 시공사 답변이 올라옵니다.";
  else if (repair.stage === "checking") hint = "현장 작업을 마쳤고, 시공사가 결과를 확인하고 있습니다.";
  else if (repair.stage === "in_progress") hint = "보수를 진행하고 있습니다.";
  else hint = "보수할 담당자가 정해졌습니다.";
  const dueOk = !!repair?.dueDate && (repair.stage === "assigned" || repair.stage === "in_progress") && (!a.today || repair.dueDate >= a.today);
  return {
    company: a.company,
    ...(a.phone ? { phone: a.phone } : {}),
    siteName: a.site?.name ?? "현장",
    no: req.intake?.no ?? "",
    location: req.location ?? "",
    description: req.description,
    createdAt: req.createdAt,
    step,
    label,
    steps: noRepair ? INTAKE_NO_REPAIR_STEPS : DEFECT_STEPS,
    hint,
    ...(noRepair ? { noRepair: true as const } : {}),
    ...(dueOk ? { dueDate: repair!.dueDate } : {}),
    ...(req.reply ? { reply: req.reply, ...(answered ? { repliedAt: answered } : {}) } : {}),
    sentPhotos: (req.photoIds ?? []).length,
    photos: (req.replyPhotoIds ?? []).map((id) => ({ id, kind: "repair" as const })),
    ...(req.confirmedAt ? { confirmedAt: req.confirmedAt, ...(req.confirmNote ? { confirmNote: req.confirmNote } : {}) } : {}),
    canConfirm,
    canReopen: canConfirm && (a.round ?? 0) < INTAKE_MAX_REOPEN,
    ...(a.prev?.intake ? { prev: { no: a.prev.intake.no, ...(a.prev.reply ? { reply: a.prev.reply } : {}) } } : {}),
    ...(a.sample ? { sample: true as const } : {}),
  };
}

/**
 * 접수 제목 — 접수자가 적은 내용의 앞부분 (‘하자 접수 · 위치’는 위치를 되풀이할 뿐 무엇이 문제인지 알려 주지 않는다 · 점검 10차).
 * 위치는 따로 보여 주므로 제목에 넣지 않는다.
 */
export function intakeTitle(description: string, location: string): string {
  const first = description.split(/\n/)[0].replace(/\s+/g, " ").trim();
  const t = first.length > 40 ? `${first.slice(0, 39)}…` : first;
  return t || `하자 접수 · ${location}`.slice(0, 80);
}

/**
 * 작업지시를 받은 보수 담당자에게 보일 접수자 연락처 — 본사가 ‘연락처 보여 주기’를 고른 작업지시만, 본사가 완료를 확인하기 전까지만.
 * (이름·전화번호가 지워졌으면 없다)
 */
export function workOrderContact(db: Pick<DemoDB, "partnerRequests">, w: Pick<WorkOrder, "showContact" | "status" | "sourcePartnerRequestId">): { who: string; phone?: string } | undefined {
  if (!w.showContact || w.status === "confirmed" || !w.sourcePartnerRequestId) return undefined;
  const c = db.partnerRequests.find((r) => r.id === w.sourcePartnerRequestId)?.intake;
  if (!c || (!c.name && !c.phone)) return undefined;
  return { who: [c.org, c.name].filter(Boolean).join(" ") || "접수자", ...(c.phone ? { phone: c.phone } : {}) };
}

/** 어떻게 들어온 접수인지 — ‘링크 접수’ / ‘전화 접수’(본사가 전화로 받아 등록) */
export const intakeVia = (c: { id: string }) => (c.id === "phone" ? "전화 접수" : "링크 접수");

/** 본사 화면에 보일 접수자 한 줄 — ‘관리사무소 홍길동’ (지웠으면 ‘연락처 삭제됨’) */
export function intakeContactLabel(r: Pick<PartnerRequest, "intake">): string {
  const c = r.intake;
  if (!c) return "";
  const who = [c.org, c.name].filter(Boolean).join(" ");
  return who || (c.purgedAt ? "접수자 정보 삭제됨" : "접수자");
}

/** 현장의 접수 링크 (열린 것 먼저, 최근 것부터) */
export function intakesOf(db: Pick<DemoDB, "intakes">, siteId: string): DefectIntake[] {
  return (db.intakes ?? []).filter((i) => i.siteId === siteId).sort((a, b) => Number(!!a.closedAt) - Number(!!b.closedAt) || b.createdAt.localeCompare(a.createdAt));
}

/** 본사가 접수자에게 보낼 문자 (회신 뒤) — 금액 없음 */
export function intakeReplyMessage(a: { company: string; no: string; url?: string }): string {
  return `[${a.company}] 접수하신 하자(접수 번호 ${a.no})에 답변드렸습니다.${a.url ? `\n아래 주소에서 진행 상황을 보실 수 있습니다.\n${a.url}` : ""}`;
}
