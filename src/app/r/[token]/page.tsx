"use client";

/**
 * 하자 접수 화면 (D-74) — 로그인 없이, 접수 주소·QR로 들어온 사람이 쓴다. 휴대폰 한 화면에서 위치·내용·사진·연락처만.
 * LIVE: /api/intake가 주소를 확인하고 접수를 만든다. DEMO: 서버가 없어 이 브라우저의 가상 데이터에 넣는다.
 * 접수가 끝나면 ‘진행 확인 주소’를 보여 주고, 이 기기에 기억해 둔다 (같은 QR로 다시 들어오면 맨 위에 내 접수 목록이 보인다).
 * 적던 글은 화면을 새로 열어도 남는다 (사진을 찍다 화면이 다시 열리는 휴대폰이 있다).
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Camera, CheckCircle2, ChevronRight, MessageSquareText, Share2, X } from "lucide-react";
import { dispatch, useDb } from "@/lib/data/store";
import { CommandError, errorMessage } from "@/lib/data/commands";
import { submitIntake } from "@/lib/data/intakeCommands";
import { IS_LIVE } from "@/lib/mode";
import { fmtDateTime } from "@/lib/domain/format";
import { INTAKE_CONTACT_KEEP_DAYS, INTAKE_MAX_PHOTOS, INTAKE_TOKEN_RE, intakeFullToday, intakeState, normalizePhone, tokenHash, type IntakeFormView } from "@/lib/domain/intake";
import { Button, cx, inputCls } from "@/components/ui/primitives";
import { CallButton, CallHint, PublicLoading, PublicMessage, PublicShell } from "@/components/intake/PublicShell";
import { downscalePhoto } from "@/components/easy/photo";

type Gone = { status: "gone"; code: "notfound" | "closed"; company?: string; phone?: string };
type Load = { status: "loading" } | { status: "ok"; view: IntakeFormView } | Gone | { status: "error"; message: string };
interface Mine {
  no: string;
  key: string;
  at: string;
  location: string;
}
/** 이 기기에 기억해 두는 기간 (일) — 오래된 것은 목록에서 뺀다 */
const MINE_KEEP_DAYS = 120;
const MINE_KEY = (token: string) => `tk-site-intel:intake-mine:${tokenHash(token).slice(0, 16)}`;
const DRAFT_KEY = (token: string) => `tk-site-intel:intake-draft:${tokenHash(token).slice(0, 16)}`;
const readMine = (token: string): Mine[] => {
  try {
    const v = JSON.parse(localStorage.getItem(MINE_KEY(token)) ?? "[]");
    const from = Date.now() - MINE_KEEP_DAYS * 86_400_000;
    return Array.isArray(v) ? (v as Mine[]).filter((x) => x && typeof x.key === "string" && new Date(x.at).getTime() > from).slice(0, 20) : [];
  } catch {
    return [];
  }
};
const writeMine = (token: string, list: Mine[]): boolean => {
  try {
    if (list.length) localStorage.setItem(MINE_KEY(token), JSON.stringify(list.slice(0, 20)));
    else localStorage.removeItem(MINE_KEY(token));
    return true;
  } catch {
    return false;
  }
};
const GONE = {
  notfound: { title: "열 수 없는 주소입니다", desc: "주소가 끝까지 입력됐는지 확인해 주세요. QR을 다시 찍거나 받은 주소를 그대로 눌러 주세요." },
  closed: { title: "지금은 이 주소로 접수를 받지 않습니다", desc: "시공사에서 이 접수 주소를 닫았습니다. 하자는 전화로 알려 주세요." },
} as const;

/** 주소 끝에 문장부호·글자가 붙어 와도 주소만 골라 쓴다 (문자·메신저가 붙여 보내는 ‘.’ ‘)’ ‘입니다’ 등) */
function cleanToken(raw: string): string {
  let d = raw;
  try {
    d = decodeURIComponent(raw);
  } catch {
    // 그대로 쓴다
  }
  const m = /^([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/.exec(d);
  return m ? m[1] : d;
}

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
  const { token: rawToken } = useParams<{ token: string }>();
  const token = useMemo(() => cleanToken(rawToken), [rawToken]);
  const db = useDb();
  const [live, setLive] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!IS_LIVE) return;
    if (!INTAKE_TOKEN_RE.test(token)) return setLive({ status: "gone", code: "notfound" });
    let off = false;
    (async () => {
      try {
        const r = await fetch(`/api/intake/${token}`, { cache: "no-store", credentials: "omit" });
        const body = await r.json().catch(() => null);
        if (off) return;
        if (r.status === 404 || r.status === 410) return setLive(body?.code === "closed" ? { status: "gone", code: "closed", company: body.company, phone: body.phone } : { status: "gone", code: "notfound" });
        if (!r.ok || !body?.siteName) return setLive({ status: "error", message: r.status === 429 ? "지금은 여는 사람이 많습니다. 잠시 뒤 다시 열어 주세요." : (body?.error ?? "화면을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.") });
        setLive({ status: "ok", view: body as IntakeFormView });
      } catch {
        if (!off) setLive({ status: "error", message: "인터넷 연결을 확인한 뒤 다시 열어 주세요." });
      }
    })();
    return () => {
      off = true;
    };
  }, [token, attempt]);

  // 시연판: 이 브라우저의 가상 데이터에서 같은 규칙으로 찾는다
  const demo: Load = useMemo(() => {
    if (IS_LIVE) return { status: "loading" };
    if (!db) return { status: "loading" };
    const intake = INTAKE_TOKEN_RE.test(token) ? (db.intakes ?? []).find((i) => i.token === token) : undefined;
    const site = intake ? db.sites.find((s) => s.id === intake.siteId) : undefined;
    if (!intake || !site) return { status: "gone", code: "notfound" };
    const phone = db.settings?.publicPhone;
    if (intakeState(intake) !== "open") return { status: "gone", code: "closed", company: db.company.name, ...(phone ? { phone } : {}) };
    return { status: "ok", view: { company: db.company.name, siteName: intake.place || site.name, ...(phone ? { phone } : {}), ...(intakeFullToday(db, intake.id, new Date().toISOString()) ? { full: true as const } : {}) } };
  }, [db, token]);

  const load = IS_LIVE ? live : demo;
  if (load.status === "loading") return <PublicLoading testId="intake-page" />;
  if (load.status === "gone") return <PublicMessage testId="intake-page" state={load.code} {...GONE[load.code]} company={load.company} phone={load.phone} />;
  if (load.status === "error")
    return (
      <PublicMessage testId="intake-page" state="error" title="화면을 열지 못했습니다" desc={load.message}>
        <Button
          variant="cta"
          className="mt-5"
          onClick={() => {
            if (!IS_LIVE) return window.location.reload();
            setLive({ status: "loading" });
            setAttempt((n) => n + 1);
          }}
        >
          다시 열기
        </Button>
      </PublicMessage>
    );
  return <IntakeForm token={token} view={load.view} />;
}

interface Draft {
  location: string;
  description: string;
  org: string;
  name: string;
  phone: string;
}

function IntakeForm({ token, view }: { token: string; view: IntakeFormView }) {
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [org, setOrg] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [extra, setExtra] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ no: string; key: string; saved: boolean } | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);
  const [copied, setCopied] = useState<"ok" | "manual" | null>(null);
  const [canShare, setCanShare] = useState(false);
  // 같은 접수가 두 번 들어가지 않게 — 한 건을 적는 동안 같은 번호
  const idem = useRef("");
  const fileRef = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const restored = useRef(false);

  useEffect(() => {
    idem.current = newIdem();
    setMine(readMine(token));
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
    // 적던 글 되살리기 (사진을 찍다가 화면이 다시 열린 경우)
    try {
      const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY(token)) ?? "null") as Partial<Draft> | null;
      if (d) {
        setLocation(typeof d.location === "string" ? d.location : "");
        setDescription(typeof d.description === "string" ? d.description : "");
        setOrg(typeof d.org === "string" ? d.org : "");
        setName(typeof d.name === "string" ? d.name : "");
        setPhone(typeof d.phone === "string" ? d.phone : "");
      }
    } catch {
      // 무시
    }
    restored.current = true;
  }, [token]);
  useEffect(() => {
    if (!restored.current) return;
    try {
      const d: Draft = { location, description, org, name, phone };
      if (Object.values(d).some(Boolean)) sessionStorage.setItem(DRAFT_KEY(token), JSON.stringify(d));
      else sessionStorage.removeItem(DRAFT_KEY(token));
    } catch {
      // 무시
    }
  }, [token, location, description, org, name, phone]);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  /** 칸을 고치면 그 칸의 오류 표시를 바로 지운다 */
  const edit = (key: string, set: (v: string) => void) => (v: string) => {
    set(v);
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
    if (failed) setFailed(null);
  };

  const addPhotos = async (files: FileList | null) => {
    const picked = files ? Array.from(files) : [];
    if (fileRef.current) fileRef.current.value = "";
    if (!picked.length) return;
    const room = INTAKE_MAX_PHOTOS - photos.length;
    setPhotoBusy(true);
    // 한 장을 못 읽어도 나머지는 넣는다
    const results = await Promise.allSettled(picked.slice(0, room).map((f) => downscalePhoto(f, 1280)));
    setPhotoBusy(false);
    const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const bad = results.length - ok.length;
    setPhotos((p) => [...p, ...ok].slice(0, INTAKE_MAX_PHOTOS));
    const notes = [picked.length > room ? `사진은 ${INTAKE_MAX_PHOTOS}장까지 보낼 수 있습니다. 앞의 ${room}장만 넣었습니다.` : "", bad ? `사진 ${bad}장을 읽지 못했습니다. 다른 사진으로 해 보세요.` : ""].filter(Boolean);
    setErrors((e) => ({ ...e, photos: notes.join(" ") }));
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
    if (busy || photoBusy) return;
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
        let r: Response;
        try {
          r = await fetch(`/api/intake/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", body: JSON.stringify({ ...input, extra }) });
        } catch {
          // 통신이 끊김 — 다시 누르면 같은 접수로 이어진다 (두 번 접수되지 않는다)
          setFailed("인터넷 연결이 끊겼습니다. 적어 주신 내용은 그대로 있습니다. 연결을 확인한 뒤 ‘하자 접수하기’를 다시 눌러 주세요.");
          return;
        }
        const body = await r.json().catch(() => null);
        if (!r.ok || !body?.statusToken) {
          if (body?.fieldErrors && Object.keys(body.fieldErrors).length) setErrors(body.fieldErrors);
          setFailed(
            r.status === 429
              ? "지금은 접수가 몰려 보낼 수 없습니다. 적은 내용은 그대로 두고 10분쯤 뒤에 다시 눌러 주세요."
              : body?.code === "DUPLICATE"
                ? "이미 접수되었습니다. 접수 번호와 진행은 시공사에 문의해 주세요."
                : (body?.error ?? "접수하지 못했습니다. 잠시 뒤 다시 눌러 주세요."),
          );
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
      const list = [item, ...readMine(token).filter((x) => x.key !== item.key)];
      const saved = writeMine(token, list);
      if (saved) setMine(list);
      setDone({ no: out.no, key: out.statusToken, saved });
      setCopied(null);
      topRef.current?.scrollIntoView({ block: "start" });
    } catch (err) {
      if (err instanceof CommandError && err.fieldErrors && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setFailed(err instanceof CommandError && err.code === "DUPLICATE" ? "이미 접수되었습니다." : errorMessage(err, "접수하지 못했습니다. 잠시 뒤 다시 눌러 주세요."));
    } finally {
      setBusy(false);
    }
  };

  /** 다른 하자를 이어서 접수 — 위치·내용·사진만 비우고 연락처와 동의는 그대로 */
  const another = () => {
    idem.current = newIdem();
    setLocation("");
    setDescription("");
    setPhotos([]);
    setErrors({});
    setFailed(null);
    setDone(null);
    setTimeout(() => document.getElementById("in-location")?.focus(), 0);
  };
  const forget = (key: string) => {
    const list = mine.filter((x) => x.key !== key);
    writeMine(token, list);
    setMine(list);
  };

  const statusUrl = done && typeof window !== "undefined" ? `${window.location.origin}/r/s/${done.key}` : "";
  const message = done ? `[${view.company}] 하자 접수 번호 ${done.no}\n진행 확인: ${statusUrl}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(statusUrl);
      setCopied("ok");
    } catch {
      // 복사가 막힌 브라우저: 주소를 골라 두고 직접 복사하도록 알린다
      (document.getElementById("in-status-url") as HTMLInputElement | null)?.select();
      setCopied("manual");
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: `하자 접수 번호 ${done?.no}`, text: message });
    } catch {
      // 취소
    }
  };

  const mineCard = mine.length > 0 && (
    <section className="mb-4 rounded-2xl border border-line bg-surface p-4" data-testid="intake-mine">
      <h2 className="text-[0.95rem] font-extrabold">이 기기로 접수한 건 {mine.length}건</h2>
      <ul className="mt-1 divide-y divide-line">
        {mine.map((m) => (
          <li key={m.key} className="flex items-center gap-1" data-testid="intake-mine-row">
            <Link href={`/r/s/${m.key}`} className="press flex min-h-12 min-w-0 flex-1 items-center gap-2 py-2 text-[0.92rem]">
              <span className="min-w-0 flex-1">
                <b className="num">접수 번호 {m.no}</b>
                <span className="block text-[0.82rem] text-ink-2 [overflow-wrap:anywhere]">
                  {m.location} · {fmtDateTime(m.at).slice(5)}
                </span>
              </span>
              <span className="shrink-0 whitespace-nowrap font-bold text-theme-ink">진행 보기</span>
              <ChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden />
            </Link>
            <button type="button" onClick={() => forget(m.key)} className="press grid size-11 shrink-0 place-items-center rounded-full text-ink-3" aria-label={`접수 번호 ${m.no} 이 기기에서 지우기`} data-testid="intake-mine-forget">
              <X size={18} />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[0.78rem] leading-relaxed text-ink-3">이 기기(브라우저)에만 저장된 목록입니다. 여럿이 쓰는 기기라면 ×를 눌러 지워 주세요.</p>
    </section>
  );

  return (
    <PublicShell company={view.company} phone={view.phone} sub="하자 접수" sample={view.sample} testId="intake-page" state={done ? "done" : view.full ? "full" : "open"}>
      <div ref={topRef} />
      {done ? (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card" data-testid="intake-done">
          <h1 ref={doneRef} tabIndex={-1} className="flex items-center gap-2 text-[1.2rem] font-extrabold text-ok outline-none">
            <CheckCircle2 size={24} aria-hidden /> 접수되었습니다
          </h1>
          <p className="mt-3 text-[0.84rem] font-semibold text-ink-2">접수 번호</p>
          <p className="num text-[1.9rem] font-extrabold leading-tight text-ink" data-testid="intake-no">{done.no}</p>
          <p className="text-[0.88rem] text-ink-2 [overflow-wrap:anywhere]">{view.siteName}</p>
          <p className="mt-3 text-[0.95rem] leading-relaxed text-ink">담당자가 확인한 뒤 적어 주신 번호로 연락드립니다. 보수 진행은 아래 주소에서 볼 수 있습니다.</p>

          <label htmlFor="in-status-url" className="mt-4 block text-[0.84rem] font-bold text-ink-2">
            진행 확인 주소
          </label>
          <input id="in-status-url" readOnly value={statusUrl} onFocus={(e) => e.currentTarget.select()} className={cx(inputCls, "num mt-1.5 text-[0.82rem]")} data-testid="intake-status-url" />
          <p className="mt-1.5 text-[0.82rem] leading-relaxed text-ink-2" role="status" data-testid="intake-saved">
            {copied === "ok" ? "주소를 복사했습니다. 메모나 대화방에 붙여 넣어 보관하세요." : copied === "manual" ? "주소를 골라 두었습니다. 길게 눌러 ‘복사’를 눌러 주세요." : done.saved ? "이 기기에 저장해 두었습니다. 다음에 같은 QR·주소로 들어오면 맨 위에 보입니다." : "이 기기에는 저장하지 못했습니다. 아래 버튼으로 주소를 따로 보관해 주세요."}
          </p>
          <div className="mt-3 grid gap-2 min-[26rem]:grid-cols-2">
            <Link href={`/r/s/${done.key}`} className="press inline-flex h-12 items-center justify-center gap-2 rounded-full bg-cta px-5 text-[1rem] font-bold text-cta-text shadow-card min-[26rem]:col-span-2" data-testid="intake-status-open">
              진행 보기 <ChevronRight size={18} aria-hidden />
            </Link>
            <a href={`sms:?&body=${encodeURIComponent(message)}`} className="press inline-flex h-12 items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-[0.95rem] font-bold" data-testid="intake-status-sms">
              <MessageSquareText size={18} aria-hidden /> 문자로 보관
            </a>
            {canShare ? (
              <button type="button" onClick={share} className="press inline-flex h-12 items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-[0.95rem] font-bold" data-testid="intake-status-share">
                <Share2 size={18} aria-hidden /> 공유·보관
              </button>
            ) : (
              <Button size="lg" onClick={copy} data-testid="intake-status-copy">
                주소 복사
              </Button>
            )}
            {canShare && (
              <Button size="lg" onClick={copy} className="min-[26rem]:col-span-2" data-testid="intake-status-copy">
                주소 복사
              </Button>
            )}
          </div>
          <p className="mt-4 rounded-xl bg-surface-2 px-3.5 py-3 text-[0.86rem] leading-relaxed text-ink-2">
            접수 번호 <b className="num text-ink">{done.no}</b>를 적어 두세요. 주소를 잃어버려도 시공사에 접수 번호를 말씀하시면 진행을 알려 드립니다.
          </p>
          <CallHint company={view.company} phone={view.phone} className="mt-2" />
          <Button size="lg" block className="mt-5" onClick={another} data-testid="intake-another">
            다른 하자 접수하기
          </Button>
          <p className="mt-1.5 text-center text-[0.8rem] text-ink-3">이름·전화번호는 그대로 두고 위치와 내용만 새로 적습니다.</p>
        </section>
      ) : view.full ? (
        <>
          {mineCard}
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-card" data-testid="intake-full">
            <h1 className="text-[1.2rem] font-extrabold leading-snug">오늘은 접수가 많아 더 받을 수 없습니다</h1>
            <p className="mt-1 text-[0.92rem] font-semibold text-ink-2 [overflow-wrap:anywhere]" data-testid="intake-site">{view.siteName}</p>
            <p className="mt-2 text-[0.92rem] leading-relaxed text-ink-2">내일 다시 접수하시거나, 급한 하자는 전화로 알려 주세요.</p>
            <CallHint company={view.company} phone={view.phone} className="mt-3" />
          </section>
        </>
      ) : (
        <>
          {mineCard}
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h1 className="text-[1.25rem] font-extrabold leading-snug">하자 접수</h1>
            <p className="mt-1 text-[0.92rem] font-semibold text-ink-2 [overflow-wrap:anywhere]" data-testid="intake-site">{view.siteName}</p>
            <p className="mt-2 text-[0.88rem] leading-relaxed text-ink-2">창문·유리·실리콘(코킹) 등에 문제가 있으면 아래에 적어 보내 주세요. 담당자가 확인하고 연락드립니다.</p>

            <form
              className="mt-5 space-y-5"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              onKeyDown={(e) => {
                // 한 줄 칸에서 Enter로 접수가 나가지 않게 (PC에서 적다가 오류가 한꺼번에 뜨던 문제) — 접수는 버튼으로만
                if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "checkbox") e.preventDefault();
              }}
            >
              <Q id="in-location" label="어디에 문제가 있나요?" error={errors.location}>
                <input id="in-location" value={location} onChange={(e) => edit("location", setLocation)(e.target.value)} maxLength={60} enterKeyHint="next" placeholder="예: 3층 302호 거실 창" className={BIG} aria-invalid={!!errors.location} aria-required aria-describedby={errors.location ? "in-location-err" : undefined} data-testid="intake-location" />
              </Q>
              <Q id="in-description" label="어떤 문제인가요?" error={errors.description}>
                <textarea
                  id="in-description"
                  value={description}
                  onChange={(e) => edit("description", setDescription)(e.target.value)}
                  maxLength={800}
                  rows={4}
                  placeholder="예: 비가 오면 창틀 아래로 물이 샙니다."
                  className={cx(BIG, "h-auto resize-none leading-relaxed")}
                  aria-invalid={!!errors.description}
                  aria-required
                  aria-describedby={errors.description ? "in-description-err" : undefined}
                  data-testid="intake-description"
                />
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
                      <button type="button" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="press absolute right-0 top-0 grid size-11 place-items-center" aria-label={`사진 ${i + 1} 빼기`}>
                        <span className="grid size-8 place-items-center rounded-full bg-black/65 text-white">
                          <X size={16} />
                        </span>
                      </button>
                    </div>
                  ))}
                  {photos.length < INTAKE_MAX_PHOTOS && (
                    <label className="press grid size-24 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-line-strong text-center text-[0.8rem] font-semibold text-ink-2 focus-within:border-active" data-testid="intake-photo-add">
                      <span>
                        <Camera size={24} className="mx-auto" aria-hidden />
                        {photoBusy ? "준비 중…" : "사진 넣기"}
                      </span>
                      <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" disabled={photoBusy} onChange={(e) => void addPhotos(e.target.files)} data-testid="intake-photo-input" />
                    </label>
                  )}
                </div>
                {errors.photos && (
                  <p className="mt-1.5 text-[0.84rem] font-medium text-err" role="alert" data-testid="intake-photo-note">
                    {errors.photos}
                  </p>
                )}
              </div>

              <fieldset className="space-y-4 rounded-xl border border-line bg-surface-2 px-4 py-4">
                <legend className="px-1 text-[0.95rem] font-bold text-ink">연락받으실 분</legend>
                <Q id="in-name" label="이름" error={errors.name}>
                  <input id="in-name" value={name} onChange={(e) => edit("name", setName)(e.target.value)} maxLength={30} autoComplete="name" enterKeyHint="next" className={BIG} aria-invalid={!!errors.name} aria-required aria-describedby={errors.name ? "in-name-err" : undefined} data-testid="intake-name" />
                </Q>
                <Q id="in-phone" label="전화번호" error={errors.phone}>
                  <input id="in-phone" type="tel" value={phone} onChange={(e) => edit("phone", setPhone)(e.target.value)} maxLength={20} inputMode="tel" autoComplete="tel" enterKeyHint="next" placeholder="010-1234-5678" className={cx(BIG, "num")} aria-invalid={!!errors.phone} aria-required aria-describedby={errors.phone ? "in-phone-err" : undefined} data-testid="intake-phone" />
                </Q>
                <Q id="in-org" label="소속" optional error={errors.org}>
                  <input id="in-org" value={org} onChange={(e) => edit("org", setOrg)(e.target.value)} maxLength={40} placeholder="예: 관리사무소" autoComplete="organization" enterKeyHint="done" className={BIG} data-testid="intake-org" />
                </Q>
              </fieldset>

              {/* 사람에게는 보이지 않는 칸 — 기계가 채우면 접수하지 않는다. 자동 완성이 채우지 않게 이름·안내를 일부러 뜻 없이 둔다 */}
              <div className="hidden" aria-hidden>
                <label>
                  이 칸은 비워 두세요
                  <input tabIndex={-1} autoComplete="off" value={extra} onChange={(e) => setExtra(e.target.value)} name="extra" />
                </label>
              </div>

              <div>
                <label className={cx("flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5", errors.consent ? "border-err" : "border-line")}>
                  <input
                    id="in-consent"
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => {
                      setConsent(e.target.checked);
                      if (errors.consent) setErrors((x) => ({ ...x, consent: "" }));
                    }}
                    className="mt-0.5 size-6 shrink-0 accent-[var(--t-active)]"
                    aria-invalid={!!errors.consent}
                    aria-required
                    aria-describedby={errors.consent ? "in-consent-err" : "in-consent-note"}
                    data-testid="intake-consent"
                  />
                  <span className="text-[0.92rem] leading-relaxed text-ink">
                    하자 접수 처리와 연락을 위해 <b className="whitespace-nowrap">이름·전화번호</b>(적은 경우 소속)와 접수 내용·사진을 <span className="whitespace-nowrap">{view.company}</span>에 제공하는 데 동의합니다.
                  </span>
                </label>
                {errors.consent && (
                  <p id="in-consent-err" className="mt-1.5 text-[0.84rem] font-medium text-err" role="alert">
                    {errors.consent}
                  </p>
                )}
                <p id="in-consent-note" className="mt-2 text-[0.84rem] leading-relaxed text-ink-2">
                  하자 처리와 연락에만 쓰고, 처리가 끝나면 {INTAKE_CONTACT_KEEP_DAYS}일 뒤 이름·전화번호를 지웁니다.
                </p>
                <details className="mt-1 text-[0.82rem] text-ink-2" data-testid="intake-privacy">
                  <summary className="flex min-h-11 cursor-pointer items-center font-semibold">개인정보 안내 자세히 보기</summary>
                  <ul className="list-disc space-y-0.5 pl-5 leading-relaxed">
                    <li>받는 것: 이름, 전화번호, 소속(적은 경우), 접수 내용과 사진</li>
                    <li>쓰는 곳: 하자 접수 확인, 방문 일정 연락, 처리 결과 안내</li>
                    <li>보는 사람: {view.company} 본사 담당자와, 방문 약속을 위해 배정된 보수 담당자</li>
                    <li>보관: 처리가 끝난 뒤 {INTAKE_CONTACT_KEEP_DAYS}일이 지나면 이름·전화번호를 지웁니다 (접수 내용은 하자 이력으로 남습니다)</li>
                    <li>동의하지 않으면 이 화면으로는 접수할 수 없습니다. 전화로 접수해 주세요.</li>
                    <li>열람·정정·삭제 요청과 문의: {view.company}{view.phone ? ` ${view.phone}` : " (전화)"}</li>
                  </ul>
                </details>
              </div>

              {failed && (
                <div role="alert" className="rounded-xl bg-err-bg px-4 py-3" data-testid="intake-error">
                  <p className="text-[0.92rem] font-semibold text-err">{failed}</p>
                  {view.phone && (
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-[0.86rem] text-ink-2">
                      급하면 <CallButton phone={view.phone} />
                    </p>
                  )}
                </div>
              )}
              <Button type="submit" variant="cta" size="lg" block loading={busy} disabled={photoBusy} data-testid="intake-submit">
                {busy ? "보내는 중…" : "하자 접수하기"}
              </Button>
            </form>
          </section>
        </>
      )}
    </PublicShell>
  );
}

const BIG = cx(inputCls, "min-h-12 text-[1.02rem] aria-invalid:border-err");

function Q({ id, label, optional, error, children }: { id: string; label: string; optional?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[1rem] font-bold text-ink">
        {label}
        {optional && <span className="ml-1.5 text-[0.84rem] font-normal text-ink-3">(선택)</span>}
      </label>
      {children}
      {error && (
        <p id={`${id}-err`} className="text-[0.84rem] font-medium text-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
