# PROJECT_STATE — TAEKANG SITE INTELLIGENCE

> 기준일: 2026-10-31 · 10/27 대표자 미팅 시연 완료 → **실제 운영(LIVE) 전환 개발 1차 완료**
> 단계: **LIVE 1차 (Phase 2)** — 로그인·서버 DB·서버 권한·운영 관리 동작. **운영 배포 전** (Supabase·Vercel 계정 필요) · 실사용자·실데이터 아직 없음
> 브랜치: `ccr-30b16665-v55wk6`

---

## 0. 한 줄 상태
**10/31 Phase 2**: 같은 소스가 DEMO(영업 시연)와 LIVE(실제 운영)로 나뉘어 동작합니다.
- LIVE에서 동작하는 것: 이메일 로그인, 서버 DB(Supabase Postgres / 로컬 내장 PGlite), 서버에서 강제하는 역할 권한(현장소장·발주처에게 금액 미전송), 노트북↔휴대폰 자동 동기화(5초), 운영 관리(현장 등록·사용자·공무 확인·운영 설정), 노무 공수 입력, 공정률 입력.
- 검증: 단위 38(서버 23 포함) · LIVE E2E 9 · DEMO E2E 20 · 큐시트 53 · `npm audit` 0.
- 남은 것: **Supabase·Vercel을 태강지엘텍 명의로 만들고 배포**(README 2절), 실기기(iPhone Safari·Android) 확인, 첫 현장 1곳 등록.

(10/26까지 DEMO 기록)
모바일 현장 원가 입력 → 공통 저장 → PC 현장 손익 재계산 → 규칙 기반 위험 감지 → 조치 배정·완료 → Proof Event → 대표 보고서(+ 발주처 요청 Closed Loop)가 **같은 데이터로 실제 동작**하며, 단위 15 · E2E 20 · 큐시트 53 · 예외 상황 20 · axe 0 · Console Error 0으로 검증됨. 10/26: 기본 화면과 시연 모드 6단계를 모두 PC+Mobile로 바꾸고 단계마다 휴대폰 화면(대표 ↔ 현장소장)이 달라지도록 개선 (D-16). 남은 것은 **배포(사용자 계정 필요)와 사람 리허설**.

## 1. 진행 단계

| Phase | 내용 | 상태 |
|---|---|---|
| 1 | 문서 정독, PASS 1 전략·설계 잠금 (`PROJECT_SPEC.md`) | ✅ |
| 2 | 도메인 모델·Seed·계산·위험 규칙·DEMO 저장소 + 단위 테스트 | ✅ |
| 3 | App Shell·7 Theme·Device View(PC/Mobile/PC+Mobile) | ✅ |
| 4 | P0 흐름 화면 (대시보드·현장 상세·현장 보고·위험/조치·Proof·보고서) | ✅ |
| 5 | 발주처 포털 Closed Loop·기성/수금·설정(CSV)·Why AX·Evidence·시연 모드/튜토리얼 | ✅ |
| 6 | QA (E2E·반응형·Theme·axe·Console·성능·큐시트), Red Team 1회, 문서 | ✅ |
| 6-1 | 대표 피드백: 처음부터 PC+Mobile, 시연 단계별 휴대폰 화면 차별화 | ✅ (10/26) |
| 6-2 | 업종 현실성 리뷰 반영(D-17) + 예외 상황 테스트 20건 + 보고서 인쇄 오류 수정 | ✅ (10/26) |
| 6-3 | 시연 모드 원클릭 + 시작할 때마다 초기화 (D-18) | ✅ (10/27) |
| 7 | DEMO Vercel 배포 · 리허설 | ⏳ USER ACTION |
| P2-1 | 서버 DB 계층·스키마·저장·명령 레지스트리·권한·역할별 데이터 (D-19·D-20) | ✅ (10/31) |
| P2-2 | 로그인·세션·최초 설정·로그인 안 된 접근 차단·API | ✅ |
| P2-3 | LIVE 화면 (서버 실행·자동 동기화·세션 역할·DEMO 요소 숨김) | ✅ |
| P2-4 | 운영 관리 (현장·사용자·공무 확인·운영 설정) + 노무 공수·공정률 (D-21) | ✅ |
| P2-5 | 테스트 (서버 통합·LIVE E2E) · 운영 시작 보호 장치(D-22) · 배포 가이드 | ✅ |
| P2-6 | **운영 배포** (Supabase·Vercel, 태강지엘텍 명의) | ⏳ **USER ACTION** |
| P2-7 | 실기기 확인 + 첫 현장 1곳 등록 + 현장소장 1명 2주 사용 | ⏳ USER ACTION |

## 2. STRATEGIC GATES
| Gate | 상태 |
|---|---|
| Demo ≠ Live 구분 | ✅ 전 화면 DEMO 표기, 저장소 상태 표시 |
| Baseline 날조 금지 | ✅ KPI 3종 `UNKNOWN`, 개선율 미산출 |
| 규칙 기반을 AI로 포장 금지 | ✅ `규칙 기반 진단 · RULE v1`, AI는 `연결 예정` |
| 보장 표현 금지 | ✅ 정책자금·인증 결과 보장 없음 |
| 미래 기능 분리 | ✅ NEXT 미리보기로만 표시 |
| Strategic P0 | **0** |

## 3. PRIMARY CONSTRAINT STATUS
- 정의: 현장별 원가·변경공사·기성 정보 분산 → 이익 감소·청구 누락을 늦게 인지 (`PROJECT_SPEC.md` 1절)
- 상태: **가설** — 미팅에서 실제 현장 수, 현재 집계 방식(엑셀·카톡), 최근 설계변경 청구 누락 사례 유무를 확인해야 함 (`/why-ax` 마지막 섹션 "미팅에서 함께 확인할 것")

## 4. MONEY KPI / BASELINE STATUS
| KPI | 측정 지점 구현 | Baseline |
|---|---|---|
| COST 원가 초과 인지 리드타임 | ✅ `cost_entries.date` → 조치 생성 시각 | UNKNOWN |
| REVENUE 설계변경 → 청구 검토 전환율 | ✅ 사유=설계변경 원가 ↔ `change_orders.sourceEntryIds` | UNKNOWN |
| SCALE 관리자 1인당 현장 수·월 집계 시간 | △ 사용자·현장 수만 (집계 시간은 인터뷰 필요) | UNKNOWN |

## 5. DATA FOUNDATION
| 항목 | 상태 |
|---|---|
| 저장소 | DEMO: 브라우저 로컬 (`localStorage`). **LIVE: 서버 Postgres** — `records` jsonb + 회사 설정 + 사용자·세션 + 사진 원본 분리 (`src/server/migrations.ts` = `supabase/migrations/001_init.sql`) |
| 쓰기 경로 | 전부 `src/lib/data/commands.ts`·`adminCommands.ts`의 순수 함수 (검증·멱등 키·활동 로그). LIVE는 서버가 권한 확인 후 같은 함수 실행 (D-19) |
| 계산 | `src/lib/domain/calc.ts` — EAC = 발생 + 잔여, 이익 = 계약 + 승인 변경 − EAC, 이익률 = 이익 ÷ (계약 + 승인 변경), 미수 = 확정 기성 − 수금. 원 단위 정수 |
| 중복 계산 방지 | `forecast_impact` (baseline / additional / within_forecast) |
| 변경공사 | `approved`만 계약 반영, 나머지는 미반영 영역 + 승인 시 시뮬레이션 |
| CSV | 가져오기(검증)·내보내기·샘플 |
| Supabase | 코드 준비 완료 — 연결 문자열만 넣으면 첫 연결 때 스키마 자동 적용. **실제 Supabase 연결은 계정 생성 후 1회 확인 필요** (테스트는 같은 Postgres SQL을 내장 PGlite로 실행) |
| 기기 간 공유 | LIVE ✅ (5초 간격 + 화면 복귀 시) · DEMO ❌ |
| 원가 확정 | 운영 설정으로 선택: 저장 즉시 / 본사 공무 확인 후 (D-21) |

## 6. AI / LOGIC STATUS
| 기능 | 방식 | 상태 |
|---|---|---|
| 손익·EAC·미수 | 결정론적 코드 | ✅ 동작 |
| 위험 신호 7종 (이익률 하락·목표 미달·항목 초과·공정 대비 원가·설계변경 미청구·장기 미수·장기 승인 대기) | RULE v1 (기준값 `/settings`에서 조정) | ✅ 동작 |
| 조치 제안 | 규칙별 기본 조치 + 사람 승인 | ✅ 동작 |
| 위험요인 자연어 요약 | LLM | ⏳ NEXT — 키·대표 승인 없음, 호출 코드 없음 |

## 7. PROOF STATUS
- 조치 완료 → Proof Event 자동 생성(`recorded`) → 관리자·대표 결과 확인(`confirmed`) → 보고서·Evidence 반영 ✅
- 모든 기록 `data_source = DEMO_LOCAL` — 실증 성과 아님
- 스키마: `PROOF_EVENT_SCHEMA.md`

## 8. ADOPTION READINESS
- 현장직원 화면: 하단 탭(현장보고·내 조치·내 현장·더보기), 큰 글자, 데모 값 채우기, 임시 저장, 되돌리기
- 위험: 현장소장의 실제 입력 습관 미검증 → `AX_COACH_PLAN.md`

## 9. RISK / GOVERNANCE
| 위험 | 상태 |
|---|---|
| 권한 | DEMO: 권한 프리뷰(보안 아님, 화면에 명시). **LIVE: 서버에서 강제** — 실행 권한 + 역할별 전송 데이터 제한 + Origin 확인 (D-20) |
| 계정 | scrypt 해시, HttpOnly 세션(DB에는 해시), 30일, 8회 실패 잠금, 첫 로그인 비밀번호 변경, 비활성화 즉시 로그아웃 |
| 최초 설정 | Vercel 운영 배포는 `SETUP_CODE` 필수, 회사 0개일 때 1회만 (D-22) |
| DB 공개 API | 전 테이블 RLS ON·정책 없음 → Supabase anon key로 접근 불가 |
| 비밀키 | 코드·저장소에 키 없음, `.env.example`만. 서버 전용 키 규칙 명시 |
| 외부 노출 | 발주처 포털에 원가·이익·미수·타 현장 비노출 (E2E 검사) |
| 실명·실적 | 미사용 (가상 현장·가상 인물) |
| 사진 | 시드에 실제 사진 없음, 업로드 사진은 브라우저 안에서만 축소 저장 |
| 보안 헤더 | `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`, `nosniff`, Referrer-Policy |

## 10. PLATFORM READINESS
- 발주처 포털: 요청 등록 → 본사 검토·회신 → 포털 상태 갱신 (경량, P0 범위)
- 확장 4종(전자 기성 승인·협력사 납품 일정·하자보수·다현장 리포트 구독): NEXT 미리보기만
- 판단: `MID 가설` — 미팅에서 발주처 공유 수요 확인 후 결정

## 11. EVIDENCE STATUS
- `EVIDENCE_PLAN.md` — 12주 실증 계획(안), Week 0 Baseline Lock부터 시작
- 현재 실증 데이터: **없음**

## 12. RED TEAM FINDINGS
- 1회 실행 완료 (`QA_REPORT.md` 5절). P1 6건 수정, 수용 위험 8건 기록, P2는 `RECOMMENDATIONS.md`

## 13. USER ACTION QUEUE
### 운영 시작 (10/31~)
| 순서 | 할 일 | 담당 | 필요한 것 |
|---|---|---|---|
| 1 | 태강지엘텍 명의 GitHub·Supabase·Vercel 계정 준비, 미래AI랩에 구축 권한 초대 | 태강지엘텍 (대표 김상호 안내) | 회사 이메일 |
| 2 | Supabase 프로젝트(서울) 생성 → 연결 문자열 | 미래AI랩 | README 2-1 |
| 3 | Vercel 환경변수 3개 + 지역 서울 → 배포 | 미래AI랩 | README 2-2 |
| 4 | 최초 설정 (대표 계정) → 사용자·첫 현장 등록 | 태강지엘텍 대표 + 미래AI랩 | README 2-3·2-4, 실제 현장 1곳 계약·실행예산 |
| 5 | iPhone Safari·Android Chrome에서 현장소장 로그인·보고 1회 | 현장소장 1명 | 휴대폰 |
| 6 | 원가 반영 방식 결정 (저장 즉시 / 공무 확인 후)·노무 기본 일당 | 태강지엘텍 | 내부 확정 주체 |
| 7 | Supabase 유료 플랜(일일 백업) 여부 결정 | 태강지엘텍 | 비용 승인 |

### 10/27 미팅 전 기록 (DEMO)
| 시점 | 할 일 | 담당 | 필요한 것 |
|---|---|---|---|
| 미팅 전 | Vercel에서 저장소 Import → Deploy (환경변수 불필요) | 대표(김상호) | Vercel 계정 |
| 미팅 전 | 배포 주소로 `QA_BASE_URL=<주소> npm run qa:cuesheet` 또는 직접 큐시트 1회 리허설 | 대표 | 노트북 Chrome 1280px 이상 |
| 미팅 전 | iPhone Safari로 배포 주소 1회 열어 확인 | 대표 | 휴대폰 |
| 미팅 중 | Pilot 현장 1~2곳·참여자, 현재 원가 집계 방식, 설계변경 청구 이력 확인 | 대표 | `/why-ax` 마지막 섹션 |
| Pilot 시 | 실제 현장 원가 CSV 또는 Supabase 프로젝트·키 | 태강지엘텍 / 미래AI랩 | `README.md` 7절 |
| 선택 | AI 요약 1개 기능 승인 + API Key(서버 전용) | 대표 승인 | — |

## 14. 이번에 제외
실제 회계 ERP·은행 연동, 전자세금계산서, BIM/도면 견적, 영상 AI, 발주처 결제·전자계약, 멀티테넌트 과금, 정책자금 신청 자동화, 특허 성과 주장, AI 예측 정확도 주장, 실제 LLM 호출, 비밀번호 찾기 메일·카카오 알림, Native App.
(10/31: 실제 로그인·서버 권한은 LIVE 모드로 구현되어 제외 목록에서 뺌)
