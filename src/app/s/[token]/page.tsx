"use client";

/**
 * 보고서 링크 화면 (D-73) — 로그인 없이 여는 읽기 전용 보고서.
 * LIVE: 주소의 비밀값으로 /api/share가 준 ‘만들 때 고정한 내용’만 그린다 (회사 데이터·로그인 정보는 받지 않는다).
 * DEMO: 서버가 없으므로 이 브라우저에 저장된 가상 데이터에서 같은 규칙으로 찾는다 (다른 기기에서는 열리지 않음).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CircleAlert, Clock3, Lock, Printer, RefreshCw } from "lucide-react";
import { dispatch, useDb } from "@/lib/data/store";
import { recordShareView } from "@/lib/data/shareCommands";
import { IS_LIVE } from "@/lib/mode";
import { fmtDate } from "@/lib/domain/format";
import { SHARE_TOKEN_RE, shareIdOf, sharePhotoVisible, shareState, type ShareDoc } from "@/lib/domain/share";
import { Button, PageSkeleton } from "@/components/ui/primitives";
import { LogoMark } from "@/components/shell/Logo";
import { CompletionDocView, MonthlyDocView } from "@/components/docs/ReportDocs";

type Gone = "notfound" | "expired" | "revoked";
type View =
  | { status: "loading" }
  | { status: "ok"; title: string; expiresAt: string; doc: ShareDoc; photoSrc: (id: string) => string | null }
  | { status: "gone"; code: Gone }
  | { status: "error"; message: string };

const GONE: Record<Gone, { title: string; desc: string }> = {
  notfound: { title: "열 수 없는 주소입니다", desc: "주소가 끝까지 복사됐는지 확인해 주세요. 계속 열리지 않으면 보내 주신 분께 새 주소를 요청해 주세요." },
  expired: { title: "기한이 지난 보고서 링크입니다", desc: "이 주소는 정해진 기간 동안만 열립니다. 보내 주신 분께 새 주소를 요청해 주세요." },
  revoked: { title: "보낸 곳에서 닫은 보고서 링크입니다", desc: "이 주소는 더 이상 열리지 않습니다. 보내 주신 분께 새 주소를 요청해 주세요." },
};

const VIEW_GAP_MS = 30 * 60_000;

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  return IS_LIVE ? <LiveShare token={token} /> : <DemoShare token={token} />;
}

function LiveShare({ token }: { token: string }) {
  const [view, setView] = useState<View>({ status: "loading" });
  const counted = useRef(false);
  const load = useCallback(async () => {
    setView({ status: "loading" });
    if (!SHARE_TOKEN_RE.test(token)) return setView({ status: "gone", code: "notfound" });
    try {
      // 로그인 쿠키를 보내지 않는다 — 누가 열든 같은 내용
      const r = await fetch(`/api/share/${token}`, { cache: "no-store", credentials: "omit" });
      const body = await r.json().catch(() => null);
      if (r.status === 404 || r.status === 410) return setView({ status: "gone", code: (body?.code as Gone) ?? "notfound" });
      if (r.status === 429) return setView({ status: "error", message: body?.error ?? "요청이 많습니다. 잠시 뒤 다시 열어 주세요." });
      if (!r.ok || !body?.doc) return setView({ status: "error", message: "보고서를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요." });
      const ok = new Set<string>(body.photoIds ?? []);
      setView({ status: "ok", title: body.title, expiresAt: body.expiresAt, doc: body.doc as ShareDoc, photoSrc: (id) => (ok.has(id) ? `/api/share/${token}/photo/${encodeURIComponent(id)}` : null) });
      if (!counted.current) {
        counted.current = true;
        // 열어 본 기록 — 실패해도 화면에는 영향 없음
        void fetch(`/api/share/${token}/view`, { method: "POST", credentials: "omit", keepalive: true }).catch(() => {});
      }
    } catch {
      setView({ status: "error", message: "인터넷 연결을 확인한 뒤 다시 열어 주세요." });
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  return <Frame view={view} onRetry={load} />;
}

function DemoShare({ token }: { token: string }) {
  const db = useDb();
  const id = useMemo(() => (SHARE_TOKEN_RE.test(token) ? shareIdOf(token) : ""), [token]);
  const share = db?.shares?.find((s) => s.id === id);
  // 화면을 연 시각 기준 (다시 그릴 때마다 바뀌지 않게)
  const [openedAt] = useState(() => new Date().toISOString());
  const state = share ? shareState(share, openedAt) : null;
  const counted = useRef(false);
  useEffect(() => {
    if (!share || state !== "open" || counted.current) return;
    counted.current = true;
    // 같은 브라우저에서 30분 안에 다시 열면 세지 않는다 (서버와 같은 규칙)
    const key = `tk-site-intel:share-view:${id.slice(0, 16)}`;
    try {
      const last = Number(sessionStorage.getItem(key) ?? 0);
      if (Date.now() - last < VIEW_GAP_MS) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // 저장소를 못 쓰면 그냥 센다
    }
    try {
      dispatch((d, ctx) => recordShareView(d, { shareId: id }, ctx));
    } catch {
      // 기록 실패는 화면에 영향 없음
    }
  }, [share, state, id]);

  const view: View = useMemo(() => {
    if (!db) return { status: "loading" };
    if (!share || !state) return { status: "gone", code: "notfound" };
    if (state !== "open" || !share.snapshot) return { status: "gone", code: state === "open" ? "notfound" : state };
    return {
      status: "ok",
      title: share.title,
      expiresAt: share.expiresAt,
      doc: share.snapshot,
      photoSrc: (pid) => {
        const p = db.photos.find((x) => x.id === pid);
        return sharePhotoVisible(db, p, share.siteId) ? p.dataUrl : null;
      },
    };
  }, [db, share, state]);
  return <Frame view={view} />;
}

function Frame({ view, onRetry }: { view: View; onRetry?: () => void }) {
  // 탭 이름·PDF 파일 이름을 보고서 이름으로 — 화면 틀이 뒤늦게 넣는 기본 제목에 덮이지 않게 지켜본다
  const title = view.status === "ok" ? `${view.title} (읽기 전용)` : null;
  useEffect(() => {
    if (!title) return;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [title]);
  if (view.status === "loading")
    return (
      <div className="min-h-dvh bg-[#F6F5F3]" data-testid="share-page" data-state="loading">
        <div className="mx-auto max-w-[960px] px-4 py-6">
          <PageSkeleton />
        </div>
      </div>
    );
  if (view.status !== "ok") {
    const g = view.status === "gone" ? GONE[view.code] : { title: "보고서를 열지 못했습니다", desc: view.message };
    return (
      <main id="main" className="grid min-h-dvh place-items-center bg-[#F6F5F3] px-5 py-10" data-testid="share-page" data-state={view.status === "gone" ? view.code : "error"}>
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 text-center shadow-card" role={view.status === "error" ? "alert" : undefined}>
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-3 text-ink-2">{view.status === "gone" && view.code !== "notfound" ? <Clock3 size={24} aria-hidden /> : <CircleAlert size={24} aria-hidden />}</span>
          <h1 className="mt-4 text-[1.2rem] font-extrabold leading-snug" data-testid="share-gone-title">{g.title}</h1>
          <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-2">{g.desc}</p>
          {view.status === "error" && onRetry && (
            <Button variant="cta" icon={<RefreshCw size={17} />} className="mt-5" onClick={onRetry} data-testid="share-retry">
              다시 열기
            </Button>
          )}
          {!IS_LIVE && view.status === "gone" && view.code === "notfound" && (
            <p className="mt-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-left text-[0.8rem] text-ink-2" data-testid="share-demo-hint">
              시연판에서는 링크를 만든 <b>그 브라우저에서만</b> 열립니다 (가상 데이터가 그 브라우저에 저장돼 있어서). 실제 운영에서는 받는 분 휴대폰에서 바로 열립니다.
            </p>
          )}
        </div>
      </main>
    );
  }
  const { doc } = view;
  const hidden = doc.photos.filter((p) => !view.photoSrc(p.id)).length;
  return (
    <div className="min-h-dvh bg-[#F6F5F3] print:bg-white" data-testid="share-page" data-state="open" data-kind={doc.kind}>
      <header className="no-print border-b border-line bg-surface">
        <div className="mx-auto flex min-h-14 max-w-[960px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <LogoMark size={26} />
          <p className="min-w-0 flex-1 truncate text-[0.92rem] font-extrabold" data-testid="share-company">{doc.company}</p>
          <Button size="sm" icon={<Printer size={16} />} onClick={() => window.print()} data-testid="share-print">
            인쇄·PDF
          </Button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[960px] px-4 py-5 print:max-w-none print:p-0">
        <p className="no-print mb-3 rounded-xl bg-surface px-3.5 py-2.5 text-[0.84rem] leading-relaxed text-ink-2 shadow-card" data-testid="share-note">
          <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 align-[1px] text-[0.74rem] font-bold text-ink-2">
            <Lock size={12} aria-hidden /> 읽기 전용
          </span>
          <b className="num text-ink">{fmtDate(doc.asOf)}</b>에 만든 내용 그대로입니다 · <b className="num text-ink">{fmtDate(view.expiresAt)}</b>까지 열립니다
          {!IS_LIVE && <span className="block text-[0.78rem] text-ink-3">시연판 — 이 브라우저에 저장된 가상 데이터로 여는 화면입니다.</span>}
        </p>
        {doc.kind === "monthly" ? <MonthlyDocView doc={doc} photoSrc={view.photoSrc} /> : <CompletionDocView doc={doc} photoSrc={view.photoSrc} />}
        {hidden > 0 && (
          <p className="no-print mt-3 text-[0.8rem] text-ink-3" data-testid="share-hidden-photos">
            사진 {hidden}장은 보낸 곳에서 공개를 거두어 보이지 않습니다.
          </p>
        )}
        <p className="no-print mt-4 pb-6 text-center text-[0.78rem] leading-relaxed text-ink-3">
          {doc.company}에서 보낸 읽기 전용 보고서입니다. 로그인이나 앱 설치 없이 볼 수 있습니다.
          <br />
          궁금한 점은 보내 주신 담당자에게 문의해 주세요.
        </p>
      </main>
    </div>
  );
}
