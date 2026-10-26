# PROJECT_STATE — TAEKANG SITE INTELLIGENCE

> 기준일: 2026-10-23 · 다음 마일스톤: **2026-10-27(화) 대표자 미팅 시연**
> 단계: **DEMO MVP 완료 (First Build)** — 실데이터·실사용자 없음 · 배포 URL 없음
> 브랜치: `ccr-30b16665-v55wk6`

---

## 0. 한 줄 상태
모바일 현장 원가 입력 → 공통 저장 → PC 현장 손익 재계산 → 규칙 기반 위험 감지 → 조치 배정·완료 → Proof Event → 대표 보고서(+ 발주처 요청 Closed Loop)가 **같은 데이터로 실제 동작**하며, 단위 15 · E2E 20 · 큐시트 숫자 51 · axe 0 · Console Error 0으로 검증됨. 10/26: 기본 화면과 시연 모드 6단계를 모두 PC+Mobile로 바꾸고 단계마다 휴대폰 화면(대표 ↔ 현장소장)이 달라지도록 개선 (D-16). 남은 것은 **배포(사용자 계정 필요)와 사람 리허설**.

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
| 7 | Vercel 배포 | ⏳ **USER ACTION** (계정 연결 필요) |
| 8 | 사람 리허설 3~4분 1회 | ⏳ **USER ACTION** (미팅 전) |

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
| 저장소 | DEMO 로컬 (`localStorage` `tk-site-intel:db:v1`) + BroadcastChannel로 PC·모바일 프레임 동기화 |
| 쓰기 경로 | 전부 `src/lib/data/commands.ts`의 순수 함수 (검증·멱등 키·활동 로그) |
| 계산 | `src/lib/domain/calc.ts` — EAC = 발생 + 잔여, 이익 = 계약 + 승인 변경 − EAC, 이익률 = 이익 ÷ (계약 + 승인 변경), 미수 = 확정 기성 − 수금. 원 단위 정수 |
| 중복 계산 방지 | `forecast_impact` (baseline / additional / within_forecast) |
| 변경공사 | `approved`만 계약 반영, 나머지는 미반영 영역 + 승인 시 시뮬레이션 |
| CSV | 가져오기(검증)·내보내기·샘플 |
| Supabase | 스키마·RLS SQL READY, 미실행. `Repository` 인터페이스로 교체 가능 |
| 기기 간 공유 | ❌ (노트북 ↔ 휴대폰 불가) — Supabase 전환 후 |

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
| 권한 | Demo 역할 전환 = **권한 프리뷰** (실제 보안 아님, 화면에 명시) |
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

## 13. USER ACTION QUEUE (미팅 전 → 후 순서)
| 시점 | 할 일 | 담당 | 필요한 것 |
|---|---|---|---|
| 미팅 전 | Vercel에서 저장소 Import → Deploy (환경변수 불필요) | 대표(김상호) | Vercel 계정 |
| 미팅 전 | 배포 주소로 `QA_BASE_URL=<주소> npm run qa:cuesheet` 또는 직접 큐시트 1회 리허설 | 대표 | 노트북 Chrome 1280px 이상 |
| 미팅 전 | iPhone Safari로 배포 주소 1회 열어 확인 | 대표 | 휴대폰 |
| 미팅 중 | Pilot 현장 1~2곳·참여자, 현재 원가 집계 방식, 설계변경 청구 이력 확인 | 대표 | `/why-ax` 마지막 섹션 |
| Pilot 시 | 실제 현장 원가 CSV 또는 Supabase 프로젝트·키 | 태강지엘텍 / 미래AI랩 | `README.md` 7절 |
| 선택 | AI 요약 1개 기능 승인 + API Key(서버 전용) | 대표 승인 | — |

## 14. 이번에 제외 (변동 없음)
실제 회계 ERP·은행 연동, 전자세금계산서, BIM/도면 견적, 영상 AI, 발주처 결제·전자계약, 멀티테넌트 과금, 정책자금 신청 자동화, 특허 성과 주장, AI 예측 정확도 주장, 실제 LLM 호출, 실제 Auth/RLS 활성화, Native App.
