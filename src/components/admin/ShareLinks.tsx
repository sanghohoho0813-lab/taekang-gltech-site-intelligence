"use client";

/**
 * 보고서 링크 (D-73) — 본사가 월간 공정 보고서·준공 보고서를 ‘로그인 없이 여는 읽기 전용 주소’로 만들어 보낸다.
 * - ShareLinkButton: 보고서 화면의 ‘링크로 보내기’ (기한 고르기 → 주소·보낼 글 복사·공유)
 * - SharesCard: 현장 상세 ‘보낸 보고서 링크’ (기한·열어 본 횟수·닫기)
 * 주소는 만들 때 한 번만 보인다 (비밀값을 저장하지 않으므로) — 다시 필요하면 새로 만든다.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Eye, Link2, Send, Share2 } from "lucide-react";
import { run } from "@/lib/data/store";
import { errorMessage } from "@/lib/data/commands";
import { fmtDate, fmtDateTime } from "@/lib/domain/format";
import { SHARE_DAYS, SHARE_DEFAULT_DAYS, SHARE_MAX_OPEN_PER_SITE, shareMessage, shareState, sharesOf } from "@/lib/domain/share";
import type { DemoDB, ReportShare, ShareKind } from "@/lib/domain/types";
import { IS_LIVE } from "@/lib/mode";
import { Badge, Button, Card, CardHeader, Notice, Segmented, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 권한이 없거나 오래된 브라우저 — 숨은 입력칸으로 복사
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
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
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<string>(String(SHARE_DEFAULT_DAYS));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<Created | null>(null);
  const [copied, setCopied] = useState<"url" | "msg" | null>(null);
  const [canShare, setCanShare] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);

  const close = () => {
    setOpen(false);
    setMade(null);
    setErr(null);
    setCopied(null);
  };
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await run("createShare", { kind, siteId, ...(month ? { month } : {}), days: Number(days) });
      setMade({ url: `${window.location.origin}/s/${r.token}`, title: r.title, expiresAt: r.expiresAt });
    } catch (e) {
      setErr(errorMessage(e, "링크를 만들지 못했습니다. 다시 눌러 주세요."));
    } finally {
      setBusy(false);
    }
  };
  const message = made ? shareMessage({ company, title: made.title, url: made.url, expiresAt: made.expiresAt }) : "";
  const copy = async (what: "url" | "msg") => {
    const ok = await copyText(what === "url" ? made!.url : message);
    if (ok) {
      setCopied(what);
      toast.push({ tone: "ok", title: what === "url" ? "주소를 복사했습니다" : "보낼 글을 복사했습니다", desc: "카카오톡·문자에 붙여 넣으세요." });
    } else {
      urlRef.current?.select();
      toast.push({ tone: "err", title: "복사하지 못했습니다", desc: "주소를 길게 눌러 직접 복사해 주세요." });
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: made!.title, text: message });
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
        footer={
          made ? (
            <>
              <a href={made.url} target="_blank" rel="noreferrer" className="press inline-flex h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-[0.9rem] font-semibold text-ink hover:bg-surface-2" data-testid="share-preview">
                <ExternalLink size={16} aria-hidden /> 열어 보기
              </a>
              <Button variant="cta" onClick={close} data-testid="share-done">
                닫기
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
          <div className="space-y-4 text-[0.9rem]">
            <p className="text-ink-2">
              <b className="text-ink">지금 내용 그대로</b> 고정해서 주소 하나로 만듭니다. 받는 분은 로그인·앱 설치 없이 <b className="text-ink">읽기만</b> 할 수 있습니다.
            </p>
            <dl className="grid gap-2 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[0.84rem]" data-testid="share-scope">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 font-bold text-ink-2">들어감</dt>
                <dd className="min-w-0">공정 진행률 · 발주처에 공개한 사진 · 요청 처리 건수</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 font-bold text-ink-2">안 들어감</dt>
                <dd className="min-w-0">계약·원가·기성 금액 · 사람 이름 · 요청 내용 · 내부 메모</dd>
              </div>
            </dl>
            {note && (
              <Notice tone="warn" className="text-[0.84rem]">
                {note}
              </Notice>
            )}
            <div>
              <p className="mb-1.5 text-[0.82rem] font-bold text-ink-2">열어 둘 기간</p>
              <Segmented label="열어 둘 기간" value={days} onChange={setDays} options={SHARE_DAYS.map((d) => ({ value: String(d), label: `${d}일`, testId: `share-days-${d}` }))} />
              <p className="mt-1.5 text-[0.78rem] text-ink-3">기간이 지나면 열리지 않습니다. 그 전에도 현장 상세에서 바로 닫을 수 있습니다.</p>
            </div>
            {err && (
              <p role="alert" className="rounded-xl bg-err-bg px-3.5 py-2 text-[0.84rem] font-semibold text-err" data-testid="share-error">
                {err}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4 text-[0.9rem]">
            <div>
              <label htmlFor="share-url" className="mb-1.5 block text-[0.82rem] font-bold text-ink-2">
                주소
              </label>
              <div className="flex flex-wrap gap-2">
                <input id="share-url" ref={urlRef} readOnly value={made.url} onFocus={(e) => e.currentTarget.select()} className={cx(inputCls, "num min-w-0 flex-1 text-[0.84rem]")} data-testid="share-url" />
                <Button icon={copied === "url" ? <Check size={17} /> : <Copy size={17} />} onClick={() => copy("url")} data-testid="share-copy">
                  {copied === "url" ? "복사됨" : "주소 복사"}
                </Button>
              </div>
            </div>
            <div>
              <label htmlFor="share-message" className="mb-1.5 block text-[0.82rem] font-bold text-ink-2">
                보낼 글 (카카오톡·문자에 붙여 넣기)
              </label>
              <textarea id="share-message" readOnly rows={4} value={message} className={cx(inputCls, "h-auto resize-none py-2 text-[0.84rem] leading-relaxed")} data-testid="share-message" />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button icon={copied === "msg" ? <Check size={17} /> : <Copy size={17} />} onClick={() => copy("msg")} data-testid="share-copy-message">
                  {copied === "msg" ? "복사됨" : "보낼 글 복사"}
                </Button>
                {canShare && (
                  <Button icon={<Share2 size={17} />} onClick={share} data-testid="share-native">
                    카카오톡·문자로 공유
                  </Button>
                )}
              </div>
            </div>
            <Notice tone="warn" className="text-[0.84rem]" title="이 주소는 지금만 보입니다">
              창을 닫으면 다시 볼 수 없으니 먼저 복사해 두세요. 다시 필요하면 새 링크를 만들면 됩니다. 주소를 아는 사람은 누구나 볼 수 있으니 받는 분에게만 보내세요.
            </Notice>
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
                    </p>
                    <p className="num mt-0.5 text-[0.78rem] text-ink-2">
                      만든 날 {fmtDate(s.createdAt)} ·{" "}
                      {st === "revoked" ? `닫은 날 ${fmtDate(s.revokedAt!)}` : st === "expired" ? `${fmtDate(s.expiresAt)}에 끝남` : `${fmtDate(s.expiresAt)}까지`}
                    </p>
                  </div>
                  <p className={cx("num inline-flex items-center gap-1.5 whitespace-nowrap text-[0.84rem]", s.views ? "font-bold text-theme-ink" : "text-ink-3")} data-testid="share-views">
                    <Eye size={15} aria-hidden />
                    {s.views ? `${s.views}번 열어 봄` : "아직 안 열어 봄"}
                    {s.lastViewedAt && <span className="font-normal text-ink-3">· 마지막 {fmtDateTime(s.lastViewedAt).slice(5)}</span>}
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
          주소는 만들 때 한 번만 보입니다 (보안을 위해 저장하지 않음). 열어 본 횟수는 같은 곳에서 30분 안에 다시 열면 한 번으로 셉니다.
          {!IS_LIVE && " 시연판에서는 이 브라우저에서 연 것만 셉니다."}
        </p>
      </div>
    </Card>
  );
}
