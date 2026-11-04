"use client";

/** 오늘 작업 인원 알리기 (출력) — 팀 → 인원 → 단체 사진 → 보내기. 한 화면에 질문 하나 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Camera, CircleCheck, HardHat, MapPin, Plus, Users, X } from "lucide-react";
import { run } from "@/lib/data/store";
import { useMe } from "@/lib/data/hooks";
import { IS_LIVE } from "@/lib/mode";
import { CommandError } from "@/lib/data/commands";
import type { GeoStamp, Site } from "@/lib/domain/types";
import { geoText, judgeGeo, type GeoSample } from "@/lib/domain/geo";
import { recentTeams } from "@/lib/domain/crew";
import { todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { locateOnce } from "@/lib/geo/client";
import { cx } from "@/components/ui/primitives";
import { Choice, EasyBar, EasyQuestion, SectionBar, Stepper, VoiceHint, easyTextareaCls } from "./ui";
import { downscalePhoto } from "./photo";
import { easyDate } from "./words";
import { hasConsent } from "@/lib/domain/privacy";

type Step = "site" | "team" | "count" | "photo" | "confirm";

export function EasyCrew() {
  const { db, role, userId } = useMe();
  const sites = useMemo<Site[]>(() => (!db ? [] : role === "field" && !IS_LIVE ? db.sites.filter((s) => s.fieldUserId === userId) : db.sites), [db, role, userId]);
  const [siteId, setSiteId] = useState(sites.length === 1 ? sites[0].id : "");
  const [stack, setStack] = useState<Step[]>([sites.length === 1 ? "team" : "site"]);
  const [team, setTeam] = useState("");
  const [kind, setKind] = useState<"direct" | "subcontract">("subcontract");
  const [newTeam, setNewTeam] = useState(false);
  const [count, setCount] = useState(1);
  const [photo, setPhoto] = useState<string | null>(null);
  const [geo, setGeo] = useState<{ sample?: GeoSample; noLocation?: GeoStamp["reason"] } | null>(null);
  const [key, setKey] = useState(() => uid("idem"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ team: string; count: number; updated: boolean } | null>(null);
  const step = stack[stack.length - 1];
  const consented = !!db && hasConsent(db, userId);

  useEffect(() => {
    if (!siteId && sites.length === 1) {
      setSiteId(sites[0].id);
      setStack((s) => (s[0] === "site" && s.length === 1 ? ["team"] : s));
    }
  }, [sites, siteId]);

  // 확인 화면에서 위치 1번 (동의한 사람만)
  useEffect(() => {
    if (step !== "confirm" || geo || !consented) return;
    let alive = true;
    void locateOnce(10_000).then((r) => alive && setGeo("sample" in r ? { sample: r.sample } : { noLocation: r.error }));
    return () => {
      alive = false;
    };
  }, [step, geo, consented]);

  if (!db) return null;
  const site = db.sites.find((s) => s.id === siteId);
  const teams = site ? recentTeams(db, site.id) : [];
  const todayDone = (db.crewChecks ?? []).filter((c) => c.siteId === siteId && c.workDate === todayIso());
  const go = (s: Step) => {
    setErr(null);
    setStack((x) => [...x, s]);
  };
  const back = () => (stack.length > 1 ? setStack((x) => x.slice(0, -1)) : undefined);
  const sections = ["팀", "인원", "사진", "확인"];
  const secIdx = step === "site" || step === "team" ? 0 : step === "count" ? 1 : step === "photo" ? 2 : 3;

  const send = async () => {
    if (!site || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await run("reportCrew", { siteId: site.id, team, kind, headcount: count, ...(photo ? { photoDataUrl: photo } : {}), geo: geo ?? { noLocation: consented ? "timeout" : "skipped" }, idempotencyKey: key });
      setDone({ team, count, updated: r.updated });
    } catch (e) {
      setErr(e instanceof CommandError || e instanceof Error ? e.message : "보내지 못했어요. 다시 눌러 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    setTeam("");
    setNewTeam(false);
    setCount(1);
    setPhoto(null);
    setGeo(null);
    setKey(uid("idem"));
    setDone(null);
    setStack(["team"]);
  };

  if (done)
    return (
      <div className="anim-pop space-y-5 pt-4 text-center" data-testid="crew-done">
        <CircleCheck size={64} className="mx-auto text-ok" aria-hidden />
        <p className="text-[1.6rem] font-extrabold">
          {done.team} {done.count}명 {done.updated ? "수정했어요" : "보냈어요"}
        </p>
        <p className="text-[1.05rem] text-ink-2">본사 출퇴근 현황에 바로 보입니다.</p>
        <button type="button" onClick={again} className="press h-[4rem] w-full rounded-2xl bg-cta text-[1.2rem] font-extrabold text-cta-text" data-testid="crew-again">
          다른 팀도 알리기
        </button>
        <Link href="/field" className="press flex h-[3.8rem] w-full items-center justify-center rounded-2xl border-2 border-line-strong bg-surface text-[1.12rem] font-bold">
          처음 화면으로
        </Link>
      </div>
    );

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;
  switch (step) {
    case "site":
      body = (
        <EasyQuestion title="어느 현장인가요?">
          <div className="space-y-2.5">
            {sites.map((s) => (
              <Choice key={s.id} icon={<HardHat size={24} />} label={s.shortName} sub={s.workType} selected={siteId === s.id} onClick={() => (setSiteId(s.id), go("team"))} testId={`crew-site-${s.id}`} />
            ))}
          </div>
        </EasyQuestion>
      );
      break;
    case "team":
      body = (
        <EasyQuestion title="어느 팀 인원인가요?" help="팀(협력업체)마다 따로 보내 주세요." testId="crew-team">
          {todayDone.length > 0 && (
            <p className="rounded-2xl bg-ok-bg px-4 py-3 text-[1.02rem] font-semibold text-ok">
              오늘 보낸 팀: {todayDone.map((c) => `${c.team} ${c.headcount}명`).join(", ")} (다시 보내면 인원이 수정됩니다)
            </p>
          )}
          <div className="space-y-2.5">
            {teams.map((t) => (
              <Choice
                key={t.team}
                icon={<Users size={24} />}
                label={t.team}
                sub={`${t.kind === "direct" ? "우리 회사 직영" : "협력업체(외주)"} · 지난번 ${t.last}명`}
                onClick={() => {
                  setTeam(t.team);
                  setKind(t.kind);
                  setCount(t.last);
                  setNewTeam(false);
                  go("count");
                }}
                testId="crew-team-chip"
              />
            ))}
            {!newTeam ? (
              <button type="button" onClick={() => setNewTeam(true)} className="press flex h-[3.8rem] w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-active bg-active-soft text-[1.15rem] font-extrabold text-theme-ink" data-testid="crew-new-team">
                <Plus size={22} aria-hidden /> 새 팀 넣기
              </button>
            ) : (
              <div className="space-y-3 rounded-2xl border-2 border-line bg-surface p-4">
                <label htmlFor="crew-team-name" className="block text-[1.1rem] font-bold">
                  팀 이름 (예: 유리 설치팀, ○○산업)
                </label>
                <input id="crew-team-name" maxLength={30} value={team} onChange={(e) => setTeam(e.target.value)} className={easyTextareaCls} data-testid="crew-team-name" />
                <VoiceHint />
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["subcontract", "협력업체(외주)"],
                      ["direct", "우리 회사 직영"],
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setKind(v)} aria-pressed={kind === v} className={cx("press min-h-[3.4rem] rounded-2xl border-2 text-[1.05rem] font-bold", kind === v ? "border-active bg-active-soft" : "border-line-strong bg-surface")} data-testid={`crew-kind-${v}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </EasyQuestion>
      );
      footer = newTeam ? <EasyBar onBack={stack.length > 1 ? back : undefined} onNext={() => go("count")} nextDisabled={!team.trim()} hint={team.trim() ? undefined : "팀 이름을 넣어 주세요"} /> : stack.length > 1 ? <EasyBar onBack={back} /> : null;
      break;
    case "count":
      body = (
        <EasyQuestion kicker={team} title="오늘 몇 명이 일했나요?" help="현장에 실제로 나온 인원만 넣으세요." testId="crew-count">
          <Stepper label="인원" value={count} min={1} max={300} step={1} unit="명" onChange={setCount} testId="crew-count-stepper" />
          <div className="grid grid-cols-3 gap-2">
            {[1, 5, 10].map((n) => (
              <button key={n} type="button" onClick={() => setCount((c) => Math.min(300, c + n))} className="press h-[3.4rem] rounded-2xl bg-surface-3 text-[1.15rem] font-extrabold">
                +{n}명
              </button>
            ))}
          </div>
        </EasyQuestion>
      );
      footer = <EasyBar onBack={back} onNext={() => go("photo")} />;
      break;
    case "photo":
      body = (
        <EasyQuestion kicker={`${team} ${count}명`} title="모두 나오게 단체 사진 한 장" help="본사가 인원을 확인하는 데 씁니다. 얼굴이 아니라 인원과 현장이 보이면 됩니다." testId="crew-photo">
          {photo ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="단체 사진" className="max-h-72 w-full rounded-2xl object-cover" />
              <button type="button" onClick={() => setPhoto(null)} className="press flex h-12 w-full items-center justify-center gap-1 rounded-xl border-2 border-line-strong text-[1.02rem] font-bold">
                <X size={18} aria-hidden /> 다시 찍기
              </button>
            </div>
          ) : (
            <label className="press flex min-h-[7rem] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl bg-cta text-[1.2rem] font-extrabold text-cta-text">
              <Camera size={36} aria-hidden /> 단체 사진 찍기
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                data-testid="crew-photo-file"
                onChange={async (e) => {
                  const f = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (!f) return;
                  try {
                    setPhoto(await downscalePhoto(f));
                  } catch {
                    setErr("사진을 읽지 못했어요. 다시 찍어 주세요.");
                  }
                }}
              />
            </label>
          )}
          {err && <p className="text-[1.05rem] font-semibold text-err">{err}</p>}
        </EasyQuestion>
      );
      footer = <EasyBar onBack={back} onNext={() => go("confirm")} nextLabel={photo ? "다음" : "사진 없이 다음 (본사에 표시)"} />;
      break;
    case "confirm":
      body = (
        <EasyQuestion title="이렇게 보낼까요?" testId="crew-confirm">
          <div className="space-y-2 rounded-2xl border-2 border-line bg-surface p-4 text-[1.15rem]">
            <p>
              <b>{site?.shortName}</b> · {easyDate(todayIso())}
            </p>
            <p data-testid="crew-confirm-text">
              {team} ({kind === "direct" ? "직영" : "외주"}) <b className="num">{count}명</b>
            </p>
            <p className={photo ? "text-ok" : "text-warn"}>{photo ? "단체 사진 있음" : "단체 사진 없음 — 본사에 표시됩니다"}</p>
            {consented && (
              <p className="flex items-center gap-1.5 text-[1.02rem] text-ink-2">
                <MapPin size={18} aria-hidden /> 보내는 곳: {geo ? geoText(judgeGeo(site, geo.sample ?? null, geo.noLocation)) : "위치 확인 중…"}
              </p>
            )}
          </div>
          {err && <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.05rem] font-semibold text-err">{err}</p>}
        </EasyQuestion>
      );
      footer = <EasyBar onBack={back} onNext={send} nextLabel="본사로 보내기" loading={busy} nextTestId="crew-send" />;
      break;
  }

  return (
    <div className="space-y-6" data-testid="easy-crew">
      <SectionBar sections={sections} current={secIdx} />
      {site && step !== "site" && (
        <p className="flex items-center gap-1.5 text-[1rem] font-semibold text-ink-2">
          <HardHat size={18} aria-hidden /> {site.shortName} · 작업 인원 알리기
        </p>
      )}
      <div key={step} className="anim-fade-up">
        {body}
      </div>
      {footer}
    </div>
  );
}
