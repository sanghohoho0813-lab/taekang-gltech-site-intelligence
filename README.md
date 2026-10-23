# TAEKANG SITE INTELLIGENCE

**(주)태강지엘텍 · AI 기반 창호·유리 공사 현장 수익·공정관리 플랫폼 — 시연용 Interactive MVP (DEMO)**

현장에서 모바일로 입력한 원가가 같은 데이터로 **PC 현장 손익 → 위험 감지 → 담당자 조치 → Proof Event → 대표 보고서 → 발주처 포털 상태**까지 이어지는 것을 실제로 클릭·입력하며 보여주는 MVP입니다.

> ⚠️ 모든 현장·금액·인물은 **가상 시연 데이터**입니다. 위험 판단은 **규칙 기반 진단(RULE v1)** 이며 실제 AI API는 연결되어 있지 않습니다. Demo 역할 전환은 **권한 프리뷰**이며 실제 보안(Auth/RLS)이 아닙니다.

- 시연 큐시트: [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md)
- 설계: [`PROJECT_SPEC.md`](PROJECT_SPEC.md) · 진행: [`PROJECT_STATE.md`](PROJECT_STATE.md) · 결정: [`DECISIONS.md`](DECISIONS.md)
- 품질: [`QA_REPORT.md`](QA_REPORT.md) · 개선 후보: [`RECOMMENDATIONS.md`](RECOMMENDATIONS.md)
- 실증: [`EVIDENCE_PLAN.md`](EVIDENCE_PLAN.md) · [`AX_COACH_PLAN.md`](AX_COACH_PLAN.md) · [`PROOF_EVENT_SCHEMA.md`](PROOF_EVENT_SCHEMA.md)
- 기준 문서: `docs/(AX+플랫폼전용)미래AI랩_AX_Platform_Unified_Design_Development_System_v4.1_260922.md`, `docs/태강지엘텍_ClaudeCode_AX플랫폼_MVP_통합프롬프트_261023.md`, `docs/references/*.png`

---

## 1. 실행

요구사항: Node.js 20.9 이상 (개발 환경 Node 22에서 확인)

```bash
npm install
npm run build
npm start            # http://localhost:3000
# 개발 모드: npm run dev
```

환경변수 없이 DEMO 모드로 바로 동작합니다. (`.env.example` 참고 — 실데이터 전환 시에만 필요)

## 2. 배포 (Vercel)

1. Vercel에서 이 GitHub 저장소를 Import → Framework Preset **Next.js** (자동 인식)
2. 환경변수 없이 Deploy
3. 발급된 URL에서 상단 **데모 초기화** 후 시연

> 데이터는 각 브라우저에 저장되므로 **배포 URL을 열어도 다른 사람의 시연 데이터와 섞이지 않습니다.** 반대로 노트북과 실제 휴대폰 사이에는 공유되지 않습니다 (공유는 Supabase 전환 후).

## 3. 데모 사용법

| 기능 | 위치 |
|---|---|
| PC / Mobile / PC+Mobile (v4.1 Device View) | 상단 검은 바 가운데 — 1024px 이상 화면에서 표시, 선택값 유지 |
| 모바일 시연 역할 (PC+Mobile 전용) | 오른쪽 모바일 프레임 위 ‘역할’ (기본: PC와 동일) |
| Demo 역할 (대표자/본사관리자/현장직원/발주처·협력사) | 상단 바 ‘역할’, 헤더 사용자 메뉴, `/settings` |
| 데모 초기화 | 상단 바 ‘데모 초기화’, `/settings`, `/presentation` |
| 발주처 포털 ↔ Business AX | 상단 바 ‘발주처 포털 보기 / Business AX 보기’ |
| 시연 모드 (6단계 Guided Demo) | `/presentation` → 시연 시작 |
| 튜토리얼 (4단계) | `/settings` → 튜토리얼 다시 보기 |
| 테마 7종 · 글자 크기 · 모션 줄이기 | `/settings` |
| CSV 원가 가져오기·내보내기 | `/settings` → 데이터 (본사관리자·대표자) |

### 미팅 시나리오 (가상 현장 A)
계약 10억 · EAC 8.5억(발생 5.1억 + 잔여 3.4억) · 예상이익 1.5억 · 15%
→ 모바일 추가비용 자재 3,000만 + 노무 1,000만 (예상 외 추가원가 · 설계변경)
→ EAC 8.9억 · 예상이익 1.1억 · 11% · 이익 감소 4,000만 원 (자동 재계산, 단위 테스트로 고정)

## 4. 화면 (Route)

| Route | 설명 |
|---|---|
| `/dashboard` | 대표 대시보드 (현장직원 역할은 현장 홈) |
| `/sites`, `/sites/[id]` | 현장 목록 / 현장 손익 엔진·원가·공정·보고·계약·기성·요청·이력 + 모바일 ‘현장 보고 · 비용 입력’ |
| `/field` | 모바일 현장 보고 (작업·사진·이슈·추가 비용·작성 이력·되돌리기) |
| `/my-actions` | 배정된 위험 조치 처리 |
| `/insights` | 규칙 기반 위험 신호 → 조치 생성·배정·진행·완료 → Proof Event, 발주처 요청함 |
| `/finance` | 계약·변경공사(승인만 계약 반영)·기성·입금·미수 |
| `/report` | 대표자 실시간 보고서 (인쇄/PDF) |
| `/partner` | 발주처·협력사 포털 (진행률·요청·회신, 내부 금액 비노출) |
| `/evidence` | Proof Event · Money KPI 3 (Baseline 미확보) · 12주 실증 계획 |
| `/why-ax` | 태강지엘텍 맞춤 기획의도 16 Section |
| `/settings` | 테마·글자·권한 매트릭스·데모·데이터·AI 상태·위험 기준 |
| `/presentation` | 시연 모드 |

## 5. 구조

```
src/
  app/                 Route (Next.js App Router)
  components/
    shell/             Sidebar(4 Group), Header, Mobile Header/BottomNav/Drawer, AccessGate
    device/            DeviceStage(PC/Mobile/PC+Mobile, iframe Route Sync), DemoBar
    tour/              시연 모드·튜토리얼 (비차단형 코치 패널)
    domain/            손익 엔진·차트·현장보고 폼·조치·위젯
    ui/                Button/Card/Badge/Modal(native dialog)/Toast …
  lib/
    domain/            types · calc(EAC/이익/미수) · risk(RULE v1) · format · csv · labels
    data/              seed(가상 현장 3) · commands(모든 쓰기 경로) · store(DEMO Repository) · hooks
    theme/             Canonical 7 Theme
    ai/provider.ts     AI 연결 지점 (READY, 실제 호출 없음)
supabase/migrations/   001 스키마 · 002 RLS (READY, 미실행)
tests/unit             계산·명령·위험 규칙 (vitest)
tests/e2e              시연 흐름·Device View·역할·테마·CSV·반응형 (Playwright)
```

## 6. 테스트

```bash
npm test                         # 단위 테스트 15 (계산·명령·위험 규칙·7 Theme 대비)
npm run build && npm run e2e     # E2E 16 (Playwright, next start 자동 실행 · 포트 3100)
QA_BASE_URL=http://127.0.0.1:3000 npm run qa:cuesheet   # 시연 큐시트 숫자 44개 검증 (서버 실행 중일 때)
```
Playwright 브라우저가 없다면 `npx playwright install chromium` 후 실행하세요.

## 7. 실데이터 전환 (USER ACTION QUEUE)

현재 MVP는 운영 DB에 연결되어 있지 않습니다. 실제 현장 데이터로 Pilot을 시작하려면:

1. **CSV (가장 빠름)** — `/settings` → ‘샘플 내려받기’ 형식으로 실제 현장 1곳의 원가를 정리해 가져오기 (검증 오류는 행 번호로 표시)
2. **Supabase (기기 간 공유·실제 권한)**
   1. Supabase 프로젝트 생성
   2. `supabase/migrations/001_base_schema.sql` → `002_rls.sql` 순서로 실행
   3. Vercel 환경변수 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 등록 (서버 전용 키는 `NEXT_PUBLIC_` 금지)
   4. `src/lib/data/store.ts`의 `Repository` 인터페이스에 Supabase 구현을 추가하고 교체 → 재배포
3. **실제 AI 1개 기능** — 대표 명시 승인 + `ANTHROPIC_API_KEY`(서버 전용) 제공 시 `src/lib/ai/provider.ts` 인터페이스에 맞춰 서버 Route 1개만 추가 (현장 위험요인 요약). 산술은 계속 코드가 담당.

## 8. 이번 범위에서 제외
실제 회계 ERP·은행 연동, 전자세금계산서, BIM/도면 견적, 영상 AI, 발주처 결제·전자계약, 멀티테넌트 과금, 정책자금 신청 자동화, 특허 성과 주장, AI 예측 정확도 주장, 실제 LLM 호출, 실제 Auth/RLS 활성화, Native App.
