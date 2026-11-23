"use client";

/**
 * 회사 휴대폰 알림 (D-91) — 대표가 ‘회사 휴대폰 알림 켜기’를 누르면 서버가 알림 키를 만들어 보관한다.
 * 예전에는 Vercel 환경변수(VAPID)를 사람이 넣어야 했다. 환경변수가 있으면 그것을 그대로 쓴다.
 * 켠 뒤에는 사람마다 자기 휴대폰에서 ‘알림 켜기’를 한 번 눌러야 받는다 (아래 내 기기 카드).
 */
import { useEffect, useState } from "react";
import { BellRing, KeyRound } from "lucide-react";
import Link from "next/link";
import { enableCompanyPush, serverStatus, type ServerPushStatus } from "@/lib/browser/push";
import { IS_LIVE } from "@/lib/mode";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { PushCard } from "@/components/PushCard";

export function CompanyPushCard() {
  const toast = useToast();
  const [st, setSt] = useState<ServerPushStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!IS_LIVE) return;
    let alive = true;
    serverStatus()
      .then((s) => alive && setSt(s))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const turnOn = async () => {
    setBusy(true);
    try {
      const s = await enableCompanyPush();
      setSt(s);
      setRound((r) => r + 1);
      toast.push({ tone: "ok", title: "회사 휴대폰 알림을 켰습니다", desc: "이제 각자 휴대폰에서 ‘알림 켜기’를 한 번 누르면 받습니다." });
    } catch (e) {
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "회사 알림을 켜지 못했습니다." });
    } finally {
      setBusy(false);
    }
  };

  const on = !!st?.enabled;
  return (
    <Card data-testid="company-push" data-state={!IS_LIVE ? "demo" : st ? (on ? "on" : "off") : failed ? "error" : "loading"}>
      <CardHeader
        title="회사 휴대폰 알림"
        sub="작업지시·보완 요청·가입 신청·하자보증 만료·아침 알림을 휴대폰으로 보냅니다. 무료 웹 알림이라 비용이 들지 않습니다."
        right={IS_LIVE && st ? on ? <Badge tone="ok">켜짐</Badge> : <Badge tone="warn">꺼짐</Badge> : undefined}
      />
      <div className="space-y-3 px-5 pb-5 text-[0.86rem]">
        {!IS_LIVE && <p className="text-ink-3">시연판은 알림을 보내지 않습니다. 실제 운영에서는 대표가 여기서 한 번 켭니다.</p>}
        {IS_LIVE && !st && !failed && <p className="text-ink-3">확인 중…</p>}
        {IS_LIVE && failed && <p className="text-err">알림 상태를 확인하지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>}
        {IS_LIVE && st && !on && (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-ink-2" data-testid="company-push-steps">
              <li>
                <b className="text-ink">회사 알림 켜기</b> — 대표가 한 번만 누릅니다. 서버가 알림 전용 키를 만들어 보관합니다(밖으로 나가지 않음).
              </li>
              <li>
                <b className="text-ink">각자 휴대폰에서 켜기</b> — 현장 직원은 ‘내 정보 → 휴대폰 알림’, 본사는 ‘설정’에서 ‘알림 켜기’를 한 번 누릅니다. 아이폰은 홈 화면에 추가한 아이콘으로 열어야 합니다.
              </li>
            </ol>
            {st.canEnable ? (
              <Button variant="cta" icon={<BellRing size={16} />} loading={busy} onClick={() => void turnOn()} data-testid="company-push-on">
                회사 휴대폰 알림 켜기
              </Button>
            ) : (
              <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 font-semibold text-ink-2" data-testid="company-push-ceo-only">
                대표 권한 계정이 켤 수 있습니다. 대표님께 ‘운영 관리 → 운영 설정 → 회사 휴대폰 알림 켜기’를 부탁하세요.
              </p>
            )}
          </>
        )}
        {IS_LIVE && st && on && (
          <>
            <p className="text-ink-2" data-testid="company-push-source">
              <KeyRound size={14} className="mr-1 inline-block align-[-2px] text-ink-3" aria-hidden />
              {st.source === "env" ? "서버 설정(환경변수)의 알림 키를 쓰고 있습니다." : "운영 설정에서 켠 알림 키를 쓰고 있습니다."} 이제 사람마다 자기 휴대폰에서 ‘알림 켜기’를 한 번 누르면 받습니다 — 현장 직원은 ‘내 정보’, 본사는{" "}
              <Link href="/settings#push" className="font-bold text-theme-ink underline">
                설정
              </Link>
              .
            </p>
            {/* 이 기기에서 바로 받기 — 대표·공무가 이 화면에서 끝내도록 */}
            <PushCard key={round} size="compact" audience="hq" />
          </>
        )}
      </div>
    </Card>
  );
}
