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
import type { DefectIntake, DemoDB, PartnerRequest, Site, WorkOrder } from "./types";
import { DEFECT_STEPS, defectProgress, partnerRepairView } from "./partnerFeed";
import { base64url } from "./share";
import { hex, sha256, utf8 } from "./hmac";

/** 접수 주소: 16바이트 난수 → 22자 (QR이 단순해지도록 짧게 · 접수만 되는 주소) */
export const INTAKE_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
/** 진행 확인 주소: 24바이트 난수 → 32자 (내용을 볼 수 있는 주소) */
export const INTAKE_STATUS_RE = /^[A-Za-z0-9_-]{32}$/;
/** 한 현장에 열어 둘 수 있는 접수 링크 수 */
export const INTAKE_MAX_OPEN_PER_SITE = 5;
/** 접수 링크 하나가 하루에 받는 접수 수 (장난·기계 접수 방지 — 넘으면 전화로) */
export const INTAKE_DAILY_LIMIT = 20;
/** 처리 끝난 뒤 접수자 이름·연락처를 보관하는 기간 (일) */
export const INTAKE_CONTACT_KEEP_DAYS = 90;
export const INTAKE_MAX_PHOTOS = 3;

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
  const d = raw.replace(/[^\d]/g, "");
  if (!/^0\d{8,10}$/.test(d)) return null;
  if (d.startsWith("02")) return d.length === 9 ? `02-${d.slice(2, 5)}-${d.slice(5)}` : d.length === 10 ? `02-${d.slice(2, 6)}-${d.slice(6)}` : null;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return null;
}

/** 접수 번호 — 그날(한국 날짜) 그 현장의 몇 번째 링크 접수인지: 1112-1 */
export function nextIntakeNo(db: Pick<DemoDB, "partnerRequests">, siteId: string, atIso: string): string {
  const day = kst(atIso);
  const n = db.partnerRequests.filter((r) => r.siteId === siteId && r.intake && kst(r.createdAt) === day).length;
  return `${day.slice(5, 7)}${day.slice(8, 10)}-${n + 1}`;
}

/** 오늘 이 링크로 들어온 접수 수 */
export function intakeCountToday(db: Pick<DemoDB, "partnerRequests">, intakeId: string, atIso: string): number {
  const day = kst(atIso);
  return db.partnerRequests.filter((r) => r.intake?.id === intakeId && kst(r.createdAt) === day).length;
}

/** 접수 화면에 보이는 것 (주소로 열었을 때) — 회사·현장 이름뿐 */
export interface IntakeFormView {
  company: string;
  siteName: string;
  /** 가상 시연 데이터 회사 */
  sample?: true;
}

/** 진행 확인 화면에 보이는 것 — 그 접수 한 건. 담당자·내부 메모·금액·작업지시 번호 없음 */
export interface IntakeStatusView {
  company: string;
  siteName: string;
  no: string;
  location: string;
  description: string;
  createdAt: string;
  /** 0 접수 · 1 보수 배정 · 2 보수 중 · 3 보수 완료 · 4 확인 완료 */
  step: number;
  label: string;
  steps: readonly string[];
  /** 보수 예정일 (작업지시 기한) */
  dueDate?: string;
  reply?: string;
  repliedAt?: string;
  /** 보낸 사진·보수 완료 사진 (번호만 — 원본은 진행 확인 주소로만 받는다) */
  photos: { id: string; kind: "sent" | "repair" }[];
  confirmedAt?: string;
  /** ‘확인했습니다’를 누를 수 있는가 (보수가 끝나고 회신을 받은 뒤) */
  canConfirm: boolean;
  sample?: true;
}

/** 확인할 수 있는가 — 발주처 계정의 확인과 같은 규칙 (회신 받음 · 보수 끝남 · 아직 확인 전) */
export function intakeCanConfirm(r: Pick<PartnerRequest, "status" | "confirmedAt" | "type" | "closedWithoutRepair" | "linkedWorkOrderId" | "history">, workOrders: WorkOrder[]): boolean {
  if (r.status !== "answered" || r.confirmedAt) return false;
  const repair = partnerRepairView({ workOrders }, r);
  if (repair) return repair.stage === "done";
  return !!r.closedWithoutRepair;
}

export function intakeStatusView(a: { company: string; sample?: boolean; site: Pick<Site, "name"> | undefined; req: PartnerRequest; workOrder?: WorkOrder }): IntakeStatusView {
  const { req } = a;
  const workOrders = a.workOrder ? [a.workOrder] : [];
  const repair = partnerRepairView({ workOrders }, req);
  const prog = defectProgress(req, repair);
  const answered = req.history.find((h) => h.status === "answered")?.at;
  return {
    company: a.company,
    siteName: a.site?.name ?? "현장",
    no: req.intake?.no ?? "",
    location: req.location ?? "",
    description: req.description,
    createdAt: req.createdAt,
    step: prog.step,
    label: prog.label,
    steps: DEFECT_STEPS,
    ...(repair?.dueDate && prog.step < 3 ? { dueDate: repair.dueDate } : {}),
    ...(req.reply ? { reply: req.reply, ...(answered ? { repliedAt: answered } : {}) } : {}),
    photos: [...(req.photoIds ?? []).map((id) => ({ id, kind: "sent" as const })), ...(req.replyPhotoIds ?? []).map((id) => ({ id, kind: "repair" as const }))],
    ...(req.confirmedAt ? { confirmedAt: req.confirmedAt } : {}),
    canConfirm: intakeCanConfirm(req, workOrders),
    ...(a.sample ? { sample: true as const } : {}),
  };
}

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
  return `[${a.company}] 접수하신 하자(접수 번호 ${a.no})에 회신드렸습니다.${a.url ? `\n아래 주소에서 진행 상황을 보실 수 있습니다.\n${a.url}` : ""}`;
}
