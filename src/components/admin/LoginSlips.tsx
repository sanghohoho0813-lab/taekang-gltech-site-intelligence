"use client";

/**
 * 직원 로그인 안내 쪽지 (D-54) — 접속 QR·주소·아이디·임시 비밀번호·홈 화면 추가 방법·본사 전화. A4 한 장에 4명(잘라서 나눠 줌).
 * - 임시 비밀번호는 방금 만든 것만 들어간다(화면 메모리). 저장하지 않고, 모르면 손으로 쓰는 빈칸.
 * - QR에는 접속 주소만 넣는다(아이디·비밀번호는 넣지 않음).
 * - 인쇄할 때는 body 바로 아래에 둔 쪽지만 보이게 한다(다른 화면·대화상자 숨김).
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import type { RoleId } from "@/lib/domain/types";
import { qrPath } from "@/lib/geo/qrClient";
import { IS_LIVE } from "@/lib/mode";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";

export interface Slip {
  id: string;
  name: string;
  title: string;
  role: RoleId;
  email?: string;
  /** 방금 만든 임시 비밀번호 — 없으면 빈칸 */
  password?: string;
  sites: string[];
}

const APP_NAME: Record<RoleId, string> = { field: "현장 앱", partner: "발주처 화면", manager: "본사 화면", ceo: "본사 화면" };

export function loginUrl(): string {
  return typeof window === "undefined" ? "" : `${window.location.origin}/login`;
}

function Qr({ text }: { text: string }) {
  const { size, d } = qrPath(text);
  const q = 4; // 바깥 여백(모듈) — 휴대폰 카메라가 잘 읽게
  return (
    <svg viewBox={`${-q} ${-q} ${size + q * 2} ${size + q * 2}`} className="size-[30mm] shrink-0 bg-white" role="img" aria-label={`접속 주소 QR: ${text}`} data-testid="slip-qr" data-text={text} shapeRendering="crispEdges">
      <path d={d} fill="#000" />
    </svg>
  );
}

function SlipCard({ s, url, phone }: { s: Slip; url: string; phone?: string }) {
  const row = "flex items-baseline gap-2";
  const k = "w-[6.2em] shrink-0 whitespace-nowrap text-[9.5pt] text-neutral-500";
  return (
    <article className="slip-card flex h-[130mm] flex-col overflow-hidden border border-dashed border-neutral-400 p-[5mm] text-black" data-testid="slip-card" data-user={s.id}>
      <p className="text-[9pt] font-semibold text-neutral-500">
        TAEKANG {APP_NAME[s.role]} · 로그인 안내{IS_LIVE ? "" : " · DEMO"}
      </p>
      <p className="mt-0.5 text-[16pt] font-extrabold leading-tight">
        {s.name} <span className="text-[11pt] font-semibold text-neutral-600">{s.title}</span>
      </p>
      {s.sites.length > 0 && <p className="text-[9.5pt] text-neutral-600">담당 {s.sites.join(", ")}</p>}
      <div className="mt-2.5 flex items-center gap-3">
        {/* QR에 아이디를 넣어 두면 로그인 화면에 아이디가 채워져 비밀번호만 치면 된다 (장갑 낀 손 · D-67) */}
        <Qr text={s.email ? `${url}?id=${encodeURIComponent(s.email)}` : url} />
        <div className="min-w-0 text-[10pt] leading-snug">
          <p className="font-bold">① 휴대폰 카메라로 QR을 찍으세요</p>
          <p className="mt-0.5 break-all text-[8.5pt] text-neutral-600">{url}</p>
          <p className="mt-1 text-[8.5pt] text-neutral-600">카카오톡 안에서 열지 말고 크롬·사파리로 여세요 (위치·알림이 안 될 수 있어요)</p>
        </div>
      </div>
      <div className="mt-2.5 space-y-1.5 text-[11pt]">
        <p className={row}>
          <span className={k}>아이디</span>
          {s.email ? <b className="break-all">{s.email}</b> : <span className="h-[7mm] flex-1 border-b border-neutral-500" aria-hidden />}
        </p>
        <p className={row}>
          <span className={k}>임시 비밀번호</span>
          {s.password ? (
            <b className="font-mono text-[15pt] tracking-[0.12em]" data-testid="slip-password">
              {s.password}
            </b>
          ) : (
            <span className="h-[7mm] flex-1 border-b border-neutral-500" aria-hidden />
          )}
        </p>
        <p className="text-[9.5pt] text-neutral-700">② 처음 들어가면 새 비밀번호를 정해요 (영어+숫자 8자 이상). 이 쪽지는 본인만 보고, 바꾼 뒤 버리세요.</p>
      </div>
      <div className="mt-2 pb-2 text-[9.5pt] leading-snug text-neutral-800">
        <p className="font-bold">③ 홈 화면에 앱 아이콘 만들기</p>
        <p>아이폰: 사파리 아래 공유 버튼 → ‘홈 화면에 추가’</p>
        <p>갤럭시: 크롬 오른쪽 위 점 세 개 → ‘홈 화면에 추가’</p>
      </div>
      <p className="mt-auto border-t border-neutral-300 pt-2 text-[10.5pt] font-bold">
        모르면 본사로 전화: {phone ? <span className="num">{phone}</span> : <span className="inline-block w-[40mm] border-b border-neutral-500 align-bottom" aria-hidden />}
      </p>
    </article>
  );
}

export function SlipSheet({ slips, url, phone }: { slips: Slip[]; url: string; phone?: string }) {
  return (
    <div className="slip-sheet grid grid-cols-1 gap-[4mm] bg-white sm:grid-cols-2 print:grid-cols-2" data-testid="slip-sheet">
      {slips.map((s) => (
        <SlipCard key={s.id} s={s} url={url} phone={phone} />
      ))}
    </div>
  );
}

/** 미리보기 대화상자 + 인쇄 (쪽지만 인쇄) */
export function SlipPrintDialog({ slips, phone, onClose }: { slips: Slip[]; phone?: string; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setUrl(loginUrl());
    const el = document.createElement("div");
    el.className = "slip-print-root print-plain";
    document.body.appendChild(el);
    setHost(el);
    const after = () => document.documentElement.classList.remove("print-slips");
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("afterprint", after);
      after();
      el.remove();
    };
  }, []);
  const print = () => {
    document.documentElement.classList.add("print-slips");
    window.print();
  };
  const withPw = slips.filter((s) => s.password).length;
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`로그인 쪽지 ${slips.length}장`}
      description={withPw ? `임시 비밀번호 ${withPw}명 포함 — 이 화면을 닫으면 다시 볼 수 없습니다. 인쇄한 뒤 본인에게만 직접 주세요.` : "임시 비밀번호 칸은 비어 있습니다 — 손으로 적거나, 첫 로그인 전인 사람은 ‘임시 비밀번호 새로 만들기’로 다시 만드세요."}
      testId="slip-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button variant="cta" icon={<Printer size={17} />} onClick={print} data-testid="slip-print">
            인쇄 (A4 한 장에 4명)
          </Button>
        </>
      }
    >
      {url && <SlipSheet slips={slips} url={url} phone={phone} />}
      {host && url && createPortal(<SlipSheet slips={slips} url={url} phone={phone} />, host)}
    </Modal>
  );
}
