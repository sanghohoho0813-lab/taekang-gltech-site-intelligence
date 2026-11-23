/**
 * 직원 가입 안내 (D-91) — 본사가 카카오톡·문자·QR·A4 안내문으로 가입 신청 주소를 보낸다.
 * 주소의 ‘누구용’(?k=)은 신청 화면에서 미리 골라 둘 뿐이다 — 역할·현장은 승인 담당이 승인할 때 정한다(권한이 생기지 않음, D-90).
 */
export type InviteKind = "field" | "manager" | "partner";

export const INVITE_KINDS: { value: InviteKind; label: string; who: string }[] = [
  { value: "field", label: "현장 직원용", who: "현장 직원" },
  { value: "manager", label: "본사 직원용", who: "본사 직원" },
  { value: "partner", label: "발주처용", who: "발주처·협력사" },
];

export const isInviteKind = (v: unknown): v is InviteKind => v === "field" || v === "manager" || v === "partner";

export const inviteWho = (kind: InviteKind) => INVITE_KINDS.find((k) => k.value === kind)!.who;

/** ‘현장 직원’을 · ‘발주처·협력사’를 — 마지막 글자 받침으로 을/를 */
export function eulReul(word: string): string {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 !== 0 ? "을" : "를";
}

/** 고를 항목 + 조사 (예: ‘현장 직원’을) */
export const whoQuoted = (kind: InviteKind) => `‘${inviteWho(kind)}’${eulReul(inviteWho(kind))}`;

/** 가입 신청 주소 — 이 운영 주소(origin)의 /signup */
export const inviteUrl = (origin: string, kind: InviteKind) => `${origin}/signup?k=${kind}`;

/** 카카오톡·문자로 보낼 글 */
export function inviteMessage(companyName: string, kind: InviteKind, url: string, phone?: string): string {
  return [
    `[${companyName}] 현장 관리 앱 가입 안내`,
    "",
    "아래 주소를 눌러 가입 신청해 주세요.",
    url,
    "",
    "① 이름·휴대폰 번호·이메일(로그인 아이디)·비밀번호를 적습니다.",
    `② ‘어떤 일로 쓰시나요?’에서 ${whoQuoted(kind)} 확인하고 ‘가입 신청하기’를 누릅니다.`,
    "③ 본사가 승인하면 그 이메일과 비밀번호로 로그인됩니다. 승인 전에는 ‘승인 대기’라고 나옵니다.",
    "④ 로그인한 뒤 휴대폰 홈 화면에 추가해 두면 앱처럼 바로 열 수 있습니다.",
    ...(phone ? ["", `문의: 본사 ${phone}`] : []),
  ].join("\n");
}
