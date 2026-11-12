"use client";

/**
 * 하자 접수 화면 (D-74) — 로그인 없이, 접수 주소·QR로 들어온 사람이 쓴다. 휴대폰 한 화면에서 위치·내용·사진·연락처만.
 * LIVE: /api/intake가 주소를 확인하고 접수를 만든다. DEMO: 서버가 없어 이 브라우저의 가상 데이터에 넣는다.
 * 접수가 끝나면 ‘진행 확인 주소’를 보여 주고, 이 휴대폰에 기억해 둔다 (같은 QR로 다시 들어오면 내 접수 목록이 보인다).
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Camera, CheckCircle2, ChevronRight, X } from "lucide-react";
import { dispatch, useDb } from "@/lib/data/store";
import { CommandError, errorMessage } from "@/lib/data/commands";
import { submitIntake } from "@/lib/data/intakeCommands";
import { IS_LIVE } from "@/lib/mode";
import { fmtDateTime } from "@/lib/domain/format";
import { INTAKE_CONTACT_KEEP_DAYS, INTAKE_MAX_PHOTOS, INTAKE_TOKEN_RE, intakeState, normalizePhone, tokenHash, type IntakeFormView } from "@/lib/domain/intake";
import { Button, PageSkeleton, cx, inputCls } from "@/components/ui/primitives";
import { PublicMessage, PublicShell } from "@/components/intake/PublicShell";
import { downscalePhoto } from "@/components/easy/photo";

type Load = { status: "loading" } | { status: "ok"; view: IntakeFormView } | { status: "gone"; code: "notfound" | "closed" } | { status: "error"; message: string };
interface Mine {
  no: string;
  key: string;
  at: string;
  location: string;
}
const MINE_KEY = (token: string) => `tk-site-intel:intake-mine:${tokenHash(token).slice(0, 16)}`;
const readMine = (token: string): Mine[] => {
  try {
    const v = JSON.parse(localStorage.getItem(MINE_KEY(token)) ?? "[]");
    return Array.isArray(v) ? (v as Mine[]).filter((x) => x && typeof x.key === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
};
const GONE = {
  notfound: { title: "열 수 없는 주소입니다", desc: "주소가 끝까지 입력됐는지 확인해 주세요. QR을 다시 찍거나, 시공사에 전화로 알려 주세요." },
  closed: { title: "지금은 이 주소로 접수를 받지 않습니다", desc: "시공사에서 이 접수 주소를 닫았습니다. 시공사에 전화로 알려 주세요." },
} as const;

/** 이 접수의 번호(난수) — 응답을 못 받고 다시 보내도 같은 접수로 알아보고, 진행 확인 주소도 여기서 만들어진다 */
function newIdem(): string {
  const c = typeof crypto === "undefined" ? undefined : (crypto as Partial<Crypto>);
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export default function IntakePage() {
  const { token } = useParams<{ token: string }>();
  const db = useDb();
  const [live, setLive] = useState<Load>({ status: "loading" });

  useEffect(() => {
    if (!IS_LIVE) return;
    if (!INTAKE_TOKEN_RE.test(token)) return setLive({ status: "gone", code: "notfound" });
    let off = false;
    (async () => {
      try {
        const r = await fetch(`/api/intake/${token}`, { cache: "no-store", credentials: "omit" });
        const body = await r.json().catch(() => null);
        if (off) return;
        if (r.status === 404 || r.status === 410) return setLive({ status: "gone", code: body?.code === "closed" ? "closed" : "notfound" });
        if (!r.ok || !body?.siteName) return setLive({ status: "error", message: body?.error ?? "화면을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요." });
        setLive({ status: "ok", view: body as IntakeFormView });
      } catch {
        if (!off) setLive({ status: "error", message: "인터넷 연결을 확인한 뒤 다시 열어 주세요." });
      }
    })();
    return () => {
      off = true;
    };
  }, [token]);

  // 시연판: 이 브라우저의 가상 데이터에서 같은 규칙으로 찾는다
  const demo: Load = useMemo(() => {
    if (IS_LIVE) return { status: "loading" };
    if (!db) return { status: "loading" };
    const intake = INTAKE_TOKEN_RE.test(token) ? (db.intakes ?? []).find((i) => i.token === token) : undefined;
    const site = intake ? db.sites.find((s) => s.id === intake.siteId) : undefined;
    if (!intake || !site) return { status: "gone", code: "notfound" };
    if (intakeState(intake) !== "open") return { status: "gone", code: "closed" };
    return { status: "ok", view: { company: db.company.name, siteName: site.name } };
  }, [db, token]);

  const load = IS_LIVE ? live : demo;
  if (load.status === "loading")
    return (
      <div className="min-h-dvh bg-[#F6F5F3] px-4 py-6" data-testid="intake-page" data-state="loading">
        <PageSkeleton />
      </div>
    );
  if (load.status === "gone") return <PublicMessage testId="intake-page" state={load.code} {...GONE[load.code]} />;
  if (load.status === "error")
    return (
      <PublicMessage testId="intake-page" state="error" title="화면을 열지 못했습니다" desc={load.message}>
        <Button variant="cta" className="mt-5" onClick={() => window.location.reload()}>
          다시 열기
        </Button>
      </PublicMessage>
    );
  return <IntakeForm token={token} view={load.view} />;
}

function IntakeForm({ token, view }: { token: string; view: IntakeFormView }) {
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [org, setOrg] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ no: string; key: string } | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);
  const [copied, setCopied] = useState(false);
  // 같은 접수가 두 번 들어가지 않게 — 화면을 연 동안 같은 번호
  const idem = useRef("");
  const fileRef = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    idem.current = newIdem();
    setMine(readMine(token));
  }, [token]);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = INTAKE_MAX_PHOTOS - photos.length;
    try {
      const urls = await Promise.all(Array.from(files).slice(0, room).map((f) => downscalePhoto(f)));
      setPhotos((p) => [...p, ...urls].slice(0, INTAKE_MAX_PHOTOS));
      setErrors((e) => ({ ...e, photos: files.length > room ? `사진은 ${INTAKE_MAX_PHOTOS}장까지 보낼 수 있습니다.` : "" }));
    } catch {
      setErrors((e) => ({ ...e, photos: "사진을 읽지 못했습니다. 다른 사진으로 해 보세요." }));
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const check = () => {
    const e: Record<string, string> = {};
    if (!location.trim()) e.location = "하자가 있는 곳을 적어 주세요.";
    if (!description.trim()) e.description = "어떤 문제인지 적어 주세요.";
    if (!name.trim()) e.name = "연락받으실 분 이름을 적어 주세요.";
    if (!normalizePhone(phone)) e.phone = "전화번호를 확인해 주세요. (예: 010-1234-5678)";
    if (!consent) e.consent = "동의해 주셔야 접수할 수 있습니다.";
    return e;
  };

  const submit = async () => {
    const e = check();
    setErrors(e);
    setFailed(null);
    if (Object.keys(e).length) {
      // 처음 틀린 칸으로
      const first = ["location", "description", "name", "phone", "consent"].find((k) => e[k]);
      document.getElementById(`in-${first}`)?.focus();
      return;
    }
    setBusy(true);
    const input = { idempotencyKey: idem.current, location, description, photoDataUrls: photos, org, name, phone, consent };
    try {
      let out: { no: string; statusToken: string };
      if (IS_LIVE) {
        const r = await fetch(`/api/intake/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", body: JSON.stringify({ ...input, website }) });
        const body = await r.json().catch(() => null);
        if (!r.ok || !body?.statusToken) {
          if (body?.fieldErrors && Object.keys(body.fieldErrors).length) setErrors(body.fieldErrors);
          setFailed(body?.code === "DUPLICATE" ? "이미 접수되었습니다. 진행은 시공사에 전화로 문의해 주세요." : (body?.error ?? "접수하지 못했습니다. 잠시 뒤 다시 눌러 주세요."));
          return;
        }
        out = body;
      } else {
        const r = dispatch((d, ctx) => {
          const intake = (d.intakes ?? []).find((i) => i.token === token);
          return submitIntake(d, { ...input, intakeId: intake?.id ?? "" }, { ...ctx, userId: "system" });
        });
        out = { no: r.no, statusToken: r.statusToken };
      }
      const item: Mine = { no: out.no, key: out.statusToken, at: new Date().toISOString(), location: location.trim().slice(0, 60) };
      try {
        localStorage.setItem(MINE_KEY(token), JSON.stringify([item, ...readMine(token)].slice(0, 20)));
      } catch {
        // 저장소를 못 쓰면 화면의 주소만 안내한다
      }
      setDone({ no: out.no, key: out.statusToken });
      topRef.current?.scrollIntoView({ block: "start" });
    } catch (err) {
      if (err instanceof CommandError && err.fieldErrors && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setFailed(err instanceof CommandError && err.code === "DUPLICATE" ? "이미 접수되었습니다." : errorMessage(err, "접수하지 못했습니다. 잠시 뒤 다시 눌러 주세요."));
    } finally {
      setBusy(false);
    }
  };

  const statusUrl = done && typeof window !== "undefined" ? `${window.location.origin}/r/s/${done.key}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(statusUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      (document.getElementById("in-status-url") as HTMLInputElement | null)?.select();
    }
  };

  return (
    <PublicShell company={view.company} sub="하자 접수" sample={view.sample} testId="intake-page" state={done ? "done" : "open"}>
      <div ref={topRef} />
      {done ? (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card" data-testid="intake-done" aria-live="polite">
          <p className="flex items-center gap-2 text-[1.15rem] font-extrabold text-ok">
            <CheckCircle2 size={24} aria-hidden /> 접수되었습니다
          </p>
          <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-2">
            접수 번호 <b className="num text-[1.1rem] text-ink" data-testid="intake-no">{done.no}</b> · {view.siteName}
          </p>
          <p className="mt-3 text-[0.92rem] leading-relaxed text-ink">담당자가 확인한 뒤 적어 주신 번호로 연락드립니다. 보수 진행은 아래 주소에서 언제든 볼 수 있습니다.</p>
          <label htmlFor="in-status-url" className="mt-4 block text-[0.82rem] font-bold text-ink-2">
            진행 확인 주소 <span className="font-normal text-ink-3">(이 휴대폰에 저장해 두었습니다)</span>
          </label>
          <input id="in-status-url" readOnly value={statusUrl} onFocus={(e) => e.currentTarget.select()} className={cx(inputCls, "num mt-1.5 text-[0.82rem]")} data-testid="intake-status-url" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/r/s/${done.key}`} className="press inline-flex h-12 items-center gap-2 rounded-full bg-cta px-5 text-[1rem] font-bold text-cta-text shadow-card" data-testid="intake-status-open">
              진행 보기 <ChevronRight size={18} aria-hidden />
            </Link>
            <Button size="lg" onClick={copy} data-testid="intake-status-copy">
              {copied ? "복사됨" : "주소 복사"}
            </Button>
          </div>
          <p className="mt-4 text-[0.82rem] leading-relaxed text-ink-3">다른 하자가 더 있으면 이 화면을 새로 열어(QR을 다시 찍어) 한 건씩 접수해 주세요.</p>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h1 className="text-[1.25rem] font-extrabold leading-snug">하자 접수</h1>
            <p className="mt-1 text-[0.92rem] font-semibold text-ink-2" data-testid="intake-site">{view.siteName}</p>
            <p className="mt-2 text-[0.88rem] leading-relaxed text-ink-2">창호·유리·실링 등에 문제가 있으면 아래에 적어 보내 주세요. 담당자가 확인하고 연락드립니다.</p>

            <form
              className="mt-5 space-y-5"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <Q id="in-location" label="어디에 문제가 있나요?" error={errors.location}>
                <input id="in-location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} placeholder="예: 3층 302호 거실 창" className={BIG} aria-invalid={!!errors.location} data-testid="intake-location" />
              </Q>
              <Q id="in-description" label="어떤 문제인가요?" error={errors.description}>
                <textarea id="in-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={800} rows={4} placeholder="예: 비가 오면 창틀 아래로 물이 샙니다." className={cx(BIG, "h-auto resize-none leading-relaxed")} aria-invalid={!!errors.description} data-testid="intake-description" />
              </Q>
              <div>
                <p className="text-[1rem] font-bold text-ink">
                  사진 <span className="text-[0.84rem] font-normal text-ink-3">(선택 · {INTAKE_MAX_PHOTOS}장까지)</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2.5">
                  {photos.map((p, i) => (
                    <div key={i} className="relative size-24 overflow-hidden rounded-xl border border-line" data-testid="intake-photo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p} alt={`보낼 사진 ${i + 1}`} className="size-full object-cover" />
                      <button type="button" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="press absolute right-1 top-1 grid size-8 place-items-center rounded-full bg-black/65 text-white" aria-label={`사진 ${i + 1} 빼기`}>
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  {photos.length < INTAKE_MAX_PHOTOS && (
                    <label className="press grid size-24 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-line-strong text-center text-[0.8rem] font-semibold text-ink-2 focus-within:border-active" data-testid="intake-photo-add">
                      <span>
                        <Camera size={24} className="mx-auto" aria-hidden />
                        사진 넣기
                      </span>
                      <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => void addPhotos(e.target.files)} data-testid="intake-photo-input" />
                    </label>
                  )}
                </div>
                {errors.photos && (
                  <p className="mt-1.5 text-[0.84rem] font-medium text-err" role="alert">
                    {errors.photos}
                  </p>
                )}
              </div>

              <fieldset className="space-y-4 rounded-xl border border-line bg-surface-2 px-4 py-4">
                <legend className="px-1 text-[0.95rem] font-bold text-ink">연락받으실 분</legend>
                <Q id="in-name" label="이름" error={errors.name}>
                  <input id="in-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="name" className={BIG} aria-invalid={!!errors.name} data-testid="intake-name" />
                </Q>
                <Q id="in-phone" label="전화번호" error={errors.phone}>
                  <input id="in-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} inputMode="tel" autoComplete="tel" placeholder="010-1234-5678" className={cx(BIG, "num")} aria-invalid={!!errors.phone} data-testid="intake-phone" />
                </Q>
                <Q id="in-org" label="소속" optional error={errors.org}>
                  <input id="in-org" value={org} onChange={(e) => setOrg(e.target.value)} maxLength={40} placeholder="예: 관리사무소" autoComplete="organization" className={BIG} data-testid="intake-org" />
                </Q>
              </fieldset>

              {/* 사람에게는 보이지 않는 칸 — 기계가 채우면 접수하지 않는다 */}
              <div className="hidden" aria-hidden>
                <label>
                  홈페이지
                  <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
                </label>
              </div>

              <div>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-4 py-3.5">
                  <input id="in-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-6 shrink-0 accent-[var(--t-active)]" aria-invalid={!!errors.consent} data-testid="intake-consent" />
                  <span className="text-[0.92rem] leading-relaxed text-ink">
                    하자 접수 처리와 연락을 위해 <b>이름·전화번호</b>를 {view.company}에 알려 주는 데 동의합니다.
                  </span>
                </label>
                {errors.consent && (
                  <p className="mt-1.5 text-[0.84rem] font-medium text-err" role="alert">
                    {errors.consent}
                  </p>
                )}
                <details className="mt-2 text-[0.82rem] text-ink-2" data-testid="intake-privacy">
                  <summary className="cursor-pointer py-1 font-semibold">개인정보 안내 보기</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 leading-relaxed">
                    <li>받는 것: 이름, 전화번호, 소속(적은 경우), 접수 내용과 사진</li>
                    <li>쓰는 곳: 하자 접수 확인, 방문 일정 연락, 처리 결과 안내</li>
                    <li>보관: 처리가 끝난 뒤 {INTAKE_CONTACT_KEEP_DAYS}일이 지나면 이름·전화번호를 지웁니다 (접수 내용은 하자 이력으로 남습니다)</li>
                    <li>동의하지 않으면 이 화면으로는 접수할 수 없습니다. 전화로 접수해 주세요.</li>
                  </ul>
                </details>
              </div>

              {failed && (
                <p role="alert" className="rounded-xl bg-err-bg px-4 py-3 text-[0.92rem] font-semibold text-err" data-testid="intake-error">
                  {failed}
                </p>
              )}
              <Button type="submit" variant="cta" size="lg" block loading={busy} data-testid="intake-submit">
                하자 접수하기
              </Button>
            </form>
          </section>

          {mine.length > 0 && (
            <section className="mt-4 rounded-2xl border border-line bg-surface p-5" data-testid="intake-mine">
              <h2 className="text-[1rem] font-extrabold">이 휴대폰으로 접수한 건</h2>
              <ul className="mt-2 divide-y divide-line">
                {mine.map((m) => (
                  <li key={m.key}>
                    <Link href={`/r/s/${m.key}`} className="press flex min-h-12 items-center gap-3 py-2 text-[0.92rem]" data-testid="intake-mine-row">
                      <span className="min-w-0 flex-1">
                        <b className="num">접수 번호 {m.no}</b>
                        <span className="block text-[0.82rem] text-ink-2 [overflow-wrap:anywhere]">
                          {m.location} · {fmtDateTime(m.at).slice(5)}
                        </span>
                      </span>
                      <span className="shrink-0 font-bold text-theme-ink">진행 보기</span>
                      <ChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </PublicShell>
  );
}

const BIG = cx(inputCls, "min-h-12 text-[1.02rem]");

function Q({ id, label, optional, error, children }: { id: string; label: string; optional?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[1rem] font-bold text-ink">
        {label}
        {optional && <span className="ml-1.5 text-[0.84rem] font-normal text-ink-3">(선택)</span>}
      </label>
      {children}
      {error && (
        <p className="text-[0.84rem] font-medium text-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
