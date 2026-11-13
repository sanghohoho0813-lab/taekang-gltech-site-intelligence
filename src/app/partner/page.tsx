"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Send, CircleCheck, Clock3, Inbox, ChevronRight, Lock, Settings, LayoutDashboard, Sparkles, X, Camera, Wrench, FileText, RotateCcw, ShieldCheck } from "lucide-react";
import { warrantyClientLine, warrantyStatus } from "@/lib/domain/warranty";
import { setPrefs, run, logout } from "@/lib/data/store";
import { useMe } from "@/lib/data/hooks";
import { CommandError } from "@/lib/data/commands";
import { PARTNER_STATUS_LABEL, PARTNER_TYPE_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import type { DemoDB, PartnerRequest, PartnerRequestStatus } from "@/lib/domain/types";
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, Field, Notice, PageSkeleton, ProgressBar, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Facade } from "@/components/domain/Facade";
import { Donut } from "@/components/domain/Charts";
import { LogoMark } from "@/components/shell/Logo";
import { Clock } from "@/components/shell/Clock";
import { IS_LIVE } from "@/lib/mode";
import { PushCard } from "@/components/PushCard";
import { SampleDataBanner } from "@/components/shell/AppShell";
import { DEFECT_STEPS, defectProgress, partnerProgressFeed, partnerRepairView, repairReady, sharedPhotos, PARTNER_FEED_DAYS } from "@/lib/domain/partnerFeed";
import { shiftDate } from "@/lib/domain/attendance";
import { downscalePhoto } from "@/components/easy/photo";
import { errorMessage } from "@/lib/data/commands";
import { todayIso } from "@/lib/domain/format";

const FUTURE = [
  { title: "기성 확인 요청 (직발주 건축주)", items: ["기성 내역·진행 사진 온라인 확인", "확인 이력 보관", "확인 요청 알림"] },
  { title: "자재 납품 일정 공유 (협력사)", items: ["유리·프레임 반입 일정 등록", "현장 반입 확인", "지연 알림"] },
  { title: "다현장 진행 리포트", items: ["건축주·원청별 여러 현장 진행률 한 화면", "공유 링크 발송"] },
];

export default function PartnerPage() {
  const { db, role, userId } = useMe();
  if (!db) return <PageSkeleton />;
  if (role === "field") {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center" data-testid="access-denied">
        <Lock size={28} className="mx-auto text-ink-3" />
        <h1 className="mt-3 text-[1.25rem] font-bold">현장직원 역할에서는 발주처 포털을 볼 수 없습니다</h1>
        {!IS_LIVE && <p className="mt-2 text-[0.88rem] text-ink-3">권한 프리뷰(DEMO)</p>}
        <Link href="/field">
          <Button variant="cta" className="mt-5">현장 보고로 이동</Button>
        </Link>
      </div>
    );
  }
  const preview = role !== "partner";
  // 관리자 미리보기: 현장이 지정된 첫 발주처 계정 기준 / 발주처: 본인 계정
  const partner = preview ? db.users.find((u) => u.role === "partner" && !u.inactive && (u.partnerSiteIds ?? []).some((id) => db.sites.some((s) => s.id === id))) : db.users.find((u) => u.id === userId);
  const mySites = db.sites.filter((s) => partner?.partnerSiteIds?.includes(s.id));
  if (!partner || mySites.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16" data-testid="partner-portal">
        <EmptyState
          title={preview ? "발주처 포털을 볼 수 있는 계정이 아직 없습니다" : "볼 수 있는 현장이 아직 없습니다"}
          desc={preview ? "운영 관리 → 사용자에서 ‘발주처·협력사’ 계정을 만들고 공개할 현장을 지정하세요." : "태강지엘텍 담당자에게 현장 공개를 요청해주세요."}
          action={
            preview ? (
              <Link href={IS_LIVE ? "/admin" : "/settings"}>
                <Button variant="cta">{IS_LIVE ? "운영 관리로" : "설정으로"}</Button>
              </Link>
            ) : (
              // 현장이 없는 발주처 계정은 아무 단추도 없어 갇히던 문제 — 전화·로그아웃 (D-77 리허설)
              <div className="flex flex-col items-center gap-2" data-testid="partner-nosite-actions">
                {db.settings?.publicPhone && (
                  <a href={`tel:${db.settings.publicPhone.replace(/[^\d+]/g, "")}`} className="press inline-flex min-h-12 items-center rounded-full bg-cta px-5 text-[1rem] font-bold text-cta-text">
                    태강지엘텍에 전화 {db.settings.publicPhone}
                  </a>
                )}
                {IS_LIVE && (
                  <Button onClick={() => void logout()} data-testid="partner-nosite-logout">
                    로그아웃
                  </Button>
                )}
              </div>
            )
          }
        />
      </div>
    );
  }
  return (
    <>
      <SampleDataBanner />
      <PartnerPortal db={db} partner={partner} sites={mySites} preview={preview} />
    </>
  );
}

function PartnerPortal({ db, partner, sites: mySites, preview }: { db: NonNullable<ReturnType<typeof useMe>["db"]>; partner: NonNullable<ReturnType<typeof useMe>["db"]>["users"][number]; sites: NonNullable<ReturnType<typeof useMe>["db"]>["sites"]; preview: boolean }) {
  const [siteId, setSiteId] = useState(mySites[0].id);
  const site = mySites.find((s) => s.id === siteId) ?? mySites[0];
  // 아직 만들지 않은 기능 소개는 시연·본사 미리보기에서만 (실제 고객 화면에는 숨김 · D-65)
  const showFuture = !IS_LIVE || preview;
  const requests = db.partnerRequests.filter((r) => r.siteId === site.id && r.partnerUserId === partner.id);
  // ‘다시 요청하기’ — 확인한 하자가 또 생기면 같은 위치로 새 요청을 채워 준다 (D-68)
  const [draft, setDraft] = useState<Draft | null>(null);
  const nextStage = site.stages.find((s) => s.progressPct < 100);

  return (
    <div className="min-h-[calc(100dvh-var(--demo-bar-h))] bg-[#F6F5F3]" data-testid="partner-portal">
      {/* 휴대폰에서는 머리를 고정하지 않는다 — 작은 화면·아주 큰 글씨에서 머리가 화면 4분의 1을 차지하던 문제 (D-69) */}
      <header className="top-[var(--demo-bar-h)] z-30 border-b border-line bg-surface/95 backdrop-blur lg:sticky">
        <div className="mx-auto flex min-h-14 max-w-[1240px] items-center gap-2.5 px-4 py-1.5 sm:min-h-16">
          <LogoMark size={28} />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[0.95rem] font-extrabold tracking-[0.04em] max-[420px]:hidden">TAEKANG GLTECH</p>
            <p className="truncate text-[0.7rem] font-semibold text-ink-3 max-[420px]:hidden">발주처·협력사 포털</p>
            <p className="hidden whitespace-nowrap text-[0.95rem] font-extrabold max-[420px]:block">발주처 포털</p>
          </div>
          <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="포털 메뉴">
            <a href="#status" className="press rounded-lg px-3 py-2 text-[0.85rem] font-bold text-ink hover:bg-surface-3">현장 현황</a>
            <a href="#photos" className="press rounded-lg px-3 py-2 text-[0.85rem] font-bold text-ink hover:bg-surface-3">공정 사진</a>
            <a href="#request" className="press rounded-lg px-3 py-2 text-[0.85rem] font-bold text-ink hover:bg-surface-3">요청하기</a>
            <a href="#my-requests" className="press rounded-lg px-3 py-2 text-[0.85rem] font-bold text-ink hover:bg-surface-3">내 요청</a>
            <Link href={`/partner/report?site=${site.id}`} className="press rounded-lg px-3 py-2 text-[0.85rem] font-bold text-ink hover:bg-surface-3" data-testid="partner-report-link">월간 보고서</Link>
            {showFuture && (
              <a href="#next" className="press rounded-lg px-3 py-2 text-[0.85rem] font-semibold text-ink-3 hover:bg-surface-3">
                확장 예정 <Badge tone="neutral">NEXT</Badge>
              </a>
            )}
            <Link href="/help" className="press hidden rounded-lg px-3 py-2 text-[0.85rem] font-bold text-ink hover:bg-surface-3 lg:inline-flex" data-testid="partner-help">
              사용 안내
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <DemoBadge compact />
            {preview ? (
              <>
                {/* 휴대폰에서는 감춘다 — Badge 기본 inline-flex가 hidden을 덮어 로고가 잘리던 문제 (D-67 점검 반영) */}
                <span className="hidden sm:inline-flex">
                  <Badge tone="info">관리자 미리보기</Badge>
                </span>
                <Link href="/dashboard" className="press inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3 text-[0.85rem] font-bold" data-testid="partner-back-hq">
                  <LayoutDashboard size={15} aria-hidden /> <span className="whitespace-nowrap">본사 화면</span>
                </Link>
              </>
            ) : (
              <Link href="/settings" className="press inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-[0.85rem] font-bold text-ink-2 hover:bg-surface-3" aria-label={IS_LIVE ? "설정" : "설정 · 역할 전환"}>
                <Settings size={16} aria-hidden /> <span className="hidden sm:inline">{IS_LIVE ? "설정" : "역할 전환"}</span>
              </Link>
            )}
          </div>
        </div>
        {/* 휴대폰 메뉴: 손가락 크기(44px)·잘리지 않게 4개만 — ‘확장 예정’은 시연에서만 (D-65) */}
        <nav className="no-scrollbar flex gap-1.5 overflow-x-auto border-t border-line px-3 py-2 lg:hidden" aria-label="포털 메뉴 (모바일)">
          {[
            // 휴대폰 첫 화면에 다 보이게 자주 쓰는 순서로 (월간 보고서가 화면 밖에 있던 문제 · D-68 점검 반영)
            ["#request", "요청하기"],
            ["#my-requests", "내 요청"],
            [`/partner/report?site=${site.id}`, "월간 보고서"],
            ["#photos", "공정 사진"],
            ["#status", "현장 현황"],
            ...(showFuture ? [["#next", "확장 예정"]] : []),
            ["/help", "사용 안내"],
          ].map(([h, l]) => (
            <a key={h} href={h} className="press inline-flex min-h-11 shrink-0 items-center rounded-full bg-surface-3 px-3.5 text-[0.9rem] font-bold text-ink-2">
              {l}
            </a>
          ))}
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-[1240px] space-y-5 px-4 py-6 pb-16">
        {preview && (
          <Notice tone="info" title={`관리자 미리보기 — ‘${partner.name} ${partner.title}’에게 보이는 화면입니다`}>
            내부 원가·예상이익·미수금·다른 현장 정보는 이 포털에 표시되지 않습니다.
            {!IS_LIVE && (
              <>
                {" "}요청 등록은 발주처 역할로 전환해 시연하세요.{" "}
                <button type="button" className="font-bold text-theme-ink underline" onClick={() => setPrefs({ role: "partner" })} data-testid="switch-to-partner">
                  발주처 역할로 전환
                </button>
              </>
            )}
          </Notice>
        )}
        {mySites.length > 1 && (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="현장 선택">
            {mySites.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={s.id === site.id} onClick={() => setSiteId(s.id)} className={cx("press rounded-full border px-3.5 py-1.5 text-[0.85rem] font-bold", s.id === site.id ? "border-active bg-active-soft text-theme-ink" : "border-line bg-surface text-ink-2")}>
                {s.shortName}
              </button>
            ))}
          </div>
        )}

        <section id="status" className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <Facade kind={site.illustration} className="h-52 sm:h-64" />
            <div className="p-5">
              <p className="text-[0.78rem] font-semibold text-ink-3">{partner.name} {partner.title}님의 현장</p>
              <h1 className="mt-1 text-[1.35rem] font-extrabold leading-snug" data-testid="partner-site">{site.name}</h1>
              <p className="mt-1 text-[0.82rem] text-ink-3">{site.region} · {fmtDate(site.startDate)} ~ {fmtDate(site.endDate)} · <Clock compact /></p>
              {/* 하자보증 (D-70) — 기간만, 본사 메모 없음 */}
              {site.warranty && (
                <p className="num mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1 text-[0.82rem] font-semibold text-ink-2" data-testid="partner-warranty">
                  <ShieldCheck size={15} aria-hidden className="shrink-0" /> <span className="[overflow-wrap:anywhere]">{warrantyClientLine(site)}</span>
                </p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader
              title="공정 진행 현황"
              sub="현장 보고 기준 (태강지엘텍 확인 전 보고 포함)"
              right={
                <Link href={`/partner/report?site=${site.id}`} className="press inline-flex min-h-11 items-center gap-1 rounded-xl border border-line-strong px-3 text-[0.84rem] font-bold" data-testid="partner-report-card-link">
                  <FileText size={15} aria-hidden /> 월간 보고서
                </Link>
              }
            />
            <div className="flex items-center gap-4 px-5">
              <Donut value={site.progressPct} label="전체 공정률" size={124} />
              <div className="text-[0.85rem]">
                <p className="text-ink-3">진행 중인 단계</p>
                {/* 단계가 없는 새 현장에서 ‘준공’으로 보이던 문제 — 모든 단계가 끝났을 때만 ‘준공’ (D-77 리허설) */}
                <p className="font-bold text-ink">{nextStage?.name ?? (site.stages.length === 0 ? "공정 단계 등록 전" : "준공")}</p>
                {nextStage && <p className="text-[0.76rem] text-ink-3 num">{fmtDate(nextStage.startDate)} ~ {fmtDate(nextStage.endDate)}</p>}
              </div>
            </div>
            <ul className="space-y-2.5 px-5 py-4">
              {site.stages.map((st) => (
                <li key={st.id}>
                  <div className="flex justify-between text-[0.82rem]">
                    <span className="font-semibold">{st.name}</span>
                    <b className="num">{st.progressPct}%</b>
                  </div>
                  <ProgressBar value={st.progressPct} className="mt-1" label={`${st.name} 진행률`} tone={st.progressPct === 100 ? "ok" : "theme"} />
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <SiteUpdates db={db} siteId={site.id} preview={preview} />

        <div className="grid gap-5 lg:grid-cols-2">
          <RequestForm siteId={site.id} disabled={preview} draft={draft} warrantyState={warrantyStatus(site, todayIso()).state} />
          {/* min-w-0: 긴 버튼이 칸을 밀어 화면이 옆으로 밀리던 문제 (D-70 점검 반영) */}
          <div className="min-w-0 space-y-5">
            <MyRequests db={db} requests={requests} preview={preview} onRedo={(r) => setDraft({ n: Date.now(), type: "defect", title: r.title.slice(0, 80), location: r.location ?? "", desc: "", reopenedFrom: r.id, fromTitle: r.title })} />
            {IS_LIVE && !preview && <PushCard size="compact" audience="partner" />}
          </div>
        </div>

        {/* 아직 만들지 않은 기능은 실제 고객 화면에 보이지 않게 — 시연·본사 미리보기에서만 (D-65) */}
        {showFuture && (
          <section id="next" aria-labelledby="next-title">
            <h2 id="next-title" className="mb-3 flex items-center gap-2 text-[1.05rem] font-bold">
              <Sparkles size={18} aria-hidden /> 향후 확장 예정 <Badge tone="neutral">아직 없는 기능 · 미리보기</Badge>
            </h2>
            <FutureCards />
          </section>
        )}

        <p className="text-center text-[0.74rem] text-ink-3">
          {IS_LIVE
            ? "이 포털에는 내부 원가·이익·미수금·다른 고객 현장 정보가 표시되지 않습니다 (서버에서 차단)."
            : "DEMO · 가상 시연 데이터 · 이 포털에는 내부 원가·이익·미수금·다른 고객 현장 정보가 표시되지 않습니다 (권한 프리뷰 — 실제 운영에서는 서버에서 차단)."}
        </p>
      </main>
    </div>
  );
}

type Draft = { n: number; type: PartnerRequest["type"]; title: string; location: string; desc: string; reopenedFrom?: string; fromTitle?: string };

function RequestForm({ siteId, disabled, draft, warrantyState }: { siteId: string; disabled: boolean; draft: Draft | null; warrantyState?: string }) {
  const toast = useToast();
  const [type, setType] = useState<PartnerRequest["type"]>("quote");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const goods = type === "quote" || type === "order";
  const defect = type === "defect";
  const [reopen, setReopen] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => {
    if (!draft) return;
    setSent(false);
    setType(draft.type);
    setTitle(draft.title);
    setLocation(draft.location);
    setDesc(draft.desc);
    setPhotos([]);
    setErrors({});
    setReopen(draft.reopenedFrom ? { id: draft.reopenedFrom, title: draft.fromTitle ?? draft.title } : null);
    setKey(uid("idem"));
    window.setTimeout(() => document.getElementById("request")?.scrollIntoView({ block: "start", behavior: "smooth" }), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.n]);
  const ph = PLACEHOLDER[type];
  const [key, setKey] = useState(() => uid("idem"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  return (
    <Card id="request" className="scroll-mt-4 lg:scroll-mt-40" data-testid="partner-form">
      <CardHeader title="요청하기" sub="전화 없이 요청을 남기면 태강지엘텍 본사 요청함에 바로 접수됩니다" />
      {sent ? (
        <div className="anim-pop flex flex-col items-center gap-2 px-5 pb-6 pt-2 text-center" data-testid="partner-sent">
          <CircleCheck size={40} className="text-ok" />
          <p className="text-[1.05rem] font-bold">요청이 접수되었습니다</p>
          <p className="text-[0.85rem] text-ink-3">처리 상태는 ‘내 요청’에서 확인할 수 있습니다. 담당자가 답하면 그곳에 표시됩니다.</p>
          <a href="#my-requests" className="press mt-1 inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-[0.9rem] font-bold" data-testid="partner-sent-go">
            내 요청 보기
          </a>
          <Button
            className="mt-2"
            onClick={() => {
              setSent(false);
              setTitle("");
              setDesc("");
              setItem("");
              setQty("");
              setDate("");
              setLocation("");
              setPhotos([]);
              setReopen(null);
              setKey(uid("idem"));
            }}
          >
            새 요청 작성
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3 px-5 pb-5"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await run("createPartnerRequest", { idempotencyKey: key, siteId, title, description: desc, desiredDate: date, type, ...(goods ? { item, qty } : {}), ...(defect ? { location, photoDataUrls: photos, ...(reopen ? { reopenedFrom: reopen.id } : {}) } : {}) });
              setSent(true);
              setErrors({});
              toast.push({ tone: "ok", title: "요청을 접수했습니다", desc: "태강지엘텍 담당자가 확인하면 ‘내 요청’에 답이 표시됩니다." });
              document.getElementById("request")?.scrollIntoView({ block: "start", behavior: "smooth" });
            } catch (err) {
              if (err instanceof CommandError) {
                setErrors(err.fieldErrors);
                if (!Object.keys(err.fieldErrors).length) toast.push({ tone: "err", title: err.message });
                // 빈칸 오류가 화면 위쪽 밖에 있어도 보이게 첫 오류 칸으로 (D-66)
                else window.setTimeout(() => document.querySelector('#request [role="alert"]')?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
              }
            }
          }}
          noValidate
        >
          {disabled && <Notice tone="info">{IS_LIVE ? "관리자 미리보기에서는 요청을 등록할 수 없습니다. 발주처 담당자 계정으로 로그인하면 등록할 수 있습니다." : "미리보기 모드에서는 요청을 등록할 수 없습니다. 위의 ‘발주처 역할로 전환’을 누르세요."}</Notice>}
          {reopen && defect && (
            <Notice tone="info" title={`다시 요청: ‘${reopen.title}’`}>
              <span data-testid="partner-redo-notice">위치·제목을 채워 두었습니다. 지금 상태를 적고 사진을 다시 올린 뒤 ‘요청 보내기’를 누르세요.</span>
              <button type="button" className="press mt-1.5 inline-flex min-h-11 items-center rounded-xl border border-line-strong bg-surface px-3 text-[0.84rem] font-bold" onClick={() => setReopen(null)} data-testid="partner-redo-cancel">
                새 요청으로 쓰기
              </button>
            </Notice>
          )}
          <Field label="요청 유형" htmlFor="p-type">
            <select id="p-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value as PartnerRequest["type"])} disabled={disabled} data-testid="p-type">
              <option value="quote">견적 문의 (추가 공사·자재)</option>
              <option value="order">주문 요청 (수량 확정)</option>
              <option value="change_review">설계변경 지시·변경견적 요청</option>
              <option value="schedule">일정 문의</option>
              <option value="defect">하자보수 요청 (사진 첨부)</option>
              <option value="other">기타</option>
            </select>
          </Field>
          {defect && (
            <Field label="하자 위치" htmlFor="p-location" required error={errors.location}>
              <input id="p-location" className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} disabled={disabled} placeholder="예) 3층 302호 거실 창" data-testid="p-location" />
            </Field>
          )}
          <Field label="제목" htmlFor="p-title" required error={errors.title}>
            <input id="p-title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} disabled={disabled} placeholder={ph.title} />
          </Field>
          {goods && (
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <Field label="품목·사양" htmlFor="p-item" required error={errors.item}>
                <input id="p-item" className={inputCls} value={item} onChange={(e) => setItem(e.target.value)} maxLength={60} disabled={disabled} placeholder="예) 24mm 로이 복층유리" data-testid="p-item" />
              </Field>
              <Field label={type === "order" ? "수량" : "수량 (대략)"} htmlFor="p-qty" required={type === "order"} error={errors.qty}>
                <input id="p-qty" className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} maxLength={30} disabled={disabled} placeholder="예) 12장, 약 40㎡" data-testid="p-qty" />
              </Field>
            </div>
          )}
          <Field label="내용" htmlFor="p-desc" required error={errors.description} counter={`${desc.length}/800`}>
            <textarea id="p-desc" rows={4} className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={800} disabled={disabled} placeholder={ph.desc} />
          </Field>
          {defect && (
            <div data-testid="p-photos">
              <p className="mb-1.5 text-[0.85rem] font-bold text-ink">사진 (선택 · 3장까지)</p>
              <div className="flex flex-wrap gap-2">
                {photos.map((p, i) => (
                  <span key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p} alt={`첨부 사진 ${i + 1}`} className="size-20 rounded-xl border border-line object-cover" />
                    <button type="button" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="press absolute -right-2 -top-2 grid size-11 place-items-center rounded-full bg-black/70 text-white" aria-label={`첨부 사진 ${i + 1} 빼기`}>
                      <X size={15} />
                    </button>
                  </span>
                ))}
                {photos.length < 3 && (
                  <label className={cx("press grid size-20 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-line-strong bg-surface text-ink-2", (disabled || photoBusy) && "pointer-events-none opacity-50")}>
                    <span className="flex flex-col items-center gap-0.5 text-[0.75rem] font-bold">
                      <Camera size={20} aria-hidden /> {photoBusy ? "줄이는 중" : "사진 추가"}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      disabled={disabled}
                      data-testid="p-photo"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f) return;
                        setPhotoBusy(true);
                        try {
                          const u = await downscalePhoto(f);
                          setPhotos((x) => [...x, u].slice(0, 3));
                        } catch {
                          toast.push({ tone: "err", title: "사진을 읽지 못했습니다", desc: "다른 사진을 골라 주세요." });
                        } finally {
                          setPhotoBusy(false);
                        }
                      }}
                    />
                  </label>
                )}
              </div>
              {errors.photos && <p role="alert" className="mt-1 text-[0.8rem] font-semibold text-err">{errors.photos}</p>}
              <p className="mt-1.5 text-[0.76rem] text-ink-3">사진은 태강지엘텍 담당자와 보수 작업자만 봅니다. 보수가 끝나면 ‘내 요청’에 처리 결과가 표시됩니다.</p>
              {warrantyState === "expired" && <p className="mt-1 text-[0.76rem] font-semibold text-ink-2" data-testid="p-warranty-expired">이 현장은 하자보증 기간이 지났습니다. 요청은 그대로 접수되고, 태강지엘텍이 내용을 확인한 뒤 처리 방법을 안내합니다.</p>}
            </div>
          )}
          {goods && <p className="-mt-1 text-[0.76rem] text-ink-3">본사가 내용을 확인한 뒤 회신합니다. 금액·납기는 회신과 별도 견적서로 확정되며, 이 요청만으로 계약·주문이 성립하지 않습니다.</p>}
          <Field label={type === "order" ? "희망 납품·시공일 (선택)" : defect ? "보수 희망일 (선택)" : "희망 회신일 (선택)"} htmlFor="p-date" error={errors.desiredDate}>
            <input id="p-date" type="date" min={todayIso()} className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} disabled={disabled} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {IS_LIVE ? <span /> : <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (type === "defect") {
                  setTitle("3층 거실 창 누수 — 하자보수 요청");
                  setLocation("3층 302호 거실 창 (남측)");
                  setDesc("비가 오면 창틀 아래 실리콘 부분으로 물이 스며듭니다. 확인 후 보수 일정을 알려주세요. (DEMO 요청)");
                  return;
                }
                if (type === "quote" || type === "order") {
                  setTitle(type === "quote" ? "1층 로비 출입문 옆 고정창 추가 — 견적 문의" : "지하 주차장 방화유리 교체 — 주문 요청");
                  setItem(type === "quote" ? "24mm 로이 복층유리 + 알루미늄 프레임" : "방화유리 (기존 규격 동일)");
                  setQty(type === "quote" ? "약 18㎡" : "6장");
                  setDesc(type === "quote" ? "로비 동측 벽체 일부를 고정창으로 바꾸려 합니다. 대략적인 금액과 시공 가능 시기를 알려주세요. (DEMO 요청)" : "파손된 방화유리 6장을 기존 규격으로 교체 요청합니다. 납품·시공 가능일을 회신해주세요. (DEMO 요청)");
                  return;
                }
                setType("change_review");
                setTitle("3층 남측 커튼월 유리 사양 변경 — 작업지시 및 변경견적 요청");
                setDesc("건축주 지시로 3층 남측 회의실 구간 유리를 삼중 로이유리로 변경합니다. 서면 작업지시로 남기며, 변경 범위·일정·변경견적을 회신해주세요. (DEMO 요청)");
              }}
              className="press rounded-lg bg-[#FFF7D6] px-2 py-1 text-[0.75rem] font-bold text-[#7A5200] disabled:opacity-50"
              data-testid="partner-fill"
            >
              DEMO 요청 채우기
            </button>}
            <Button type="submit" variant="cta" size="lg" icon={<Send size={17} />} disabled={disabled} data-testid="partner-submit">
              요청 보내기
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

const STEPS: PartnerRequestStatus[] = ["received", "reviewing", "answered"];

const PLACEHOLDER: Record<PartnerRequest["type"], { title: string; desc: string }> = {
  quote: { title: "예) 1층 로비 고정창 추가 견적 문의", desc: "위치, 대략적인 크기·사양, 원하는 시기를 적어주세요." },
  order: { title: "예) 지하 주차장 방화유리 6장 교체 주문", desc: "위치, 규격, 납품·시공 희망 조건을 적어주세요." },
  change_review: { title: "예) 3층 유리 사양 변경 검토 요청", desc: "변경 범위, 위치, 사유를 적어주세요." },
  schedule: { title: "예) 외관 점검 가능 일정 문의", desc: "원하시는 날짜와 확인할 내용을 적어주세요." },
  defect: { title: "예) 3층 거실 창 누수", desc: "언제부터, 어떤 증상인지 적어주세요. (예: 비 올 때 창틀 아래로 물이 샘)" },
  other: { title: "제목을 적어주세요", desc: "요청 내용을 적어주세요." },
};

function MyRequests({ db, requests, preview, onRedo }: { db: DemoDB; requests: PartnerRequest[]; preview: boolean; onRedo: (r: PartnerRequest) => void }) {
  const toast = useToast();
  const [big, setBig] = useState<{ src: string; title: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const confirm = async (r: PartnerRequest) => {
    setBusy(r.id);
    try {
      await run("confirmPartnerRequest", { requestId: r.id });
      toast.push({ tone: "ok", title: "확인했다고 남겼습니다", desc: "태강지엘텍에 ‘발주처 확인 완료’로 표시됩니다." });
    } catch (e) {
      toast.push({ tone: "err", title: errorMessage(e, "처리하지 못했습니다.") });
    } finally {
      setBusy(null);
    }
  };
  const thumbs = (ids: string[] | undefined, title: string, testId: string) => {
    const list = (ids ?? []).map((id) => db.photos.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
    if (!list.length) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-2" data-testid={testId}>
        {list.map((p) => (
          <button key={p.id} type="button" onClick={() => setBig({ src: p.dataUrl, title })} className="press overflow-hidden rounded-xl border border-line" aria-label={`${title} 크게 보기`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.dataUrl} alt="" loading="lazy" className="size-16 object-cover" />
          </button>
        ))}
      </div>
    );
  };
  return (
    <Card id="my-requests" className="scroll-mt-4 lg:scroll-mt-40" data-testid="partner-requests">
      <CardHeader title="내 요청" sub="처리 상태가 실시간으로 바뀝니다 · 하자보수는 보수 진행까지 보입니다" />
      {requests.length === 0 ? (
        <EmptyState icon={<Inbox size={28} />} title="요청 내역이 없습니다." />
      ) : (
        <ul className="space-y-3 px-5 pb-5">
          {requests.map((r) => {
            const idx = STEPS.indexOf(r.status);
            const repair = db.partnerRepairs?.[r.id] ?? partnerRepairView(db, r);
            // 하자보수는 한 줄 단계로: 접수 → 보수 배정 → 보수 중 → 보수 완료 → 확인 완료 (D-68 점검 반영)
            // 하자보수는 접수부터 같은 5단계 (작업지시 전에 3단계 표시였다가 바뀌던 문제 · D-69 점검 반영)
            const prog = r.type === "defect" ? defectProgress(r, repair) : null;
            const original = r.reopenedFrom ? requests.find((x) => x.id === r.reopenedFrom) : undefined;
            const canConfirm = r.status === "answered" && !r.confirmedAt && (repair ? repairReady(repair) : r.type !== "defect" || !!r.closedWithoutRepair);
            const redo = requests.find((x) => x.reopenedFrom === r.id);
            return (
              <li key={r.id} className="rounded-2xl border border-line bg-surface-2 p-4" data-testid="partner-request-item" data-status={r.status} data-type={r.type}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-[0.92rem] font-bold [overflow-wrap:anywhere]">
                    <span className="mr-1.5 text-[0.74rem] font-bold text-theme-ink" data-testid="partner-request-type">{PARTNER_TYPE_LABEL[r.type]}</span>
                    {r.title}
                  </p>
                  <Badge tone={prog ? (prog.step >= 3 ? "ok" : "theme") : r.confirmedAt || r.status === "answered" ? "ok" : r.status === "reviewing" ? "theme" : "warn"} data-testid="partner-request-badge">
                    {prog ? prog.label : r.confirmedAt ? "확인 완료" : PARTNER_STATUS_LABEL[r.status]}
                  </Badge>
                </div>
                {(r.item || r.qty) && (
                  <p className="mt-1 text-[0.8rem] text-ink-2">
                    {r.item}
                    {r.qty ? ` · ${r.qty}` : ""}
                    {r.desiredDate ? ` · 희망 ${fmtDate(r.desiredDate)}` : ""}
                  </p>
                )}
                {r.location && (
                  <p className="mt-1 text-[0.8rem] text-ink-2" data-testid="partner-request-location">
                    위치: {r.location}
                    {r.desiredDate ? ` · 보수 희망 ${fmtDate(r.desiredDate)}` : ""}
                  </p>
                )}
                {r.reopenedFrom && (
                  <p className="mt-1 text-[0.76rem] text-ink-3" data-testid="partner-reopened-from">
                    다시 요청 · 원래 요청: {original ? `‘${original.title}’ (${fmtDate(original.createdAt)} 접수)` : "앞서 보낸 요청"}
                  </p>
                )}
                {thumbs(r.photoIds, "첨부한 하자 사진", "partner-request-photos")}
                {prog ? (
                  <ol className="mt-3 grid grid-cols-5 gap-0.5" aria-label="하자보수 단계" data-testid="partner-defect-steps" data-step={prog.step}>
                    {DEFECT_STEPS.map((label, i) => (
                      <li key={label} className="text-center">
                        <span className={cx("mx-auto grid size-7 place-items-center rounded-full", i <= prog.step ? "bg-solid text-white" : "bg-surface-3 text-ink-3")}>
                          {i < prog.step || (prog.step >= 3 && i <= prog.step) ? <CircleCheck size={15} /> : <Clock3 size={15} />}
                        </span>
                        <span className="mt-1 block text-[0.7rem] font-bold leading-tight [word-break:keep-all]">{label}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                <ol className="mt-3 grid grid-cols-3 gap-1" aria-label="처리 단계">
                  {STEPS.map((s, i) => {
                    const h = r.history.find((x) => x.status === s);
                    return (
                      <li key={s} className="text-center">
                        <span className={cx("mx-auto grid size-7 place-items-center rounded-full", i <= idx ? "bg-solid text-white" : "bg-surface-3 text-ink-3")}>
                          {i < idx || r.status === "answered" ? <CircleCheck size={15} /> : <Clock3 size={15} />}
                        </span>
                        <span className="mt-1 block text-[0.72rem] font-bold">{PARTNER_STATUS_LABEL[s]}</span>
                        <span className="block text-[0.78rem] text-ink-3 num">{h ? fmtRelative(h.at) : "—"}</span>
                      </li>
                    );
                  })}
                </ol>
                )}
                {repair && (
                  <p className={cx("mt-3 flex flex-wrap items-center gap-1.5 rounded-xl px-3 py-2 text-[0.82rem] font-semibold", repair.stage === "done" ? "bg-ok-bg text-ok" : "bg-active-soft text-theme-ink")} data-testid="partner-repair" data-stage={repair.stage}>
                    <Wrench size={15} aria-hidden /> {defectProgress({ status: r.status }, repair).label}
                    {/* 줄이 바뀌어도 ‘·’로 시작하지 않게 (D-69 점검 반영) */}
                    <span className="num font-normal text-ink-2">{fmtRelative(repair.at)}</span>
                    {repair.stage !== "done" && repair.dueDate && <span className="num font-normal text-ink-2">· {fmtDate(repair.dueDate)}까지 예정</span>}
                  </p>
                )}
                {r.reply ? (
                  <div className="mt-3 rounded-xl bg-surface px-3 py-2 text-[0.82rem]">
                    <p className="text-[0.72rem] font-bold text-ink-3">태강지엘텍 회신</p>
                    <p className="text-ink [overflow-wrap:anywhere]">{r.reply}</p>
                    {thumbs(r.replyPhotoIds, "보수 완료 사진", "partner-reply-photos")}
                  </div>
                ) : (
                  <p className="mt-2 text-[0.76rem] text-ink-3">접수 {fmtDateTime(r.createdAt)}</p>
                )}
                {r.status === "answered" && r.type === "defect" && !canConfirm && !r.confirmedAt && !redo && (
                  <p className="mt-2 text-[0.78rem] text-ink-3" data-testid="partner-confirm-later">태강지엘텍이 보수를 마무리하면 ‘보수 확인했어요’를 누를 수 있습니다.</p>
                )}
                {r.confirmedAt && (
                  <p className="mt-2 text-[0.78rem] font-semibold text-ok" data-testid="partner-confirmed">
                    <CircleCheck size={14} className="mr-1 inline" aria-hidden />
                    {fmtDateTime(r.confirmedAt)} 확인함
                  </p>
                )}
                {/* 다시 요청했으면 원래 요청은 확인 버튼 없이 ‘이어서 처리 중’ (D-69 점검 반영) */}
                {r.type === "defect" && redo && (
                  <p className="mt-2 text-[0.8rem] font-semibold text-ink-2" data-testid="partner-redone">
                    {fmtDate(redo.createdAt)} 다시 요청함 — 새 요청으로 이어서 처리합니다
                  </p>
                )}
                {!preview && !redo && (canConfirm || (r.type === "defect" && !!r.confirmedAt)) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canConfirm && (
                      <Button variant="cta" icon={<CircleCheck size={16} />} disabled={busy === r.id} onClick={() => confirm(r)} data-testid="partner-confirm">
                        {r.type === "defect" ? "보수 확인했어요" : "회신 확인했어요"}
                      </Button>
                    )}
                    {r.type === "defect" && (
                      <Button variant="soft" icon={<RotateCcw size={16} />} onClick={() => onRedo(r)} className="h-auto min-h-11 whitespace-normal py-2 text-left" data-testid="partner-redo">
                        {r.confirmedAt ? "같은 곳에 또 문제가 생겼어요" : "아직 문제가 있어요"}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={!!big} onClose={() => setBig(null)} title={big?.title ?? "사진"} size="lg" footer={<Button onClick={() => setBig(null)} icon={<X size={16} />}>닫기</Button>}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {big && <img src={big.src} alt={big.title} className="w-full rounded-xl" />}
      </Modal>
    </Card>
  );
}

function FutureCards() {
  const [open, setOpen] = useState<(typeof FUTURE)[number] | null>(null);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FUTURE.map((f) => (
          <button key={f.title} type="button" onClick={() => setOpen(f)} className="lift rounded-2xl border border-dashed border-line-strong bg-surface p-4 text-left" data-testid="future-card">
            <Badge tone="neutral">NEXT</Badge>
            <p className="mt-2 text-[0.92rem] font-bold">{f.title}</p>
            <p className="mt-1 inline-flex items-center gap-0.5 text-[0.76rem] font-semibold text-ink-3">
              미리보기 <ChevronRight size={14} />
            </p>
          </button>
        ))}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.title} — 향후 확장 기능` : ""} description="현재 구현되지 않은 기능입니다 (Preview). 계약 범위에 포함되지 않습니다." size="sm" footer={<Button onClick={() => setOpen(null)} icon={<X size={16} />}>닫기</Button>}>
        <ul className="list-disc space-y-1 pl-5 text-[0.88rem] text-ink-2">{open?.items.map((i) => <li key={i}>{i}</li>)}</ul>
      </Modal>
    </>
  );
}

/** 공정 사진(본사가 공개한 것만) + 최근 2주 공정 변화 (D-67) */
function SiteUpdates({ db, siteId, preview }: { db: NonNullable<ReturnType<typeof useMe>["db"]>; siteId: string; preview: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const photos = sharedPhotos(db, siteId).slice(0, 24);
  // 발주처 계정은 서버가 만든 공정 변화만 받는다 (보고 원문은 오지 않음). 본사 미리보기·시연은 같은 계산을 바로 한다.
  // 서버는 월간 보고서용으로 62일치를 보낸다 — 이 카드는 최근 14일만 (D-68)
  const since = shiftDate(todayIso(), -(PARTNER_FEED_DAYS - 1));
  const feed = (db.partnerFeed?.[siteId] ?? partnerProgressFeed(db, siteId, todayIso())).filter((f) => f.date >= since);
  const big = photos.find((p) => p.id === open);
  return (
    <section id="photos" className="grid scroll-mt-4 gap-5 lg:scroll-mt-40 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card data-testid="partner-photos">
        <CardHeader title="공정 사진" sub={photos.length ? `태강지엘텍이 공개한 사진 ${photos.length}장 · 누르면 크게 보입니다` : "아직 공개된 사진이 없습니다"} />
        {photos.length === 0 ? (
          <EmptyState title="공개된 공정 사진이 없습니다" desc={preview ? "본사 사진대장에서 사진 아래 ‘발주처 공개’를 누르면 여기에 보입니다." : "태강지엘텍이 사진을 공개하면 여기에 표시됩니다."} />
        ) : (
          <ul className="grid grid-cols-2 gap-2 px-5 pb-5 sm:grid-cols-3">
            {photos.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setOpen(p.id)} className="press block w-full overflow-hidden rounded-xl border border-line bg-surface-2 text-left" data-testid="partner-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.dataUrl} alt={p.shared?.caption || "공정 사진"} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                  <span className="block px-2 py-1.5 text-[0.8rem] text-ink-2">
                    <span className="num block">{fmtDate(p.createdAt)}</span>
                    {p.shared?.caption && <span className="line-clamp-2 [overflow-wrap:anywhere]">{p.shared.caption}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card data-testid="partner-feed">
        <CardHeader title="최근 공정 변화" sub={`최근 ${PARTNER_FEED_DAYS}일 · 현장 보고·공정 기록으로 바뀐 공정 진행률`} />
        {feed.length === 0 ? (
          <EmptyState title={`최근 ${PARTNER_FEED_DAYS}일 동안 바뀐 공정이 없습니다`} desc={preview ? "현장 보고에서 공정 단계 진척을 바꾸면 이곳에 날짜별로 보입니다." : undefined} />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {feed.slice(0, 12).map((f) => (
              <li key={`${f.date}-${f.stage}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[0.86rem]" data-testid="partner-feed-item">
                <span className="min-w-0">
                  <span className="block font-semibold [overflow-wrap:anywhere]">{f.stage}</span>
                  <span className="num block text-[0.76rem] text-ink-3">{fmtDate(f.date)}</span>
                </span>
                <b className="num shrink-0">
                  {f.from}% → {f.to}%
                </b>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={!!big} onClose={() => setOpen(null)} title={big?.shared?.caption || "공정 사진"} description={big ? fmtDate(big.createdAt) : undefined} size="lg" footer={<Button onClick={() => setOpen(null)} icon={<X size={16} />}>닫기</Button>}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {big && <img src={big.dataUrl} alt={big.shared?.caption || "공정 사진"} className="w-full rounded-xl" />}
      </Modal>
    </section>
  );
}
