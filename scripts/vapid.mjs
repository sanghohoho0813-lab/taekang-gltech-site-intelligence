#!/usr/bin/env node
/** 휴대폰 알림(웹 푸시)용 VAPID 키 만들기 — 한 번만 만들어 Vercel 환경변수에 넣는다. 다시 만들면 모든 사람이 알림을 다시 켜야 한다. */
import webpush from "web-push";

const k = webpush.generateVAPIDKeys();
console.log(`
Vercel → Settings → Environment Variables 에 아래 3개를 넣고 다시 배포하세요.
(개인 키는 서버 전용 — 메신저·메일로 보내지 말고, NEXT_PUBLIC_ 을 붙이지 마세요)

VAPID_PUBLIC_KEY=${k.publicKey}
VAPID_PRIVATE_KEY=${k.privateKey}
VAPID_SUBJECT=mailto:담당자이메일@회사도메인
`);
