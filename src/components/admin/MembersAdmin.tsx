"use client";

/** 운영 관리 · 사용자 — 추가(임시 비밀번호), 역할·담당 현장, 비밀번호 초기화, 비활성화 */
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, UserRound, UserX, UserCheck } from "lucide-react";
import type { DemoDB, RoleId } from "@/lib/domain/types";
import { ROLE_LABEL } from "@/lib/domain/labels";
import { api } from "@/lib/live/api";
import { liveFetch } from "@/lib/data/store";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Notice, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

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
}

const ROLES: RoleId[] = ["ceo", "manager", "field", "partner"];
const ROLE_HELP: Record<RoleId, string> = {
  ceo: "모든 화면·설정",
  manager: "손익·정산·조치 관리, 현장·사용자 관리 (대표 계정은 못 바꿈)",
  field: "담당 현장 보고·내 조치만 (금액·이익률 안 보임)",
  partner: "지정 현장의 공정·요청만 (내부 정보 안 보임)",
};

/** 읽기 쉬운 임시 비밀번호 (영문+숫자 10자, 헷갈리는 글자 제외) */
function tempPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = letters + letters.toUpperCase() + digits;
  const pick = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const chars = [pick(letters), pick(digits), ...Array.from({ length: 8 }, () => pick(all))];
  return chars.sort(() => (crypto.getRandomValues(new Uint8Array(1))[0] > 127 ? 1 : -1)).join("");
}

export function MembersAdmin({ db, me }: { db: DemoDB; me: { id: string; role: RoleId } }) {
  const toast = useToast();
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemberView | "new" | null>(null);
  const [issued, setIssued] = useState<{ name: string; email: string; password: string } | null>(null);

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

  return (
    <Card data-testid="admin-members">
      <CardHeader
        title={members ? `사용자 ${members.filter((m) => m.active).length}명` : "사용자"}
        sub="계정은 회사 이메일로 만들고, 처음 로그인할 때 본인이 비밀번호를 바꿉니다"
        right={
          <Button variant="cta" icon={<Plus size={17} />} onClick={() => setEditing("new")} data-testid="member-new">
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
            <button type="button" className="ml-2 font-bold underline" onClick={() => setIssued(null)}>
              닫기
            </button>
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
      ) : members.length === 0 ? (
        <EmptyState icon={<UserRound size={30} />} title="사용자가 없습니다" />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {members.map((m) => (
            <li key={m.id} className={cx("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3", !m.active && "opacity-60")} data-testid="member-row">
              <div className="min-w-[14rem] flex-1">
                <p className="font-bold">
                  {m.name} <span className="font-medium text-ink-3">{m.title}</span>
                </p>
                <p className="text-[0.78rem] text-ink-3">{m.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={m.role === "ceo" ? "theme" : m.role === "manager" ? "info" : m.role === "field" ? "ok" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>
                {!m.active && <Badge tone="neutral">비활성</Badge>}
                {m.lockedUntil && <Badge tone="err">로그인 잠김</Badge>}
                {m.active && m.mustChangePassword && <Badge tone="warn">첫 로그인 전</Badge>}
              </div>
              <p className="min-w-[10rem] text-[0.8rem] text-ink-2">{assignedSites(m) || "담당 현장 없음"}</p>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setEditing(m)} disabled={m.role === "ceo" && me.role !== "ceo"}>
                  수정
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<KeyRound size={14} />}
                  disabled={!m.active || (m.role === "ceo" && me.role !== "ceo")}
                  onClick={async () => {
                    const pw = tempPassword();
                    if (await patch(m, { password: pw }, "비밀번호를 초기화했습니다")) setIssued({ name: m.name, email: m.email, password: pw });
                  }}
                  data-testid="member-reset"
                >
                  비밀번호 초기화
                </Button>
                {m.id !== me.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={m.active ? <UserX size={14} /> : <UserCheck size={14} />}
                    disabled={m.role === "ceo" && me.role !== "ceo"}
                    onClick={() => void patch(m, { active: !m.active }, m.active ? "접근을 중지했습니다 (기존 로그인도 종료)" : "다시 사용할 수 있게 했습니다")}
                  >
                    {m.active ? "비활성" : "활성"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <MemberModal
          db={db}
          me={me}
          member={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (issuedPw) => {
            if (issuedPw) setIssued(issuedPw);
            setEditing(null);
            await load();
            void liveFetch();
          }}
        />
      )}
    </Card>
  );
}

function MemberModal({ db, me, member, onClose, onSaved }: { db: DemoDB; me: { role: RoleId }; member: MemberView | null; onClose: () => void; onSaved: (issued?: { name: string; email: string; password: string }) => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ name: member?.name ?? "", title: member?.title ?? "", email: member?.email ?? "", role: member?.role ?? ("field" as RoleId) });
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
    };
    const r = member ? await api(`/api/admin/members/${encodeURIComponent(member.id)}`, { method: "PATCH", body }) : await api("/api/admin/members", { body });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors);
      toast.push({ tone: "err", title: r.error ?? "저장 실패" });
      return;
    }
    toast.push({ tone: "ok", title: member ? "사용자 정보를 저장했습니다" : "사용자를 추가했습니다", desc: `${f.name} · ${ROLE_LABEL[f.role]}` });
    await onSaved(member ? undefined : { name: f.name, email: f.email.trim().toLowerCase(), password });
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
