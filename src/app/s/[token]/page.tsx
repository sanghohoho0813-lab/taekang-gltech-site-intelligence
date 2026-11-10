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
import { SHARE_PREVIEW_HASH, SHARE_TOKEN_RE, shareIdOf, sharePhotoVisible, shareState, type ShareDoc } from "@/lib/domain/share";
import { Button, PageSkeleton } from "@/components/ui/primitives";
import { LogoMark } from "@/components/shell/Logo";
import { CompletionDocView, MonthlyDocView } from "@/components/docs/ReportDocs";

type Gone = "notfound" | "expired" | "revoked";
type View =
  | { status: "loading" }
  | { status: "ok"; title: string; expiresAt: string; doc: ShareDoc; photoSrc: (id: string) => string | null; hidden: number }
  | { status: "gone"; code: Gone }
  | { status: "error"; message: string };

const GONE: Record<Gone, { title: string; desc: string }> = {
  notfound: { title: "열 수 없는 주소입니다", desc: "주소가 끝까지 복사됐는지 확인해 주세요. 계속 열리지 않으면 보내 주신 분께 새 주소를 요청해 주세요." },
  expired: { title: "기한이 지난 보고서 링크입니다", desc: "이 주소는 정해진 기간 동안만 열립니다. 보내 주신 분께 새 주소를 요청해 주세요." },
  revoked: { title: "보낸 곳에서 닫은 보고서 링크입니다", desc: "이 주소는 더 이상 열리지 않습니다. 보내 주신 분께 새 주소를 요청해 주세요." },
};

const VIEW_GAP_MS = 30 * 60_000;
const PREVIEW_KEY = "tk-site-intel:share-preview";
/**
 * 본사가 ‘열어 보기’로 확인하는 중인가 (주소 뒤 #preview — 서버로 가지 않는 표시). 받는 분이 여는 주소에는 없다.
 * 표시는 읽자마자 주소에서 지운다 — 본사가 이 탭의 주소를 복사해 보내도 받는 분의 열람이 정상으로 세어지게 (점검 9차).
 * 같은 탭에서 새로 고쳐도 미리보기로 남도록 탭 저장소에 적어 둔다.
 */
function isPreview(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  try {
    if (window.location.hash === SHARE_PREVIEW_HASH) {
      sessionStorage.setItem(PREVIEW_KEY, path);
      window.history.replaceState(window.history.state, "", path + window.location.search);
      return true;
    }
    return sessionStorage.getItem(PREVIEW_KEY) === path;
  } catch {
    return window.location.hash === SHARE_PREVIEW_HASH;
  }
}

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
      // 서버가 지금도 공개인 사진만 담아 보낸다 (공개를 거둔 사진은 번호·설명도 오지 않고 장수만)
      const doc = body.doc as ShareDoc;
      const ok = new Set<string>(doc.photos.map((p) => p.id));
      setView({ status: "ok", title: body.title, expiresAt: body.expiresAt, doc, hidden: Number(body.hiddenPhotos ?? 0), photoSrc: (id) => (ok.has(id) ? `/api/share/${token}/photo/${encodeURIComponent(id)}` : null) });
      // 본사가 확인하려고 연 것은 세지 않는다 — ‘처음 열림’ 알림이 받는 분이 열기 전에 나가 버리지 않게 (점검 9차)
      if (!counted.current && !isPreview()) {
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
    if (!share || state !== "open" || counted.current || isPreview()) return;
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
    // 서버와 같은 규칙: 지금도 공개인 사진만 남기고, 거둔 사진은 장수만
    const src = new Map<string, string>();
    for (const ph of share.snapshot.photos) {
      const p = db.photos.find((x) => x.id === ph.id);
      if (sharePhotoVisible(db, p, share.siteId)) src.set(ph.id, p.dataUrl);
    }
    const photos = share.snapshot.photos.filter((ph) => src.has(ph.id));
    return {
      status: "ok",
      title: share.title,
      expiresAt: share.expiresAt,
      doc: { ...share.snapshot, photos },
      hidden: share.snapshot.photos.length - photos.length,
      photoSrc: (pid) => src.get(pid) ?? null,
    };
  }, [db, share, state]);
  return <Frame view={view} />;
}

/** 본사 확인용으로 연 화면인가 — 주소 뒤 표시는 브라우저에서만 알 수 있어 화면이 뜬 뒤에 읽는다 */
function usePreviewFlag() {
  const [preview, setPreview] = useState(false);
  useEffect(() => setPreview(isPreview()), []);
  return preview;
}

/** 카카오톡 안의 브라우저인가 — 그 안에서는 인쇄가 안 되는 경우가 많다 */
function useInAppBrowser() {
  const [inApp, setInApp] = useState(false);
  useEffect(() => setInApp(/KAKAOTALK/i.test(navigator.userAgent)), []);
  return inApp;
}

function Frame({ view, onRetry }: { view: View; onRetry?: () => void }) {
  const preview = usePreviewFlag();
  const inApp = useInAppBrowser();
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
  const { doc, hidden } = view;
  return (
    <div className="min-h-dvh bg-[#F6F5F3] print:bg-white" data-testid="share-page" data-state="open" data-kind={doc.kind}>
      <header className="no-print border-b border-line bg-surface">
        <div className="mx-auto flex min-h-14 max-w-[960px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <LogoMark size={26} />
          {/* 보낸 곳 이름은 자르지 않는다 (큰 글씨에서 ‘(주)태강…’으로 잘리던 문제 · 점검 9차) */}
          <p className="min-w-0 flex-1 text-[0.92rem] font-extrabold [overflow-wrap:anywhere]" data-testid="share-company">{doc.company}</p>
          <Button icon={<Printer size={17} />} onClick={() => window.print()} data-testid="share-print">
            인쇄·PDF
          </Button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[960px] px-4 py-5 print:max-w-none print:p-0">
        <p className="no-print mb-3 rounded-xl bg-surface px-3.5 py-2.5 text-[0.84rem] leading-relaxed text-ink-2 shadow-card" data-testid="share-note">
          <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 align-[1px] text-[0.74rem] font-bold text-ink-2">
            <Lock size={12} aria-hidden /> 읽기 전용
          </span>
          <b className="num text-ink">{fmtDate(doc.asOf)}</b> 기준으로 작성한 보고서입니다 (이후 변경은 반영되지 않습니다) · <b className="num text-ink">{fmtDate(view.expiresAt)}</b>까지 볼 수 있습니다
          {preview && (
            <span className="block text-[0.78rem] font-semibold text-theme-ink" data-testid="share-preview-note">
              본사 확인용 미리보기 — 열어 본 횟수에 넣지 않습니다. 받는 분에게는 이 줄이 보이지 않습니다.
            </span>
          )}
          {inApp && (
            <span className="block text-[0.78rem] text-ink-3" data-testid="share-inapp-note">
              카카오톡 안에서는 인쇄가 안 될 수 있습니다. 오른쪽 위 메뉴의 ‘다른 브라우저로 열기’를 누른 뒤 인쇄해 주세요.
            </span>
          )}
          {!IS_LIVE && <span className="block text-[0.78rem] text-ink-3">시연판 — 이 브라우저에 저장된 가상 데이터로 여는 화면입니다.</span>}
        </p>
        {doc.kind === "monthly" ? <MonthlyDocView doc={doc} photoSrc={view.photoSrc} hiddenPhotos={hidden} /> : <CompletionDocView doc={doc} photoSrc={view.photoSrc} hiddenPhotos={hidden} />}
        <p className="no-print mt-4 pb-6 text-center text-[0.78rem] leading-relaxed text-ink-3" data-testid="share-foot">
          {doc.company}에서 보낸 읽기 전용 보고서입니다. 로그인이나 앱 설치 없이 볼 수 있습니다.
          <br />
          이 보고서를 열어 본 횟수는 보낸 곳에 표시됩니다. 궁금한 점은 보내 주신 담당자에게 문의해 주세요.
        </p>
      </main>
    </div>
  );
}
