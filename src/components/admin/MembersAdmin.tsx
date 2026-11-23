"use client";

/**
 * 운영 관리 · 사용자 — 추가(임시 비밀번호), 역할·담당 현장, 비밀번호 초기화, 일시 정지, 로그인된 기기·모든 기기 로그아웃
 * 회원가입 신청(D-90): 승인(역할·현장) · 승인 안 함(이유) · 지우기 — 가입 승인 담당(대표 권한 또는 지정된 본사관리자)만
 */
import { useCallback, useEffect, useState } from "react";
import { helpPhoneOf } from "@/lib/domain/companyPhone";
import { ChevronDown, KeyRound, LogOut, Pencil, Plus, Printer, ShieldCheck, Trash2, UserRound, UserX, UserCheck, UserPlus } from "lucide-react";
import { fmtDateTime, fmtRelative } from "@/lib/domain/format";
import type { DemoDB, RoleId } from "@/lib/domain/types";
import { ROLE_LABEL } from "@/lib/domain/labels";
import { api } from "@/lib/live/api";
import { liveFetch } from "@/lib/data/store";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Notice, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { tempPassword } from "@/lib/domain/password";
import { SlipPrintDialog, type Slip } from "./LoginSlips";
import { InviteCard } from "./InviteCard";

interface MemberView {
  id: string;
  email: string;
  name: string;
  title: string;
  role: RoleId;
  siteIds: string[];
  partnerSiteIds: string[];
  active: boolean;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  devices: number;
  lastSeenAt: string | null;
  approver?: boolean;
  signupStatus: "pending" | "approved" | "rejected" | null;
  signup: { phone: string; kind: SignupKind; note: string; requestedAt: string; decidedAt?: string; decidedByName?: string; reason?: string } | null;
  createdAt: string | null;
}
type SignupKind = "field" | "manager" | "partner" | "other";
const KIND_LABEL: Record<SignupKind, string> = { field: "현장 직원", manager: "본사 직원", partner: "발주처·협력사", other: "그 밖" };
const KIND_ROLE: Record<SignupKind, RoleId> = { field: "field", manager: "manager", partner: "partner", other: "field" };
type Me = { id: string; role: RoleId; approver: boolean };

const ROLES: RoleId[] = ["ceo", "manager", "field", "partner"];
const ROLE_HELP: Record<RoleId, string> = {
  ceo: "모든 화면·설정",
  manager: "손익·정산·조치 관리, 현장·사용자 관리 (대표 계정은 못 바꿈)",
  field: "담당 현장 보고·내 조치만 (금액·이익률 안 보임)",
  partner: "지정 현장의 공정·요청만 (내부 정보 안 보임)",
};

export function MembersAdmin({ db, me }: { db: DemoDB; me: Me }) {
  const toast = useToast();
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemberView | "new" | null>(null);
  const [approving, setApproving] = useState<MemberView | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  /** 이 화면에서 만든 임시 비밀번호들 — 로그인 쪽지로 한 번에 인쇄 (새로고침하면 사라짐 · 저장 안 함) */
  const [issuedAll, setIssuedAll] = useState<Issued[]>([]);
  const [slipOpen, setSlipOpen] = useState(false);
  const remember = (x: Issued) => {
    setIssued(x);
    setIssuedAll((all) => [...all.filter((a) => a.id !== x.id), x]);
  };
  const [askOut, setAskOut] = useState<string | null>(null);
  const signOut = async (m: MemberView) => {
    const r = await api<{ devices: number }>(`/api/admin/members/${encodeURIComponent(m.id)}/signout`, { method: "POST", body: {} });
    setAskOut(null);
    if (!r.ok) return void toast.push({ tone: "err", title: r.error ?? "실패" });
    toast.push({ tone: "ok", title: `모든 기기에서 로그아웃시켰습니다 (${r.data?.devices ?? 0}대)`, desc: `${m.name} — 휴대폰 알림도 해제됨. 다시 쓰려면 아이디·비밀번호로 로그인합니다.` });
    await load();
  };

  const load = useCallback(async () => {
    const r = await api<{ members: MemberView[] }>("/api/admin/members");
    if (r.ok && r.data) {
      setMembers(r.data.members);
      setError(null);
    } else setError(r.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (m: MemberView, body: Record<string, unknown>, ok: string) => {
    const r = await api<{ member: MemberView }>(`/api/admin/members/${encodeURIComponent(m.id)}`, { method: "PATCH", body });
    if (!r.ok) {
      toast.push({ tone: "err", title: r.error ?? "실패" });
      return false;
    }
    toast.push({ tone: "ok", title: ok, desc: `${m.name} ${m.title}` });
    await load();
    void liveFetch();
    return true;
  };

  const siteNames = (ids: string[]) => ids.map((id) => db.sites.find((s) => s.id === id)?.shortName).filter(Boolean).join(", ");
  const assignedSites = (m: MemberView) => (m.role === "field" ? db.sites.filter((s) => s.fieldUserId === m.id || m.siteIds.includes(s.id)).map((s) => s.shortName).join(", ") : m.role === "partner" ? siteNames(m.partnerSiteIds) : "전체");

  // 가입 신청(승인 대기·승인 안 함)은 사용자 목록과 따로 (D-90)
  const signups = (members ?? []).filter((m) => m.signupStatus === "pending");
  const rejected = (members ?? []).filter((m) => m.signupStatus === "rejected");
  const people = (members ?? []).filter((m) => m.signupStatus !== "pending" && m.signupStatus !== "rejected");

  return (
    <div className="space-y-5">
    <InviteCard db={db} approver={!!me.approver} />
    <SignupsCard db={db} me={me} signups={signups} rejected={rejected} loaded={!!members} onApprove={setApproving} onDone={async () => (await load(), void liveFetch())} />
    <Card data-testid="admin-members">
      <CardHeader
        title={members ? `사용자 ${people.filter((m) => m.active).length}명` : "사용자"}
        sub="계정은 회사 이메일로 만들고, 처음 로그인할 때 본인이 비밀번호를 바꿉니다"
        right={
          <Button variant="cta" icon={<Plus size={17} />} onClick={() => setEditing("new")} disabled={!me.approver} title={me.approver ? undefined : "계정 추가는 가입 승인 담당만 할 수 있습니다"} data-testid="member-new">
            사용자 추가
          </Button>
        }
      />
      {issued && (
        <div className="px-5 pb-3">
          <Notice tone="ok" title={`${issued.name} 계정 — 임시 비밀번호를 전달하세요 (이 화면을 닫으면 다시 볼 수 없음)`}>
            <span className="num" data-testid="issued-password">
              아이디 <b>{issued.email}</b> · 임시 비밀번호 <b className="rounded bg-surface px-1.5 py-0.5 tracking-wider">{issued.password}</b>
            </span>
            <span className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="cta" icon={<Printer size={15} />} onClick={() => setSlipOpen(true)} data-testid="issued-slips">
                로그인 쪽지 인쇄 ({issuedAll.length}장)
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
                닫기
              </Button>
            </span>
          </Notice>
        </div>
      )}
      {error && (
        <div className="px-5 pb-3">
          <Notice tone="err" title={error} />
        </div>
      )}
      {!members ? (
        <p className="px-5 pb-5 text-[0.85rem] text-ink-3">불러오는 중…</p>
      ) : people.length === 0 ? (
        <EmptyState icon={<UserRound size={30} />} title="사용자가 없습니다" />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {people.map((m) => (
            <li key={m.id} className={cx("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3", !m.active && "opacity-60")} data-testid="member-row">
              <div className="min-w-[14rem] flex-1">
                <p className="font-bold">
                  {m.name} <span className="font-medium text-ink-3">{m.title}</span>
                </p>
                <p className="text-[0.78rem] text-ink-3">{m.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={m.role === "ceo" ? "theme" : m.role === "manager" ? "info" : m.role === "field" ? "ok" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>
                {(m.role === "ceo" || m.approver) && (
                  <Badge tone="theme" data-testid="member-approver">
                    가입 승인 담당
                  </Badge>
                )}
                {!m.active && <Badge tone="err">일시 정지</Badge>}
                {m.lockedUntil && <Badge tone="err">로그인 잠김</Badge>}
                {m.active && m.mustChangePassword && <Badge tone="warn">첫 로그인 전</Badge>}
              </div>
              <p className="min-w-[10rem] text-[0.8rem] text-ink-2">{assignedSites(m) || "담당 현장 없음"}</p>
              <p className="min-w-[9rem] text-[0.78rem] text-ink-3" data-testid="member-devices" data-devices={m.devices}>
                {m.devices ? `로그인된 기기 ${m.devices}대` : "로그인된 기기 없음"}
                {m.lastSeenAt ? ` · 마지막 사용 ${fmtRelative(m.lastSeenAt)}` : ""}
              </p>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setEditing(m)} disabled={m.role === "ceo" && me.role !== "ceo"}>
                  수정
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<KeyRound size={14} />}
                  disabled={!m.active || (m.role === "ceo" && me.role !== "ceo")}
                  onClick={async () => {
                    // 한 번 잘못 누르면 그 사람이 바로 로그인하지 못한다 — 이름을 넣어 한 번 더 묻는다 (D-77 리허설)
                    if (!window.confirm(`${m.name}${m.title ? ` ${m.title}` : ""}의 비밀번호를 새로 만들까요?\n지금 쓰는 비밀번호로는 더 이상 로그인할 수 없고, 새 임시 비밀번호를 쪽지로 전해 주어야 합니다.`)) return;
                    const pw = tempPassword();
                    if (await patch(m, { password: pw }, "비밀번호를 초기화했습니다")) remember({ id: m.id, name: m.name, title: m.title, role: m.role, email: m.email, password: pw, siteIds: m.role === "partner" ? m.partnerSiteIds : m.siteIds });
                  }}
                  data-testid="member-reset"
                >
                  비밀번호 초기화
                </Button>
                {m.id !== me.id && m.devices > 0 && (
                  <Button size="sm" variant="ghost" icon={<LogOut size={14} />} disabled={m.role === "ceo" && me.role !== "ceo"} onClick={() => setAskOut(m.id)} data-testid="member-signout">
                    모든 기기 로그아웃
                  </Button>
                )}
                {/* 일시 정지·다시 사용은 가입 승인 담당만 (D-90) — 정지하면 바로 로그인이 끊기고 다시 들어올 수 없다 */}
                {m.id !== me.id && me.approver && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={m.active ? <UserX size={14} /> : <UserCheck size={14} />}
                    disabled={m.role === "ceo" && me.role !== "ceo"}
                    onClick={() => void patch(m, { active: !m.active }, m.active ? "일시 정지했습니다 (기존 로그인도 바로 종료)" : "다시 사용할 수 있게 했습니다")}
                    data-testid="member-suspend"
                  >
                    {m.active ? "일시 정지" : "다시 사용"}
                  </Button>
                )}
              </div>
              {askOut === m.id && (
                <div className="basis-full rounded-xl border border-err/30 bg-err-bg px-3.5 py-2.5 text-[0.84rem]" role="alertdialog" aria-label={`${m.name} 모든 기기 로그아웃 확인`}>
                  <p className="font-semibold">{m.name}의 휴대폰·PC {m.devices}대에서 바로 로그아웃시키고 휴대폰 알림도 끕니다. 휴대폰을 잃어버렸을 때 쓰세요.</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setAskOut(null)}>
                      취소
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => void signOut(m)} data-testid="member-signout-yes">
                      로그아웃시키기
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {slipOpen && <SlipPrintDialog slips={issuedAll.map((x) => toSlip(db, x))} phone={helpPhoneOf(db.settings)} onClose={() => setSlipOpen(false)} />}
      {editing && (
        <MemberModal
          db={db}
          me={me}
          member={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (issuedPw) => {
            if (issuedPw) remember(issuedPw);
            setEditing(null);
            await load();
            void liveFetch();
          }}
        />
      )}
      {approving && (
        <ApproveModal
          db={db}
          me={me}
          member={approving}
          onClose={() => setApproving(null)}
          onDone={async () => {
            setApproving(null);
            await load();
            void liveFetch();
          }}
        />
      )}
    </Card>
    </div>
  );
}

// ───────────── 회원가입 신청 (D-90) ─────────────

function SignupsCard({ db, me, signups, rejected, loaded, onApprove, onDone }: { db: DemoDB; me: Me; signups: MemberView[]; rejected: MemberView[]; loaded: boolean; onApprove: (m: MemberView) => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showRejected, setShowRejected] = useState(false);
  const [busy, setBusy] = useState(false);
  void db;
  if (!loaded || (!signups.length && !rejected.length)) return null;
  const act = async (m: MemberView, body: Record<string, unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    const r = await api(`/api/admin/members/${encodeURIComponent(m.id)}/signup`, { body });
    setBusy(false);
    if (!r.ok) return void toast.push({ tone: "err", title: r.error ?? "실패" });
    toast.push({ tone: "ok", title: ok, desc: m.name });
    setRejecting(null);
    setReason("");
    await onDone();
  };
  const when = (iso?: string) => (iso ? fmtDateTime(iso) : "");
  return (
    <Card id="signups" className="scroll-mt-24" data-testid="signups-card">
      <CardHeader
        title={signups.length ? `가입 신청 ${signups.length}건 — 승인 대기` : "가입 신청"}
        sub={me.approver ? "승인하면 역할·현장을 정하고 바로 로그인할 수 있게 됩니다. 모르는 사람이면 ‘승인 안 함’ — 로그인할 수 없습니다." : "가입 승인은 가입 승인 담당(대표 권한 또는 지정된 본사 담당)만 할 수 있습니다."}
      />
      {signups.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {signups.map((m) => (
            <li key={m.id} className="space-y-2 px-5 py-3.5" data-testid="signup-row">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-[14rem] flex-1">
                  <p className="font-bold">
                    {m.name} {m.title && <span className="font-medium text-ink-3">{m.title}</span>} <Badge tone="warn">승인 대기</Badge>
                  </p>
                  <p className="text-[0.8rem] text-ink-2">
                    {m.email}
                    {m.signup?.phone ? ` · ${m.signup.phone}` : ""} · {m.signup ? KIND_LABEL[m.signup.kind] : ""}
                  </p>
                  {m.signup?.note && <p className="text-[0.8rem] text-ink-2">남긴 말: {m.signup.note}</p>}
                  <p className="text-[0.74rem] text-ink-3">신청 {when(m.signup?.requestedAt ?? m.createdAt ?? undefined)}</p>
                </div>
                {me.approver && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="cta" icon={<UserPlus size={15} />} onClick={() => onApprove(m)} data-testid="signup-approve">
                      승인
                    </Button>
                    <Button size="sm" variant="ghost" icon={<UserX size={15} />} onClick={() => (setRejecting(m.id), setReason(""))} data-testid="signup-reject">
                      승인 안 함
                    </Button>
                  </div>
                )}
              </div>
              {rejecting === m.id && (
                <div className="rounded-xl border border-err/30 bg-err-bg px-3.5 py-2.5 text-[0.84rem]" role="alertdialog" aria-label={`${m.name} 승인 안 함`}>
                  <p className="font-semibold">{m.name}님의 가입을 승인하지 않습니다. 이 이메일로는 로그인할 수 없고, 30일 뒤 신청 기록이 지워집니다.</p>
                  <input className={cx(inputCls, "mt-2")} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="이유 (선택) — 예: 회사 사람이 아님" data-testid="signup-reject-reason" aria-label="승인 안 함 이유" />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                      닫기
                    </Button>
                    <Button size="sm" variant="danger" loading={busy} onClick={() => void act(m, { action: "reject", reason }, "가입을 승인하지 않았습니다")} data-testid="signup-reject-yes">
                      승인 안 함
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => void act(m, { action: "delete" }, "가입 신청을 지웠습니다")} data-testid="signup-delete">
                      기록 없이 지우기 (장난·중복)
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!signups.length && <p className="px-5 pb-3 text-[0.84rem] text-ink-3">승인 대기 중인 신청이 없습니다.</p>}
      {rejected.length > 0 && (
        <div className="border-t border-line px-5 pb-3 pt-2">
          <button type="button" className="inline-flex items-center gap-1 text-[0.8rem] font-semibold text-ink-2" onClick={() => setShowRejected((v) => !v)} aria-expanded={showRejected} data-testid="signup-rejected-toggle">
            <ChevronDown size={14} className={cx("transition-transform", showRejected && "rotate-180")} aria-hidden />
            승인 안 함 {rejected.length}건 (30일 뒤 자동으로 지워짐)
          </button>
          {showRejected && (
            <ul className="mt-1.5 space-y-1.5 text-[0.82rem]" data-testid="signup-rejected">
              {rejected.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 text-ink-2">
                    <b className="text-ink">{m.name}</b> {m.email} — {m.signup?.reason || "이유 없음"}{" "}
                    <span className="text-[0.74rem] text-ink-3">
                      ({m.signup?.decidedByName ?? ""} {when(m.signup?.decidedAt)})
                    </span>
                  </span>
                  {me.approver && (
                    <span className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onApprove(m)} data-testid="signup-reapprove">
                        다시 승인
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => void act(m, { action: "delete" }, "가입 신청 기록을 지웠습니다")}>
                        지우기
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function ApproveModal({ db, me, member, onClose, onDone }: { db: DemoDB; me: Me; member: MemberView; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [role, setRole] = useState<RoleId>(member.signup ? KIND_ROLE[member.signup.kind] : "field");
  const [title, setTitle] = useState(member.title);
  const [sites, setSites] = useState<string[]>([]);
  const [approver, setApprover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const roles = ROLES.filter((r) => r !== "ceo" || me.role === "ceo");
  const save = async () => {
    if (busy) return;
    setBusy(true);
    const r = await api(`/api/admin/members/${encodeURIComponent(member.id)}/signup`, {
      body: { action: "approve", role, title, siteIds: role === "field" ? sites : [], partnerSiteIds: role === "partner" ? sites : [], ...(me.role === "ceo" && role === "manager" ? { approver } : {}) },
    });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.push({ tone: "ok", title: "가입을 승인했습니다 — 바로 로그인할 수 있습니다", desc: `${member.name} · ${ROLE_LABEL[role]}${approver && role === "manager" ? " · 가입 승인 담당" : ""}` });
    await onDone();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`가입 승인 · ${member.name}`}
      description={`${member.email}${member.signup ? ` · 신청: ${KIND_LABEL[member.signup.kind]}` : ""}. 승인하면 본인이 정한 비밀번호로 바로 로그인합니다.`}
      size="md"
      testId="approve-form"
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button variant="cta" icon={<ShieldCheck size={16} />} onClick={save} loading={busy} data-testid="approve-save">
            승인
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="직함" htmlFor="ap-title">
          <input id="ap-title" className={inputCls} value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder="예) 현장소장" />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[0.88rem] font-semibold">역할</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((r) => (
              <label key={r} className={cx("press cursor-pointer rounded-xl border px-3 py-2.5 text-[0.84rem]", role === r ? "border-active bg-active-soft" : "border-line hover:bg-surface-2")}>
                <input type="radio" name="ap-role" className="sr-only" checked={role === r} onChange={() => (setRole(r), setSites([]))} data-testid={`ap-role-${r}`} />
                <span className="block font-bold">{ROLE_LABEL[r]}</span>
                <span className="block text-[0.74rem] text-ink-3">{ROLE_HELP[r]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {(role === "field" || role === "partner") && db.sites.length > 0 && (
          <fieldset>
            <legend className="mb-1.5 text-[0.88rem] font-semibold">{role === "field" ? "담당 현장" : "공개할 현장"}</legend>
            <div className="flex flex-wrap gap-2">
              {db.sites.map((s) => {
                const on = sites.includes(s.id);
                return (
                  <label key={s.id} className={cx("press cursor-pointer rounded-full border px-3 py-1.5 text-[0.82rem] font-semibold", on ? "border-active bg-active-soft text-theme-ink" : "border-line")}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => setSites(on ? sites.filter((x) => x !== s.id) : [...sites, s.id])} />
                    {s.shortName}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
        {me.role === "ceo" && role === "manager" && (
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line px-3 py-2.5 text-[0.84rem]" data-testid="ap-approver">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={approver} onChange={(e) => setApprover(e.target.checked)} />
            <span>
              <b>가입 승인 담당으로 지정</b>
              <span className="block text-[0.76rem] text-ink-3">가입 신청 승인·승인 안 함, 계정 추가, 일시 정지를 할 수 있습니다.</span>
            </span>
          </label>
        )}
        {err && <Notice tone="err" title={err} />}
      </div>
    </Modal>
  );
}

interface Issued {
  id: string;
  name: string;
  title: string;
  role: RoleId;
  email: string;
  password: string;
  siteIds: string[];
}

/** 쪽지에 쓸 담당 현장 이름 (현장 담당으로 지정된 현장 포함) */
function toSlip(db: DemoDB, x: Issued): Slip {
  const sites = db.sites.filter((s) => s.status !== "completed" && (x.siteIds.includes(s.id) || (x.role === "field" && s.fieldUserId === x.id))).map((s) => s.shortName);
  return { id: x.id, name: x.name, title: x.title, role: x.role, email: x.email, password: x.password, sites };
}

function MemberModal({ db, me, member, onClose, onSaved }: { db: DemoDB; me: Me; member: MemberView | null; onClose: () => void; onSaved: (issued?: Issued) => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ name: member?.name ?? "", title: member?.title ?? "", email: member?.email ?? "", role: member?.role ?? ("field" as RoleId) });
  const [approver, setApprover] = useState(!!member?.approver);
  const [sites, setSites] = useState<string[]>(member ? (member.role === "partner" ? member.partnerSiteIds : member.siteIds) : []);
  const [password] = useState(() => tempPassword());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const roles = ROLES.filter((r) => r !== "ceo" || me.role === "ceo");

  const save = async () => {
    if (busy) return;
    setBusy(true);
    const body = {
      name: f.name,
      title: f.title,
      email: f.email,
      role: f.role,
      siteIds: f.role === "field" ? sites : [],
      partnerSiteIds: f.role === "partner" ? sites : [],
      ...(member ? {} : { password }),
      // 가입 승인 담당 — 대표 권한만 정한다 (D-90)
      ...(me.role === "ceo" && f.role === "manager" && approver !== !!member?.approver ? { approver } : {}),
    };
    const r = member ? await api<{ member: { id: string } }>(`/api/admin/members/${encodeURIComponent(member.id)}`, { method: "PATCH", body }) : await api<{ member: { id: string } }>("/api/admin/members", { body });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors);
      toast.push({ tone: "err", title: r.error ?? "저장 실패" });
      return;
    }
    toast.push({ tone: "ok", title: member ? "사용자 정보를 저장했습니다" : "사용자를 추가했습니다", desc: `${f.name} · ${ROLE_LABEL[f.role]}` });
    const email = f.email.trim().toLowerCase();
    await onSaved(member ? undefined : { id: r.data?.member?.id ?? email, name: f.name, title: f.title, role: f.role, email, password, siteIds: f.role === "field" || f.role === "partner" ? sites : [] });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={member ? `사용자 수정 · ${member.name}` : "사용자 추가"}
      description={member ? "역할을 바꾸면 그 사람의 기존 로그인은 종료됩니다." : "저장하면 임시 비밀번호가 화면에 한 번 표시됩니다. 본인에게 전달하면 첫 로그인 때 직접 바꿉니다."}
      size="md"
      testId="member-form"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={save} loading={busy} data-testid="member-save">
            {member ? "저장" : "추가"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="이름" htmlFor="mf-name" required error={errors.name}>
            <input id="mf-name" className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="직함" htmlFor="mf-title" error={errors.title}>
            <input id="mf-title" className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="예) 현장소장" />
          </Field>
        </div>
        <Field label="이메일 (로그인 아이디)" htmlFor="mf-email" required error={errors.email}>
          <input id="mf-email" type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[0.88rem] font-semibold">역할</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((r) => (
              <label key={r} className={cx("press cursor-pointer rounded-xl border px-3 py-2.5 text-[0.84rem]", f.role === r ? "border-active bg-active-soft" : "border-line hover:bg-surface-2")}>
                <input type="radio" name="mf-role" className="sr-only" checked={f.role === r} onChange={() => setF({ ...f, role: r })} data-testid={`mf-role-${r}`} />
                <span className="block font-bold">{ROLE_LABEL[r]}</span>
                <span className="block text-[0.74rem] text-ink-3">{ROLE_HELP[r]}</span>
              </label>
            ))}
          </div>
          {errors.role && <p className="mt-1 text-[0.8rem] text-err">{errors.role}</p>}
        </fieldset>
        {me.role === "ceo" && f.role === "manager" && (
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line px-3 py-2.5 text-[0.84rem]" data-testid="mf-approver">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={approver} onChange={(e) => setApprover(e.target.checked)} />
            <span>
              <b>가입 승인 담당</b>
              <span className="block text-[0.76rem] text-ink-3">가입 신청 승인·승인 안 함, 계정 추가, 일시 정지를 할 수 있습니다. (대표 권한은 원래 가능)</span>
            </span>
          </label>
        )}
        {(f.role === "field" || f.role === "partner") && (
          <fieldset>
            <legend className="mb-1.5 text-[0.88rem] font-semibold">{f.role === "field" ? "추가 담당 현장" : "공개할 현장"}</legend>
            {f.role === "field" && <p className="mb-1.5 text-[0.76rem] text-ink-3">현장 등록에서 ‘현장 담당’으로 지정된 현장은 자동으로 포함됩니다.</p>}
            {db.sites.length === 0 ? (
              <p className="text-[0.8rem] text-ink-3">등록된 현장이 없습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {db.sites.map((s) => {
                  const on = sites.includes(s.id);
                  return (
                    <label key={s.id} className={cx("press cursor-pointer rounded-full border px-3 py-1.5 text-[0.82rem] font-semibold", on ? "border-active bg-active-soft text-theme-ink" : "border-line")}>
                      <input type="checkbox" className="sr-only" checked={on} onChange={() => setSites(on ? sites.filter((x) => x !== s.id) : [...sites, s.id])} />
                      {s.shortName}
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
        )}
      </div>
    </Modal>
  );
}
