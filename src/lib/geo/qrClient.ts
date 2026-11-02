"use client";

/** QR 그리기(현장 태블릿)·읽기(현장 직원 휴대폰 사진) — 브라우저 전용 */
import qrcode from "qrcode-generator";
import jsQR from "jsqr";

/** QR 모듈 배열 → SVG path (라이브러리가 만든 HTML을 그대로 넣지 않는다) */
export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return { size: n, d };
}

/** 휴대폰으로 찍은 사진에서 QR 글자 읽기 (여러 크기로 시도) */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("image"));
      i.src = url;
    });
    for (const max of [1000, 1600, 700]) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      const hit = jsQR(data.data, w, h, { inversionAttempts: "attemptBoth" });
      if (hit?.data) return hit.data;
    }
    return null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
