# TAEKANG SITE INTELLIGENCE

**(주)태강지엘텍 · 창호·유리 공사 현장 수익·공정관리 플랫폼**

현장소장이 휴대폰으로 입력한 원가가 같은 데이터로 **PC 현장 손익 → 위험 감지 → 담당자 조치 → Proof Event → 대표 보고서 → 발주처 포털**까지 이어집니다.

같은 소스코드가 두 가지 모드로 동작합니다. 모드는 **빌드할 때** 정해지며, 한 배포 주소 안에서 섞이지 않습니다.

| | **DEMO** (영업·미팅 시연) | **LIVE** (실제 운영) |
|---|---|---|
| 데이터 | 가상 현장 3곳, 각 브라우저 안에만 저장 | 서버 DB (Supabase Postgres) — 모든 기기가 같은 데이터 |
| 로그인 | 없음 · 역할 전환은 **권한 프리뷰** (보안 아님) | 이메일·비밀번호, 서버 세션 30일 |
| 권한 | 화면에서만 숨김 | **서버에서 강제** — 현장소장·발주처에게는 금액 데이터가 아예 전송되지 않음 |
| 표시 | 전 화면 `DEMO · 가상 시연 데이터` | 표시 없음 (가상 현장으로 시작한 회사만 DEMO 띠 표시) |
| 시연 모드·Device View | 있음 | 없음 (대신 `운영 관리` 화면) |
| 설정 | 환경변수 없음 | `NEXT_PUBLIC_DATA_MODE=live` + `DATABASE_URL` + `SETUP_CODE` |

> 위험 판단은 **규칙 기반 진단(RULE v1)** 입니다. 실제 AI API는 연결되어 있지 않습니다. 손익·EAC·미수 계산은 모두 결정론적 코드입니다.

- 시연 큐시트: [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md)
- 설계: [`PROJECT_SPEC.md`](PROJECT_SPEC.md) · 진행: [`PROJECT_STATE.md`](PROJECT_STATE.md) · 결정: [`DECISIONS.md`](DECISIONS.md)
- 품질: [`QA_REPORT.md`](QA_REPORT.md) · 개선 후보: [`RECOMMENDATIONS.md`](RECOMMENDATIONS.md)
- 실증: [`EVIDENCE_PLAN.md`](EVIDENCE_PLAN.md) · [`AX_COACH_PLAN.md`](AX_COACH_PLAN.md) · [`PROOF_EVENT_SCHEMA.md`](PROOF_EVENT_SCHEMA.md)
- 기준 문서: `docs/(AX+플랫폼전용)미래AI랩_AX_Platform_Unified_Design_Development_System_v4.1_260922.md`, `docs/태강지엘텍_ClaudeCode_AX플랫폼_MVP_통합프롬프트_261023.md`

---

## 1. 내 컴퓨터에서 실행

요구사항: Node.js 20.9 이상 (개발 환경 Node 22에서 확인)

```bash
npm install

# DEMO (시연)
npm run build && npm start                 # http://localhost:3000

# LIVE (운영 화면을 내 컴퓨터에서 확인) — DB 설치 불필요
npm run build:live && npm run start:live   # http://localhost:3000 → 최초 설정 화면
```

LIVE를 `DATABASE_URL` 없이 실행하면 프로젝트 폴더 안 `.data/pg`에 **내장 Postgres(PGlite)** 파일 DB를 만들어 씁니다. 처음부터 다시 하려면 서버를 끄고 `.data` 폴더를 지우면 됩니다. (Vercel에서는 이 내장 DB를 쓰지 않습니다. `DATABASE_URL`이 없으면 시작을 거부합니다.)

DEMO와 LIVE 빌드 결과는 서로 다른 폴더(`.next` / `.next-live`)에 저장되어 덮어쓰지 않습니다.

## 2. 실제 운영 시작하기 (Supabase + Vercel)

**원칙: 소스코드·DB·배포 계정은 태강지엘텍 명의로 만듭니다.** 미래AI랩은 구축·유지보수 권한만 받습니다.

### 2-1. DB 만들기 (Supabase) — 약 10분
1. 태강지엘텍 명의로 [supabase.com](https://supabase.com) 가입 → **New project**
   - Region: **Northeast Asia (Seoul)**
   - Database Password: 길게 정하고 안전한 곳에 보관 (다시 볼 수 없음)
2. 프로젝트 화면 상단 **Connect** → **Transaction pooler** 연결 문자열(URI, 포트 `6543`)을 복사
   - `[YOUR-PASSWORD]` 자리에 1의 비밀번호를 넣고, 끝에 `?sslmode=require`를 붙입니다
   - 예: `postgresql://postgres.abcd:비밀번호@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require`
3. 테이블은 **앱이 처음 DB에 연결할 때 자동으로 만듭니다.** 직접 확인하고 싶으면 Supabase **SQL Editor**에 `supabase/migrations/001_init.sql`을 붙여넣어 실행해도 됩니다 (여러 번 실행해도 안전).

> 모든 테이블에 RLS(행 수준 보안)를 켜고 정책을 하나도 두지 않았습니다. 그래서 Supabase 공개 API(anon key)로는 어떤 데이터도 읽을 수 없고, **이 앱 서버만** DB 비밀번호로 접근합니다. anon key·service role key는 이 앱에서 쓰지 않습니다.

### 2-2. 배포 (Vercel) — 약 10분
1. 태강지엘텍 명의로 GitHub·Vercel 가입 → 이 저장소를 태강지엘텍 GitHub로 옮기거나(Transfer) 복사(Fork)
2. Vercel **Add New → Project → Import** → Framework **Next.js** (자동 인식, 빌드 명령 그대로)
3. **Environment Variables** (Production에 등록):

   | 이름 | 값 | 설명 |
   |---|---|---|
   | `NEXT_PUBLIC_DATA_MODE` | `live` | 운영 모드. **빌드할 때 반영**되므로 바꾸면 반드시 재배포 |
   | `DATABASE_URL` | 2-1의 연결 문자열 | 서버 전용. 절대 `NEXT_PUBLIC_`을 붙이지 않음 |
   | `SETUP_CODE` | 아무도 모르는 긴 문자열 | 최초 설정 보호. **Vercel 운영 배포에서는 없으면 최초 설정이 거부됨** |
   | `DB_POOL_MAX` | (선택) `5` | 서버 1대당 DB 연결 수. 기본 5 |

4. **Settings → Functions → Function Region**: `Seoul (icn1)` — DB와 같은 지역이라 응답이 빨라집니다
5. **Deploy**

### 2-3. 최초 설정 — 대표가 1회
1. 배포 주소 접속 → 로그인 화면에 “아직 회사 설정 전입니다” → **최초 설정**
2. 회사명 · 대표 이름 · 이메일(로그인 아이디) · 비밀번호 · 설정 코드(`SETUP_CODE`) 입력 → **회사 만들고 시작하기**
   - “가상 현장 3곳으로 시작”은 **교육·시험용**입니다. 이렇게 시작한 회사는 모든 화면에 DEMO 띠가 계속 표시됩니다. 실제 운영은 체크하지 않고 빈 상태로 시작하세요.
3. 최초 설정은 **회사가 하나도 없을 때 1번만** 가능합니다. 이후에는 거부됩니다.

### 2-4. 운영 준비 — `운영 관리` 화면 (대표·본사관리자)
| 순서 | 메뉴 | 할 일 |
|---|---|---|
| 1 | 사용자 | 본사관리자·현장소장·발주처 계정 추가 → 화면에 1번만 보이는 **임시 비밀번호**를 본인에게 전달. 첫 로그인 때 비밀번호 변경이 강제됩니다 |
| 2 | 현장 | 현장 등록: 계약금액 · 공종별 실행예산(자재·노무·외주·장비·경비) · 착공/준공 · 현장소장 지정 → 계획 이익률 자동 계산 |
| 3 | 사용자 | 발주처 계정 ‘수정’ → 공개할 현장 선택 (선택한 현장의 공정·요청만 보임) |
| 4 | 운영 설정 | 현장 원가 반영 방식(저장 즉시 / **본사 공무 확인 후**) · 노무 기본 일당 · 회사명 |
| 5 | 공무 확인 | (공무 확인 방식일 때) 현장 입력 원가를 견적·세금계산서 기준으로 승인(금액 수정 가능)·반려 |

현장소장 휴대폰: 배포 주소를 열고 로그인 → 브라우저 메뉴의 **홈 화면에 추가**로 앱처럼 씁니다.

### 2-5. 계정·비밀번호 관리
- 비밀번호를 잊으면 대표·본사관리자가 `운영 관리 → 사용자 → 비밀번호 초기화`로 새 임시 비밀번호 발급 (이메일 재설정은 아직 없음)
- 퇴사·계약 종료: `비활성` → **그 사람의 로그인이 즉시 끊김** (기록은 보존)
- 대표 권한은 대표만 줄 수 있고, 활성 대표 계정은 최소 1개가 유지됩니다. **대표 계정을 2개**(예: 대표 + 경영지원 책임자) 두면 한쪽이 비밀번호를 잊어도 다른 쪽이 초기화할 수 있습니다
- 로그인 8회 실패 시 10분 잠금

### 2-6. 영업 시연용 주소는 따로
시연은 **환경변수 없이** 만든 별도 Vercel 프로젝트(DEMO)로 합니다. 운영 주소(LIVE)를 시연에 쓰면 실제 데이터가 노출됩니다.

## 3. 권한 — 누가 무엇을 보나 (LIVE: 서버에서 강제)

| 역할 | 볼 수 있는 것 | 할 수 있는 것 |
|---|---|---|
| 대표자 | 전 현장 손익·원가·기성·미수·보고서·이력 | 전부 + 대표 권한 부여 |
| 본사관리자 | 대표와 같음 | 대표 권한 부여·대표 계정 변경 제외 전부 |
| 현장직원 | **담당 현장**의 공정·보고·사진, 본인이 입력한 원가, 본인에게 배정된 조치 (계약·예산·이익·기성·미수는 **전송 자체를 안 함**) | 담당 현장 보고·원가 입력, 본인 입력 수정·취소, 배정된 조치 진행·완료 (결과 확정은 본사) |
| 발주처·협력사 | **공개된 현장**의 공정률·일정, 본인 요청 (내부 금액·다른 현장·다른 발주처 없음) | 공개된 현장에 요청 등록 |

그 밖의 보안 장치: 비밀번호 scrypt 해시 저장 · 세션 토큰은 HttpOnly 쿠키(DB에는 해시만) · 다른 사이트에서 보낸 쓰기 요청 차단(Origin 확인) · 위험 신호는 서버가 다시 계산(지어낸 신호로 조치 생성 불가) · 활동 이력은 지워지지 않음 · 사진 원본은 권한 확인 후에만 전송.

## 4. 데모 사용법 (DEMO 모드)

| 기능 | 위치 |
|---|---|
| PC / Mobile / PC+Mobile (v4.1 Device View) | 상단 검은 바 가운데 — 1024px 이상 화면에서 표시. **기본값 PC+Mobile** |
| 모바일 시연 역할 (PC+Mobile 전용) | 오른쪽 모바일 프레임 위 ‘역할’ (기본: PC와 동일) |
| Demo 역할 (대표자/본사관리자/현장직원/발주처·협력사) | 상단 바 ‘역할’, 헤더 사용자 메뉴, `/settings` |
| 데모 초기화 | 상단 바 ‘데모 초기화’, `/settings`, `/presentation` |
| 발주처 포털 ↔ Business AX | 상단 바 ‘발주처 포털 보기 / Business AX 보기’ |
| 시연 모드 (6단계, 원클릭) | 상단 바·`/presentation` → **시연 시작** (누를 때마다 처음 상태로 초기화) → 안내 바의 주황 버튼만 누르면 진행 |
| 튜토리얼 (4단계) | `/settings` → 튜토리얼 다시 보기 |
| 테마 7종 · 글자 크기 · 모션 줄이기 | `/settings` |
| CSV 원가 가져오기·내보내기 | `/settings` → 데이터 |

### 미팅 시나리오 (가상 현장 A)
계약 10억 · EAC 8.5억(발생 5.1억 + 잔여 3.4억) · 예상이익 1.5억 · 15%
→ 모바일 추가비용 자재 3,000만 + 노무 1,000만 (실행예산 외 추가비용 · 설계변경)
→ EAC 8.9억 · 예상이익 1.1억 · 11% · 이익 감소 4,000만 원 (자동 재계산, 단위 테스트로 고정)

## 5. 화면 (Route)

| Route | 설명 |
|---|---|
| `/dashboard` | 대표 대시보드 (현장직원은 현장 홈 · LIVE 빈 회사는 ‘시작하기’ 안내) |
| `/sites`, `/sites/[id]` | 현장 목록 / 현장 손익 엔진·원가·공정·보고·계약·기성·요청·이력 |
| `/field` | 모바일 현장 보고 (작업·공정률·사진·이슈·추가 비용·**노무 공수×일당**·작성 이력·되돌리기) |
| `/my-actions` | 배정된 위험 조치 처리 |
| `/insights` | 규칙 기반 위험 신호 → 조치 생성·배정·진행·완료 → Proof Event, 발주처 요청함 |
| `/finance` | 계약·변경공사(승인만 계약 반영)·기성·입금·미수 |
| `/report` | 대표자 보고서 (인쇄/PDF) |
| `/partner` | 발주처·협력사 포털 (진행률·요청·회신, 내부 금액 비노출) |
| `/evidence` | Proof Event · Money KPI 3 · 12주 실증 계획 |
| `/settings` | 테마·글자·권한 매트릭스·데이터(CSV)·AI 상태·위험 기준 |
| `/admin` | **LIVE** 운영 관리 — 현장 · 사용자 · 공무 확인 · 운영 설정 |
| `/login` · `/setup` · `/account` | **LIVE** 로그인 · 최초 설정 · 내 계정(비밀번호 변경) |
| `/why-ax` · `/presentation` | **DEMO** 기획의도 16 Section · 시연 모드 |

## 6. 구조

```
src/
  app/                 화면 (Next.js App Router) + api/ (LIVE 서버 API)
    api/auth/*         로그인·로그아웃·내 정보·비밀번호 변경
    api/setup          최초 설정
    api/state          역할별로 걸러진 데이터 (rev가 같으면 204)
    api/commands       모든 쓰기 — 이름 + 인자 → 서버에서 권한 확인 후 실행
    api/photos/[id]    사진 원본 (권한 확인)
    api/admin/members  사용자 관리
  proxy.ts             로그인 안 된 화면 접근 → /login (LIVE)
  server/              LIVE 전용 (브라우저로 가지 않음)
    sql.ts             DB 연결 (Supabase Postgres / 내장 PGlite) · 자동 스키마 적용
    migrations.ts      스키마 (= supabase/migrations/001_init.sql)
    state.ts           DB ↔ 화면 데이터 변환 · 바뀐 것만 저장 · 사진 분리 저장
    auth.ts            비밀번호 해시 · 세션 · 잠금
    authz.ts           역할별 실행 권한 · 역할별 데이터 걸러내기
    service.ts         명령 실행(회사 단위 잠금 → 권한 → 같은 명령 함수 → 저장) · 사용자 관리
  components/
    admin/             운영 관리 (현장·사용자·공무 확인·운영 설정)
    auth/              로그인·설정 화면 틀
    shell/ device/ tour/ domain/ ui/
  lib/
    mode.ts            DEMO / LIVE 구분 (빌드 시 고정)
    domain/            types · calc(EAC/이익/미수) · risk(RULE v1) · format · csv · labels
    data/              commands · adminCommands (모든 쓰기 규칙 — DEMO·LIVE 공용) · registry · store · seed
    ai/provider.ts     AI 연결 지점 (READY, 실제 호출 없음)
supabase/migrations/   001_init.sql (앱 스키마와 같은지 단위 테스트로 확인)
tests/unit             계산·명령·위험 규칙·서버(DB·로그인·권한) — vitest
tests/e2e              DEMO 시연 흐름 — Playwright
tests/e2e-live         LIVE 운영 흐름 (새 DB에서 처음부터) — Playwright
```

핵심 설계: 화면과 서버가 **같은 명령 함수**(`src/lib/data/commands.ts`)를 씁니다. DEMO에서는 브라우저가 실행해 브라우저에 저장하고, LIVE에서는 서버가 권한을 확인한 뒤 같은 함수를 실행해 DB에 저장합니다. 그래서 시연에서 검증한 계산이 운영에서도 그대로입니다.

## 7. 테스트

```bash
npm test                          # 단위 38 (계산·명령·위험 규칙·테마 대비 + 서버 DB·로그인·권한 23)
npm run build && npm run e2e      # DEMO E2E 20 (포트 3100)
npm run build:live && npm run e2e:live   # LIVE E2E 9 (새 내장 DB, 포트 3300)
QA_BASE_URL=http://127.0.0.1:3000 npm run qa:cuesheet   # 시연 큐시트 숫자 53개 (DEMO 서버 실행 중일 때)
```
- 서버 테스트는 내장 PGlite로 실제 Postgres SQL을 실행합니다. **Supabase 실제 연결은 계정이 생긴 뒤 1회 확인이 필요합니다.**
- Playwright 브라우저가 없다면 `npx playwright install chromium`
- 테스트 서버가 남아 있으면(`reuseExistingServer`) 이전 빌드를 테스트하게 되니, 빌드 후에는 실행 중인 `next start`를 끄고 돌리세요.

## 8. 알려진 한계 (LIVE 1차)
- 사진은 DB에 저장(1장 2.5MB 이하, 휴대폰에서 960px로 줄여 올림). 사진이 수천 장을 넘으면 Supabase Storage로 옮기는 것을 권장
- 비밀번호 찾기(이메일) 없음 — 관리자 초기화로 대체
- 데이터 동기화는 5초 간격 확인 + 화면 복귀 시 즉시 확인 (실시간 푸시 아님)
- 회사 1개 전용 (여러 회사를 한 서버에서 쓰는 구조는 DB에는 있으나 화면·과금 없음)
- 백업: Supabase 무료 플랜은 자동 백업이 없고, 일정 기간 사용이 없으면 프로젝트가 일시 정지될 수 있습니다. **실제 운영은 유료 플랜(일일 백업)을 권장** — 요금·조건은 Supabase에서 최신 확인

## 9. 이번 범위에서 제외
실제 회계 ERP·은행 연동, 전자세금계산서, BIM/도면 견적, 영상 AI, 발주처 결제·전자계약, 멀티테넌트 과금, 정책자금 신청 자동화, 특허 성과 주장, AI 예측 정확도 주장, 실제 LLM 호출, 이메일·카카오 알림, Native App.

실제 AI 1개 기능(현장 위험요인 요약)은 **대표 명시 승인 + 서버 전용 API 키**가 있을 때만 `src/lib/ai/provider.ts` 인터페이스에 맞춰 서버 Route 1개로 추가합니다. 산술은 계속 코드가 담당합니다.
