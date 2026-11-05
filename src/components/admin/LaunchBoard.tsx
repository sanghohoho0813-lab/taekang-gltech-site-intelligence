"use client";

/**
 * 시범 운영 준비 (D-53) — 첫날 현장 직원이 막히지 않게 회사·현장·직원별 준비 상태를 한 화면에.
 * 빨간 것(시작 전 꼭)부터 고치고, 직원 로그인 쪽지를 인쇄해 나눠 준다(D-54).
 */
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertCircle, CircleCheck, Images, Printer, TriangleAlert } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { liveFetch } from "@/lib/data/store";
import { api } from "@/lib/live/api";
import { IS_LIVE } from "@/lib/mode";
import { launchReport, type LaunchFix, type LaunchItem, type LaunchStatus, type MemberInfo, type PersonLaunch } from "@/lib/domain/launch";
import { tempPassword } from "@/lib/domain/password";
import { fmtDate } from "@/lib/domain/format";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, DemoBadge, Notice, PageSkeleton, cx } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { SlipPrintDialog, type Slip } from "./LoginSlips";

const FIX: Record<LaunchFix, { href: string | null; label: string }> = {
  settings: { href: IS_LIVE ? "/admin?tab=settings" : null, label: "운영 관리 → 운영 설정" },
  privacy: { href: IS_LIVE ? "/admin?tab=privacy" : "/settings", label: IS_LIVE ? "운영 관리 → 개인위치정보" : "설정 → 개인위치정보" },
  members: { href: IS_LIVE ? "/admin?tab=members" : null, label: "운영 관리 → 사용자" },
  sites: { href: IS_LIVE ? "/admin?tab=sites" : null, label: "운영 관리 → 현장" },
  geo: { href: "/attendance", label: "출퇴근 현황 → 현장 위치" },
  usage: { href: "/usage", label: "사용 현황" },
};

const STATUS_ICON: Record<LaunchStatus, ReactNode> = {
  ok: <CircleCheck size={20} className="shrink-0 text-ok" aria-label="완료" />,
  warn: <TriangleAlert size={20} className="shrink-0 text-warn" aria-label="고치면 좋음" />,
  missing: <AlertCircle size={20} className="shrink-0 text-err" aria-label="시작 전 꼭" />,
};

const DEVICE: Record<PersonLaunch["device"], { t: string; tone: "ok" | "warn" | "err" | "neutral" }> = {
  ready: { t: "휴대폰 준비됨", tone: "ok" },
  warn: { t: "휴대폰 확인 권장", tone: "warn" },
  fail: { t: "휴대폰 고쳐야 함", tone: "err" },
  none: { t: "휴대폰 점검 전", tone: "neutral" },
};
const CONSENT: Record<PersonLaunch["consent"], { t: string; tone: "ok" | "warn" | "neutral" }> = {
  agreed: { t: "위치 동의", tone: "ok" },
  outdated: { t: "위치 동의 다시 필요", tone: "warn" },
  none: { t: "위치 동의 전", tone: "neutral" },
};

export function LaunchBoard() {
  const { db } = useMe();
  const toast = useToast();
  const [members, setMembers] = useState<MemberInfo[] | null>(null);
  const [memberErr, setMemberErr] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [askReset, setAskReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const load = useCallback(async () => {
    if (!IS_LIVE) return;
    const r = await api<{ members: MemberInfo[] }>("/api/admin/members");
    if (r.ok && r.data) {
      setMembers(r.data.members);
      setMemberErr(false);
    } else setMemberErr(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!db) return <PageSkeleton />;
  const rep = launchReport(db, members);
  const chosen = rep.people.filter((p) => picked.includes(p.user.id));
  const pendingChosen = chosen.filter((p) => p.firstLogin === "pending");
  const toSlips = (list: PersonLaunch[], pw: Record<string, string> = {}): Slip[] =>
    list.map((p) => ({ id: p.user.id, name: p.user.name, title: p.user.title, role: p.user.role, email: p.email, password: pw[p.user.id], sites: p.sites.map((s) => s.shortName) }));

  /**
   * 첫 로그인 전인 사람은 임시 비밀번호를 새로 만들어 쪽지에 넣는다 (전에 준 것은 더 이상 안 됨).
   * 화면을 연 뒤 그 사이 로그인한 사람이 있을 수 있어 목록을 다시 받고, 서버도 ‘첫 로그인 전’일 때만 바꾼다 (리뷰 반영).
   */
  const printWithReset = async () => {
    setBusy(true);
    const fresh = await api<{ members: MemberInfo[] }>("/api/admin/members");
    const stillPending = new Set((fresh.ok && fresh.data ? fresh.data.members : []).filter((m) => m.mustChangePassword && m.active).map((m) => m.id));
    const pw: Record<string, string> = {};
    const failed: string[] = [];
    for (const p of pendingChosen) {
      if (!stillPending.has(p.user.id)) continue;
      const v = tempPassword();
      const r = await api(`/api/admin/members/${encodeURIComponent(p.user.id)}`, { method: "PATCH", body: { password: v, onlyIfMustChange: true } });
      if (r.ok) pw[p.user.id] = v;
      else failed.push(p.user.name);
    }
    setBusy(false);
    setAskReset(false);
    if (failed.length) toast.push({ tone: "err", title: `임시 비밀번호를 만들지 못했습니다: ${failed.join(", ")}` });
    setSlips(toSlips(chosen, pw));
    void load();
    void liveFetch();
  };

  const verdictOk = rep.blockers.length === 0;
  return (
    <PageBody>
      <PageHeader
        eyebrow={<DemoBadge compact />}
        title="시범 운영 준비"
        desc="첫날 현장 직원이 막히지 않게 — 회사·현장·직원별로 준비가 끝났는지 한 화면에서 확인합니다. 빨간 것부터 고치고, 직원 로그인 쪽지를 인쇄해 나눠 주세요."
        right={
          <Link href="/help/quick" className="press inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl border border-line-strong bg-surface px-3 text-[0.88rem] font-bold" data-testid="launch-guide">
            <Images size={16} aria-hidden /> 그림 안내 1장
          </Link>
        }
      />

      <Card data-testid="launch-summary" data-ok={verdictOk ? "1" : "0"}>
        <div className="flex flex-wrap items-start gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className={cx("flex items-center gap-2 text-[1.2rem] font-extrabold", verdictOk ? "text-ok" : "text-err")}>
              {verdictOk ? <CircleCheck size={24} aria-hidden /> : <AlertCircle size={24} aria-hidden />}
              {verdictOk ? "시작할 수 있습니다" : `시작 전에 고칠 것 ${rep.blockers.length}개`}
            </p>
            {!verdictOk && (
              <p className="mt-1 text-[0.88rem] text-ink-2" data-testid="launch-blockers">
                {rep.blockers.join(" · ")}
              </p>
            )}
            {rep.warnings.length > 0 && (
              <p className="mt-1 text-[0.84rem] text-ink-3" data-testid="launch-warnings">
                고치면 좋은 것: {rep.warnings.join(" · ")}
              </p>
            )}
          </div>
          <div className="rounded-xl bg-surface-2 px-4 py-2.5 text-center" data-testid="launch-people-ready">
            <p className="text-[0.76rem] font-semibold text-ink-3">첫날 준비 끝난 직원</p>
            <p className="num text-[1.4rem] font-extrabold">
              {rep.peopleReady} / {rep.people.length}명
            </p>
          </div>
        </div>
      </Card>

      <Card data-testid="launch-company">
        <CardHeader title="회사 설정" />
        <ul className="divide-y divide-line border-t border-line">
          {rep.company.map((i) => (
            <ItemRow key={i.key} i={i} />
          ))}
        </ul>
      </Card>

      <Card data-testid="launch-sites">
        <CardHeader title="진행 중 현장" sub="시범 현장 1곳부터 시작하는 것을 권합니다" />
        {rep.sites.length === 0 ? (
          <p className="border-t border-line px-5 py-4 text-[0.88rem] text-ink-2">진행 중인 현장이 없습니다. {IS_LIVE ? <Link className="font-bold underline" href="/admin?tab=sites">운영 관리 → 현장</Link> : "운영 관리 → 현장"}에서 등록하세요.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {rep.sites.map(({ site, items }) => (
              <li key={site.id} className="px-5 py-3" data-testid="launch-site" data-site={site.id}>
                <p className="font-bold">
                  {site.shortName} <span className="font-medium text-ink-3">{site.name}</span>
                </p>
                <ul className="mt-1">
                  {items.map((i) => (
                    <ItemRow key={i.key} i={i} compact />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="launch-people">
        <CardHeader
          title="현장 직원"
          sub={IS_LIVE ? "골라서 로그인 쪽지를 인쇄하세요. 첫 로그인 전인 사람은 임시 비밀번호를 새로 만들어 쪽지에 넣을 수 있습니다." : "시연에는 로그인이 없어 ‘첫 로그인’은 표시하지 않습니다. 쪽지의 아이디·비밀번호 칸은 비어 나옵니다."}
          right={
            <Button size="sm" variant="cta" icon={<Printer size={15} />} disabled={!chosen.length} onClick={() => (pendingChosen.length && IS_LIVE ? setAskReset(true) : setSlips(toSlips(chosen)))} data-testid="launch-slips">
              로그인 쪽지 {chosen.length ? `${chosen.length}장` : ""}
            </Button>
          }
        />
        {memberErr && (
          <div className="px-5 pb-3">
            <Notice tone="warn">사용자 목록(첫 로그인 여부·아이디)을 불러오지 못했습니다. 새로고침해 주세요.</Notice>
          </div>
        )}
        {askReset && (
          <div className="mx-5 mb-3 rounded-xl border border-warn/40 bg-warn-bg px-4 py-3 text-[0.88rem]" role="alertdialog" aria-label="임시 비밀번호 새로 만들기 확인" data-testid="launch-reset-ask">
            <p className="font-semibold">
              첫 로그인 전인 {pendingChosen.map((p) => p.user.name).join(", ")}의 임시 비밀번호를 새로 만들어 쪽지에 넣을까요? 전에 준 임시 비밀번호는 더 이상 안 됩니다.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="cta" loading={busy} onClick={() => void printWithReset()} data-testid="launch-reset-yes">
                새로 만들어 쪽지에 넣기
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAskReset(false);
                  setSlips(toSlips(chosen));
                }}
                data-testid="launch-reset-no"
              >
                비밀번호 칸 비우고 인쇄
              </Button>
            </div>
          </div>
        )}
        {rep.people.length === 0 ? (
          <p className="border-t border-line px-5 py-4 text-[0.88rem] text-ink-2">현장 직원 계정이 없습니다. {IS_LIVE ? <Link className="font-bold underline" href="/admin?tab=members">운영 관리 → 사용자</Link> : "운영 관리 → 사용자"}에서 추가하세요.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            <li className="flex items-center gap-2 px-5 py-2 text-[0.84rem]">
              <input
                id="launch-all"
                type="checkbox"
                className="size-5"
                checked={chosen.length === rep.people.length}
                onChange={(e) => setPicked(e.target.checked ? rep.people.map((p) => p.user.id) : [])}
                data-testid="launch-pick-all"
              />
              <label htmlFor="launch-all" className="font-semibold">
                모두 고르기
              </label>
            </li>
            {rep.people.map((p) => (
              <PersonRow key={p.user.id} p={p} on={picked.includes(p.user.id)} onToggle={() => setPicked((x) => (x.includes(p.user.id) ? x.filter((y) => y !== p.user.id) : [...x, p.user.id]))} />
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="launch-day1">
        <CardHeader title="첫날 순서 (직원 1명당 약 5분)" sub="본사 담당자가 옆에서 같이 눌러 봅니다" />
        <ol className="list-decimal space-y-1.5 border-t border-line py-4 pl-10 pr-5 text-[0.9rem]">
          <li>로그인 쪽지를 본인에게 직접 줍니다 (임시 비밀번호는 본인만).</li>
          <li>휴대폰 카메라로 쪽지 QR → 아이디·임시 비밀번호 → 새 비밀번호 정하기.</li>
          <li>쪽지 ③대로 홈 화면에 앱 아이콘을 만들고, 그 아이콘으로 다시 엽니다.</li>
          <li>‘내 정보 → 내 휴대폰 점검’ — ‘고쳐야 함’이 나오면 그 자리에서 설정을 고칩니다.</li>
          <li>현장에서 ‘출근하기’ → 위치 기록 동의 (이 화면 ‘위치 동의’가 초록으로 바뀜).</li>
          <li>그림 안내 1장을 같이 보며 ‘오늘 보고하기’를 한 번 보내 봅니다 → 본사 ‘지시·확인’에서 확인.</li>
        </ol>
        <p className="border-t border-line px-5 py-3 text-[0.8rem] text-ink-3">
          첫 주에는 매일 ‘사용 현황’에서 출근·보고가 빠진 직원을 확인하고 전화로 도와주세요. 같은 질문이 두 번 나오면 그림 안내에 추가할 내용입니다.
        </p>
      </Card>

      {slips && <SlipPrintDialog slips={slips} phone={db.settings?.helpPhone} onClose={() => setSlips(null)} />}
    </PageBody>
  );
}

function ItemRow({ i, compact }: { i: LaunchItem; compact?: boolean }) {
  const fix = i.fix ? FIX[i.fix] : null;
  return (
    <li className={cx("flex flex-wrap items-start gap-x-3 gap-y-1", compact ? "py-1.5" : "px-5 py-3")} data-testid="launch-item" data-key={i.key} data-status={i.status}>
      {STATUS_ICON[i.status]}
      <span className="min-w-0 flex-1">
        <span className="block text-[0.92rem] font-bold">{i.label}</span>
        <span className="block text-[0.84rem] text-ink-2 [overflow-wrap:anywhere]">{i.text}</span>
      </span>
      {i.status !== "ok" &&
        fix &&
        (fix.href ? (
          <Link href={fix.href} className="press inline-flex h-9 shrink-0 items-center rounded-lg border border-line-strong px-3 text-[0.82rem] font-bold" data-testid="launch-fix">
            {fix.label}
          </Link>
        ) : (
          <span className="shrink-0 text-[0.78rem] text-ink-3">운영 모드: {fix.label}</span>
        ))}
    </li>
  );
}

function PersonRow({ p, on, onToggle }: { p: PersonLaunch; on: boolean; onToggle: () => void }) {
  const id = `launch-p-${p.user.id}`;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-5 py-3" data-testid="launch-person" data-user={p.user.id} data-ready={p.ready ? "1" : "0"}>
      <input id={id} type="checkbox" className="mt-1 size-5" checked={on} onChange={onToggle} data-testid="launch-pick" />
      <label htmlFor={id} className="min-w-[10rem] flex-1">
        <span className="block font-bold">
          {p.user.name} <span className="font-medium text-ink-3">{p.user.title}</span>
        </span>
        <span className="block text-[0.8rem] text-ink-3">
          {p.sites.length ? `담당 ${p.sites.map((s) => s.shortName).join(", ")}` : "담당 현장 없음"}
          {p.email ? ` · ${p.email}` : ""}
        </span>
      </label>
      <span className="flex flex-wrap gap-1.5">
        {p.firstLogin !== "unknown" && <Badge tone={p.firstLogin === "done" ? "ok" : "warn"}>{p.firstLogin === "done" ? "첫 로그인 끝" : "첫 로그인 전"}</Badge>}
        <Badge tone={DEVICE[p.device].tone}>{DEVICE[p.device].t}</Badge>
        <Badge tone={CONSENT[p.consent].tone}>{CONSENT[p.consent].t}</Badge>
        <Badge tone={p.firstIn ? "ok" : "neutral"}>{p.firstIn ? `첫 출근 ${fmtDate(p.firstIn)}` : "출근 기록 없음"}</Badge>
        <Badge tone={p.firstReport ? "ok" : "neutral"}>{p.firstReport ? `첫 보고 ${fmtDate(p.firstReport)}` : "보고 없음"}</Badge>
      </span>
      {p.todo.length > 0 && (
        <p className="basis-full pl-8 text-[0.8rem] text-ink-2" data-testid="launch-todo">
          남은 것: {p.todo.join(" · ")}
        </p>
      )}
    </li>
  );
}
