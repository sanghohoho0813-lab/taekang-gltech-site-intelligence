# PROJECT_SPEC — TAEKANG SITE INTELLIGENCE

> (주)태강지엘텍 · 창호·유리·커튼월 공사 현장 수익·공정관리 AX + 발주처/협력사 포털 **시연용 Interactive MVP**
> 작성: 2026-10-23 · 목표 시연일: **2026-10-27(화) 대표자 미팅**
> 상태: **DEMO** — 모든 금액·현장·인물은 가상 시연 데이터. 태강지엘텍 실제 실적이 아님.

---

## 0. Source Priority (실행 규칙)

| 순위 | 문서 | 적용 범위 |
|---|---|---|
| 1 | 사용자 최신 지시 (2026-10-23 채팅) | 화요일 시연 P0 흐름 최우선, 허위 실증·가짜 API 금지 |
| 2 | `docs/태강지엘텍_ClaudeCode_AX플랫폼_MVP_통합프롬프트_261023.md` | 사업·기능 요구사항, 화면, 계산식, DoD |
| 3 | Unified v4.1 Device View Override (마스터 1~397행) | PC / Mobile / PC+Mobile, 동일 Route·Data·State |
| 4 | Unified v4.0 Override (401~931행) | Evidence-First, Grouped IA, 7 Theme, Motion Gate |
| 5 | AX Penguin 3.0 Strategic Layer / v3.0 Hybrid·QA Override | Strategic P0, Dual Score, Red Team |
| 6 | 마스터 나머지 상속 규칙 | 충돌하지 않는 범위 |
| 7 | `docs/references/*.png` | Customer/AX Visual 방향 (Front Reference First) |

**적용하지 않는 구버전 문구 (SUPERSEDED, 마스터 내 잔존 확인):**
- "Desktop에서는 Mobile 보기만 제공" (마스터 3049 / 8021 / 11162행) → v4.1 3모드로 대체
- "Theme 3종 / 최소 3 Preset" (3413 / 3586 / 3694 / 11643 / 11977행) → Canonical 7 전수
- "AI Ready 3~6곳 필수" (3624 / 5119 / 6538 / 6580 / 11700행) → AI Fit 통과 1~6개, 0개 허용
- "Olive / Cocoa Theme" 검사 문구 (2921 / 2982 / 11001행 등) → 현 Canonical 7에 없음, 05 Deep Teal·06·03·04로 대체 검사
- Dashboard Module Color의 Violet/Rose (4651 / 4657행) → Group Hue 4색 체계로 대체 (Rainbow 금지)

---

## 1. PASS 1-A — HYBRID STRATEGY LOCK

> 아래 전략 항목은 **미팅 전 가설**이다. 실제 고객 데이터·인터뷰가 없으므로 Baseline은 전부 `UNKNOWN`으로 둔다.

### AX VERDICT
`GO 가설 (미팅에서 검증)` — 근거: 공사 현장은 계약·원가·기성·변경공사 데이터가 현장마다 반복 생성되고, 현장 1곳의 이익률 몇 %p 변동이 금액상 크다. 단, 실제 현장 수·관리 방식·데이터 위치를 확인하기 전까지 FULL/LITE를 확정하지 않는다.

### CAPITAL INDEPENDENCE TEST
`YES 가설` — 정책자금이 없어도 "원가 초과·설계변경 미청구를 월말/준공 전에 조기 발견"하는 것 자체가 현장 이익을 지키는 경제적 이유가 된다. 실제 효과 금액은 Baseline 확보 후에만 말한다.

### PRIMARY CONSTRAINT (MONEY LEAK)
```
현재 현장별 계약·예산·자재·인건비·공정·변경공사·기성·입금 정보가 엑셀·메신저·담당자 기억에 분산되어 있어,
대표와 본사가 [현장이 실제로 돈을 버는지 / 어디서 이익이 줄고 있는지 / 청구하지 못한 변경공사가 있는지]를
늦게 알게 되고 그 결과 이익 감소와 청구 누락이 발생할 위험이 있다.
이번 프로젝트의 핵심은 "현장 원가 입력 1회 → 손익 자동 재계산 → 위험 감지 → 담당자 조치 → 기록"으로 이를 줄이는 것이다.
```
핵심 기능의 약 70%가 이 Constraint와 직접 연결된다 (원가 입력, EAC 재계산, 위험 규칙, 조치, Proof Event, 보고서).

### PROCESS REDESIGN

| 현재 단계(가설) | 문제 | 제거 | 표준화 | 디지털화 | 자동화 | AI 필요 | 최종 상태 |
|---|---|---|---|---|---|---|---|
| 현장 일보 카톡/문자 보고 | 비용 정보가 글 속에 묻힘 | 중복 보고 제거 | 일보 양식 통일 | 모바일 현장보고 | 비용 → 원가이벤트 자동 생성 | 불필요 | 1회 입력 |
| 본사 엑셀 원가 집계 | 월말에야 집계 | 재입력 제거 | 원가 항목 5종 | 공통 DB | EAC 자동 재계산 | 불필요(RULE) | 실시간 손익 |
| 대표 구두 보고 | 판단 지연 | — | 위험 기준 명문화 | 위험 신호 | 규칙 기반 감지 | 요약은 향후 LLM(NEXT) | 대표 대시보드 |
| 설계변경 추가비용 | 청구 누락 위험 | — | 사유 유형 분류 | 변경공사 후보 | 청구 검토 조치 자동 제안 | 불필요(RULE) | 청구 검토 Loop |
| 발주처 문의·요청 | 전화/메일 분산 | — | 요청 양식 | 파트너 포털 | 내부 요청함 반영 | 불필요 | 양방향 상태 공유 |

### CORE VALUE 3
1. **Cost** — 현장 원가 초과를 늦지 않게 발견 (EAC 실시간 재계산)
2. **Revenue** — 설계변경·추가공사 청구 누락 방지, 미수금 관리
3. **Scale** — 본사 인원 증가 없이 더 많은 현장을 같은 기준으로 관리

### MONEY KPI 3 (BASELINE: REQUIRED / UNKNOWN · TARGET: DO NOT INVENT)
| 구분 | KPI | 측정 지점 |
|---|---|---|
| COST | 원가 초과 인지 리드타임 (현장 발생 → 본사 인지, 일) | `cost_entries.created_at` ↔ `risk_signal` 감지 ↔ `actions.created_at` |
| REVENUE | 설계변경 추가원가 대비 청구 검토 전환율 (%) | 사유=설계변경 원가 합계 vs `change_orders` 등록 금액 |
| SCALE | 본사 관리자 1인당 관리 현장 수 / 월 손익 집계 소요시간 | 사용자·현장 수, 월말 보고 작성 시간 (도입 전 인터뷰 필요) |

### CUSTOMER PRIMARY CONVERSION (Partner Surface)
발주처/협력사 담당자가 **전화 없이 변경공사 검토 요청 1건을 등록하고, 처리 상태와 회신을 포털에서 확인**하는 것.

### CUSTOMER EVENT → AX MAP
| Partner Event | AX 반영 | 처리 | Partner 피드백 |
|---|---|---|---|
| 변경공사 검토 요청 등록 | `/insights` 요청함 + 현장 상세 요청 탭 + 알림 | 관리자 검토 시작 → 회신(변경공사 후보 등록 가능) | 포털 상태 `접수→검토 중→회신 완료` + 회신 내용 |

### SHARED DATA ASSET / SSOT
| Entity | System of Record | 입력 주체 | 갱신 | 민감도 | AI 사용 |
|---|---|---|---|---|---|
| sites / site_contracts | 본사 | 관리자 | 계약 시 | 중 | 요약만 |
| cost_budgets / cost_forecasts | 본사 | 관리자 | 계약·재추정 | 높음(원가) | 규칙 |
| cost_entries | 현장 | 현장직원/관리자 | 수시 | 높음 | 규칙 |
| progress_updates / site_photos | 현장 | 현장직원 | 일보 | 중 | NEXT |
| change_orders | 본사 | 관리자 | 수시 | 높음 | 규칙 |
| progress_billings / payments_received | 본사 | 관리자 | 월 | 높음 | 규칙 |
| partner_requests | 발주처·협력사 | 파트너 | 수시 | 중(파트너 본인 건만) | — |
| risk signals | 계산값(파생) | 시스템 | 데이터 변경 시 | 높음 | 규칙 |
| actions / proof_events / activity_logs | 본사 | 관리자/현장 | 수시 | 중 | — |

MVP에서의 저장소: **브라우저 로컬 DEMO 저장소** (`localStorage`, 같은 Origin의 PC·Mobile Frame이 공유). 운영 DB가 아니다. Supabase 스키마·RLS는 `supabase/migrations`에 READY 상태로 준비.

### AI METHOD MATRIX
| 기능 | Business Question | Input | Method | Output | Why | Error Cost | Approval | Evidence |
|---|---|---|---|---|---|---|---|---|
| EAC·예상이익·이익률 | 이 현장은 지금 얼마 남는가 | 계약, 승인변경, 원가이벤트, 잔여예상 | RULE (결정론적 코드) | 금액·% | 산술은 LLM에 맡기지 않음 | HIGH | — | 계산식 표시 |
| 이익률 하락 감지 | 계획 대비 얼마나 줄었나 | 계획/현재 이익률 | RULE (임계 3%p) | 위험 신호 | 기준이 명확 | MID | 관리자 확인 | proof_event |
| 원가항목 예산 초과 | 어느 항목이 넘었나 | 항목별 예산 vs EAC | RULE (5%) | 위험 신호 | 단순 비교 | MID | 관리자 | proof_event |
| 공정 대비 원가 과다 | 진척보다 돈이 먼저 나가나 | 공정률 vs 원가진척률 | RULE (10%p) | 위험 신호 | 단순 비교 | MID | 관리자 | — |
| 설계변경 청구 검토 | 받을 수 있는 돈을 놓치나 | 사유=설계변경 원가, 변경공사 등록 여부 | RULE | 청구 검토 조치 제안 | 사유 분류로 충분 | HIGH(금전) | **사람 승인 필수 (L3)** | proof_event |
| 미수·미승인 변경공사 | 돈이 묶여 있나 | 기성·입금·경과일 | RULE | 위험 신호 | 단순 비교 | MID | 관리자 | — |
| 위험요인 자연어 요약 | 대표에게 무엇을 먼저 말할까 | 위 신호·근거 | LLM — **NEXT (미연결, AI Ready)** | 요약문 | 여러 신호 종합 설명 | LOW~MID | L1 Assist | — |

Automation Level: 모든 조치는 **L2 Recommend → L3 사람 승인**. L4 자동 실행 없음.

### PROOF PLAN
`Mission → Action → Result → Proof Event` 구조를 실제 클릭으로 생성. Demo에서 생성된 Proof Event는 `data_source = DEMO_LOCAL`로 저장·표시하고 **실증 성과로 표현하지 않는다.** 12주 실증 계획은 `EVIDENCE_PLAN.md`.

### PORTAL / PLATFORM READINESS
`MID 가설` — 발주처·협력사와의 변경공사·진행현황 공유는 업계 공통 문제이고 표준화 가능성이 있으나, 태강지엘텍이 플랫폼 사업자가 될 중립성·네트워크는 미확인. 이번엔 **경량 상태 포털**만 구현.

### FUTURE EXPANSION (NEXT · 미구현 · Preview Sheet)
1. 전자 기성 승인 (발주처) 2. 협력사 자재 납품 일정 공유 3. 하자보수 요청·이력 4. 다현장 통합 리포트 구독(B2B)

### MOAT CANDIDATE
현장별 원가 이벤트 + 사유 + 조치 + 결과가 연결된 **커튼월·창호 공사 원가 이력 데이터**, 회사 고유 위험 기준(Workflow), 발주처 요청 이력. (Next.js/Supabase 등 기술스택은 Moat가 아님)

### RISK
- 데모 수치가 실제 실적으로 오인될 위험 → 전 화면 `DEMO · 가상 시연 데이터` 배지, 보고서 머리말 고지
- Demo Role은 권한 **프리뷰**이며 보안이 아님 → Settings·Role 선택기에 명시
- 로컬 저장소는 기기 간 동기화 안 됨 → 같은 브라우저(PC+Mobile 3모드)에서 시연

### NOT BUILDING THIS PHASE
실제 회계 ERP·은행 연동, 전자세금계산서, BIM/도면 견적, 영상 AI, 발주처 결제·전자계약, 멀티테넌트 과금, 정책자금 신청 자동화, 특허 성과 주장, AI 예측 정확도 주장, 실제 LLM 호출(키·승인 없음), 실제 Auth/RLS 활성화, Native App.

### STRATEGIC ACCEPTANCE
Strategic P0 0건: Demo≠Live 구분, Baseline 미날조, 규칙 기반을 AI로 포장하지 않음, 보장 표현 없음, 미래 기능 NEXT 분리.

---

## 2. PRODUCT DESIGN LOCK

### PROJECT FINAL OBJECTIVE (1차 MVP)
현장에서 모바일로 입력한 원가가 **같은 데이터**로 PC 대표 손익·위험 알림·관리자 조치·Proof Event·대표 보고서·파트너 상태까지 즉시 이어지는 것을 3~4분 안에 실제 조작으로 보여준다.

### Demo Scenario (반드시 재현)
가상 현장 A: 계약 **10억** · EAC **8.5억**(발생 5.1억 + 잔여 3.4억) · 예상이익 **1.5억** · 이익률 **15%**
→ 모바일 입력: 자재비 **3,000만** + 인건비(노무비) **1,000만**, 성격 = 실행예산 외 추가비용 (구 명칭: 예상 외 추가원가), 사유 = 설계변경·원청(발주처) 요청
→ EAC **8.9억** · 예상이익 **1.1억** · 이익률 **11%** · 이익 감소 **4,000만** (재계산)

### 계산식 (src/lib/domain/calc.ts — 단위 테스트로 고정)
- `발생원가 incurred_c = Σ 유효(cost_entries, category=c)`
- `잔여예상 remaining_c = max(0, forecast_remaining_c − Σ 유효 '계획 내 집행' entries_c)`
- `EAC = Σ_c (incurred_c + remaining_c)`
- 원가 이벤트 성격 `forecast_impact`:
  - `baseline` — 시드/기준 시점에 이미 잔여예상에 반영된 발생원가
  - `additional` — **예상 외 추가원가** → 발생 +, 잔여 그대로 → **EAC 증가**
  - `within_forecast` — **계획 내 집행** → 발생 +, 잔여 − → **EAC 불변** (중복 계산 금지)
- `조정 계약금액 = 계약금액 + Σ change_orders(status = approved)` — 요청·검토·청구 중 금액은 **가산하지 않음**
- `예상이익 = 조정 계약금액 − EAC`, `예상이익률 = 예상이익 / 조정 계약금액 × 100`
- `미수금 = Σ 확정 기성청구 − Σ 실제 수금`
- 표시: 모든 금액 **공급가액 기준, 부가세 별도** · 단위(원/만 원/억 원) 명시

### Roles (Demo 권한 프리뷰 — 실제 보안 아님)
| Role | 가상 사용자 | 접근 |
|---|---|---|
| 대표자 `ceo` | 대표자 (DEMO) | 전체 |
| 본사관리자 `manager` | 박관리 과장 (가상) | 전체 (설정 포함) |
| 현장직원 `field` | 최현장 소장 (가상) | 현장보고, 내 조치, 현장 상세(손익·계약금액 숨김), 설정(표시만) |
| 발주처·협력사 `partner` | 가상 발주처 A 담당자 | `/partner` 전용 (내부 원가·이익·미수·타 현장 비노출) |

### Business IA — Grouped Sidebar (4 Group / 12 Primary)
```
[운영 · Blue #5B8DEF]      대시보드 /dashboard · 현장 관리 /sites · 현장 보고 /field · 내 조치 /my-actions
[고객·정산 · Amber #D79A43] 기성·수금 /finance · 대표 보고서 /report · 발주처 포털 /partner
[AX·성과 · Teal #3C9A75]   위험 분석·조치 /insights · 실증 Evidence /evidence · 기획의도 /why-ax
[관리 · Slate #718096]     설정 /settings · 시연 모드 /presentation
```
Mobile Bottom Nav (role별 4+더보기): 대표/관리자 `홈·현장·위험조치·보고서·더보기`, 현장직원 `현장보고·내 조치·내 현장·더보기`, 파트너 `현장현황·요청·더보기`.

### Routes & Feature Inventory
| Route | 목적 | Primary Action | Role |
|---|---|---|---|
| `/dashboard` | 대표 5초 판단 | 위험 현장 클릭 → 상세 | ceo, manager (field→현장 홈 대체) |
| `/sites`, `/sites/[id]` | 현장 손익·원가·공정·계약·기성·보고·요청 | 현장보고·비용 입력(Sheet), 원가 무효/수정 | 전체 내부 (field는 손익 숨김) |
| `/field` | 모바일 현장보고 허브 | 보고 등록 (비용 포함) | field, manager, ceo |
| `/my-actions` | 배정된 위험조치 처리 | 진행 시작 / 완료 보고 | field(본인), manager/ceo(전체) |
| `/insights` | 규칙 기반 위험·조치 보드·파트너 요청함 | 조치 생성·배정·상태·완료·결과확인 | ceo, manager |
| `/finance` | 계약/변경/기성/입금/미수 | 변경공사 승인·반려, 기성·입금 등록 | ceo, manager |
| `/report` | 대표자 실시간 보고서 | 인쇄 | ceo, manager |
| `/partner` | 발주처·협력사 상태 포털 | 변경공사 검토 요청 등록 | partner (+데모 관리자 Preview) |
| `/evidence` | Proof Event·KPI·12주 계획 | 결과 확인 | ceo, manager |
| `/why-ax` | 회사 맞춤 기획의도 14 Section | 대시보드 복귀 | 내부 전체 |
| `/settings` | Theme 7·글자·모션·Role·Reset·CSV·AI상태 | Demo Reset, CSV 가져오기 | 전체 (파트너는 Role 전환만) |
| `/presentation` | 실제 Route Guided Demo 6 Step | 시연 시작 | ceo, manager |

### Product Shell Parity Matrix
| 기능 | Desktop | 실제 Mobile | Device View(Mobile Frame) | Discoverable | Behavior Parity |
|---|---|---|---|---|---|
| 전체 Navigation | Sidebar 4 Group | Bottom Nav + Drawer(같은 Group 색) | 동일 | ✓ | ✓ |
| 날짜 + 현재시각(초) | Header | Header 압축 `10.23 금 14:32:08` | 동일 | ✓ | ✓ |
| Theme 7 | Settings | Settings | 부모와 상태 공유 | ✓ | ✓ |
| Font Scale | Settings | Settings | 공유 | ✓ | ✓ |
| Role Preview | Demo Bar + Settings | Drawer + Settings | 공유(옵션: 모바일 시연 역할) | ✓ | ✓ |
| Tutorial | Settings·Header | Settings | Frame 안 Tour 금지(부모만) | ✓ | ✓ |
| Why / Story | Sidebar | Drawer | 동일 | ✓ | ✓ |
| Demo Reset | Demo Bar + Settings | Settings | 공유 | ✓ | ✓ |
| Surface Switch | Demo Bar | Drawer | 동일 | ✓ | ✓ |

### Device View (v4.1)
- `[PC] [Mobile] [PC+Mobile]` — Demo Control Bar(최상단 얇은 바, ≥1024px)에 배치, 선택값 `localStorage` 유지
- Mobile Frame = **같은 앱·같은 Route를 390px iframe**으로 렌더 (`?frame=mobile`), 높이 `min(844px, 화면높이−여백)`
- PC+Mobile = PC 67% : Mobile 33%(최소 430px), 우측 sticky, PC 영역 `min-width:0` + `overflow-x:clip` + Container Query
- Route Sync = `postMessage {type:'tk:route', path}` · `origin === location.origin` · `source === iframe.contentWindow` · 동일 경로 재이동 금지
- Frame Context(`window.self !== window.top`) = Device Switch·Demo Bar·Tour·추가 iframe 생성 금지
- Data Sync = 같은 Origin `localStorage` + `BroadcastChannel('tk-site-intel')` + `storage` 이벤트

### Theme (Canonical 7 × 6 Color)
01 Deep Navy Blue · 02 Navy Gold · 03 Emerald Gold · 04 Forest Sage · 05 Deep Teal · **06 Onyx Gold (기본, 태강 오렌지 튜닝)** · 07 Pure White
- 06은 참고 시안(다크 차콜 Shell + 절제된 오렌지)에 가장 가까운 Seed. 마스터 6절 "Default Seed 선택 후 브랜드 Hue 미세조정 허용"에 따라 **Accent `#B89032`→`#E25A1C`, Highlight `#E0C76F`→`#F3B07E`만 조정**, 나머지 6개 Theme는 원본값.
- Neutral(본문·표·폼·모달)·Semantic(성공/경고/오류/정보)·Group Icon Hue는 Theme와 분리.
- 회사 로고 마크 오렌지는 Brand Token(의도적 고정).

### PROJECT SIGNATURE (Anti-Template, 3+)
1. **현장 손익 엔진 카드** — `발생원가 + 잔여예상 = EAC → 예상이익` 분해 바(계산식 노출)
2. **Cost Event Pulse** — 모바일 저장 순간 PC 손익 카드가 이전값→새값으로 재계산 표시 + 변화 칩(▼4,000만)
3. **커튼월 파사드 일러스트** (실제 사진 아님 표기) + 다크 차콜/오렌지 브랜드 레이어
4. **설계변경 청구 검토 Loop** — 추가원가 사유 → 청구 검토 조치 → 변경공사 후보(미승인, 이익 미반영) → 승인 시 시뮬레이션 분리 표시

### Visual Reference Map
- Reference Status: **PROVIDED** (`docs/references/taekang_front_pc.png`, `taekang_front_mobile.png`, 과거 시안 — 최종 화면 아님)
- Must Preserve: 다크 차콜 Sidebar(#15171C~#181E22) + 오렌지 Active 틴트, 순백 Card Surface, 상단 태그라인 + 큰 `태강지엘텍 AX` 타이틀, KPI 5카드(아이콘 타일·큰 숫자·증감), 탭 필터 Pill, 오렌지 진행 바, 상태 Pill(정상/주의/긴급 — 텍스트 동반), 모바일 현장상세(대표 이미지·탭·도넛 공정률)·현장보고(날짜·작업내용·사진 3+추가·이슈 경고박스·하단 `임시저장 / 보고 등록`)
- Adapt: 메뉴 구조(4 Group), KPI 내용(계약·예상이익·미수·위험), 차트(현장별 이익률·기성/수금), 모바일 보고에 **추가 비용 입력** 추가
- Do Not Copy: 시안의 가상 수치(24개 현장, 3,482억 등), 실명처럼 보이는 현장명·발주처명, 출처 불명 사진

### Typography
Root 19px(기본) / 17.1px(작게) / 21.3px(크게), 모바일 Root 18px 기준. Pretendard Variable(로컬 번들). `word-break: keep-all`, 숫자 `tabular-nums`.

### Demo / Live
전 화면 `DEMO · 가상 시연 데이터` 배지 + Data Freshness(`DEMO · 브라우저 로컬 저장소 · 마지막 업데이트 hh:mm:ss`). AI 상태 = `규칙 기반 진단 (AI API 미연결)`.

---

## 3. CORE / CONDITIONAL / PLUS

**CORE (P0)**: Shell·Device View 3모드·7 Theme 구조, Seed 3현장 + 계산 엔진, 대시보드, 현장 상세, 모바일 현장보고·비용 입력, 위험 규칙, 조치 배정·상태·완료, Proof Event, 대표 보고서, Demo Reset, 파트너 요청 Closed Loop, Role 프리뷰, DEMO 표기, Why AX, 기본 접근성·반응형·Empty/Loading/Error.
**CONDITIONAL**: Supabase 실 DB/RLS (키 없음 → READY), 실제 AI API (키·승인 없음 → NEXT), 사진 첨부(브라우저 로컬, 축소 저장).
**PLUS (P1)**: CSV 가져오기/내보내기, Presentation Mode, 7 Theme 전수 QA, 12주 Evidence 계획, 차트·모션 완성도, 인쇄형 보고서, 잔여예상원가 재추정.

## 4. Acceptance (전용 프롬프트 11절 DoD + 마스터 Gate)
`QA_REPORT.md`에 항목별 PASS/FAIL과 근거를 기록한다. Strategy Score / Product Score 별도.
