"use client";

/**
 * 사진 백업 (D-86, 대표 · LIVE) — 전체 자료 백업에는 사진 원본이 없어(크기) 달마다 ZIP으로 따로 받는다.
 * ZIP은 윈도우 탐색기에서 그대로 열리고(사진 파일 + 목록), 새 시스템으로 옮긴 뒤 같은 파일을 올리면 ‘사진 원본 없음’이 채워진다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Images, Upload } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { api } from "@/lib/live/api";
import { buildPhotoZip, uploadPhotoZip, type PhotoRestoreResult } from "@/lib/browser/backupFiles";
import { Button, Notice, cx, inputCls } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";

interface Status {
  total: number;
  missing: number;
  months: { month: string; count: number; missing: number }[];
}

const monthLabel = (m: string) => (m === "0000-00" ? "날짜 없음" : `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`);

export function PhotoBackup() {
  const { db } = useMe();
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [month, setMonth] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  // 올리기 결과는 알림(몇 초)만이 아니라 카드에 남긴다 (점검 반영)
  const [result, setResult] = useState<{ tone: "ok" | "warn" | "err"; title: string; lines: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await api<Status>("/api/backup/photos");
    if (r.ok && r.data) {
      setStatus(r.data);
      setMonth((m) => m || r.data!.months[0]?.month || "");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!db || !status) return null;
  const busy = progress !== null;
  const cur = status.months.find((m) => m.month === month);
  // 원본이 하나도 없는 달은 빈 ZIP이 되므로 내려받지 않는다 (점검 반영)
  const allMissing = !!cur && cur.count > 0 && cur.missing >= cur.count;

  const download = async () => {
    if (!month || busy) return;
    setProgress("사진 받는 중…");
    try {
      const r = await buildPhotoZip(db, month, (d, t) => setProgress(`사진 받는 중 ${d}/${t}장`));
      if (!r.saved) {
        toast.push({ tone: "err", title: `${monthLabel(month)}에 내려받을 사진 원본이 없습니다${r.missing ? ` (원본 없음 ${r.missing}장 — 사진 백업을 먼저 올리세요)` : ""}` });
        return;
      }
      const url = URL.createObjectURL(new Blob(r.parts as BlobPart[], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `taekang_photos_${month}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      const extra = [r.missing ? `원본 없음 ${r.missing}장 빠짐` : "", r.failed ? `받지 못함 ${r.failed}장 — 다시 받아 주세요` : ""].filter(Boolean).join(" · ");
      toast.push({ tone: r.failed ? "err" : "ok", title: `${monthLabel(month)} 사진 ${r.saved}장을 ZIP으로 내려받았습니다${extra ? ` (${extra})` : ""}` });
    } catch {
      toast.push({ tone: "err", title: "사진 백업을 만들지 못했습니다. 인터넷 연결을 확인하고 다시 해 주세요." });
    } finally {
      setProgress(null);
    }
  };

  const upload = async (file: File) => {
    setProgress("사진 올리는 중…");
    setResult(null);
    try {
      const r: PhotoRestoreResult = await uploadPhotoZip(file, (d, t) => setProgress(`사진 올리는 중 ${d}/${t}장`));
      const lines = [
        r.existed ? `이미 원본이 있는 사진 ${r.existed}장 (그대로 둠)` : "",
        r.unknown ? `이 회사 기록에 없는 사진 ${r.unknown}장 — 다른 회사·다른 시스템의 사진 백업일 수 있습니다` : "",
        r.mismatch ? `원래 사진과 다른 파일 ${r.mismatch}장 — 받지 않았습니다(사진을 바꿔 넣을 수 없음)` : "",
        r.invalid ? `사진이 아니거나 너무 큰 파일 ${r.invalid}장` : "",
        r.corrupt ? `ZIP 안에서 깨진 파일 ${r.corrupt}장 — 예전 시스템에서 그 달 사진 백업을 다시 받아 주세요` : "",
        r.notFound ? `목록에 있는데 ZIP 안에서 찾지 못한 사진 ${r.notFound}장 — 내려받은 ZIP을 풀거나 다시 묶지 말고 그대로 올려 주세요` : "",
        r.failed ? `인터넷 문제로 보내지 못한 사진 ${r.failed}장 — 같은 파일을 다시 올리면 됩니다` : "",
      ].filter(Boolean);
      const problem = r.unknown + r.mismatch + r.invalid + r.corrupt + r.notFound + r.failed;
      setResult({ tone: !r.saved && problem ? "err" : problem ? "warn" : "ok", title: `사진 백업 올리기 — 원본 ${r.saved}장 채움`, lines });
    } catch (e) {
      setResult({ tone: "err", title: e instanceof Error ? e.message : "사진 백업을 올리지 못했습니다.", lines: [] });
    } finally {
      setProgress(null);
      void load();
    }
  };

  return (
    <div className="mx-5 mb-5 space-y-3 rounded-xl border border-line bg-surface-2 p-4" data-testid="photo-backup" data-total={status.total} data-missing={status.missing}>
      <div>
        <p className="text-[0.92rem] font-bold">사진 백업 (달마다 .zip)</p>
        <p className="text-[0.8rem] text-ink-3">사진 원본은 위 파일에 들어가지 않아 달마다 따로 받습니다. ZIP을 풀면 날짜·현장 이름이 붙은 사진 파일이 나옵니다 — 변경공사 증빙 파일(변경계약서·공문 사진·PDF)도 ‘변경공사증빙_…’ 이름으로 함께 들어갑니다(PC 권장 · 한 달 수백 장이면 몇 분 걸릴 수 있음).</p>
      </div>
      {status.missing > 0 && (
        <Notice tone="warn" title={`사진 원본 없음 ${status.missing}장 — 백업으로 옮겨 온 자료입니다`}>
          예전 시스템에서 받은 사진 백업(taekang_photos_….zip)을 올리면 채워집니다. 이미 있는 사진은 바꾸지 않으니 여러 번 올려도 됩니다.
        </Notice>
      )}
      {status.months.length === 0 ? (
        <p className="text-[0.84rem] text-ink-2">아직 사진이 없습니다.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="pb-month" className="sr-only">
            사진 백업할 달
          </label>
          <select id="pb-month" className={cx(inputCls, "w-full sm:w-auto sm:min-w-[12rem]")} value={month} onChange={(e) => setMonth(e.target.value)} disabled={busy} data-testid="photo-backup-month">
            {status.months.map((m) => (
              <option key={m.month} value={m.month}>
                {monthLabel(m.month)} · {m.count}장{m.missing ? ` (원본 없음 ${m.missing})` : ""}
              </option>
            ))}
          </select>
          <Button icon={<Images size={16} />} onClick={download} disabled={busy || allMissing} data-testid="photo-backup-download">
            사진 백업 내려받기
          </Button>
          {allMissing && <p className="basis-full text-[0.8rem] text-ink-3">이 달 사진은 원본이 아직 없어 내려받을 것이 없습니다 — 아래 ‘사진 백업 올리기’로 먼저 채우세요.</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          data-testid="photo-backup-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
        <Button variant={status.missing > 0 ? "cta" : "ghost"} size="sm" icon={<Upload size={15} />} onClick={() => fileRef.current?.click()} disabled={busy} data-testid="photo-backup-upload">
          사진 백업 올리기 (.zip)
        </Button>
        {progress && (
          <span className="text-[0.84rem] font-semibold text-theme-ink" role="status" data-testid="photo-backup-progress">
            {progress}
          </span>
        )}
      </div>
      {result && (
        <div data-testid="photo-backup-result" data-tone={result.tone}>
          <Notice tone={result.tone} title={result.title}>
            {result.lines.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4">
                {result.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </Notice>
        </div>
      )}
    </div>
  );
}
