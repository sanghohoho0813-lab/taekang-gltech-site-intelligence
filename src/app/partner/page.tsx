"use client";

import Link from "next/link";
import { useState } from "react";
import { Send, CircleCheck, Clock3, Inbox, ChevronRight, Lock, Settings, LayoutDashboard, Sparkles, X } from "lucide-react";
import { dispatch, setPrefs } from "@/lib/data/store";
import { useMe } from "@/lib/data/hooks";
import { createPartnerRequest, CommandError } from "@/lib/data/commands";
import { PARTNER_STATUS_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import type { PartnerRequest, PartnerRequestStatus } from "@/lib/domain/types";
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, Field, Notice, PageSkeleton, ProgressBar, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Facade } from "@/components/domain/Facade";
import { Donut } from "@/components/domain/Charts";
import { LogoMark } from "@/components/shell/Logo";
import { Clock } from "@/components/shell/Clock";

const FUTURE = [
  { title: "전자 기성 승인", items: ["기성 청구서 온라인 확인·승인", "승인 이력 보관", "결재 알림"] },
  { title: "자재 납품 일정 공유 (협력사)", items: ["유리·프레임 반입 일정 등록", "현장 반입 확인", "지연 알림"] },
  { title: "하자보수 요청", items: ["준공 후 하자 접수·사진 첨부", "처리 상태 확인", "보수 이력"] },
  { title: "다현장 통합 리포트 (B2B)", items: ["발주처별 여러 현장 진행률 한 화면", "월간 리포트 PDF", "구독형 검토"] },
];

export default function PartnerPage() {
  const { db, role, userId } = useMe();
  if (!db) return <PageSkeleton />;
  if (role === "field") {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center" data-testid="access-denied">
        <Lock size={28} className="mx-auto text-ink-3" />
        <h1 className="mt-3 text-[1.25rem] font-bold">현장직원 역할에서는 발주처 포털을 볼 수 없습니다</h1>
        <p className="mt-2 text-[0.88rem] text-ink-3">권한 프리뷰(DEMO)</p>
        <Link href="/field">
          <Button variant="cta" className="mt-5">현장 보고로 이동</Button>
        </Link>
      </div>
    );
  }
  const preview = role !== "partner";
  const partner = db.users.find((u) => u.id === (preview ? "u-partner" : userId))!;
  const site = db.sites.find((s) => partner.partnerSiteIds?.includes(s.id))!;
  const requests = db.partnerRequests.filter((r) => r.siteId === site.id && r.partnerUserId === partner.id);
  const nextStage = site.stages.find((s) => s.progressPct < 100);

  return (
    <div className="min-h-[calc(100dvh-var(--demo-bar-h))] bg-[#F6F5F3]" data-testid="partner-portal">
      <header className="sticky top-[var(--demo-bar-h)] z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-3 px-4">
          <LogoMark size={28} />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[0.95rem] font-extrabold tracking-[0.04em]">TAEKANG GLTECH</p>
            <p className="text-[0.7rem] font-semibold text-ink-3">발주처·협력사 포털</p>
          </div>
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="포털 메뉴">
            <a href="#status" className="press rounded-lg px-3 py-2 text-[0.85rem] font-bold text-ink hover:bg-surface-3">현장 현황</a>
            <a href="#request" className="press rounded-lg px-3 py-2 text-[0.85rem] font-bold text-ink hover:bg-surface-3">요청하기</a>
            <a href="#my-requests" className="press rounded-lg px-3 py-2 text-[0.85rem] font-bold text-ink hover:bg-surface-3">내 요청</a>
            <a href="#next" className="press rounded-lg px-3 py-2 text-[0.85rem] font-semibold text-ink-3 hover:bg-surface-3">
              확장 예정 <Badge tone="neutral">NEXT</Badge>
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <DemoBadge compact />
            {preview ? (
              <>
                <Badge tone="info" className="hidden sm:inline-flex">관리자 미리보기</Badge>
                <Link href="/dashboard">
                  <Button size="sm" icon={<LayoutDashboard size={15} />}>
                    <span className="hidden sm:inline">Business AX</span>
                  </Button>
                </Link>
              </>
            ) : (
              <Link href="/settings" aria-label="설정 · 역할 전환">
                <Button size="sm" variant="ghost" icon={<Settings size={15} />} aria-label="역할 전환">
                  <span className="hidden sm:inline">역할 전환</span>
                </Button>
              </Link>
            )}
          </div>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto border-t border-line px-3 py-1.5 md:hidden" aria-label="포털 메뉴 (모바일)">
          {[
            ["#status", "현장 현황"],
            ["#request", "요청하기"],
            ["#my-requests", "내 요청"],
            ["#next", "확장 예정"],
          ].map(([h, l]) => (
            <a key={h} href={h} className="press shrink-0 rounded-full bg-surface-3 px-3 py-1.5 text-[0.8rem] font-bold text-ink-2">
              {l}
            </a>
          ))}
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-[1240px] space-y-5 px-4 py-6 pb-16">
        {preview && (
          <Notice tone="info" title="관리자 미리보기 — ‘가상 발주처 A 담당자’에게 보이는 화면입니다">
            내부 원가·예상이익·미수금·다른 현장 정보는 이 포털에 표시되지 않습니다. 요청 등록은 발주처 역할로 전환해 시연하세요.{" "}
            <button type="button" className="font-bold text-theme-ink underline" onClick={() => setPrefs({ role: "partner" })} data-testid="switch-to-partner">
              발주처 역할로 전환
            </button>
          </Notice>
        )}

        <section id="status" className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <Facade kind={site.illustration} className="h-52 sm:h-64" />
            <div className="p-5">
              <p className="text-[0.78rem] font-semibold text-ink-3">{partner.name} {partner.title}님의 현장</p>
              <h1 className="mt-1 text-[1.35rem] font-extrabold leading-snug" data-testid="partner-site">{site.name}</h1>
              <p className="mt-1 text-[0.82rem] text-ink-3">{site.region} · {fmtDate(site.startDate)} ~ {fmtDate(site.endDate)} · <Clock compact /></p>
            </div>
          </Card>
          <Card>
            <CardHeader title="공정 진행 현황" sub="태강지엘텍이 승인·공개한 상태 정보" />
            <div className="flex items-center gap-4 px-5">
              <Donut value={site.progressPct} label="전체 공정률" size={124} />
              <div className="text-[0.85rem]">
                <p className="text-ink-3">진행 중인 단계</p>
                <p className="font-bold text-ink">{nextStage?.name ?? "준공"}</p>
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

        <div className="grid gap-5 lg:grid-cols-2">
          <RequestForm siteId={site.id} disabled={preview} />
          <MyRequests requests={requests} />
        </div>

        <section id="next" aria-labelledby="next-title">
          <h2 id="next-title" className="mb-3 flex items-center gap-2 text-[1.05rem] font-bold">
            <Sparkles size={18} aria-hidden /> 향후 확장 예정 <Badge tone="neutral">NEXT · 현재 미구현</Badge>
          </h2>
          <FutureCards />
        </section>

        <p className="text-center text-[0.74rem] text-ink-3">
          DEMO · 가상 시연 데이터 · 이 포털에는 내부 원가·이익·미수금·다른 고객 현장 정보가 표시되지 않습니다 (권한 프리뷰, 실제 보안은 Supabase RLS 전환 후 적용).
        </p>
      </main>
    </div>
  );
}

function RequestForm({ siteId, disabled }: { siteId: string; disabled: boolean }) {
  const toast = useToast();
  const [type, setType] = useState<PartnerRequest["type"]>("change_review");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [date, setDate] = useState("");
  const [key, setKey] = useState(() => uid("idem"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  return (
    <Card id="request" data-testid="partner-form">
      <CardHeader title="요청하기" sub="전화 없이 요청을 남기면 태강지엘텍 본사 요청함에 바로 접수됩니다" />
      {sent ? (
        <div className="anim-pop flex flex-col items-center gap-2 px-5 pb-6 pt-2 text-center" data-testid="partner-sent">
          <CircleCheck size={40} className="text-ok" />
          <p className="text-[1.05rem] font-bold">요청이 접수되었습니다</p>
          <p className="text-[0.85rem] text-ink-3">처리 상태는 오른쪽 ‘내 요청’에서 확인할 수 있습니다.</p>
          <Button
            className="mt-2"
            onClick={() => {
              setSent(false);
              setTitle("");
              setDesc("");
              setDate("");
              setKey(uid("idem"));
            }}
          >
            새 요청 작성
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3 px-5 pb-5"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              dispatch((d, ctx) => createPartnerRequest(d, { idempotencyKey: key, siteId, title, description: desc, desiredDate: date, type }, ctx));
              setSent(true);
              setErrors({});
              toast.push({ tone: "ok", title: "요청을 접수했습니다", desc: "본사 ‘위험 분석·조치 > 요청함’에 표시됩니다." });
            } catch (err) {
              if (err instanceof CommandError) {
                setErrors(err.fieldErrors);
                if (!Object.keys(err.fieldErrors).length) toast.push({ tone: "err", title: err.message });
              }
            }
          }}
          noValidate
        >
          {disabled && <Notice tone="info">미리보기 모드에서는 요청을 등록할 수 없습니다. 위의 ‘발주처 역할로 전환’을 누르세요.</Notice>}
          <Field label="요청 유형" htmlFor="p-type">
            <select id="p-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value as PartnerRequest["type"])} disabled={disabled}>
              <option value="change_review">변경공사 검토 요청</option>
              <option value="schedule">일정 문의</option>
              <option value="other">기타</option>
            </select>
          </Field>
          <Field label="제목" htmlFor="p-title" required error={errors.title}>
            <input id="p-title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} disabled={disabled} placeholder="예) 3층 유리 사양 변경 검토 요청" />
          </Field>
          <Field label="내용" htmlFor="p-desc" required error={errors.description} counter={`${desc.length}/800`}>
            <textarea id="p-desc" rows={4} className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={800} disabled={disabled} placeholder="변경 범위, 위치, 사유를 적어주세요." />
          </Field>
          <Field label="희망 회신일 (선택)" htmlFor="p-date">
            <input id="p-date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} disabled={disabled} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setType("change_review");
                setTitle("3층 남측 커튼월 유리 사양 변경 검토 요청");
                setDesc("3층 남측 회의실 구간 유리를 삼중유리로 변경하는 범위와 일정·비용 영향을 검토해주세요. (DEMO 요청)");
              }}
              className="press rounded-lg bg-[#FFF7D6] px-2 py-1 text-[0.75rem] font-bold text-[#7A5200] disabled:opacity-50"
              data-testid="partner-fill"
            >
              DEMO 요청 채우기
            </button>
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

function MyRequests({ requests }: { requests: PartnerRequest[] }) {
  return (
    <Card id="my-requests" data-testid="partner-requests">
      <CardHeader title="내 요청" sub="처리 상태가 실시간으로 바뀝니다" />
      {requests.length === 0 ? (
        <EmptyState icon={<Inbox size={28} />} title="요청 내역이 없습니다." />
      ) : (
        <ul className="space-y-3 px-5 pb-5">
          {requests.map((r) => {
            const idx = STEPS.indexOf(r.status);
            return (
              <li key={r.id} className="rounded-2xl border border-line bg-surface-2 p-4" data-testid="partner-request-item" data-status={r.status}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[0.92rem] font-bold">{r.title}</p>
                  <Badge tone={r.status === "answered" ? "ok" : r.status === "reviewing" ? "theme" : "warn"}>{PARTNER_STATUS_LABEL[r.status]}</Badge>
                </div>
                <ol className="mt-3 grid grid-cols-3 gap-1" aria-label="처리 단계">
                  {STEPS.map((s, i) => {
                    const h = r.history.find((x) => x.status === s);
                    return (
                      <li key={s} className="text-center">
                        <span className={cx("mx-auto grid size-7 place-items-center rounded-full", i <= idx ? "bg-solid text-white" : "bg-surface-3 text-ink-3")}>
                          {i < idx || r.status === "answered" ? <CircleCheck size={15} /> : <Clock3 size={15} />}
                        </span>
                        <span className="mt-1 block text-[0.72rem] font-bold">{PARTNER_STATUS_LABEL[s]}</span>
                        <span className="block text-[0.65rem] text-ink-3 num">{h ? fmtRelative(h.at) : "—"}</span>
                      </li>
                    );
                  })}
                </ol>
                {r.reply ? (
                  <div className="mt-3 rounded-xl bg-surface px-3 py-2 text-[0.82rem]">
                    <p className="text-[0.72rem] font-bold text-ink-3">태강지엘텍 회신</p>
                    <p className="text-ink">{r.reply}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-[0.76rem] text-ink-3">접수 {fmtDateTime(r.createdAt)}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
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
