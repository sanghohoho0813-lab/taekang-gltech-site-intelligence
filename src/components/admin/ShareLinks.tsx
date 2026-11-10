"use client";

/**
 * 보고서 링크 (D-73) — 본사가 월간 공정 보고서·준공 보고서를 ‘로그인 없이 여는 읽기 전용 주소’로 만들어 보낸다.
 * - ShareLinkButton: 보고서 화면의 ‘링크로 보내기’ (기한 고르기 → 보낼 글·주소 복사·공유)
 * - SharesCard: 현장 상세 ‘보낸 보고서 링크’ (기한·열어 본 횟수·닫기)
 * 주소는 만들 때 한 번만 보인다 (비밀값을 저장하지 않으므로) — 다시 필요하면 새로 만든다.
 *
 * 점검 9차 반영
 * - 복사: 창(dialog) 안에서 복사한다. 창 밖에 만든 숨은 입력칸은 창이 떠 있는 동안 비활성이라 ‘복사됨’이라 해 놓고 실제로는 복사되지 않았다.
 * - 복사 결과는 창 안에 적는다 (화면 아래 알림은 창 뒤에 가려 보이지 않았다).
 * - 주소를 가져가기 전에는 바깥·뒤로·Esc로 닫히지 않고, 만든 직후 잠깐은 버튼을 막는다 (두 번 눌러 닫히던 문제).
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Eye, Link2, Send, Share2 } from "lucide-react";
import { run } from "@/lib/data/store";
import { userLabel } from "@/lib/data/hooks";
import { errorMessage } from "@/lib/data/commands";
import { fmtDate, fmtDateTime } from "@/lib/domain/format";
import { SHARE_DAYS, SHARE_DEFAULT_DAYS, SHARE_MAX_OPEN_PER_SITE, SHARE_PREVIEW_HASH, shareMessage, shareState, sharesOf } from "@/lib/domain/share";
import type { DemoDB, ReportShare, ShareKind } from "@/lib/domain/types";
import { IS_LIVE } from "@/lib/mode";
import { Badge, Button, Card, CardHeader, Segmented, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

/**
 * 글 복사 — 최신 방식이 막히면(주소가 http이거나 앱 안 브라우저) 예전 방식으로.
 * 예전 방식의 숨은 입력칸은 host(열려 있는 창) 안에 만든다: 창 밖(body)은 창이 떠 있는 동안 비활성이라 선택·복사가 되지 않는다.
 * 실제로 그 입력칸이 선택됐을 때만 성공으로 본다.
 */
async function copyText(text: string, host: HTMLElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.opacity = "0";
      (host ?? document.body).appendChild(ta);
      ta.focus();
      ta.select();
      const selected = document.activeElement === ta;
      const ok = selected && document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

interface Created {
  url: string;
  title: string;
  expiresAt: string;
}

const SCOPE: Record<ShareKind, { yes: string; no: string }> = {
  monthly: { yes: "공정 진행률 · 발주처에 공개한 사진 · 요청·하자보수 건수", no: "금액 · 사람 이름 · 요청 내용 · 내부 메모" },
  completion: { yes: "공사 기간·공정 단계별 완료일 · 공개한 사진 · 하자 처리 건수 · 하자보증 기간 · 발주처 이름", no: "금액 · 사람 이름 · 요청 내용 · 내부 메모" },
};

export function ShareLinkButton({
  kind,
  siteId,
  month,
  title,
  company,
  note,
  variant = "default",
}: {
  kind: ShareKind;
  siteId: string;
  month?: string;
  /** 보낼 보고서 이름 (예: ‘강남 물류 11월 공정 보고서’) */
  title: string;
  company: string;
  /** 지금 보내면 어떤 상태로 나가는지 알려 줄 말 (예: 준공 전이라 ‘공사 진행 정리’로 나갑니다) */
  note?: string;
  variant?: "default" | "cta";
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<string>(String(SHARE_DEFAULT_DAYS));
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<Created | null>(null);
  const [copied, setCopied] = useState<"url" | "msg" | null>(null);
  /** 창 안에 보이는 복사 결과 */
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [canShare, setCanShare] = useState(false);
  /** 주소를 복사했거나 공유 창으로 보냈는가 — 아직이면 실수로 닫히지 않게 막는다 (주소는 다시 볼 수 없으므로) */
  const [taken, setTaken] = useState(false);
  /** 만든 직후 잠깐 — 같은 자리를 두 번 눌러 바로 닫히지 않게 */
  const [settling, setSettling] = useState(false);
  const creating = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const copyBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
  // 주소가 만들어지면 가장 먼저 할 일(보낼 글 복사)에 초점
  useEffect(() => {
    if (!made) return;
    copyBtn.current?.focus();
    const t = window.setTimeout(() => setSettling(false), 700);
    return () => window.clearTimeout(t);
  }, [made]);

  const close = () => {
    setOpen(false);
    setMade(null);
    setErr(null);
    setCopied(null);
    setStatus(null);
    setTaken(false);
    setTo("");
  };
  /** ‘완료’ 버튼: 주소를 아직 가져가지 않았으면 한 번 더 묻는다 */
  const done = () => {
    if (made && !taken && !window.confirm("주소를 아직 복사하지 않았습니다.\n닫으면 이 주소를 다시 볼 수 없습니다. 그래도 닫을까요?")) return;
    close();
  };
  const create = async () => {
    // 두 번 눌러 링크가 두 개 만들어지지 않게
    if (creating.current) return;
    creating.current = true;
    setBusy(true);
    setErr(null);
    try {
      const r = await run("createShare", { kind, siteId, ...(month ? { month } : {}), days: Number(days), ...(to.trim() ? { to: to.trim() } : {}) });
      setSettling(true);
      setMade({ url: `${window.location.origin}/s/${r.token}`, title: r.title, expiresAt: r.expiresAt });
    } catch (e) {
      setErr(errorMessage(e, "링크를 만들지 못했습니다. 다시 눌러 주세요."));
    } finally {
      creating.current = false;
      setBusy(false);
    }
  };
  const message = made ? shareMessage({ company, title: made.title, url: made.url, expiresAt: made.expiresAt }) : "";
  const copy = async (what: "url" | "msg") => {
    const ok = await copyText(what === "url" ? made!.url : message, bodyRef.current?.closest("dialog") ?? bodyRef.current);
    if (ok) {
      setCopied(what);
      setTaken(true);
      setStatus({ ok: true, text: `${what === "url" ? "주소를" : "보낼 글을"} 복사했습니다. 카카오톡·문자 대화창에 붙여 넣으세요.` });
    } else {
      setCopied(null);
      // 직접 복사할 수 있게 보낼 글을 선택해 둔다
      msgRef.current?.focus();
      msgRef.current?.select();
      setStatus({ ok: false, text: "복사하지 못했습니다. 위 ‘보낼 글’을 길게 눌러(또는 Ctrl+C) 직접 복사해 주세요." });
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: made!.title, text: message });
      setTaken(true);
      setStatus({ ok: true, text: "공유 창으로 보냈습니다." });
    } catch {
      // 사용자가 공유 창을 닫음 — 아무것도 하지 않는다
    }
  };

  return (
    <>
      <Button variant={variant === "cta" ? "cta" : undefined} icon={<Send size={17} />} onClick={() => setOpen(true)} data-testid="share-open">
        링크로 보내기
      </Button>
      <Modal
        open={open}
        onClose={close}
        title={made ? "링크를 만들었습니다" : "링크로 보내기"}
        description={made ? `${made.title} · ${fmtDate(made.expiresAt)}까지 열립니다` : title}
        size="md"
        testId="share-dialog"
        // 주소를 만든 뒤 가져가기 전에는 바깥을 누르거나 ‘뒤로’로 닫히지 않는다 — 아래 ‘완료’로만 (한 번 더 물음)
        dismissible={!made || taken}
        footer={
          made ? (
            <>
              {/* 본사 확인용: 주소 뒤 표시(#preview) 때문에 열어 본 횟수·‘처음 열림’ 알림에 들어가지 않는다 */}
              <a
                href={`${made.url}${SHARE_PREVIEW_HASH}`}
                target="_blank"
                rel="noreferrer"
                aria-disabled={settling || undefined}
                className={cx("press inline-flex h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-[0.9rem] font-semibold text-ink hover:bg-surface-2", settling && "pointer-events-none opacity-50")}
                data-testid="share-preview"
              >
                <ExternalLink size={16} aria-hidden /> 열어 보기
              </a>
              <Button onClick={done} disabled={settling} data-testid="share-done">
                완료
              </Button>
            </>
          ) : (
            <>
              <Button onClick={close} disabled={busy}>
                취소
              </Button>
              <Button variant="cta" icon={<Link2 size={17} />} onClick={create} disabled={busy} data-testid="share-create">
                {busy ? "만드는 중…" : "링크 만들기"}
              </Button>
            </>
          )
        }
      >
        {!made ? (
          <div className="space-y-4 text-[0.9rem]" ref={bodyRef}>
            <p className="text-ink-2">
              <b className="text-ink">지금 내용 그대로</b> 주소 하나로 만듭니다. 받는 분은 로그인·앱 설치 없이 <b className="text-ink">읽기만</b> 합니다. 만든 주소를 카카오톡·문자에 붙여 보내면 됩니다.
            </p>
            <div>
              <p className="mb-1.5 text-[0.82rem] font-bold text-ink-2">열어 둘 기간</p>
              <Segmented label="열어 둘 기간" value={days} onChange={setDays} options={SHARE_DAYS.map((d) => ({ value: String(d), label: `${d}일`, testId: `share-days-${d}` }))} />
              <p className="mt-1.5 text-[0.78rem] text-ink-3">마지막 날 밤까지 열립니다. 그 전에도 현장 상세 ‘보낸 보고서 링크’에서 바로 닫을 수 있습니다.</p>
            </div>
            <div>
              <label htmlFor="share-to" className="mb-1.5 block text-[0.82rem] font-bold text-ink-2">
                받는 분 <span className="font-normal text-ink-3">(선택 · 본사 목록에만 보이는 메모)</span>
              </label>
              <input id="share-to" value={to} onChange={(e) => setTo(e.target.value)} maxLength={30} placeholder="예: 원청 공무팀" className={cx(inputCls, "text-[0.88rem]")} data-testid="share-to" />
            </div>
            <dl className="grid gap-1.5 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[0.82rem]" data-testid="share-scope">
              <div className="flex gap-2">
                <dt className="w-[4.2rem] shrink-0 font-bold text-ink-2">들어감</dt>
                <dd className="min-w-0">{SCOPE[kind].yes}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[4.2rem] shrink-0 font-bold text-ink-2">안 들어감</dt>
                <dd className="min-w-0">{SCOPE[kind].no}</dd>
              </div>
            </dl>
            {note && (
              <p className="rounded-xl bg-warn-bg px-3.5 py-2 text-[0.84rem] font-semibold text-ink-2" data-testid="share-note-warn">
                {note}
              </p>
            )}
            {err && (
              <p role="alert" className="rounded-xl bg-err-bg px-3.5 py-2 text-[0.84rem] font-semibold text-err" data-testid="share-error">
                {err}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3.5 text-[0.9rem]" ref={bodyRef}>
            {/* 가장 중요한 안내를 맨 위 한 줄로 (작은 휴대폰에서 아래로 밀려 안 보이던 문제) */}
            <p className="rounded-xl bg-warn-bg px-3.5 py-2 text-[0.84rem] font-semibold text-ink-2" data-testid="share-once">
              지금만 보이는 주소입니다 — 먼저 복사해 두세요. (다시 필요하면 새로 만들면 됩니다)
            </p>
            <div>
              <label htmlFor="share-message" className="mb-1.5 block text-[0.82rem] font-bold text-ink-2">
                보낼 글 <span className="font-normal text-ink-3">① 복사 → ② 카카오톡·문자 대화창에 붙여 넣기</span>
              </label>
              <textarea
                id="share-message"
                ref={msgRef}
                readOnly
                rows={5}
                value={message}
                onCopy={() => setTaken(true)}
                className={cx(inputCls, "h-auto resize-none py-2 text-[0.84rem] leading-relaxed [overflow-wrap:anywhere]")}
                data-testid="share-message"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button ref={copyBtn} variant="cta" icon={copied === "msg" ? <Check size={17} /> : <Copy size={17} />} onClick={() => copy("msg")} data-testid="share-copy-message">
                  {copied === "msg" ? "복사됨" : "보낼 글 복사"}
                </Button>
                {canShare && (
                  <Button icon={<Share2 size={17} />} onClick={share} data-testid="share-native">
                    카카오톡·문자로 공유
                  </Button>
                )}
              </div>
            </div>
            <div>
              <label htmlFor="share-url" className="mb-1.5 block text-[0.82rem] font-bold text-ink-2">
                주소만
              </label>
              <div className="flex flex-wrap gap-2">
                <input id="share-url" readOnly value={made.url} onFocus={(e) => e.currentTarget.select()} onCopy={() => setTaken(true)} className={cx(inputCls, "num min-w-0 flex-1 basis-[12rem] text-[0.82rem]")} data-testid="share-url" />
                <Button icon={copied === "url" ? <Check size={17} /> : <Copy size={17} />} onClick={() => copy("url")} data-testid="share-copy">
                  {copied === "url" ? "복사됨" : "주소 복사"}
                </Button>
              </div>
            </div>
            {/* 복사 결과는 창 안에 (화면 아래 알림은 창 뒤에 가려진다) */}
            <p role="status" aria-live="polite" className={cx("min-h-[1.3rem] text-[0.84rem] font-semibold", status ? (status.ok ? "text-ok" : "text-err") : "text-ink-3")} data-testid="share-status">
              {status?.text ?? "주소를 아는 사람은 누구나 볼 수 있으니 받는 분에게만 보내세요."}
            </p>
            <p className="text-[0.8rem] text-ink-2">
              열어 봤는지는{" "}
              <Link href={`/sites/${siteId}?tab=requests`} className="font-bold text-theme-ink underline underline-offset-2" data-testid="share-list-link">
                현장 상세 ‘보낸 보고서 링크’
              </Link>
              에서 봅니다.
            </p>
            {!IS_LIVE && (
              <p className="text-[0.78rem] text-ink-3" data-testid="share-demo-note">
                시연판: 이 주소는 이 브라우저에서만 열립니다 (가상 데이터가 이 브라우저에 저장돼 있어서). 실제 운영에서는 받는 분 휴대폰에서 바로 열립니다.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

const STATE_BADGE = { open: { tone: "ok", label: "열림" }, expired: { tone: "neutral", label: "기한 지남" }, revoked: { tone: "neutral", label: "닫음" } } as const;

/** 현장 상세 — 이 현장에서 보낸 보고서 링크 (최근 것부터) */
export function SharesCard({ db, siteId }: { db: DemoDB; siteId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const nowIso = new Date().toISOString();
  const list = sharesOf(db, siteId);
  const openCount = list.filter((s) => shareState(s, nowIso) === "open").length;
  const shown = all ? list : list.slice(0, 5);
  const revoke = async (s: ReportShare) => {
    if (!window.confirm(`‘${s.title}’ 링크를 닫을까요?\n닫으면 받은 분이 더 이상 열 수 없고, 되돌릴 수 없습니다 (다시 보내려면 새로 만드세요).`)) return;
    setBusy(s.id);
    try {
      await run("revokeShare", { shareId: s.id });
      toast.push({ tone: "ok", title: "링크를 닫았습니다", desc: "이제 그 주소는 열리지 않습니다." });
    } catch (e) {
      toast.push({ tone: "err", title: errorMessage(e, "닫지 못했습니다.") });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card data-testid="shares-card">
      <CardHeader
        title="보낸 보고서 링크"
        sub={list.length ? `열려 있는 링크 ${openCount}개 · 닫히거나 기한이 지난 링크는 60일 뒤 목록에서 지워집니다` : "월간 공정 보고서·준공 보고서를 주소 하나로 보낼 수 있습니다 (로그인 없이 읽기만 · 금액 없음)"}
        right={openCount >= SHARE_MAX_OPEN_PER_SITE ? <Badge tone="warn">열린 링크 {SHARE_MAX_OPEN_PER_SITE}개 (최대)</Badge> : undefined}
      />
      <div className="px-5 pb-5">
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-4 text-[0.86rem] text-ink-2" data-testid="shares-empty">
            아직 보낸 링크가 없습니다. 아래 ‘발주처 월간 보고서’ 또는 ‘준공 보고서’ 화면에서 <b>링크로 보내기</b>를 누르면 여기에 기한과 열어 본 횟수가 나옵니다.
          </p>
        ) : (
          <ul className="divide-y divide-line border-y border-line" data-testid="shares-list">
            {shown.map((s) => {
              const st = shareState(s, nowIso);
              const badge = STATE_BADGE[st];
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5" data-testid="share-row" data-state={st}>
                  <div className="min-w-0 flex-1 basis-[14rem]">
                    <p className="flex flex-wrap items-center gap-2 text-[0.9rem] font-bold">
                      <span className="[overflow-wrap:anywhere]">{s.title}</span>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      {s.to && (
                        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[0.76rem] font-semibold text-ink-2 [overflow-wrap:anywhere]" data-testid="share-to-label">
                          받는 분: {s.to}
                        </span>
                      )}
                    </p>
                    {/* 같은 보고서를 다시 보낸 링크와 구분되게 만든 시각·만든 사람까지 (점검 9차) */}
                    <p className="num mt-0.5 text-[0.78rem] text-ink-2" data-testid="share-meta">
                      만든 때 {fmtDateTime(s.createdAt).slice(5)} · {userLabel(db, s.createdBy)} ·{" "}
                      {st === "revoked" ? `닫은 날 ${fmtDate(s.revokedAt!)}` : st === "expired" ? `${fmtDate(s.expiresAt)}에 끝남` : `${fmtDate(s.expiresAt)}까지`}
                    </p>
                  </div>
                  <p className={cx("num inline-flex flex-wrap items-center gap-x-1.5 text-[0.84rem]", s.views ? "font-bold text-theme-ink" : "text-ink-3")} data-testid="share-views">
                    <Eye size={15} aria-hidden />
                    <span className="whitespace-nowrap">{s.views ? `${s.views}번 열어 봄` : "아직 안 열어 봄"}</span>
                    {s.lastViewedAt && <span className="whitespace-nowrap font-normal text-ink-3">· 마지막 {fmtDateTime(s.lastViewedAt).slice(5)}</span>}
                  </p>
                  {st === "open" && (
                    <Button size="sm" onClick={() => revoke(s)} disabled={busy === s.id} data-testid="share-revoke">
                      {busy === s.id ? "닫는 중…" : "링크 닫기"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {list.length > 5 && (
          <button type="button" className="press mt-2 min-h-11 rounded-xl px-3 text-[0.84rem] font-bold text-theme-ink hover:bg-surface-3" onClick={() => setAll((v) => !v)} data-testid="shares-more">
            {all ? "접기" : `전체 ${list.length}개 보기`}
          </button>
        )}
        <p className="mt-3 text-[0.76rem] text-ink-3">
          주소는 만들 때 한 번만 보입니다 (보안을 위해 저장하지 않음). 열어 본 횟수는 잠깐 사이(5분)에 여러 번 열어도 한 번으로 세고, 만들 때 ‘열어 보기’로 본사가 확인한 것은 세지 않습니다.
          {!IS_LIVE && " 시연판에서는 이 브라우저에서 연 것만 셉니다."}
        </p>
      </div>
    </Card>
  );
}
