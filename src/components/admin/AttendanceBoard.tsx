"use client";

/** 본사 — 출퇴근 현황 (GPS) · 의심 표시 · 보고 위치 · 월 합계(CSV) */
import { downloadCsv } from "@/lib/browser/download";
import { useState } from "react";
import { AlertTriangle, Download, LocateFixed, MapPin, MapPinCheck, Pencil, QrCode, TabletSmartphone } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { run } from "@/lib/data/store";
import { CommandError } from "@/lib/data/commands";
import type { AttendanceRecord, DemoDB, GeoStamp, Kiosk, QrStamp, Site } from "@/lib/domain/types";
import { QR_LABEL } from "@/lib/domain/qr";
import { CREW_FLAG_LABEL, crewFlags, crewSummary, mandayGap, mandayOver } from "@/lib/domain/crew";
import { qrPath } from "@/lib/geo/qrClient";
import { GEO_LABEL, geoText, mapLink } from "@/lib/domain/geo";
import { FLAG_LABEL, FLAG_ORDER, backdatedDays, dayFlags, hhmm, minutesOf, periodSummary, recentFlags, shiftDate, siteCrew, type AttendanceFlag } from "@/lib/domain/attendance";
import { todayIso } from "@/lib/domain/format";
import { locateOnce } from "@/lib/geo/client";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, Field, Notice, PageSkeleton, Segmented, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

const TONE: Record<GeoStamp["status"], string> = {
  inside: "bg-ok-bg text-ok",
  outside: "bg-err-bg text-err",
  weak: "bg-warn-bg text-warn",
  none: "bg-warn-bg text-warn",
  nosite: "bg-surface-3 text-ink-2",
};

function GeoChip({ g, label }: { g?: GeoStamp; label?: string }) {
  if (!g) return <span className="text-[0.78rem] text-ink-3">{label ?? "—"}</span>;
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.74rem] font-bold", TONE[g.status])} title={geoText(g)}>
      {GEO_LABEL[g.status]}
      {g.distanceM !== undefined && <span className="num font-semibold">{g.distanceM >= 1000 ? `${(g.distanceM / 1000).toFixed(1)}km` : `${g.distanceM}m`}</span>}
    </span>
  );
}

function MapA({ g }: { g?: GeoStamp }) {
  if (g?.lat === undefined || g.lng === undefined) return null;
  return (
    <a href={mapLink(g.lat, g.lng, "누른 위치")} target="_blank" rel="noreferrer noopener" className="text-[0.74rem] font-semibold text-theme-ink underline underline-offset-2">
      지도
    </a>
  );
}

export function AttendanceBoard() {
  const { db } = useMe();
  const today = todayIso();
  const [mode, setMode] = useState<"today" | "yesterday" | "pick">("today");
  const [picked, setPicked] = useState(today);
  const [geoSite, setGeoSite] = useState<Site | null>(null);
  const [fix, setFix] = useState<AttendanceRecord | null>(null);
  const [pairing, setPairing] = useState<{ site: Site; code: string; expiresAt: string } | null>(null);
  const toast = useToast();
  if (!db) return <PageSkeleton />;
  const qrMode = db.settings?.attendanceMode === "qr";
  const setAttMode = async (m: "gps" | "qr") => {
    try {
      await run("setCompanySettings", { attendanceMode: m });
      toast.push({ tone: "ok", title: m === "qr" ? "출근 방식: 현장 QR + GPS" : "출근 방식: GPS만" });
    } catch (e) {
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "변경 실패" });
    }
  };
  const addKiosk = async (s: Site) => {
    try {
      const r = await run("createKiosk", { siteId: s.id });
      setPairing({ site: s, code: r.pairCode, expiresAt: r.pairExpiresAt });
    } catch (e) {
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "등록 실패" });
    }
  };
  const revoke = async (k: Kiosk) => {
    if (!window.confirm(`‘${k.name}’ 단말기를 해제할까요? 이 태블릿의 QR은 더 이상 인정되지 않습니다.`)) return;
    try {
      await run("revokeKiosk", { kioskId: k.id });
      toast.push({ tone: "ok", title: "단말기를 해제했습니다" });
    } catch (e) {
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "해제 실패" });
    }
  };
  const date = mode === "today" ? today : mode === "yesterday" ? shiftDate(today, -1) : picked;
  const flags = [...dayFlags(db, date), ...(date === today ? recentFlags(db, today) : [])];
  const records = (db.attendance ?? []).filter((r) => r.workDate === date);
  const sites = db.sites.filter((s) => s.status === "active" || records.some((r) => r.siteId === s.id));
  const name = (id: string) => db.users.find((u) => u.id === id)?.name ?? "알 수 없음";
  const reports = db.reports.filter((r) => r.reportDate === date || r.createdAt.slice(0, 10) === date).filter((r) => r.status !== "voided");
  const monthFrom = `${date.slice(0, 8)}01`;
  const month = periodSummary(db, monthFrom, date);
  const elsewhere = (u: string) => records.find((r) => r.userId === u);
  const userFlags = (u: string, siteId?: string) => flags.filter((f) => f.userId === u && (!f.siteId || !siteId || f.siteId === siteId));

  const csv = () => {
    const head = ["이름", "기간", "출근일수", "총 근무(시간)", "퇴근 누락", "현장 밖", "위치 없음", "본사 정정"];
    const lines = month.map((m) => [name(m.userId), `${monthFrom}~${date}`, m.days, (m.minutes / 60).toFixed(1), m.noCheckout, m.outside, m.noLocation, m.corrected].join(","));
    const detail = (db.attendance ?? [])
      .filter((r) => r.workDate >= monthFrom && r.workDate <= date)
      .sort((a, b) => a.workDate.localeCompare(b.workDate))
      .map((r) => [r.workDate, name(r.userId), db.sites.find((s) => s.id === r.siteId)?.shortName ?? "", hhmm(r.inAt), GEO_LABEL[r.inGeo.status], r.outAt ? hhmm(r.outAt) : "", r.outGeo ? GEO_LABEL[r.outGeo.status] : "", minutesOf(r) ?? "", (r.corrections ?? []).map((c) => c.note).join(" / ")].join(","));
    const body = ["# 월 합계", head.join(","), ...lines, "", "# 일별 기록", "날짜,이름,현장,출근,출근 위치,퇴근,퇴근 위치,근무(분),정정 사유", ...detail].join("\n");
    downloadCsv(`출퇴근_${monthFrom}_${date}.csv`, body);
  };

  const grouped = FLAG_ORDER.map((k) => ({ k, items: flags.filter((f) => f.kind === k) })).filter((g) => g.items.length);

  return (
    <PageBody>
      <PageHeader
        eyebrow={<DemoBadge compact />}
        title="출퇴근 현황"
        desc="현장 직원이 출근·퇴근 버튼을 누른 시각(서버 시각)과 그때의 위치입니다. 의심 표시는 ‘확인할 대상’이지 부정 확정이 아닙니다."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="출근 방식"
              value={qrMode ? "qr" : "gps"}
              onChange={(v) => void setAttMode(v as "gps" | "qr")}
              options={[
                { value: "gps", label: "GPS만", testId: "att-mode-gps" },
                { value: "qr", label: "현장 QR + GPS", testId: "att-mode-qr" },
              ]}
            />
            <Segmented
              label="날짜"
              value={mode}
              onChange={setMode}
              options={[
                { value: "today", label: "오늘", testId: "att-today" },
                { value: "yesterday", label: "어제", testId: "att-yesterday" },
                { value: "pick", label: "날짜 선택" },
              ]}
            />
            {mode === "pick" && <input type="date" aria-label="날짜" className={cx(inputCls, "w-auto")} value={picked} max={today} onChange={(e) => e.target.value && setPicked(e.target.value)} />}
          </div>
        }
      />

      <Card data-testid="att-flags">
        <CardHeader title={grouped.length ? `확인이 필요한 항목 ${flags.length}건` : "확인이 필요한 항목 없음"} sub={date === today ? "오늘 기준 + 최근 14일 (퇴근 누락·위치가 매일 똑같음)" : `${date} 기준`} />
        {grouped.length === 0 ? (
          <p className="px-5 pb-5 text-[0.88rem] text-ink-2">이 날짜에는 의심 표시가 없습니다.</p>
        ) : (
          <div className="space-y-3 px-5 pb-5">
            {grouped.map((g) => (
              <div key={g.k} data-testid={`att-flag-${g.k}`}>
                <p className="mb-1 flex items-center gap-1.5 text-[0.86rem] font-bold">
                  <AlertTriangle size={15} className={["shared_device", "same_spot", "outside"].includes(g.k) ? "text-err" : "text-warn"} aria-hidden /> {FLAG_LABEL[g.k]} <span className="num text-ink-3">{dedupe(g.items).length}</span>
                </p>
                <ul className="space-y-0.5 pl-5 text-[0.82rem] text-ink-2">
                  {dedupe(g.items).slice(0, 6).map((f, i) => (
                    <li key={i}>{f.text}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 @min-[1100px]:grid-cols-2">
        {sites.map((s) => {
          const crew = siteCrew(db, s, date);
          return (
            <Card key={s.id} data-testid="att-site" data-site={s.id}>
              <CardHeader
                title={s.shortName}
                sub={
                  s.geo ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <MapPinCheck size={14} className="text-ok" aria-hidden /> 현장 위치 등록 · 반경 {s.geo.radiusM}m ·{" "}
                      <a href={mapLink(s.geo.lat, s.geo.lng, s.shortName)} target="_blank" rel="noreferrer noopener" className="font-semibold text-theme-ink underline underline-offset-2">
                        지도
                      </a>
                    </span>
                  ) : (
                    <span className="font-semibold text-warn">현장 위치 미등록 — 현장 안/밖을 판단할 수 없습니다</span>
                  )
                }
                right={
                  <Button size="sm" variant={s.geo ? "ghost" : "soft"} icon={<MapPin size={15} />} onClick={() => setGeoSite(s)} data-testid={`att-geo-${s.id}`}>
                    {s.geo ? "위치 수정" : "위치 등록"}
                  </Button>
                }
              />
              {crew.length === 0 ? (
                <p className="px-5 pb-5 text-[0.84rem] text-ink-3">배정된 현장 직원이 없습니다.</p>
              ) : (
                <div className="relative overflow-x-auto border-t border-line">
                  <table className="w-full min-w-[34rem] text-[0.84rem]">
                    <thead>
                      <tr className="text-left text-[0.74rem] text-ink-3">
                        <th className="px-5 py-2 font-semibold">이름</th>
                        <th className="py-2 font-semibold">출근</th>
                        <th className="py-2 font-semibold">퇴근</th>
                        <th className="py-2 font-semibold">근무</th>
                        <th className="py-2 pr-5 font-semibold">
                          <span className="sr-only">정정</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {crew.map((u) => {
                        const r = records.find((x) => x.userId === u && x.siteId === s.id);
                        const fl = userFlags(u, s.id).filter((f) => f.kind === "shared_device" || f.kind === "same_spot");
                        const min = r ? minutesOf(r) : null;
                        return (
                          <tr key={u} className="border-t border-line align-top" data-testid="att-row" data-user={u}>
                            <td className="px-5 py-2.5">
                              <span className="font-bold">{name(u)}</span>
                              {fl.map((f, i) => (
                                <Badge key={i} tone="err" className="ml-1.5">
                                  {FLAG_LABEL[f.kind]}
                                </Badge>
                              ))}
                              {r?.corrections?.length ? <span className="mt-0.5 block text-[0.72rem] text-ink-3">본사 정정: {r.corrections.at(-1)!.note}</span> : null}
                            </td>
                            {r ? (
                              <>
                                <td className="py-2.5">
                                  <span className="num font-semibold">{hhmm(r.inAt)}</span> <GeoChip g={r.inGeo} /> <MapA g={r.inGeo} /> <QrChip q={r.inQr} required={qrMode} />
                                </td>
                                <td className="py-2.5">
                                  {r.outAt ? (
                                    <>
                                      <span className="num font-semibold">{hhmm(r.outAt)}</span> <GeoChip g={r.outGeo} label="본사 정정" /> <MapA g={r.outGeo} />
                                    </>
                                  ) : (
                                    <span className={cx("text-[0.8rem] font-semibold", date < today ? "text-warn" : "text-ink-3")}>{date < today ? "퇴근 기록 없음" : "근무 중"}</span>
                                  )}
                                </td>
                                <td className="num py-2.5">{min === null ? "—" : `${Math.floor(min / 60)}시간 ${min % 60}분`}</td>
                                <td className="py-2.5 pr-5 text-right">
                                  <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setFix(r)} data-testid="att-fix">
                                    정정
                                  </Button>
                                </td>
                              </>
                            ) : (
                              <td colSpan={4} className={cx("py-2.5 pr-5 text-[0.8rem] font-semibold", elsewhere(u) ? "text-ink-3" : "text-warn")}>
                                {elsewhere(u) ? `${db.sites.find((x) => x.id === elsewhere(u)!.siteId)?.shortName}에 출근` : date === today ? "아직 출근 기록 없음" : "출근 기록 없음"}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <KioskList kiosks={(db.kiosks ?? []).filter((k) => k.siteId === s.id && !k.revokedAt)} onAdd={() => addKiosk(s)} onRevoke={revoke} qrMode={qrMode} />
            </Card>
          );
        })}
      </div>

      <CrewCard db={db} date={date} name={name} />

      <Card data-testid="att-reports">
        <CardHeader title="현장 보고를 보낸 곳" sub="보고를 보낼 때 휴대폰 위치 (위치 기록에 동의한 사람만) · 지난 날짜로 쓴 보고 표시" />
        {reports.length === 0 ? (
          <EmptyState title="이 날짜의 보고가 없습니다" />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {reports.map((r) => {
              const late = backdatedDays(r);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[0.84rem]" data-testid="att-report-row">
                  <span className="font-bold">{db.sites.find((s) => s.id === r.siteId)?.shortName}</span>
                  <span className="text-ink-2">
                    {name(r.createdBy)} · {hhmm(r.createdAt)} 작성
                  </span>
                  <GeoChip g={r.geo} label="위치 기록 없음" />
                  <MapA g={r.geo} />
                  {late > 0 && <Badge tone="warn">{late}일 지난 날짜로 작성 ({r.reportDate})</Badge>}
                  <span className="min-w-0 flex-1 truncate text-ink-3">{r.workDone}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card data-testid="att-month">
        <CardHeader
          title={`${date.slice(0, 7).replace("-", "년 ")}월 합계`}
          sub="급여·공수 정산 근거 — 퇴근 누락·현장 밖·위치 없음은 사람에게 확인 후 정산하세요"
          right={
            <Button size="sm" icon={<Download size={15} />} onClick={csv} disabled={month.length === 0} data-testid="att-csv">
              CSV 내려받기
            </Button>
          }
        />
        {month.length === 0 ? (
          <EmptyState title="이 달의 출퇴근 기록이 없습니다" />
        ) : (
          <div className="relative overflow-x-auto border-t border-line">
            <table className="w-full min-w-[36rem] text-[0.84rem]">
              <thead>
                <tr className="text-left text-[0.74rem] text-ink-3">
                  {["이름", "출근일수", "총 근무", "퇴근 누락", "현장 밖", "위치 없음", "QR 확인", "본사 정정"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold first:pl-5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {month.map((m) => (
                  <tr key={m.userId} className="border-t border-line" data-testid="att-month-row">
                    <td className="py-2 pl-5 pr-3 font-bold">{name(m.userId)}</td>
                    <td className="num px-3 py-2">{m.days}일</td>
                    <td className="num px-3 py-2">{(m.minutes / 60).toFixed(1)}시간</td>
                    <td className={cx("num px-3 py-2", m.noCheckout > 0 && "font-bold text-warn")}>{m.noCheckout}</td>
                    <td className={cx("num px-3 py-2", m.outside > 0 && "font-bold text-err")}>{m.outside}</td>
                    <td className={cx("num px-3 py-2", m.noLocation > 0 && "font-bold text-warn")}>{m.noLocation}</td>
                    <td className="num px-3 py-2">{m.qrOk}</td>
                    <td className="num px-3 py-2">{m.corrected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Notice tone="info" title="GPS 확인의 한계">
        웹 브라우저 위치는 위치 조작 앱으로 속일 수 있고, 건물 안·고층에서는 오차가 큽니다. 그래서 ‘같은 휴대폰으로 여러 명’, ‘위치가 매일 똑같음’, ‘현장 밖’, ‘위치 없음’을 함께 표시합니다. 표시가 반복되는 사람은 현장 반장·사진·작업일보로 교차 확인하세요.
      </Notice>

      {geoSite && <GeoModal site={geoSite} onClose={() => setGeoSite(null)} />}
      {fix && <FixModal db={db} record={fix} onClose={() => setFix(null)} />}
      {pairing && <PairModal {...pairing} onClose={() => setPairing(null)} />}
    </PageBody>
  );
}

function dedupe(items: AttendanceFlag[]) {
  const seen = new Set<string>();
  return items.filter((f) => (seen.has(f.text) ? false : (seen.add(f.text), true)));
}

/** 현장 위치 등록 — 현장에서 ‘지금 내 위치로’ 또는 좌표 입력 */
function GeoModal({ site, onClose }: { site: Site; onClose: () => void }) {
  const toast = useToast();
  const [lat, setLat] = useState(site.geo ? String(site.geo.lat) : "");
  const [lng, setLng] = useState(site.geo ? String(site.geo.lng) : "");
  const [radius, setRadius] = useState(String(site.geo?.radiusM ?? 300));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [locating, setLocating] = useState(false);
  const here = async () => {
    setLocating(true);
    const r = await locateOnce();
    setLocating(false);
    if ("sample" in r) {
      setLat(r.sample.lat.toFixed(6));
      setLng(r.sample.lng.toFixed(6));
      toast.push({ tone: "ok", title: `현재 위치를 넣었습니다 (오차 약 ${Math.round(r.sample.accuracy)}m)` });
    } else toast.push({ tone: "err", title: r.error === "denied" ? "이 브라우저의 위치 권한이 꺼져 있습니다" : "위치를 잡지 못했습니다" });
  };
  const save = async () => {
    try {
      await run("setSiteGeo", { siteId: site.id, lat: Number(lat), lng: Number(lng), radiusM: Number(radius) });
      toast.push({ tone: "ok", title: `${site.shortName} 현장 위치를 저장했습니다` });
      onClose();
    } catch (e) {
      if (e instanceof CommandError) setErrors(e.fieldErrors);
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "저장 실패" });
    }
  };
  const nLat = Number(lat);
  const nLng = Number(lng);
  return (
    <Modal
      open
      onClose={onClose}
      title={`현장 위치 · ${site.shortName}`}
      description="현장 정문(또는 사무실)에 서서 ‘지금 내 위치로’를 누르는 것이 가장 정확합니다. 반경 안에서 누른 출근만 ‘현장 안’이 됩니다."
      size="sm"
      testId="geo-modal"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={save} data-testid="geo-save">
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Button block icon={<LocateFixed size={17} />} onClick={here} loading={locating}>
          지금 내 위치로
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Field label="위도" htmlFor="g-lat" error={errors.lat}>
            <input id="g-lat" inputMode="decimal" className={cx(inputCls, "num")} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="37.5665" />
          </Field>
          <Field label="경도" htmlFor="g-lng" error={errors.lng}>
            <input id="g-lng" inputMode="decimal" className={cx(inputCls, "num")} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="126.9780" />
          </Field>
        </div>
        <Field label="현장으로 인정할 반경 (m)" htmlFor="g-rad" error={errors.radiusM} hint="보통 200~500m. 대형 현장·지하 주차장이 넓으면 크게">
          <input id="g-rad" inputMode="numeric" className={cx(inputCls, "num")} value={radius} onChange={(e) => setRadius(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
        {Number.isFinite(nLat) && Number.isFinite(nLng) && nLat !== 0 && nLng !== 0 && (
          <a href={mapLink(nLat, nLng, site.shortName)} target="_blank" rel="noreferrer noopener" className="inline-block text-[0.84rem] font-semibold text-theme-ink underline underline-offset-2">
            지도에서 확인하기 (카카오맵)
          </a>
        )}
      </div>
    </Modal>
  );
}

/** 본사 정정 — 퇴근 누락 등. 위치 기록은 그대로 두고 시각만, 사유 필수 */
function FixModal({ db, record, onClose }: { db: DemoDB; record: AttendanceRecord; onClose: () => void }) {
  const toast = useToast();
  const [outTime, setOutTime] = useState(record.outAt ? hhmm(record.outAt) : "17:00");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const who = db.users.find((u) => u.id === record.userId)?.name;
  const save = async () => {
    try {
      const outAt = new Date(`${record.workDate}T${outTime}:00+09:00`).toISOString();
      await run("correctAttendance", { attendanceId: record.id, outAt, note });
      toast.push({ tone: "ok", title: "정정했습니다 (이력에 남음)" });
      onClose();
    } catch (e) {
      if (e instanceof CommandError) setErrors(e.fieldErrors);
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "정정 실패" });
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`출퇴근 정정 · ${who}`}
      description={`${record.workDate} · 출근 ${hhmm(record.inAt)} — 퇴근 시각만 고칠 수 있고, 위치 기록은 바뀌지 않습니다.`}
      size="sm"
      testId="att-fix-modal"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={save} data-testid="att-fix-save">
            정정
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="퇴근 시각" htmlFor="fx-out" error={errors.time}>
          <input id="fx-out" type="time" className={cx(inputCls, "num w-40")} value={outTime} onChange={(e) => setOutTime(e.target.value)} />
        </Field>
        <Field label="정정 사유" htmlFor="fx-note" required error={errors.note}>
          <input id="fx-note" className={inputCls} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="예) 퇴근 버튼 누락 — 현장 반장 확인" data-testid="att-fix-note" />
        </Field>
      </div>
    </Modal>
  );
}

function QrChip({ q, required }: { q?: QrStamp; required: boolean }) {
  if (!q) return required ? <span className="inline-flex rounded-md bg-surface-3 px-1.5 py-0.5 text-[0.74rem] font-bold text-ink-2">QR 없음</span> : null;
  return <span className={cx("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[0.74rem] font-bold", q.status === "ok" ? "bg-ok-bg text-ok" : "bg-err-bg text-err")} data-testid="att-qr-chip">{QR_LABEL[q.status]}</span>;
}

/** 현장 QR 단말기 목록 (현장 카드 아래) */
function KioskList({ kiosks, onAdd, onRevoke, qrMode }: { kiosks: Kiosk[]; onAdd: () => void; onRevoke: (k: Kiosk) => void; qrMode: boolean }) {
  const now = new Date().toISOString();
  return (
    <div className="border-t border-line px-5 py-3" data-testid="kiosk-list">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.82rem] font-bold text-ink-2">
          <TabletSmartphone size={15} aria-hidden /> 현장 QR 단말기 {kiosks.length}대
          {qrMode && kiosks.filter((k) => k.pairedAt).length === 0 && <span className="text-warn"> · QR 출근 방식인데 연결된 단말기가 없습니다</span>}
        </p>
        <Button size="sm" variant="soft" icon={<QrCode size={15} />} onClick={onAdd} data-testid="kiosk-add">
          단말기 추가
        </Button>
      </div>
      {kiosks.length > 0 && (
        <ul className="mt-2 space-y-1 text-[0.8rem]">
          {kiosks.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="kiosk-row">
              <span className="font-semibold">{k.name}</span>
              {k.pairedAt ? (
                <Badge tone="ok">연결됨</Badge>
              ) : k.pairExpiresAt && k.pairExpiresAt > now ? (
                <Badge tone="warn">연결 대기 · {hhmm(k.pairExpiresAt)}까지</Badge>
              ) : (
                <Badge>코드 만료 — 해제 후 다시 추가</Badge>
              )}
              {k.lastUsedAt && <span className="text-ink-3">마지막 출근 확인 {hhmm(k.lastUsedAt)}</span>}
              <button type="button" onClick={() => onRevoke(k)} className="press rounded-md px-1.5 py-0.5 text-[0.76rem] font-semibold text-err hover:bg-err-bg">
                해제
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 단말기 연결 코드 — 이번 한 번만 보여준다 */
function PairModal({ site, code, expiresAt, onClose }: { site: Site; code: string; expiresAt: string; onClose: () => void }) {
  const url = `${typeof window === "undefined" ? "" : window.location.origin}/kiosk?c=${code}`;
  const qr = qrPath(url);
  return (
    <Modal open onClose={onClose} title={`현장 QR 단말기 연결 · ${site.shortName}`} description="현장 사무실 태블릿에서 아래 QR을 카메라로 찍거나, 태블릿 브라우저에서 /kiosk 를 열고 코드를 넣으세요." size="sm" testId="pair-modal" footer={<Button onClick={onClose}>닫기</Button>}>
      <div className="space-y-3 text-center">
        <p className="num text-[2rem] font-extrabold tracking-[0.3em]" data-testid="pair-code">
          {code}
        </p>
        <p className="text-[0.84rem] text-ink-2">{hhmm(expiresAt)}까지 (30분) · 한 번만 사용 · 이 창을 닫으면 다시 볼 수 없습니다</p>
        <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} className="mx-auto block size-52" role="img" aria-label="단말기 연결 QR" shapeRendering="crispEdges">
          <rect x={-2} y={-2} width={qr.size + 4} height={qr.size + 4} fill="#fff" />
          <path d={qr.d} fill="#000" />
        </svg>
        <a href={url} target="_blank" rel="noreferrer noopener" className="inline-block text-[0.84rem] font-semibold text-theme-ink underline underline-offset-2" data-testid="pair-open">
          이 컴퓨터에서 단말기 화면 열기
        </a>
      </div>
    </Modal>
  );
}

/** 작업 인원 (출력) — 팀별 인원·단체 사진·위치, 노무 공수 보고와 대조 */
function CrewCard({ db, date, name }: { db: DemoDB; date: string; name: (id: string) => string }) {
  const since = shiftDate(date, -29);
  const monthFrom = `${date.slice(0, 8)}01`;
  const rows = (db.crewChecks ?? []).filter((c) => c.workDate === date).sort((a, b) => a.siteId.localeCompare(b.siteId) || a.at.localeCompare(b.at));
  const flags = crewFlags(db, date, since);
  const using = db.sites.filter((s) => (db.crewChecks ?? []).some((c) => c.siteId === s.id));
  const siteName = (id: string) => db.sites.find((s) => s.id === id)?.shortName ?? "";
  const csv = () => {
    const sum = crewSummary(db, monthFrom, date);
    const body = ["현장,팀,구분,보고 일수,인원일 합계,사진 없음", ...sum.map((r) => [siteName(r.siteId), `"${r.team.replace(/"/g, "'")}"`, r.kind === "direct" ? "직영" : "외주", r.days, r.personDays, r.noPhoto].join(","))].join("\n");
    downloadCsv(`작업인원_${monthFrom}_${date}.csv`, body);
  };
  return (
    <Card data-testid="crew-card">
      <CardHeader
        title="작업 인원 (출력)"
        sub="현장소장·반장이 팀별로 보낸 오늘 인원·단체 사진·위치 — 직영은 급여, 외주는 팀 기성 확인 근거"
        right={
          <Button size="sm" icon={<Download size={15} />} onClick={csv} disabled={(db.crewChecks ?? []).length === 0} data-testid="crew-csv">
            팀별 CSV
          </Button>
        }
      />
      {flags.length > 0 && (
        <ul className="space-y-1 border-t border-line px-5 py-3 text-[0.82rem]" data-testid="crew-flags">
          {flags.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5" data-kind={f.kind}>
              <AlertTriangle size={14} className={cx("mt-0.5 shrink-0", f.kind === "photo_reused" || f.kind === "manday_over" ? "text-err" : "text-warn")} aria-hidden />
              <span>
                <b>{CREW_FLAG_LABEL[f.kind]}</b> · {f.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length === 0 ? (
        <p className="border-t border-line px-5 py-4 text-[0.84rem] text-ink-3">이 날짜에 보낸 작업 인원이 없습니다.</p>
      ) : (
        <div className="relative overflow-x-auto border-t border-line">
          <table className="w-full min-w-[42rem] text-[0.84rem]">
            <thead>
              <tr className="text-left text-[0.74rem] text-ink-3">
                {["현장", "팀", "인원", "단체 사진", "보낸 사람", "위치"].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold first:pl-5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const ph = c.photoId ? db.photos.find((p) => p.id === c.photoId) : undefined;
                const mine = flags.filter((f) => f.crewId === c.id);
                return (
                  <tr key={c.id} className="border-t border-line align-middle" data-testid="crew-row">
                    <td className="py-2 pl-5 pr-3 font-semibold">{siteName(c.siteId)}</td>
                    <td className="px-3 py-2">
                      {c.team} <span className="text-[0.74rem] text-ink-3">{c.kind === "direct" ? "직영" : "외주"}</span>
                      {mine.map((f, i) => (
                        <Badge key={i} tone={f.kind === "photo_reused" ? "err" : "warn"} className="ml-1">
                          {CREW_FLAG_LABEL[f.kind]}
                        </Badge>
                      ))}
                      {c.history?.length ? <span className="block text-[0.72rem] text-ink-3">수정 {c.history.length}회 (처음 {c.history[0].headcount}명)</span> : null}
                    </td>
                    <td className="num px-3 py-2 font-bold">{c.headcount}명</td>
                    <td className="px-3 py-2">
                      {ph ? (
                        <a href={ph.dataUrl} target="_blank" rel="noreferrer noopener">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={ph.dataUrl} alt={`${c.team} 단체 사진`} className="size-12 rounded-md object-cover" />
                        </a>
                      ) : (
                        <span className="text-[0.78rem] font-semibold text-warn">없음</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-2">
                      {name(c.by)} · {hhmm(c.at)}
                    </td>
                    <td className="px-3 py-2">
                      <GeoChip g={c.geo} label="위치 기록 없음" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {using.length > 0 && (
        <ul className="border-t border-line px-5 py-3 text-[0.82rem]" aria-label="최근 30일 노무 공수 대조">
          {using.map((s) => {
            const g = mandayGap(db, s.id, since, date);
            const over = mandayOver(g);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-2" data-testid="crew-gap" data-over={over ? "1" : "0"}>
                <b>{s.shortName}</b>
                <span className="text-ink-2">최근 30일 노무 공수 보고 {g.reported} · 출력 인원 {g.crewDays}명·일</span>
                {over ? <Badge tone="err">공수가 더 많음 — 확인 필요</Badge> : <Badge tone="ok">맞음</Badge>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
