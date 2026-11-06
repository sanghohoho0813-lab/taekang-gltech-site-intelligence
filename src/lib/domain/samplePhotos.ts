/**
 * 시연판 전용 예시 사진 (D-67) — 시연 데이터에는 사진이 없어 사진대장·발주처 공개를 보여 줄 수 없었다.
 * 실제 사진이 아니라는 것이 그림 안에 보이도록 ‘예시’라고 적은 그림(SVG)을 만든다. 실제 운영에서는 쓰지 않는다.
 */
import type { Site, SitePhoto } from "./types";
import { shiftDate } from "./attendance";

const PALETTE = [
  ["#c9d6e3", "#7d93ab"],
  ["#d8d2c4", "#9a8f78"],
  ["#cfdcd4", "#7c998a"],
  ["#d9cfdc", "#937c9b"],
  ["#dcd6c9", "#a3916f"],
  ["#cdd9df", "#6f8f9e"],
];

function svg(title: string, sub: string, i: number): string {
  const [bg, fg] = PALETTE[i % PALETTE.length];
  const cols = 5 + (i % 3);
  const panes = Array.from({ length: cols * 4 }, (_, k) => {
    const x = 60 + (k % cols) * (520 / cols);
    const y = 70 + Math.floor(k / cols) * 62;
    return `<rect x="${x}" y="${y}" width="${520 / cols - 10}" height="52" rx="3" fill="${k % 4 === i % 4 ? "#ffffff" : "#eef3f7"}" stroke="${fg}" stroke-width="2"/>`;
  }).join("");
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="${bg}"/><rect x="40" y="50" width="560" height="280" fill="#f7f9fb" stroke="${fg}" stroke-width="4"/>${panes}<rect x="0" y="360" width="640" height="120" fill="rgba(17,24,39,0.72)"/><text x="32" y="408" font-family="sans-serif" font-size="30" font-weight="700" fill="#fff">예시 사진 · ${title}</text><text x="32" y="448" font-family="sans-serif" font-size="22" fill="#e5e7eb">${sub} (시연용 그림 — 실제 사진 아님)</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
}

export function samplePhotos(site: Site, today: string, by: string, n = 6): SitePhoto[] {
  return Array.from({ length: n }, (_, i) => {
    const date = shiftDate(today, -(n - 1 - i));
    // 사진대장이 붙이는 공종(그날 진행 중인 단계)과 같은 이름을 그림에도 쓴다
    const stage = site.stages.find((s) => s.startDate <= date && s.endDate >= date)?.name ?? site.workType;
    return {
      id: `ph-sample-${site.id}-${date}-${i}`,
      siteId: site.id,
      dataUrl: svg(stage, `${site.shortName} · ${date.replace(/-/g, ".")}`, i),
      caption: `예시 · ${stage}`,
      createdAt: new Date(`${date}T0${2 + (i % 6)}:30:00Z`).toISOString(),
      createdBy: by,
    };
  });
}
