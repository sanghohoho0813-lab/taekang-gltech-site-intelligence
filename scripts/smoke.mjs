#!/usr/bin/env node
/**
 * 배포 후 점검 — 사용:  npm run smoke -- https://배포주소
 * 로그인하지 않고 공개 주소만 확인합니다 (회사 데이터를 읽거나 바꾸지 않음). 문제가 있으면 종료 코드 1.
 */
import { smokeCheck, smokeSummary } from "./smoke-lib.mjs";

const url = process.argv.slice(2).find((a) => !a.startsWith("-"));
if (!url) {
  console.error("사용법: npm run smoke -- https://배포주소");
  process.exit(2);
}
const checks = await smokeCheck(url);
const { text, errors } = smokeSummary(checks);
console.log(`\nTAEKANG SITE INTELLIGENCE · 배포 후 점검 · ${url}\n`);
console.log(text);
process.exit(errors ? 1 : 0);
