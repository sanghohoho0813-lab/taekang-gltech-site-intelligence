# 미래AI랩 AX + Platform Unified Design & Development System v4.1
## AX + Customer Platform 단독 사용용 · Full-Fidelity Strategic/Product Master Source of Truth

> **Version:** v4.1  
> **Date:** 2026-09-22  
> **Role:** 세 파일 중 가장 크고 가장 높은 우선순위를 가진 최상위 Master  
> **사용 원칙:** 이 파일 하나만으로 회사 전략판정 → AX/Platform 설계 → 구현 → QA → 시연 → 실증 → 후속 고도화까지 이어질 수 있어야 한다.  
> **First Build Target:** 첫 실행에서 최종 MVP 목표의 약 70~80% 수준까지 도달하는 High-Fidelity First Build.  

> **NON-COMPRESSION:** v3.0 전체 상세 규칙을 보존하고, AX펭귄 v3.1 Evidence-First 전략·AX Coach·Proof Event·Grouped Navigation·7 Theme·Motion Completion Layer를 최상위에 추가한다. Unified v4.0은 세 파일 중 가장 크고 가장 완전한 Superset Master다.

---

# v4.1 LIVE OVERRIDE — DEVICE VIEW / PC + MOBILE SIMULTANEOUS PREVIEW — 2026-09-22

> **Release Date:** 2026-09-22  
> **Change Type:** ADD + MODIFY/SUPERSEDE(Device Preview 충돌 부분만)  
> **NON-COMPRESSION:** 기존 Master의 전략·기능·디자인·반응형·Role·Tutorial·Presentation·Evidence·QA·Security·Business 규칙은 삭제·축약·요약하지 않는다. 본 버전은 **Device View 관련 규칙만 추가/상향**하며, 아래 기존 본문은 Historical / Inherited Rule로 그대로 보존한다.  
> **적용 원칙:** 기존 `Desktop/Mobile Preview`, `Responsive`, `True Viewport`, `Preview Safety` 규칙 중 본 Override와 충돌하는 문장만 본 규칙이 우선한다. 그 외 기존 Mobile/Responsive 품질규칙은 모두 유지한다.

## 0. RELEASE FAMILY / SOURCE PRIORITY — DEVICE VIEW 범위

본 2026-09-22 Device View 공통 릴리스의 동기화 버전:

```text
Unified Master      : v4.1
AX-only             : v8.1
Platform-only       : v3.1
Rapid MVP           : v1.2
Patent+Venture+MVP  : v2.9
Family Date         : 2026-09-22
```

위 버전 묶음에서 Device View의 최소 Quality Floor는 동일하게 유지한다.

## 0.1 SOURCE PRIORITY

Device View / PC·Mobile Preview와 직접 관련된 충돌에 한해서만 아래 순서를 적용한다.

```text
1. 현재 사용자의 명시적 최신 요청
2. 본 v4.1 Device View Override
3. 기존 Master의 Responsive / Mobile / Device Preview / True Viewport 규칙
4. 그 외 기존 Master 규칙
```

특히 기존 문구 중 아래 의미는 **SUPERSEDED**다.

```text
Desktop 실제 환경에서는 Mobile 보기만 제공
Mobile 실제 환경에서는 PC 보기만 제공
현재 Device와 동일한 Preview 버튼은 반드시 숨김
Preview는 Modal/닫기 버튼을 전제로 함
```

새 기본값은 **Desktop에서 [PC] [Mobile] [PC+Mobile] 3모드**다.

---

# 1. DEVICE VIEW — P0 기본 탑재

PC와 Mobile을 모두 지원하는 Web App / AX / Platform / MVP는 특별한 제외 사유가 없으면 Device View를 기본 구현한다.

```text
[ PC ]   [ Mobile ]   [ PC+Mobile ]
```

### PC
- 일반 Desktop 제품 화면을 전체 폭으로 사용한다.
- 실제 Desktop Route / Data / State를 그대로 사용한다.

### Mobile
- Desktop 브라우저 안에서 **실제 390px Mobile Viewport**를 독립 Phone Frame으로 보여준다.
- 단순 Screenshot, CSS 축소 복제본, 별도 목업 페이지가 아니다.
- **동일 애플리케이션 / 동일 Route / 동일 Data / 동일 State**를 모바일 Viewport에서 실제 렌더링한다.

### PC+Mobile
- 같은 Route의 PC 화면과 Mobile 화면을 **한 화면에서 동시에** 보여준다.
- 사용자가 별도 DevTools 또는 실제 휴대폰을 꺼내지 않아도 두 Surface를 즉시 비교·시연할 수 있어야 한다.
- 기본 권장 비율은 `PC 67% : Mobile 33%`.
- Mobile Preview 영역은 Desktop 화면 오른쪽에 배치하고, 가능하면 `sticky`로 유지한다.
- PC 영역은 축소 때문에 가로 Overflow가 생기지 않도록 `min-width: 0`, `overflow-x: clip/hidden`, Container Query 또는 동등한 대응을 한다.

---

# 2. TRUE MOBILE FRAME — 실제 390px 렌더링

권장 기준:

```text
Viewport Width  : 390px
Viewport Height : 844px
Frame Radius    : 약 40px
Device Border   : 약 8~10px
Max Height      : calc(100dvh - Header/Safe Space)
```

필수:
- 실제 Mobile CSS Breakpoint가 발동해야 한다.
- Mobile Header / Bottom Navigation / Drawer / Sheet / Safe Area가 실제 Mobile과 동일하게 작동해야 한다.
- `scrollTop = 0`에서 정상 시작한다.
- 상단/하단이 잘리고 중간만 보이는 Frame 금지.
- 390px에 맞추려고 본문 Font를 비정상적으로 축소하지 않는다.
- 기존 390px / 430px Mobile QA는 그대로 유지한다.

---

# 3. SAME APP / SAME ROUTE / SAME DATA — P0

Mobile Preview는 별도의 복제 앱을 만들지 않는다.

권장 구조:

```text
현재 Route
→ 동일 앱을 Mobile Frame에서 다시 렌더링
→ Preview 식별용 query/state만 추가
예: ?frame=mobile
```

반드시 보장:
- 같은 Route
- 같은 Login/Session
- 같은 Data Source
- 같은 Record / Entity
- 같은 상태 의미
- 같은 권한규칙

같은 Origin에서 실행하는 경우 `localStorage`, Cookie/Session, Supabase Session 등 공유 가능한 상태는 동일 Source를 사용한다.

금지:
- PC용 Mock Data와 Mobile용 Mock Data를 따로 관리
- `/mobile-preview` 전용 가짜 화면을 만들어 실제 Route와 분리
- Mobile Preview만 성공하고 실제 Mobile Route는 깨지는 구조
- 같은 항목이 PC와 Mobile에서 서로 다른 값으로 보이는 상태

---

# 4. PC ↔ MOBILE ROUTE SYNC — P0

PC+Mobile 모드에서는 양쪽 Route를 동기화한다.

```text
PC에서 Route 이동
→ Mobile Frame도 같은 Route로 이동

Mobile Frame에서 Route 이동
→ PC도 같은 Route로 이동
```

권장 구현:
- Parent ↔ Mobile Frame 간 `postMessage` 또는 동등한 안전한 통신 사용.
- Message에는 최소 `type`, `path`를 둔다.
- `event.origin === window.location.origin` 검증.
- Parent에서는 Frame의 `contentWindow`인지 검증.
- 동일 Route 메시지는 재이동하지 않아 Loop를 방지한다.

Route Sync는 메뉴 이동뿐 아니라 핵심 Flow 시연 중에도 유지되어야 한다.

---

# 5. RECURSIVE PREVIEW BLOCK — P0

Mobile Frame 안에서 다시 Device View를 만들면 안 된다.

권장 감지:

```text
window.self !== window.top
```

또는 동등한 Frame Context 판정.

Frame Context에서는:
- Device Switch 숨김
- 추가 Mobile/PC Preview 생성 금지
- 다시 iframe을 만드는 재귀 Preview 금지

즉 아래 구조는 FAIL:

```text
PC
└─ Mobile Preview
   └─ Mobile Preview
      └─ Mobile Preview ...
```

---

# 6. REAL DEVICE BEHAVIOR VS DESKTOP DEVICE VIEW

### 실제 Desktop 브라우저
- `PC / Mobile / PC+Mobile` 3모드 제공이 기본값.
- Device View 선택값은 가능하면 `localStorage` 등으로 저장하여 새로고침 후에도 유지한다.
- Device View UI는 일반적으로 `≥1024px`에서 노출한다.

### 실제 Mobile / Tablet 브라우저
- 정상 Responsive Mobile/Tablet 제품 화면을 그대로 제공한다.
- 좁은 실제 기기에서 PC+Mobile 병렬 프리뷰를 억지로 표시하지 않는다.
- 기존 Mobile Navigation / Bottom Nav / Drawer / Safe Area 규칙을 유지한다.
- PC Preview가 사업상 반드시 필요한 특수 프로젝트가 아니라면 Device Switch를 숨겨도 된다.

따라서 **실제 Mobile UX 품질**과 **Desktop에서의 Mobile Preview 기능**을 혼동하지 않는다.

---

# 7. DEVICE VIEW UI PLACEMENT

Desktop Global Header 또는 제품 맥락상 가장 자연스러운 상단 Control 영역에 배치한다.

권장:
- Monitor Icon + `PC`
- Smartphone Icon + `Mobile`
- Columns/Devices Icon + `PC+Mobile`
- 현재 선택 상태는 명확한 Active Pill / Surface / Border로 구분
- 기능보다 버튼이 과하게 튀지 않도록 기존 Theme Token을 사용

Device View는 제품의 핵심 업무 Navigation을 밀어내면 안 된다.

---

# 8. DUAL VIEW LAYOUT CONTRACT

PC+Mobile에서:

```text
┌──────────────────────────────┬──────────────────┐
│                              │                  │
│      PC APP / SAME ROUTE     │  MOBILE 390px    │
│                              │  SAME ROUTE      │
│                              │  SAME DATA       │
│                              │                  │
└──────────────────────────────┴──────────────────┘
          약 67%                       약 33%
```

필수:
- PC 영역 `min-width: 0`
- 긴 Table / URL / Chart 때문에 전체 Dual Layout이 밀리지 않음
- 필요 시 PC 내부 Content Density가 자연스럽게 재배치
- Header는 Dual View에서 좁아진 PC Container 폭을 기준으로 반응
- Global `window width`만 믿고 Header 정보를 과밀하게 두지 않음
- Container Query 또는 동등한 방식 권장
- Mobile Frame은 화면 높이 안에서 최대한 완전하게 보이도록 배치

---

# 9. STATE / INTERACTION CONSISTENCY

Device View의 목적은 시각 비교만이 아니다.

가능하면 다음이 같은 제품 상태를 반영해야 한다.

```text
로그인 사용자
현재 회사/고객
선택한 Record
상태값
완료 여부
업무 결과
권한
DB 반영 결과
```

주의:
- iframe과 Parent가 각각 독립 React Memory State만 가지고 있어 즉시 동기화되지 않는 값이 있다면, 중요 State는 URL / Shared Store / localStorage / Server DB 등 공통 Source of Truth로 올린다.
- 동일 데이터라는 문구를 표시하려면 실제로 동일 Source인지 확인한다.
- Demo 전용 임시 State라도 PC/Mobile이 서로 모순되면 FAIL.

---

# 10. EXISTING PREVIEW CONTRACT와의 충돌 처리

기존 Master에 있는 `DEVICE PREVIEW SAFETY CONTRACT`, `Mobile Preview`, `Desktop Preview`, `True Viewport`, `Responsive` 규칙은 삭제하지 않는다.

다만 아래처럼 해석한다.

### 유지
- Preview 재귀 중첩 금지
- 실제 Viewport 검증
- Header/Footer/Bottom Nav 잘림 금지
- Safe Area
- Fixed/Sticky 정상작동
- 없는 Route 생성 금지
- 404 금지
- 실제 Mobile Responsive QA
- 모바일에서 중요정보를 삭제하지 않고 재배치

### 수정 / 상향
- `Desktop에서는 Mobile 보기만` → **Desktop에서는 PC / Mobile / PC+Mobile 3모드**
- `Mobile에서는 PC 보기만` → **실제 Mobile은 Responsive 본 화면 우선, Device Switch는 기본 숨김 가능**
- `현재 Device와 동일 Preview 숨김` → **Desktop Device View에서는 PC 버튼도 상태선택용으로 노출**
- `Preview는 닫는 Modal` → **Mobile 단독 Stage 또는 우측 Persistent Dual Pane도 정식 허용**
- `Preview 별도 Route` → **동일 Route + Frame Flag 방식을 우선**

---

# 11. QA / E2E — RELEASE GATE

최소 확인 Viewport:
- 390px
- 430px
- 768px
- 1024px
- 1280px
- 1440px
- 가능하면 1920px

Desktop에서 반드시 테스트:
1. PC 모드
2. Mobile 모드
3. PC+Mobile 모드
4. PC → Mobile → PC+Mobile 전환
5. 새로고침 후 선택모드 유지
6. PC에서 Route 이동 → Mobile 동기화
7. Mobile에서 Route 이동 → PC 동기화
8. Frame 내부 Device View 재생성 없음
9. Dual View 가로 Overflow 없음
10. Mobile Bottom Nav / Sticky / Safe Area 정상
11. 인증/세션 유지
12. 동일 핵심 데이터가 양쪽에 동일하게 표시
13. Primary Journey 핵심 단계에서 Dual View 스크린샷 확인

자동 QA가 가능하면:
- `data-testid="device-switch"`
- `data-testid="device-frame"`
- `data-testid="dual-view"`
등 안정적인 Selector를 둘 수 있다.

P0 FAIL:
- PC+Mobile에서 한쪽이 404
- Route Sync Loop
- Frame 무한 중첩
- 로그인 풀림
- 서로 다른 고객/Record 표시
- 가로 Overflow로 PC 화면 절단
- 모바일 프레임 상·하단 잘림
- 실제 Mobile 화면은 깨지는데 Preview만 정상
- Screenshot/가짜 Mobile UI를 실제 Responsive 구현처럼 사용

---

# 12. IMPLEMENTATION REFERENCE PATTERN — 현재 검증된 구조

현재 미래AI랩 AX Partner OS에서 검증된 구현 패턴을 Reference로 사용할 수 있다.

```text
DeviceView state
  pc | mobile | dual
  + localStorage persistence
  + desktop breakpoint gate

DeviceFrame
  same app in 390px iframe
  + same route
  + frame=mobile flag
  + parent ↔ frame postMessage route sync

FrameSync
  detect iframe context
  + prevent recursive Device View
  + sync route both directions

Dual Layout
  PC flex-basis ≈ 67%
  Mobile Preview ≈ 33%
  + sticky right pane
  + overflow protection
  + container-aware header
```

이 패턴의 목적은 특정 파일명이나 Framework를 복제하는 것이 아니라 아래 Product Contract를 지키는 것이다.

> **“PC와 모바일을 따로 만든 두 제품이 아니라, 하나의 실제 제품을 같은 Route·같은 Data로 PC와 Mobile에서 보고, 필요하면 한 화면에서 동시에 비교·시연한다.”**

---

# 13. PROJECT FIT / 예외

본 규칙은 아래 프로젝트에 기본 적용한다.
- Business AX
- Customer / Partner Platform
- AX + Platform
- Interactive MVP
- Judge/Demo용 High-Fidelity MVP
- 특허·벤처 실사용/시연용 AX·Platform MVP

다만 아래는 PC+Mobile 병렬 UI를 생략할 수 있다.
- Mobile-only 제품
- Kiosk-only 제품
- 단일 목적 Landing Page
- Native App만 제작하는 프로젝트
- 사용자 최신 요청에서 명시적으로 제외한 경우

생략 시에도 실제 지원 대상 Device의 Responsive / QA 규칙은 유지한다.

---



# ============================================================
# UNIFIED v4.0 LIVE OVERRIDE — EVIDENCE-FIRST / GROUPED IA / 7 THEME / MOTION COMPLETION
# ============================================================

> **Release Date:** 2026-09-15  
> **Rule:** 아래 LIVE OVERRIDE가 이 파일의 이전/내장/상속 규칙과 충돌하면 본 규칙이 우선한다.  
> **NON-COMPRESSION:** 기존 상세 기능·QA·반응형·Role·Tutorial·Presentation·Data·AI·Security 규칙을 삭제하지 않는다.  
> **ROUTE PRESERVATION:** Navigation을 묶는 것은 기능 삭제가 아니다. 기존 Route/기능은 유지하고 정보구조만 정돈한다.

## 0. SOURCE PRIORITY

```text
1. Unified v4.0 Live Override
2. AX PENGUIN Strategic Core v3.1
3. Unified v3.0 Full Detail — inherited
4. AX v7.x / Platform v3.x incorporated historical detail
5. 과거 규칙 — 충돌하지 않는 범위만
```


## A. AX PENGUIN v3.1 — EVIDENCE-FIRST STRATEGIC OVERRIDE

이 버전부터 AX펭귄의 성공 기준은 “좋은 AX 아이디어”가 아니다.

> **실제 사람의 행동과 회사의 결과가 바뀌고, 그 변화가 검증 가능한 증거로 쌓이며, 그 결과 회사가 정부·정책금융기관·투자자에게 이전보다 더 매력적인 회사가 되는가?**

### A-1. North Star

```text
Primary Constraint
→ Process Redesign
→ Data Foundation / SSOT
→ Appropriate AI / Logic
→ Decision / Action Closed Loop
→ Operating Evidence
→ Enterprise Value Evidence
→ Customer / Partner / Platform
→ Moat / Asset
→ Financeability
→ Capital Fit
```

### A-2. Proof Event — 실증 최소 단위

로그인 횟수나 스크린샷만으로 실증했다고 말하지 않는다.

```text
Trigger / Problem
→ Recommendation / Decision
→ Human Approval if needed
→ Action
→ Result
→ KPI Delta
→ Data Source / Provenance
→ User / Time
```

가능하면 중요한 개선 사건을 `proof_event` 단위로 저장한다.

### A-3. Evidence Two-Layer

**Operating Evidence**
- 시간 / 비용 / 오류 / 불량 / 폐기 / 미수금
- 매출 / 전환 / 재구매 / 이탈
- 동일인력 처리량
- AX 처리비율 / 추천 실행률 / Portal Self-Service

**Enterprise Value Evidence**
- 표준화된 Workflow
- 누적되는 Proprietary Data
- 대표 개인의존도 감소
- 고객 Lock-in / Switching Cost
- 반복매출 BM
- 동종업계 확장 가능성
- IP / 특허 / 업무규칙 자산
- Integration / Network Asset
- 추가 자본 투입 시 성장속도 증가

필수 질문:

> **AX 도입 전보다 이 회사를 더 높게 평가할 이유가 무엇인가?**

### A-4. 12-Week Evidence Plan

```text
Week 0      Baseline Lock
Week 1~4    Adoption / First Proof Events
Week 5~8    Business Lift
Week 9~12   Enterprise Value / Judge Pack
```

Baseline이 없으면 개선률을 만들지 않는다.

### A-5. AX Coach Handoff

PILOT / PRODUCTION / 12주 실증 프로젝트에서는 AX Coach를 **Evidence Operating System**으로 본다.

AX펭귄이 최소 다음을 넘긴다.

```text
AX OWNER
MONEY KPI 3
BASELINE STATUS
MEASUREMENT POINTS
CORE CLOSED LOOP
PROOF EVENT TYPES
TODAY MISSION CANDIDATES
WEEKLY EVIDENCE TARGET
ADOPTION RISK
KILL / REDESIGN CRITERIA
```

AX Coach는 하루에 1~3개의 실제 업무 행동만 우선순위화하고,
`Mission → Action → Result → Proof Event`가 남도록 한다.

DEMO 프로젝트에서는 AX Coach를 억지로 운영형처럼 만들지 않는다.

### A-6. Government Story / Investor Story 분리

같은 Evidence를 사용하되 Story는 분리한다.

**Government / Policy**
- 현장문제
- 혁신성·기술성
- 수행가능성
- 실사용·실증
- 생산성·매출·고용·산업확산
- 사업화/R&D 가능성

**Investor / Growth**
- 시장 크기
- 반복되는 문제
- 표준화/제품화 가능성
- 반복매출
- Unit Economics
- Data / Workflow / Network Moat
- Scale
- Capital Acceleration

### A-7. Strategic Technology Roadmap = Optional Module

전략기술로드맵·R&D 전략품목은 회사 문제보다 먼저 고르지 않는다.

```text
회사 실제 문제
→ AX 해결구조
→ 실증지표
→ 제품/기술요소
→ 그 다음 전략기술로드맵 매칭
```

정부 키워드에 회사 문제를 억지로 맞추면 FAIL.



## B. NAVIGATION DENSITY & GROUPED SIDEBAR — v4/v8 P0/P1

기능 수는 줄이지 않는다. **왼쪽 Sidebar에서 보이는 1차 메뉴 수만 줄이고, 기능을 논리적으로 묶는다.**

### B-1. 기본 밀도

권장:
- Desktop Sidebar Group: **3~4개**
- Group당 1차 메뉴: **2~4개**, 복잡한 프로젝트도 최대 5개
- 첫 화면에서 보이는 1차 메뉴 총합: **8~12개 권장**
- **14개 초과는 원칙적으로 FAIL**. 반드시 Group Landing / Detail Tab / Secondary Action으로 재배치한다.
- Nested Navigation은 최대 1단계까지만.
- 기능 삭제는 금지. Route/기능은 유지하되 노출 위치를 바꾼다.

나쁜 예:
```text
대시보드
오늘업무
일정
배차
수거
거래처
요청
자재
미수금
정산
통계
리포트
AI
인사이트
AX코치
실증
사용자
감사
가져오기
설정
```

권장 구조 예:
```text
[운영]
대시보드 / 오늘업무 / 일정·배차 / 핵심업무

[고객·매출]
거래처 / 요청·주문 / 매출·정산 / 미수금

[AX·성과]
AI 인사이트 / AX 코치 / Evidence / 성과

[관리]
리포트 / 사용자·권한 / 데이터·감사 / 설정
```

실제 업종에 맞춰 이름은 바꾸되 **Group 의미는 한눈에 읽혀야 한다.**

### B-2. Group Icon Color System

메뉴마다 색을 다르게 주는 Rainbow Sidebar는 금지한다.

| Group | Base Hue | 사용 예 |
|---|---|---|
| 운영 / Workflow | Blue `#5B8DEF` | 대시보드·일정·배차·생산·현장 |
| 고객·매출 / Growth | Amber `#D79A43` | CRM·주문·매출·정산·미수금 |
| AX·실증 / Intelligence | Teal-Green `#3C9A75` | AI·AX Coach·Evidence·성과 |
| 관리 / System | Slate `#718096` | 사용자·권한·감사·가져오기·설정 |

같은 Group의 Icon Container는 **같은 Hue**를 사용한다.
필요하면 Light / Base / Deep 3 Tone까지만 허용한다.

```text
Group Light = Base Hue 10~14% Tint
Group Base  = Icon
Group Deep  = Active Border / Active Pill
```

- Icon Container: 30~34px 권장
- Menu Text는 색으로 분류하지 않는다.
- Dark Sidebar Text는 White/Light Neutral.
- Pure White Sidebar Text는 Dark Neutral.
- Error / Warning Red는 Semantic State에서만 사용한다.
- Mobile Drawer도 동일 Group Mapping을 유지한다.
- Bottom Navigation은 핵심 4~5개만 노출하고 나머지는 More/Drawer로 보낸다.

### B-3. Navigation QA

- [ ] 1차 메뉴가 14개를 넘지 않는다.
- [ ] 3~4개의 의미 있는 Group으로 묶여 있다.
- [ ] 같은 Group의 Icon Hue가 동일하다.
- [ ] 메뉴 하나마다 Rainbow Color가 붙지 않는다.
- [ ] 기능이 삭제되지 않고 Detail/Tab/Action으로 보존된다.
- [ ] Mobile에서도 같은 분류 체계를 이해할 수 있다.

---

## C. CANONICAL THEME = 7 — FIXED

v4/v8부터 Theme 개수는 **7개로 고정**한다.
각 Theme는 기존처럼 6개의 Core Color Token을 가진다.

이전의 뿌연 Dark Hue Theme 2종은 제거한다.
중립 Dark Theme 1종도 Pure White와 역할이 겹치므로 Canonical Set에서 제외한다.
과거 섹션의 9 Theme / 해당 Palette 값은 모두 SUPERSEDED이며 구현하지 않는다.

| Theme | Shell | Primary | Secondary | Accent | Highlight | Soft |
|---|---|---|---|---|---|---|
| 01 Deep Navy Blue | `#0B1830` | `#2457D6` | `#1687A7` | `#17A889` | `#E7C873` | `#DCE8F7` |
| 02 Navy Gold | `#111A2D` | `#2847A7` | `#A37A28` | `#D0A84B` | `#F0D995` | `#EFE8D7` |
| 03 Emerald Gold | `#11332B` | `#0E7663` | `#2C9277` | `#B4862A` | `#E8CE88` | `#E2F0EA` |
| 04 Forest Sage | `#17352C` | `#356E58` | `#73977E` | `#A58E4D` | `#D9D2AA` | `#E5ECE5` |
| 05 Deep Teal | `#08323A` | `#087A83` | `#1597A3` | `#D2704C` | `#E9B59B` | `#DDEDEF` |
| 06 Onyx Gold | `#15171C` | `#343942` | `#6A717C` | `#B89032` | `#E0C76F` | `#E6E8EC` |
| 07 Pure White | `#FFFFFF` | `#171B20` | `#343B44` | `#6B7680` | `#D47A4A` | `#FAFAF8` |

### C-1. Pure White

Pure White는 가장 자주 쓸 수 있는 완전한 Light Theme다.

```text
Canvas / Main Surface = #FFFFFF
Primary Text          = #171B20
Secondary Text        = #343B44
Muted Text            = #6B7680
Soft Divider          = #E7EAEE
Soft Canvas           = #FAFAF8
```

전체 화면에 Beige / Rose / Gray Tint를 덮어 “뿌연 흰색”을 만들지 않는다.

### C-2. Theme QA

- Theme Picker는 7개 모두 실제로 전환된다.
- Desktop / Mobile / Device Preview 상태가 같다.
- 이전 Theme Accent 잔존 0.
- 본문 / Table / Form / Modal Neutral은 Theme와 분리한다.
- Pure White에서 Dark Text 대비를 실제 렌더링으로 검증한다.
- Dark Theme에서 Text를 Theme Hue로 물들이지 않는다.

---

## D. MOTION & HOVER — COMPLETION GATE 강화

기존 문서에도 Motion/Hover 규칙은 있었으나, v4/v8에서는 **첫 빌드부터 적용되지 않으면 완료로 보지 않는다.**

### D-1. Hover Coverage

Desktop:
- Primary CTA / Sidebar Item / Tab / Clickable Card / KPI / List Row / Table Row / Filter: **100% 상태 Feedback**
- 전체 주요 Clickable Element Hover Coverage: **90% 이상**
- 기본 Hover: `140~180ms ease-out`
- 권장: 약한 Tint / Border / Shadow / `translateY(-1px~-2px)`
- Image Card: 필요 시 `scale(1.01~1.03)`만
- 강한 Glow / Neon / 큰 Bounce 금지

Mobile:
- Hover 의존 금지
- Pressed / Active / Selected Feedback 필수
- Tap 후 상태가 즉시 보여야 한다.

### D-2. Motion Graphic Minimum Floor

첫인상과 데이터 이해를 돕는 Motion을 절제해서 사용한다.

권장:
- KPI Count-up: `450~800ms`, 첫 진입 1회
- Chart / Progress Reveal: `500~900ms`, 첫 진입 1회
- Section Reveal: `220~360ms`
- Card Stagger: `40~70ms`, 한 번에 최대 5~6개
- Modal / Drawer / Sheet: `180~240ms`
- Route 전환: `120~180ms`, 가벼운 Fade/Translate

금지:
- 의미 없는 Loop Animation
- 전체 화면 Veil / Blur가 반복적으로 덮이는 효과
- 300ms 이상 느린 Hover
- 과한 Parallax
- Animation 때문에 CTA/업무가 늦어지는 구조
- 숫자/차트가 계속 반복 재생되는 구조

`prefers-reduced-motion` 또는 동등한 Motion 감소 설정을 지원한다.

### D-3. Motion QA

Fresh Load에서 반드시 실제 렌더링으로 확인:

```text
Dashboard Load
→ KPI Motion
→ Chart/Progress Reveal
→ Sidebar Hover
→ Card Hover
→ Table Row Hover
→ CTA Press
→ Modal/Drawer Open-Close
→ Mobile Tap Feedback
→ Reduced Motion
```

CSS Class가 존재하는 것만으로 PASS하지 않는다.



## E. PROJECT MEMORY / HANDOFF — v4/v8 추가

기존 파일을 유지하고 다음을 실증형 프로젝트에서 추가한다.

```text
PROJECT_SPEC.md
PROJECT_STATE.md
DECISIONS.md
QA_REPORT.md
RECOMMENDATIONS.md

EVIDENCE_PLAN.md
AX_COACH_PLAN.md
PROOF_EVENT_SCHEMA.md
```

### E-1. `EVIDENCE_PLAN.md`
- Baseline
- Money KPI 3
- 12주 Week Plan
- Data Source / Provenance
- Operating Evidence
- Enterprise Value Evidence
- Government / Investor Story

### E-2. `AX_COACH_PLAN.md`
- AX Owner
- Today Mission 후보
- 주간 Evidence Target
- Adoption Risk
- Mission → Route Mapping
- Result 확인 방식

### E-3. `PROOF_EVENT_SCHEMA.md`
최소 필드:

```text
proof_event_id
event_type
trigger
decision
decision_method
why
human_approval
action
result
kpi_before
kpi_after
data_source
user_id
created_at
result_confirmed_at
evidence_link
status
```

---

## F. FIVE DEVIL QUESTIONS — Release 전에 필수

1. 실제 누가 반복적으로 사용하는가?
2. 도입 전과 비교해 무엇이 얼마나 바뀌었는가?
3. 그 변화가 AX Decision → Action 때문에 생겼다는 추적 근거가 있는가?
4. 12개월 후 경쟁사가 쉽게 복제하기 어려운 무엇이 남는가?
5. 3억·5억·10억을 더 넣으면 무엇이 더 빨리 커지는가?

답이 약하면 강점처럼 포장하지 않는다.



## G. UNIFIED v4 CROSS-SURFACE RULE

AX + Customer Platform은 메뉴 두 벌을 단순히 붙인 제품이 아니다.

```text
Customer Event / Intent / Transaction
→ Business AX Workflow / Decision
→ Human or Automated Action
→ Result / Evidence
→ Customer Status / Better Experience
→ Repeat / Retention / Revenue
```

### Customer Surface Navigation
- Public Header 4~7개 Primary Item 권장.
- 핵심 CTA 1~2개를 가장 강하게.
- 로그인 후 My / History / Status는 독립 목적이 분명할 때만 1차 노출.
- 부가 기능은 More / My / Detail 내부로 묶는다.
- 고객 기능도 삭제하지 않고 Journey에 맞춰 계층화한다.

### AX Surface Navigation
B절의 3~4 Group / 8~12 Primary Item 원칙을 따른다.

### Cross-Surface Completion
- Customer Event가 AX Data/Queue에 실제 반영
- AX Action Result가 Customer 상태/경험에 실제 반영
- Evidence가 생성
- PC ↔ Mobile 목적 동등성
- Customer ↔ AX 왕복 가능


## H. RELEASE CHANGELOG

### ADD
- AX Penguin v3.1 Evidence-First / Enterprise Value
- Proof Event
- 12-Week Evidence Plan
- AX Coach Handoff
- Government Story / Investor Story Split
- Grouped Sidebar IA
- Group-based Icon Color
- Canonical 7 Theme
- Pure White Theme
- Motion Graphic Minimum Floor
- Motion/Hover Actual-render QA
- EVIDENCE_PLAN / AX_COACH_PLAN / PROOF_EVENT_SCHEMA

### MODIFY
- Sidebar 1차 메뉴를 3~4 Group / 8~12 Primary Item 중심으로 정리
- 같은 Group은 같은 Icon Hue Family 사용
- Theme QA 9 → 7
- Pure White를 공식 Light Theme로 승격
- Motion/Hover를 “있으면 좋은 Polish”가 아니라 Completion Gate로 강화

### SUPERSEDE / REMOVE
- Burgundy Slate Theme 제거
- Plum Indigo Theme 제거
- Steel Platinum은 Canonical Theme에서 제외하고 Pure White로 대체
- 메뉴 하나마다 서로 다른 Rainbow Icon Color
- 9 Theme Canonical 규칙

### KEEP
- v3.0의 기존 기능·Route·QA·Responsive·Role·Tutorial·Presentation·Data/AI/Proof 상세 규칙
- Customer ↔ AX Closed Loop
- 6 Color Token per Theme 구조

---

# VERSION FAMILY / THREE-FILE SYNC CONTRACT — 2026-09-15

이 파일은 아래 세 파일과 **동일한 설계 철학과 Quality Floor를 공유하는 하나의 Version Family**다.

```text
Unified Master  : v4.0
AX-only         : v8.0
Platform-only   : v3.0
Family Date     : 2026-09-15
```

## 동기화 절대 규칙

1. `AX+플랫폼전용`은 항상 세 파일 중 **가장 크고 가장 완전한 Superset Master**여야 한다.
2. AX전용에 새로 추가된 유효한 AX/AI/Data/Proof/QA 규칙은 다음 Unified 업데이트에서 빠지면 안 된다.
3. 플랫폼전용에 새로 추가된 Customer Journey/Visual/Conversion/Growth/QA 규칙은 다음 Unified 업데이트에서 빠지면 안 된다.
4. Theme / Typography / Responsive / Asset / Tutorial / Presentation / Accessibility / Data Provenance / AI Risk / Proof / Project Memory / Red Team처럼 양쪽에 공통되는 규칙은 세 파일에서 같은 Quality Floor를 유지한다.
5. AX-only는 Customer Platform을 억지로 구현하지 않지만 `Portal Necessity / Future Expansion`을 반드시 판단한다.
6. Platform-only는 Business AX 전체를 억지로 구현하지 않지만 Customer Event의 `Operational Destination / Data / Admin 처리`를 반드시 정의한다.
7. Unified는 두 Surface를 단순 병렬 배치하지 않고 `Customer Event → AX Workflow/Decision → Result → Customer Feedback` Closed Loop까지 포함한다.
8. 한 파일만 업데이트할 때도 `ADD / MODIFY / SUPERSEDE / CROSS-FILE IMPACT`를 기록하고, 공통 규칙이면 나머지 파일 반영 필요 여부를 검사한다.
9. 구버전의 단순 Line Count보다 **Critical Rule Inventory / Gate / Semantic Coverage** 보존을 우선한다. 다만 설명을 줄이기 위한 무근거 압축은 금지한다.
10. 세 파일 사이에서 동일 개념의 숫자·명칭·Theme Count·완료기준이 충돌하면 Release FAIL이다.

## Release Parity Audit

다음 중 하나라도 발생하면 버전 릴리스 전에 교차검증한다.

- Theme 수 또는 Palette 변경
- Mobile/Preview/Navigation 규칙 변경
- AI Method / Risk / Explainability 변경
- Money KPI / Proof / Evidence 규칙 변경
- Customer Platform Primary Journey 변경
- Future Expansion / Platform Readiness 변경
- Strategic P0 / Product P0 변경
- Project Memory / Red Team / Acceptance 변경

---

# v3.0 MAJOR UPGRADE — FROM “HOW TO BUILD” TO “WHAT / WHY / PROVE / SCALE”

v2.0이 구현·디자인·테마·반응형·고객↔AX 연결을 강하게 만들었다면, v3.0은 그 앞단과 뒷단을 확장한다.

```text
Judge
→ Constraint
→ Process
→ Data
→ AX / Platform
→ AI / Logic
→ Proof
→ Moat
→ Build
→ QA
→ Red Team
```

---

# ============================================================
# AX PENGUIN 3.0 STRATEGIC INTELLIGENCE LAYER — LIVE OVERRIDE
# ============================================================

> 이 Layer는 단순 기능 아이디어 목록이 아니다.
> 프로젝트가 **왜 필요한지, 무엇을 만들지, 무엇을 만들지 않을지, 어떤 데이터와 자산이 남아야 하는지, 무엇으로 성과를 증명할지**를 구현 전에 잠그는 전략·실증·실패방지 규격이다.
>
> 최우선 질문:
>
> **“이 회사의 가장 중요한 문제를 어떤 순서로 바꾸면 실제 성과가 증명되고, 데이터·기술·고객·사업모델이라는 자산이 남아 성장 가능한 회사가 되는가?”**

## 0. AX PENGUIN 3.0 NORTH STAR

```text
Problem
→ Process Redesign
→ Data Foundation
→ Appropriate AI / Logic
→ Proof
→ Customer / Partner / Platform
→ Moat
→ Financeability
→ Capital Fit
```

한국어:

```text
문제 발견
→ 나쁜 업무 제거·표준화
→ 데이터를 한 곳에 쌓을 구조 생성
→ 적합한 AI/로직 적용
→ 성과 실증
→ 고객·거래처·파트너 연결
→ 회사에 남는 방어력과 자산 확보
→ 자금조달 가능한 회사 구조
→ 회사 수준에 맞는 성장자본
```

### 절대 원칙

- 정책자금·보증·정부지원·투자가 없어도 경제적 가치가 있어야 한다.
- “AI를 넣는 것”보다 “문제를 해결하는 것”이 먼저다.
- “플랫폼처럼 보이는 것”보다 “반복되는 거래·행동·데이터 Loop”가 먼저다.
- Demo 성과를 Live 성과처럼 말하지 않는다.
- 미래 기능을 현재 구현처럼 말하지 않는다.
- 실제 Baseline이 없으면 개선율을 지어내지 않는다.
- 기술스택 자체를 기술적 해자(Moat)로 포장하지 않는다.
- 기능 수를 품질로 착각하지 않는다.
- 가장 큰 병목과 핵심가치 3개를 설명하지 못하면 설계가 잠기지 않은 상태다.

---

# 1. STRATEGIC PREFLIGHT — 구현 전에 반드시 판정

## 1.1 AX GO / LITE / NO-GO

프로젝트를 시작하기 전에 아래 중 하나를 명시한다.

### FULL / GO
- 반복업무가 충분하다.
- 거래/운영량이 있다.
- 데이터가 계속 생성된다.
- 비용·매출·처리량 중 적어도 하나의 개선여지가 크다.
- 실제 직원/고객이 사용할 수 있다.
- 향후 데이터·프로세스·네트워크 자산이 남는다.

### LITE
- 문제는 있으나 아직 규모가 작다.
- CRM / Dashboard / Workflow / 간단한 Automation / 작은 Portal부터 시작하는 것이 경제적이다.
- Full AX를 억지로 만들지 않는다.

### NO-GO
- AX보다 고객확보·상품·원가·기본업무 정리가 먼저다.
- 반복업무/데이터가 거의 없다.
- 대표·직원이 실제로 사용할 의지가 없다.
- 구축비 대비 경제적 효과 설명이 불가능하다.

`NO-GO` 판단은 실패가 아니라 올바른 컨설팅 결과다.

## 1.2 CAPITAL INDEPENDENCE TEST — P0

다음 질문에 `YES`가 아니면 전략 P0로 본다.

> **신보·기보·중진공·정부지원·VC 투자를 한 푼도 받지 못해도 이 시스템을 구축할 경제적 이유가 있는가?**

NO라면 정책자금용 장식이 될 위험이 있으므로 범위·문제정의·ROI를 다시 설계한다.

---

# 2. CONSTRAINT FIRST — 가장 큰 병목 1개를 먼저 잠근다

다음 세 범주에서 후보를 찾고, 가장 큰 Constraint 하나를 PRIMARY로 지정한다.

### MONEY LEAK
- 불량
- 폐기
- 재고과다
- 원가누락
- 미수금
- 광고낭비
- 낮은 마진
- 과도한 인건비/외주비

### TIME LEAK
- 반복입력
- 전화/카톡 확인
- 수기 보고
- 견적
- 발주
- 일정조정
- 문서 찾기
- 승인 대기

### REVENUE LEAK
- 문의 후 미전환
- 재구매 누락
- 고객 이탈
- 교차판매 부재
- 견적 후 후속관리 부재
- 재고부족으로 판매실패
- 예약/주문 과정 이탈

### Constraint Lock 문장

```text
PRIMARY CONSTRAINT:
[현재 어떤 상황에서] [누가] [무엇 때문에] [돈/시간/매출 손실]을 겪고 있으며,
이번 프로젝트의 핵심은 [어떤 변화]로 이를 줄이는 것이다.
```

핵심 기능의 60~70%는 이 Constraint와 직접 연결되어야 한다.

---

# 3. PROCESS REDESIGN — 나쁜 프로세스를 자동화하지 않는다

반드시 다음 순서로 검토한다.

```text
ELIMINATE
불필요한 단계 삭제
↓
STANDARDIZE
사람마다 다른 업무를 표준화
↓
DIGITIZE
기록/상태/요청을 데이터화
↓
AUTOMATE
반복 실행을 자동화
↓
AI
복합판단·예측·설명에 필요한 경우만 적용
```

PROJECT_SPEC에는 최소 아래를 남긴다.

| 현재 단계 | 문제 | 제거 가능 | 표준화 | 디지털화 | 자동화 | AI 필요 | 최종 상태 |
|---|---|---|---|---|---|---|---|

중복입력을 자동화하기 전에 **중복입력 자체를 없앨 수 있는지** 먼저 본다.

---

# 4. CORE VALUE 3 + MONEY KPI CONTRACT

기능 목록보다 먼저 프로젝트의 핵심가치 3개를 잠근다.

```text
CORE VALUE 1 — Cost / Efficiency
CORE VALUE 2 — Revenue / Customer
CORE VALUE 3 — Scale / Capacity
```

## 4.1 필수 KPI 3종

### COST KPI — 최소 1개
예: 견적시간, 배차시간, 불량률, 폐기율, 미수금 회수기간, 재고오류.

### REVENUE KPI — 최소 1개
예: 전환율, 재주문율, 재방문율, 객단가, 견적→수주율, 이탈률.

### SCALE KPI — 최소 1개
예: 직원 1인당 관리거래처, 점장 1명당 관리매출, 차량 1대당 처리건수, 동일인력 처리량.

## 4.2 BASELINE UNKNOWN 상태

실제 값이 없으면:

```text
BASELINE STATUS: REQUIRED / UNKNOWN
MEASUREMENT POINT: [어디에서 어떻게 측정]
TARGET: DO NOT INVENT
```

Demo Seed 값으로 실제 개선률을 꾸미면 P0 FAIL.

---

# 5. DATA FOUNDATION / SSOT / DATA MOAT

## 5.1 SINGLE SOURCE OF TRUTH

핵심 Entity마다 기준 데이터 위치를 한 곳으로 정한다.

```text
Customer
Partner
Product / Service
Order / Reservation / Request
Inventory
Employee / Role
Location / Store / Vehicle
Action
Result
Evidence
```

각 Entity는 아래를 정의한다.

| Entity | System of Record | 입력 주체 | 업데이트 방식 | 민감도 | 보관 | AI 사용 가능 |
|---|---|---|---|---|---|---|

## 5.2 DATA ASSET TEST

단순 저장이 아니라 다음을 평가한다.

1. 독점성 — 남들이 쉽게 구할 수 없는가.
2. 시간축 — 오래 쌓일수록 가치가 커지는가.
3. 결과연결 — Input뿐 아니라 Outcome까지 연결되는가.
4. 반복성 — 매일/매주 계속 생성되는가.
5. 권리 — 합법적으로 활용 가능한가.
6. AI 활용성 — 예측·추천·분석 개선에 실제 쓰이는가.

### 12-MONTH DATA QUESTION

> **이 데이터가 12개월 쌓이면 지금은 못 하는 어떤 판단·상품·서비스가 가능해지는가?**

답이 없으면 Data Asset을 과장하지 않는다.

## 5.3 DATA MOAT SCORE

각 0~2점, 총 12점.
- 독점성
- 시간축
- Outcome 연결
- 반복성
- 권리/품질
- AI/사업 활용

`0~4 약함 / 5~8 중간 / 9~12 강함`.

---

# 6. AI NECESSITY & METHOD MATRIX

AI 기능 개수를 목표로 하지 않는다. 핵심 가치가 있는 **1~6개**까지 허용하며 0개도 가능하다.

각 기능을 다음 중 하나로 분류한다.

- `RULE` — 조건/수식/Threshold로 충분
- `OPTIMIZATION` — 경로·배차·조합·제약조건 최적화
- `ML / STATISTICAL` — 수요·이탈·이상·예측
- `RAG` — 회사 문서/규정/지식 검색·근거응답
- `LLM` — 자연어 요약·설명·작성·대화
- `HUMAN` — 자동화보다 사람이 판단해야 함

### AI METHOD MATRIX — PASS 1 필수

| 기능 | Business Question | Input | Method | Output | Why This Method | Error Cost | Approval | Evidence |
|---|---|---|---|---|---|---|---|---|

## 6.1 AUTOMATION LEVEL

- L1 Assist — 정보/정리
- L2 Recommend — 추천
- L3 Prepare + Human Approve — AI가 준비, 사람이 승인
- L4 Auto Execute — 충분히 검증된 저위험 업무만

## 6.2 ERROR COST

- LOW — 잘못돼도 쉽게 수정
- MID — 비용/고객경험 영향
- HIGH — 의료·안전·법률·신용·인사·중요 금전결정 등

HIGH는 Human-in-the-loop 필수.

## 6.3 WHY? / EXPLAINABILITY

주요 AI/추천에는 가능하면 `왜?`를 제공한다.

```text
추천
→ 사용 데이터
→ 핵심 근거 2~4개
→ 신뢰/주의사항
→ 다음 Action
```

근거 없는 “AI가 추천했습니다”는 금지한다.

---

# 7. DESIGN NOW / PREPARE NOW / VALIDATE LATER

AX펭귄 3.0의 모든 항목을 첫 MVP에 가짜로 구현하지 않는다.

## DESIGN NOW
지금 실제 설계·구현:
- Constraint
- Core Journey
- Data Structure
- Money KPI 측정지점
- AI/Logic Method
- Core Closed Loop
- Role/Permission
- Evidence 구조
- Explainability
- Demo/Live 상태

## PREPARE NOW
측정·연결 구조만 준비:
- Efficiency Proof
- Scale Proof
- Adoption KPI
- ROI/TCO
- Data Moat 변화
- Unit Economics
- Evidence Pack

## VALIDATE LATER
실제 운영 이후에만 확정:
- 실제 ROI
- 실제 개선률
- 실제 WAU/사용률
- 실제 CAC/LTV
- 실제 Scale Proof
- 실제 Financeability
- Kill Criteria 발동

실증 전 숫자를 확정값처럼 보여주지 않는다.

---

# 8. PROOF SYSTEM — Demand / Efficiency / Scale / Adoption

## Demand Proof
현재 고객, 거래처, 반복구매, 예약, 문의, 주문, 매출, 수출 등 이미 존재하는 수요.

## Efficiency Proof
Before/After 시간·비용·오류·폐기·불량·미수금·재고 차이.

## Scale Proof
인력을 비례해서 늘리지 않고 처리량·고객·매출을 늘릴 수 있는가.

## Adoption Proof
실제 직원/고객이 사용하는가.

권장 Adoption KPI:
- Weekly Active User
- 핵심 업무의 AX 처리비율
- Portal Self-Service 비율
- AI 추천 확인률
- AI 추천 승인/실행률
- 기능별 사용률

## Business Lift 우선
모델 Accuracy 자체보다 기존 방식 대비 실제 결과 개선을 우선한다.

---

# 9. AX EVIDENCE SYSTEM / PROOF PACKAGE

Evidence Log를 단순 로그가 아닌 실증 시스템으로 본다.

### Evidence Type
- BASELINE
- ACTION
- RESULT
- ADOPTION
- CUSTOMER
- EFFICIENCY
- REVENUE
- SCALE
- RISK / EXCEPTION

### Evidence Pack

```text
Before / Baseline
→ Trigger / Problem
→ Recommendation / Decision
→ Human Approval if needed
→ Action
→ Result
→ KPI Delta
→ Data Source / Provenance
→ User / Time Log
→ Screenshot / Report
```

12주 실증 종료 시 최소 Evidence Pack을 생성할 수 있는 구조를 준비한다.

---

# 10. ADOPTION READINESS / AX OWNER

기술 구현 전후로 다음을 평가한다.

- 직원 디지털 숙련도
- 현재 사용하는 프로그램 수
- 추가 입력 부담
- 중복입력 여부
- 모바일 필요성
- 교육 필요성
- 역할별 이익
- 기존 습관과 충돌

### Employee Benefit Rule
대표에게만 좋은 시스템은 Adoption Risk가 높다.
직원에게도 최소 하나 이상이 명확해야 한다.

```text
전화 감소 / 입력 감소 / 보고서 자동화 / 찾는 시간 감소 / 실수 감소 / 업무 우선순위 명확화
```

### AX OWNER — 필수

실제 운영 프로젝트에는 AX Owner 1명을 지정할 수 있는 필드를 둔다.
Owner가 KPI·데이터 품질·사용교육·Issue를 책임진다.

---

# 11. BUSINESS MODEL / UNIT ECONOMICS GATE

플랫폼·SaaS·신규사업 확장을 주장할 때 반드시 확인:

- 누가 돈을 내는가
- 무엇에 돈을 내는가
- 반복매출 가능한가
- 고객 1개 늘 때 변동비는 어떻게 되는가
- CAC
- Contribution Margin
- LTV
- Payback Period

실제 값이 없으면 측정항목만 정의하고 숫자를 꾸미지 않는다.

## PLATFORM READINESS 5 TEST

1. 업계 공통문제인가.
2. 표준화 가능한가.
3. 고객이 돈을 낼 문제인가.
4. 이 회사가 플랫폼 사업자가 될 신뢰·중립성이 있는가.
5. 네트워크가 늘수록 가치가 커지는가.

3개 미만이면 Industry Platform을 적극 권고하지 않는다.

`PLATFORM READINESS: HIGH / MID / LOW`로 판정.

---

# 12. MOAT / ASSET AFTER BUILD

구축 후 남는 자산을 확인한다.

- Software Asset
- Data Asset
- AI / Logic Asset
- IP Asset
- Network Asset

가능하면 3개 이상이 남도록 설계하되, 억지로 만들지 않는다.

### 진짜 Moat 후보
- Proprietary Data
- Workflow
- Industry Know-how
- Integration
- Customer/Partner Network
- Switching Cost
- Patent / IP

Next.js / Supabase / LLM API 같은 일반 기술스택 자체는 Moat가 아니다.

---

# 13. FINANCEABILITY / WHY MONEY / CAPITAL FIT

AX의 목적은 “정책자금 화면”이 아니다.
실제 사업·기술·데이터·실증이 먼저이고 자금조달 논리는 마지막에 붙는다.

## WHY MONEY?

한 문장으로:

> **왜 이 회사가 추가 자본을 투입했을 때 더 큰 성과를 만들 수 있는가?**

## 적합도
- 신보형 — 시장성·매출·실행력·확장성·플랫폼
- 기보형 — 기술·R&D·데이터·알고리즘·특허·자체솔루션
- 중진공형 — AX 도입·생산성·성장투자·고용/사업확장
- R&D형 — 기술적 불확실성과 개발과제
- VC형 — 큰 시장·빠른 성장·반복매출·Unit Economics·Scale

모든 회사에 VC/퍼스트펭귄을 권하지 않는다.

## CAPITAL LADDER

```text
1~5억      초기 검증 / Seed / 초기 정책·기술자금
5~20억     정책금융 / 신보·기보 / R&D / Pre-A
20~50억    성장투자 / Series A / 복합조달
50억+      Scale-up / 후속투자 / 전략자본
```

금액은 사례 범위이며 보장값이 아니다.
융자 / 보증 / 정부출연 / 지분투자를 반드시 구분한다.

---

# 14. BENCHMARK / EVIDENCE GRADE

회사별 Master Prompt / Why AX에 외부 사례가 필요하면 별도 사례 DB에서 선택한다.

- Close Benchmark — 동종·유사규모
- Adjacent Benchmark — 다른 업종, 같은 전환구조
- Aspirational Benchmark — 장기 상단

권장: `Close 2 + Adjacent 1 + Aspirational 1`.

### 자금조달 인과강도
- A — 직접 근거
- B — 강한 연관
- C — 참고 사례

### 출처 Grade
- A — 공식기관 / 기업 IR / 공시
- B — 투자사 / 주요 경제매체
- C — Startup DB
- D — 2차 인용

“AX를 해서 투자받았다”는 식의 인과 과장 금지.

---

# 15. DEMO / PILOT / PRODUCTION + CAPABILITY STATUS

## DELIVERY STAGE
- DEMO — 아이디어/영업 시연
- PILOT — 실제 데이터 일부 + 현장 실증
- PRODUCTION — 실제 업무/고객 사용

## CAPABILITY STATUS
- LIVE — 실제 작동/실데이터
- PILOT — 일부 실제 사용
- DEMO — 시연 데이터
- READY — 연결 구조 준비
- NEXT — 향후 확장

모든 Story/Presentation/설정에서 상태를 혼동시키지 않는다.

---

# 16. NOT BUILDING / KILL CRITERIA

## NOT BUILDING THIS PHASE — PASS 1 필수

이번 단계에서 의도적으로 만들지 않는 것을 기록한다.
예:
- 실결제
- 외부 POS 실API
- 자동발주 L4
- 자체 ML 학습
- Native App
- Industry SaaS

범위를 빼는 이유와 재검토 조건을 DECISIONS.md에 남긴다.

## KILL / REDESIGN CRITERIA

실제 Pilot/Production에서 다음 같은 기준을 정의할 수 있다.
- 핵심 사용률 지속 저조
- ROI 없음
- Portal Self-Service 거의 없음
- 데이터 생성량 부족
- 오류비용 과다
- 직원 업무가 오히려 늘어남

실제 기준값은 회사별로 설정하며 Demo에서 지어내지 않는다.

---

# 17. WHY NOW? / TIMING PROOF

Why AX / Growth Story에서 회사에 해당하는 경우만 설명한다.

- 인력부족
- 원가/경쟁 심화
- 고객의 모바일 행동 변화
- AI 비용/성능 변화
- 규제/정책 변화
- 데이터가 충분히 쌓이기 시작함
- 다점포/거래처 증가
- 해외/지역확장

Generic “AI 시대라서” 문구로 끝내지 않는다.

---

# 18. DUAL SCORE — STRATEGY 100 + PRODUCT 100

UI가 예쁘다는 이유로 사업적으로 틀린 AX가 높은 점수를 받지 않게 한다.

## SCORE A — AX STRATEGY / BUSINESS QUALITY 100

| 영역 | 배점 |
|---|---:|
| Problem / Constraint | 15 |
| Process Redesign | 10 |
| Data Foundation / Asset | 15 |
| AI Fit / Explainability | 10 |
| Proof / KPI Design | 15 |
| Customer / Partner / Platform Fit | 10 |
| Scale / Unit Economics | 10 |
| Moat / Asset | 5 |
| Adoption / Risk | 5 |
| Financeability / Growth Logic | 5 |

### Strategy 판정
- 90 미만: 전략 재설계 필요
- 90~94: 좋은 전략
- 95~97: 고품질
- 98~100: 매우 강한 전략

단 Strategic P0 실패 시 점수와 무관하게 FAIL.

## SCORE B — PRODUCT / IMPLEMENTATION QUALITY 100

기존 Product/Visual/Responsive/Journey/Theme/QA Scorecard를 유지·확장한다.
전략점수와 제품점수를 별도로 기록한다.

---

# 19. STRATEGIC P0 — 하나라도 있으면 완료 보고 금지

- Primary Constraint 없음
- 핵심 기능이 Constraint와 연결되지 않음
- Cost/Revenue/Scale KPI 설계 없음
- Demo Data를 Live처럼 표현
- Baseline 없는 개선율을 사실처럼 표시
- 고객행동이 내부 Workflow/Data와 단절
- Rule이면 충분한데 억지 AI 포장
- 주요 AI Action 근거 없음
- High Risk AI에 사람 승인/감독 없음
- 중요 Data Source/Provenance 불명확
- Future/NEXT를 현재 기능처럼 표현
- 정책자금·보증·투자 “보장” 표현
- Capital Independence Test 실패 상태인데 그대로 추진

---

# 20. DEVIL / FAILURE CHECKLIST — 최종에 반드시 공격적으로 검토

## BUSINESS DEVIL
- [ ] 이 AX가 없어도 회사가 아무 문제 없이 돌아가는데 억지로 만든 것은 아닌가?
- [ ] 가장 큰 병목이 아니라 구현하기 쉬운 문제만 해결했는가?
- [ ] 기능은 많은데 핵심가치 3개를 설명하지 못하는가?
- [ ] 기존의 나쁜 프로세스를 그대로 자동화했는가?
- [ ] 대표만 좋아하고 직원은 일이 늘어나는가?

## DATA DEVIL
- [ ] Demo Data가 실제 회사처럼 보이게 하는 장식에 그치는가?
- [ ] 입력은 있는데 결과/Outcome 데이터가 없는가?
- [ ] SSOT가 정의되지 않았는가?
- [ ] 12개월 쌓여도 새로운 가치가 없는 데이터인가?
- [ ] 개인정보/권리 문제를 무시했는가?

## AI DEVIL
- [ ] IF/수식이면 충분한데 AI라고 부르는가?
- [ ] LLM이 필요 없는 곳에 LLM을 썼는가?
- [ ] AI가 왜 그런 판단을 했는지 설명할 수 없는가?
- [ ] 오류비용이 큰데 L4 자동실행인가?
- [ ] AI Output이 실제 업무 Action과 연결되지 않는가?

## PLATFORM DEVIL
- [ ] 고객이 쓸 이유가 없는 Portal인가?
- [ ] 고객이 요청한 뒤 직원이 다시 수기로 옮기는가?
- [ ] 소개 홈페이지를 Platform이라고 부르는가?
- [ ] Primary Conversion 완료경로가 없는가?
- [ ] Future Menu가 허황되거나 현재 기능처럼 보이는가?

## GROWTH DEVIL
- [ ] 고객이 늘수록 인력/비용도 똑같이 늘어나는가?
- [ ] 반복매출 가능성이 없는데 SaaS라고 부르는가?
- [ ] Unit Economics가 나쁜데 Scale만 주장하는가?
- [ ] 정책자금/투자 사례를 인과처럼 과장하는가?

## PRODUCT DEVIL
- [ ] 첫 화면만 고급스럽고 Detail은 템플릿인가?
- [ ] Mobile에서 핵심기능이 빠지는가?
- [ ] Hover/Modal/Drawer/Preview가 동작은 하지만 불안정한가?
- [ ] 설정/튜토리얼/Why AX가 존재하지만 찾을 수 없는가?
- [ ] 많은 기능 때문에 Primary Journey가 흐려졌는가?

---

# 21. PASS 3 — RED TEAM / JUDGE — 1회만

PASS 1 설계 + PASS 2 구현 이후 **새 기능을 마구 추가하지 않고** 한 번 공격적으로 검토한다.

```text
Act as:
1. skeptical business owner
2. AX consultant
3. employee who must use the system
4. customer / partner
5. policy / credit evaluator
6. investor / growth reviewer
7. senior UX reviewer
8. QA engineer

Find:
- contradiction
- unnecessary feature
- fake AI
- weak data logic
- dead-end journey
- unverifiable claim
- adoption friction
- unrealistic platform expansion
- security/risk gap
- visual/product regression

Fix P0 / P1 only.
Do not start an endless improvement loop.
Record P2 ideas in RECOMMENDATIONS.md and stop.
```

---

# 22. PROJECT MEMORY v3.0 — 장기 고도화가 가능한 상태로 남긴다

## PROJECT_SPEC.md 필수 추가
- AX VERDICT
- PRIMARY CONSTRAINT
- PROCESS REDESIGN
- CORE VALUE 3
- MONEY KPI 3
- PRIMARY CONVERSION
- DATA ASSET / SSOT
- AI METHOD MATRIX
- PROOF PLAN
- PORTAL / PLATFORM VERDICT
- MOAT CANDIDATE
- RISK LEVEL
- NOT BUILDING
- STRATEGIC ACCEPTANCE

## PROJECT_STATE.md 필수 추가

```text
STRATEGIC GATES
PRIMARY CONSTRAINT STATUS
MONEY KPI / BASELINE STATUS
DATA FOUNDATION
AI / LOGIC STATUS
PROOF STATUS
ADOPTION READINESS
RISK / GOVERNANCE
PLATFORM READINESS
EVIDENCE STATUS
RED TEAM FINDINGS
```

## DECISIONS.md — WHY NOT 포함

중요한 결정은 `왜 했는지`뿐 아니라 `왜 안 했는지`, `언제 재검토할지`도 기록한다.

```text
DECISION:
WHY:
WHY NOT ALTERNATIVE:
REVISIT WHEN:
```

---

# 23. “다음 단계 / 고도화” v3.0 표준 해석

사용자가 다음과 같이 짧게 말해도:

```text
계속 고도화해줘
다음 단계 진행
최종 목표까지 가줘
```

모델은 다음 순서로 판단한다.

```text
1. PROJECT FINAL OBJECTIVE
2. PRIMARY CONSTRAINT
3. STRATEGY SCORE / Strategic P0
4. CORE 미완료
5. Primary Journey / Closed Loop
6. Data / AI / Proof Gap
7. Product / Responsive / Theme / Interaction Gap
8. Devil Checklist
9. Red Team이 아직이면 1회 실행
10. P0/P1 수정
11. PROJECT_STATE / DECISIONS 갱신
12. 완료기준 도달 시 멈춤
```

P2 아이디어 때문에 자동으로 무한 확장하지 않는다.

---

# 24. ONE-SHOT 75 GATE — 첫 실행 품질 목표

첫 Claude 실행은 “Skeleton 생성”이 목적이 아니다.
**최종 MVP 목표의 약 70~80% 수준에 해당하는 High-Fidelity First Build**를 목표로 한다.

첫 실행에서 가능한 범위 내 반드시:
- 전략 잠금
- 회사 맞춤 IA
- Product Shell
- 주요 Route
- Primary Journey
- 핵심 Data Model
- 핵심 AI/Logic Ready 또는 실제 연결
- Evidence 구조
- Role
- Theme
- Responsive
- Tutorial
- Why AX / Story
- 핵심 Visual Asset
- 주요 Empty/Loading/Error
- Demo Reset
- 주요 QA

까지 한 번에 진행한다.

### 금지
- 모든 Route가 Placeholder인 Skeleton
- 첫 화면만 고급스럽고 상세는 빈 화면
- 모바일은 나중에 한다는 전제
- Why AX/Settings/Tutorial을 전부 다음 단계로 미룸
- 준비된 Asset을 사용하지 않음

Hard Blocker가 없다면 PASS 1 이후 PASS 2를 연속 수행한다.

---

# 25. MODEL-INDEPENDENT EXECUTION RULE

Fable / Opus / 기타 모델이 달라도 목표와 Acceptance는 바뀌지 않는다.
모델별 개성은 구현방식에만 허용하고, 아래는 고정한다.

- Final Objective
- Constraint
- Primary Journey
- Data Contract
- AI Method
- System Core
- Theme Canonical Count
- Responsive
- Evidence
- Strategic / Product P0

모델 교체 직후 새 기능보다 Regression QA를 먼저 한다.

---

# ============================================================
# UNIFIED v3.0 HYBRID PRODUCT OVERRIDE
# ============================================================

# U-1. UNIFIED FINAL OBJECTIVE v3.0

본 파일의 최종 산출물은 **Customer Platform과 Business AX를 옆에 붙인 두 화면**이 아니다.

```text
Customer / Partner Need
→ Explore / Ask / Reserve / Order / Request / Reorder / Review
→ Event / Intent / Transaction Data
→ Business AX Workflow / KPI / AI Decision
→ Human / Automated Action
→ Result / Evidence
→ Customer Status / Better Experience
→ Repeat / Retention / Revenue
```

이 Closed Loop가 실제 Route와 Demo State에서 체감되어야 한다.

### 최종 사용자별 이해
- 고객: 무엇을 할 수 있고 완료상태가 무엇인지.
- 직원: 무엇을 처리해야 하고 무엇이 자동으로 들어왔는지.
- 대표: 무엇이 문제이고 다음 행동이 무엇인지.
- 심사자: 기존 업무가 어떻게 데이터·AI·성과로 바뀌는지.
- 성장 관점: 데이터·거래·반복매출·B2B·파트너·지역확장이 어떻게 가능한지.

---

# 26. DELIVERY SCALE / BATCH PRODUCTION CONTRACT

미래AI랩이 월 다수 프로젝트를 처리해도 품질이 흔들리지 않도록 **재사용 가능한 구조와 회사별 고유성**을 동시에 유지한다.

## Reuse
- App Shell / Theme / Role / Tutorial / Preview / Modal lifecycle / QA는 공통 Component와 규격을 최대한 재사용.
- 프로젝트마다 같은 버그를 다시 해결하지 않는다.
- Route Inventory / Theme Audit / Responsive QA / P0 Checklist는 반복 가능한 형식으로 남긴다.

## Customization
- PRIMARY CONSTRAINT
- CORE VALUE 3
- PRIMARY JOURNEY
- DATA MODEL
- AI METHOD
- WHY AX / STORY
- PROJECT SIGNATURE 3+

는 반드시 회사별로 다시 설계한다.

**표준화는 개발속도를 높이기 위한 것이지, 모든 고객을 같은 템플릿처럼 보이게 하기 위한 것이 아니다.**

---

# 27. FIRST BUILD HANDOFF PACKAGE — 첫 실행 종료 시 필수

최초 구현이 끝나면 코드 외에 최소 다음 파일을 최신 상태로 남긴다.

```text
PROJECT_SPEC.md
PROJECT_STATE.md
DECISIONS.md
QA_REPORT.md
RECOMMENDATIONS.md
```

필요 시:

```text
EVIDENCE_PLAN.md
DATA_DICTIONARY.md
SETUP.md
.env.example
/supabase/migrations/*
```

### QA_REPORT 최소 내용
- Strategy Score
- Product Score
- Strategic P0
- Product P0/P1
- Responsive tested widths
- Theme 7 status
- Primary Journey status
- Data/AI/Proof status
- Known Issues
- Red Team 실행 여부

### RECOMMENDATIONS
P2 이상의 선택적 개선은 구현을 무한 반복하지 말고 여기에 기록한다.

---

# U-2. CUSTOMER PLATFORM STRENGTH — “상세페이지 하나” 금지

Hybrid MVP에서 Customer Platform이 약한 상세페이지 수준으로 끝나면 FAIL.
최소 다음 구조를 회사 업종에 맞춰 검토한다.

1. Explore / Home
2. Category / Search / Quick Action
3. Detail
4. Primary Conversion Journey
5. Completion / Status
6. My / History / Result
7. Trust / Review / FAQ / Evidence
8. Repeat / Reorder / Rebook / Membership 중 해당 기능
9. Customer→AX Data Bridge
10. Growth / Future Expansion Layer

모든 항목을 억지로 메뉴화하지 않지만 **Primary Journey + 완료 + 재진입/반복 + 내부 연결**은 반드시 존재해야 한다.

---

# U-3. FUTURE EXPANSION NAVIGATION — HYBRID DEMO 필수

사용자의 최신 선호를 반영하여 Hybrid Demo/영업용 MVP에는 **현실적인 확장 가능성을 한눈에 보여주는 Navigation/목차 Layer를 반드시 둔다.**

### 기본 구성
- Current Core 70% 전후
- Future / Next 30% 전후

Future 후보:
- B2B / 법인전용
- Partner / 공급사 / 가맹점
- Membership / Subscription
- 재주문 / 반복구매
- 지역/지점 확장
- Data Report / Benchmark
- 제휴/입점
- API / 공급망
- Industry SaaS

### 표시 규칙
- `NEXT`, `향후 확장`, `Preview` Badge
- 클릭 시 404 대신 Preview Sheet / Drawer / Roadmap
- 현재 기능과 시각적으로 분리
- 회사의 실제 성장논리와 관련된 3~6개만 선택
- 일반 Public Production에서는 미구현 Future 메뉴를 숨기거나 Roadmap으로 이동 가능

광고문의/입점문의는 트래픽·공급자 생태계가 현실적으로 가능한 경우에만 사용한다.

---

# U-4. PRIMARY JOURNEY COVERAGE — 개수 기준 폐기

과거의 `Customer↔AX 최소 1개/권장2개` 규칙은 완전히 SUPERSEDED.

최소 개수를 채우는 것이 아니라 다음을 본다.

```text
Primary Customer Conversion
→ Event created
→ AX / Workflow / Data reflected
→ Owner / Employee Action
→ Result saved
→ Customer-facing status / experience updated
```

Primary Conversion Goal과 직접 연결되는 Event는 반드시 이 Loop를 가진다.
Secondary Journey는 사업가치에 따라 선택한다.

---

# U-5. SURFACE VALUE BALANCE

Customer와 AX의 품질을 별개로 본다.

### Customer Platform은
브랜드 / 탐색 / 신뢰 / 전환 / 반복사용 / 감성 / 사진 밀도.

### Business AX는
KPI / 우선순위 / 판단 / Action / Evidence / 데이터 밀도.

한쪽이 95점인데 다른 쪽이 70점이면 Unified 제품 완료로 보지 않는다.

### Minimum Floor
- Strategy Score >= 90
- Business Product >= 90
- Customer Product >= 90
- P0 = 0
- 최종 납품 권장: 각 핵심 Score 95+ 및 전체 Product 98+ 지향

---

# U-6. PASS 1-A — HYBRID STRATEGY LOCK

PROJECT_SPEC 가장 앞에 아래를 잠근다.

```text
AX VERDICT
PRIMARY CONSTRAINT
CORE VALUE 3
MONEY KPI 3
CUSTOMER PRIMARY CONVERSION
PROCESS REDESIGN
CUSTOMER CURRENT JOB-TO-BE-DONE
SHARED DATA ASSET
CUSTOMER EVENT → AX MAP
AI METHOD MATRIX
PROOF PLAN
PORTAL / PLATFORM READINESS
FUTURE EXPANSION 3~6
MOAT CANDIDATE
RISK
NOT BUILDING
```

그 다음에 Business IA / Customer IA / Shared Data Model / Theme / Route를 설계한다.

---

# U-7. WHOLE-HYBRID ACCEPTANCE v3.0

```text
Fresh Load
→ Current Stage(Demo/Pilot/Production) 확인
→ Customer Home 5초 테스트
→ Primary Conversion 시작
→ Detail/선택/입력
→ Completion
→ My/Status에서 결과 재확인
→ Customer Event 생성 확인
→ Business AX 전환
→ 해당 Event/KPI/Queue 반영
→ Why? / AI 근거 확인
→ Action 승인/처리
→ Evidence 생성
→ Customer로 복귀
→ 상태/경험 변화 확인
→ Repeat/Reorder/Rebook 경로 확인
→ Future Expansion Navigation 확인(NEXT 오인 0)
→ Settings / 7 Theme / Font / Role
→ Tutorial
→ Why AX
→ Desktop↔Mobile Preview
→ Modal/Drawer/Overlay Escape
→ Demo Reset
→ Strategy Score
→ Product Score
→ Devil Checklist
→ Red Team 1회
→ P0/P1 0 확인
```

---

# U-8. LIVE INSTRUCTION PRIORITY v3.0

충돌 시:

```text
1. Unified v3.0 North Star / AX Penguin 3.0 / Strategic P0
2. Unified v3.0 Hybrid Product Override
3. Unified v3.0 Product/QA Override
4. v2.0 Full-Fidelity Master details
5. incorporated AX v6.5 details
6. incorporated Platform v2.5 details
7. incorporated Unified v1.4 and older inherited detail
```

낮은 우선순위의 **상세 규칙은 삭제하지 않고 유지**하되, 상위와 충돌하면 상위가 실행규칙이다.

---

# U-9. KNOWN SUPERSEDED REGISTRY

아래 과거 표현은 역사적 상세를 보존하더라도 실행하지 않는다.

- Theme 일부 Preset만으로 완료 → **7 Canonical Theme가 Full 기준**
- Theme Picker 6개 Dot → **7 Theme Preview/Swatch**
- AX v6.0을 Source of Truth → **Unified v3.0**
- Unified v1.0을 Source of Truth → **Unified v3.0**
- Customer↔AX 연결 1개면 완료 → **Primary Journey Closed Loop Coverage**
- AI Ready 3~6개를 개수로 채움 → **AI Fit 통과 1~6개, 0개도 허용**
- Line Count 감소 자체를 무조건 FAIL → **Critical Semantic Coverage / Gate loss가 FAIL; 정당한 명시적 Consolidation은 Audit 후 허용**

---

# U-10. FINAL DUAL ACCEPTANCE

### STRATEGY
- Score A 90 미만 → 완료 금지
- Strategic P0 하나라도 → 완료 금지

### PRODUCT
기존 v2.0 100점 Product Score를 유지하되 Strategy와 분리한다.

### DELIVERY TARGET
- First Build: 목표의 70~80% 수준
- Good MVP: Strategy 90+ / Product 90+
- High-quality MVP: Strategy 95+ / Product 95+
- Delivery Recommended: Product 98+ + P0 0

---

# ============================================================
# v3 PRODUCT / QA EXECUTION OVERRIDE — LIVE
# ============================================================

# Q-1. CANONICAL THEME = 7

7개 Theme가 Full QA 기준이다.
대표 3개 Theme를 빠른 Smoke Test에 사용할 수는 있지만 7개 전수 검증을 대체하지 않는다.

Theme 선택은 많게 제공하되:
- 본문/표/Form Neutral은 Theme와 분리
- Pure White Raised Surface 적극 사용
- Residual Old Accent 0
- Error Red는 의미상 Error/Risk만
- Desktop/Mobile/Preview 상태 일치

---

# Q-2. REFERENCE + PROJECT SIGNATURE

Reference Image가 있으면 Mood/Hierarchy/Density를 우선 재해석한다.
Generic Template Drift를 막기 위해 회사별 `PROJECT SIGNATURE` 최소 3개를 PROJECT_SPEC에 기록한다.

예:
- 업종 고유 Hero composition
- 핵심 Journey interaction
- 독자적 Data/AI Card
- 회사 고유 Photo treatment
- 업종 맞춤 Navigation language

10개 프로젝트를 같은 규격으로 만들어도 서로 복제품처럼 보이면 FAIL.

---

# Q-3. MOBILE = SAME PURPOSE, NOT SHRUNK DESKTOP

모바일은 Desktop 축소판이 아니다.
핵심 목적/정보/Action은 동등하게 제공하되 재배치한다.

검증 폭:
`360 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1920`.

특히:
- Horizontal overflow 0
- Button text 2줄 최소화
- fixed/sticky safe-area
- Bottom Navigation overlap 0
- Modal/Sheet escape
- Font Large
- Theme 7

---

# Q-4. INTERACTION COMPLETENESS

보이는 Interactive Element는 실제로 동작해야 한다.

- Hover / Pressed / Selected / Focus
- Modal / Drawer / Sheet Lifecycle
- Loading / Error / Empty / Success
- Undo/Cancel where needed
- Escape Path
- Browser Back safety
- Focus restoration

Invisible overlay / blur 고착은 P0.

---

# Q-5. CONTENT CLARITY — 중학생도 이해 가능

전문용어는 첫 등장 시 쉬운 설명.
복합기술을 이름만 쓰지 말고 “무엇을 해주는지”를 함께 설명한다.

나쁜 예:
`Vector DB + RAG Engine`

좋은 예:
`회사 문서에서 근거를 찾아 답하는 AI 검색(RAG)`

---

# Q-6. NO PLACEHOLDER COMPLETION

“기능 존재”가 아니라 “사용자가 목적을 달성”해야 완료.

금지:
- 클릭 안 되는 버튼
- 빈 Detail
- TODO 문구
- 동일 카드 반복
- 404 Future menu
- Fake Graph without label
- Demo인데 Live처럼 표시

---

# Q-7. FIRST BUILD 70~80 TARGET

첫 실행 후 다음이 눈에 보여야 한다.
- 회사 맞춤성
- 고급스러운 첫인상
- 핵심 Journey 동작
- 모바일 완성도
- 데이터/AI/Action 논리
- Story/Why
- Growth/Expansion
- QA 기본완료

첫 결과가 “프론트 뼈대” 수준이면 One-Shot 75 Gate FAIL.

---

# ACTUAL SOURCE RECONCILIATION NOTE — v3.0

이번 v3.0 릴리스는 사용자 업로드 원본을 별도로 대조했다.

- `(AX전용) ... v6.5`의 상세 Section/Checklist/Asset/Why AX/Project Memory/특허·기술자산 규칙 보존 여부 확인
- `(플랫폼전용) ... v2.5`의 Customer Visual Density/Future Expansion/Primary Journey/Reference/Scorecard 규칙 보존 여부 확인
- 구버전 6 Theme 실행규칙은 Unified v2.0에서 복원된 **Canonical 7 Theme** 규칙으로 SUPERSEDE
- 구버전 제목/Theme 개수처럼 의도적으로 교체된 항목을 제외하고 Standalone 핵심 Section Coverage를 유지

---

# ============================================================
# INHERITED FULL-FIDELITY v2.0 BASE — DETAIL PRESERVATION
# ============================================================

> 아래는 v2.0 전체를 삭제·요약하지 않고 보존한 상세 원본이다.
> 실행 중 충돌하는 문구가 있으면 v3.0 LIVE OVERRIDE와 KNOWN SUPERSEDED REGISTRY가 우선한다.
> 역사적 버전 제목/설명은 lineage를 위해 유지할 수 있으나 현재 Source of Truth는 v3.0이다.

---

# [INHERITED FULL BASE] 미래AI랩 AX + Platform Unified Design & Development System v2.0
## AX + Customer Platform 단독 사용용 · Full-Fidelity Master Source of Truth

> **Historical Base Version:** v2.0 — v3.0 LIVE OVERRIDE가 우선  
> **Date:** 2026-09-02  
> **사용 원칙:** 앞으로 AX + Platform 프로젝트에서는 이 파일 하나만으로도 설계·개발·QA·시연·확장 스토리까지 수행할 수 있어야 한다.

---

# v2.0 MAJOR REBUILD — FULL-FIDELITY / NON-COMPRESSION MASTER

## 0. 왜 v2.0으로 재구축하는가

기존 Unified v1.x는 AX 문서와 Platform 문서의 중복을 줄이기 위해 공통 규칙을 압축하는 방식으로 설계되었다.
그러나 실제 운영에서는 `AX+플랫폼전용` 파일 하나만 사용하는 경우가 대부분이므로, 압축 과정에서 AX전용·플랫폼전용에 존재하던 세부 구현 규칙이 통합본에서 빠지는 것은 허용하지 않는다.

v2.0부터 본 파일은 다음 의미를 가진다.

> **AX전용 최신 규격 + Platform전용 최신 규격 + Cross-Surface Hybrid 규격 + 최신 상위 Override를 모두 포함하는 가장 상세한 최상위 원본.**

이 문서는 더 이상 “두 파일을 요약한 Hybrid 문서”가 아니다.

---

# 1. MASTER NON-COMPRESSION CONTRACT — 절대 규칙

앞으로 본 `AX+플랫폼전용` MD를 업데이트할 때는 아래 규칙을 최우선으로 적용한다.

1. **요약을 이유로 기존 세부 규칙을 삭제하지 않는다.**
2. AX전용 또는 플랫폼전용에 존재하는 유효한 규칙은 통합본에서도 사라지지 않아야 한다.
3. 새 버전은 기존 버전의 기능·QA·디자인·개발운영 규칙을 **포함한 상태에서 확장**한다.
4. 중복 규칙은 하나를 삭제해 축약하기보다, 상위 규칙에서 우선순위를 선언하고 원본 상세 규칙은 보존한다.
5. 완전히 폐기해야 하는 규칙은 삭제보다 `SUPERSEDED / DEPRECATED`로 표시하고 대체 규칙을 명시한다.
6. “Hybrid니까 간소화”, “토큰 절약을 위해 요약”, “공통 규칙이므로 생략” 같은 방식으로 본문을 줄이지 않는다.
7. 본 파일만 읽은 구현 모델이 AX전용/플랫폼전용을 별도로 보지 않아도 동등하거나 더 높은 품질을 낼 수 있어야 한다.
8. 업데이트 전후 **Section Inventory / Line Count / Byte Size / 핵심 Gate 목록**을 비교한다.
9. 특별한 사유 없이 이전 버전보다 핵심 섹션 수 또는 전체 상세도가 감소하면 **UPDATE FAIL**이다.
10. 파일 크기가 줄었다면 반드시 무엇이 제거되었는지 명시적 Diff Audit을 거쳐야 한다. “정리했다”는 이유만으로 축소하지 않는다.

### Size Regression Gate

```text
Previous Unified
→ Section Inventory
→ New Unified
→ Removed / Rewritten / Added Audit
→ No silent loss
```

- 섹션이 사라졌는데 동등 이상의 대체 규칙이 없으면 FAIL.
- QA Gate가 줄면 FAIL.
- Theme / Mobile / Tutorial / Why AX / Data Bridge / Role / Preview / Asset / Motion / State / Error 규칙이 약화되면 FAIL.

---

# 2. v2.0 INSTRUCTION PRIORITY

충돌 시 아래 순서로 해석한다.

```text
1. v2.0 MASTER OVERRIDE / NON-COMPRESSION / THEME / QA 규칙
2. v2.0 CROSS-SURFACE INTEGRATION 규칙
3. 통합된 AX v6.5 규칙
4. 통합된 Platform v2.5 규칙
5. 통합된 Unified v1.4 규칙
6. 각 문서 내부의 이전 inherited version
```

단, 낮은 우선순위의 규칙도 **상위 규칙과 직접 충돌하지 않는 한 모두 유효**하다.

---

# 3. v2.0 FINAL OBJECTIVE

최종 산출물은 다음 두 제품이 붙어 있는 것이 아니라 **하나의 회사 운영·고객 경험 시스템**으로 보여야 한다.

```text
Customer Platform
  탐색 / 예약 / 주문 / 문의 / 회원 / 요청 / 리뷰 / 기록
        ↓ Customer Event / Intent / Transaction Data
Business AX
  KPI / Operations / AI Insight / Action / Result / Evidence
        ↓
Customer Experience / Revenue / Efficiency Improvement
```

완성된 MVP를 보는 대표자·직원·고객·정책기관·투자자는 각각 다음을 즉시 이해할 수 있어야 한다.

- 고객: 무엇을 할 수 있고 어디서 완료되는가.
- 직원: 오늘 무엇을 처리해야 하는가.
- 대표: 무엇이 잘되고/문제이고/다음 행동이 무엇인가.
- 심사자: 기존 업무가 어떻게 데이터화·AI화되고 성과로 연결되는가.
- 투자자/성장 관점: 데이터·반복매출·B2B·파트너·지역·인접서비스 확장이 어떻게 가능한가.

---

# 4. CANONICAL 7 THEME SYSTEM — v2.0 최상위 규칙

## 4.1 7개 Palette를 복원하고 고정한다

초기 AX 원본에 존재했던 **7개 Theme Palette**를 v2.0의 Canonical Library로 사용한다.
후속 문서에서 생긴 “6개 Theme 고정” 규칙은 v2.0에서 폐기한다.

> **7개 Theme × 각 6개 핵심 Theme Color.**

| Theme | Shell | Primary | Secondary | Accent | Highlight | Soft |
|---|---|---|---|---|---|---|
| 01 Deep Navy Blue | `#0B1830` | `#2457D6` | `#1687A7` | `#17A889` | `#E7C873` | `#DCE8F7` |
| 02 Navy Gold | `#111A2D` | `#2847A7` | `#A37A28` | `#D0A84B` | `#F0D995` | `#EFE8D7` |
| 03 Emerald Gold | `#11332B` | `#0E7663` | `#2C9277` | `#B4862A` | `#E8CE88` | `#E2F0EA` |
| 04 Forest Sage | `#17352C` | `#356E58` | `#73977E` | `#A58E4D` | `#D9D2AA` | `#E5ECE5` |
| 05 Deep Teal | `#08323A` | `#087A83` | `#1597A3` | `#D2704C` | `#E9B59B` | `#DDEDEF` |
| 06 Onyx Gold | `#15171C` | `#343942` | `#6A717C` | `#B89032` | `#E0C76F` | `#E6E8EC` |
| 07 Pure White | `#FFFFFF` | `#171B20` | `#343B44` | `#6B7680` | `#D47A4A` | `#FAFAF8` |

## 4.2 Theme Token Architecture

Themeable UI는 직접 Hex나 `red/blue/purple` utility를 박지 않고 의미 기반 Token을 사용한다.

```text
--theme-shell
--theme-primary
--theme-secondary
--theme-accent
--theme-highlight
--theme-soft

--neutral-canvas
--neutral-surface
--neutral-surface-raised
--neutral-text
--neutral-text-secondary
--neutral-border
--neutral-shadow

--semantic-success
--semantic-warning
--semantic-error
--semantic-info
```

### 원칙

- Theme = 브랜드 분위기 / 선택 / 강조를 바꾼다.
- Neutral = 본문·표·폼·카드의 가독성을 고정한다.
- Semantic = 성공/경고/오류/정보 의미를 고정한다.
- Theme를 바꿨는데 본문·표·폼 전체가 특정 Theme Hue로 물들면 FAIL.

---

# 5. THEME RESIDUAL COLOR ZERO-TOLERANCE GATE — 신규 P0

사용자가 Theme를 변경했는데 화면 일부가 이전 Theme의 빨강·보라·파랑·초록 Accent로 남아 있는 현상을 허용하지 않는다.

## 5.1 Red 잔존의 허용 범위

`Red / Rose / Crimson` 계열은 아래 경우에만 허용한다.

- 실제 Error
- Destructive Action
- Critical Risk
- Overdue / Severe Alert처럼 의미상 빨강이 필요한 상태

다음 용도에 Red가 남으면 FAIL:

- 일반 CTA
- 선택된 Navigation
- KPI Accent
- AI Insight Card
- 일반 Badge
- Chart Series의 브랜드 Accent
- Customer Platform의 일반 Action
- Hover / Focus / Selected State

즉 **“빨강이 보이면 무조건 오류”가 아니라, “Theme와 무관한 장식성 빨강이 남으면 오류”**다.

## 5.2 Hard-coded Color 금지

Theme 영향을 받아야 하는 Component에서 다음을 직접 사용하지 않는다.

```text
text-red-* / bg-red-* / border-red-*
text-rose-* / bg-rose-* / border-rose-*
text-purple-* / bg-purple-*
text-blue-* / bg-blue-*  # semantic/info 제외
#DC2626 / #EF4444 / #E11D48 등 직접 Hex  # semantic token 정의부 제외
```

반드시 `var(--theme-*)` 또는 Theme Map을 거친다.

## 5.3 Residual Accent Sweep

Theme 구현 후 아래를 실제로 점검한다.

1. 7개 Theme를 순서대로 전환한다.
2. 각 Theme마다 Desktop AX 전체 주요 Route 확인.
3. Customer Platform 전체 주요 Route 확인.
4. Mobile Drawer / Bottom Nav / Modal / Sheet / Tooltip / Toast 확인.
5. Chart / Badge / KPI / AI Card / Table Selected Row / Pagination 확인.
6. Hover / Active / Focus / Pressed 상태 확인.
7. Device Preview 안쪽까지 확인.
8. 이전 Theme Accent가 남은 Element가 하나라도 있으면 수정한다.

### Source Sweep 권장

구현 저장소에서 `red|rose|purple|blue|green|amber|#[0-9A-Fa-f]{6}` 등 Hard-coded color를 검색하고,
각 사용처를 `theme / neutral / semantic / intentionally fixed` 중 하나로 분류한다.
분류되지 않은 색상은 제거한다.

---

# 6. BUSINESS AX / CUSTOMER PLATFORM THEME BEHAVIOR

## Business AX

- Settings에 **7개 Theme Picker**를 실제 구현한다.
- 각 Palette는 6개 Dot 또는 명확한 Preview Swatch로 인식 가능하게 한다.
- 변경 즉시 Sidebar / Primary / Active / KPI / AI / Chart / Badge / Highlight가 반영된다.
- 새로고침 이후 상태 유지가 필요한 Demo라면 localStorage 등으로 유지할 수 있다.

## Customer Platform

- 일반 고객에게 Theme Picker를 기본 노출하지 않는다.
- 그러나 Customer Surface도 **동일한 7개 Theme Library와 Token System**을 사용한다.
- Hybrid Demo / 관리자 Preview에서는 AX에서 선택한 Theme가 Customer Surface에도 반영되게 한다.
- Brand Reference가 있는 실 프로젝트는 7개 중 하나를 Default Seed로 선택한 뒤 브랜드에 맞춰 Hue를 미세조정할 수 있다.
- Brand Reference가 명시적으로 특정 색을 요구하면 Reference Fidelity가 우선하되, Hard-coded 잔존색이 아닌 Theme Token으로 구현한다.

---

# 7. MODEL-INDEPENDENT QUALITY FLOOR — Fable / Opus / 기타 모델 공통

구현 모델이 바뀌었다는 이유로 아래 품질이 달라져서는 안 된다.

- Layout fidelity
- Typography
- Hover / Pressed / Selected
- Modal / Drawer integrity
- Mobile overflow
- Theme completeness
- 7 Palette behavior
- Residual accent cleanup
- Tutorial
- Why AX / Story
- Customer Journey completion
- AX Action / Evidence loop
- Desktop ↔ Mobile parity
- Customer ↔ AX Bridge

모델이 다르면 구현 스타일은 달라질 수 있지만 **Acceptance Gate는 동일**하다.

### Model Handoff Gate

다른 모델로 이어서 작업할 때는 최소한 다음을 읽고 시작한다.

```text
PROJECT_SPEC.md
PROJECT_STATE.md
DECISIONS.md
현재 Theme Token / Theme Map
현재 Route Inventory
미해결 QA 목록
```

모델 변경 직후에는 “새 기능 추가”보다 **Regression QA 1회**가 먼저다.

---

# 8. FULL-FIDELITY MODULE MAP

본 파일은 아래 세 원본 계열을 모두 포함한다.

### PART A — AX FULL STANDARD
- 미래AI랩 AX Design & Development System v6.5 전체 규칙 계승
- v6.5 → v6.4 → v6.3 → v6.2 → v6.1 → v6.0 → v5.0 → v4.0 inherited detail 포함

### PART B — PLATFORM FULL STANDARD
- 미래AI랩 Platform Web App Design & Development System v2.5 전체 규칙 계승
- v2.5 → v2.4 → v2.3 → v2.2 → v2.1 → v2.0 inherited detail 포함

### PART C — CROSS-SURFACE / UNIFIED STANDARD
- 기존 Unified v1.4 전체 규칙 계승
- Customer > AX Visual Density
- Hybrid Asset Pack
- Surface Round-trip
- Cross-device parity
- Customer ↔ AX Data Bridge
- Shared Demo / Presentation / Story / QA

**아래 상세 모듈은 요약본이 아니라 원본 상세 규칙을 보존한 통합본이다.**

---



# ============================================================
# PART A — FULL AX STANDARD v6.5 INCORPORATED
# ============================================================

> 아래는 AX전용 v6.5의 상세 규칙을 통합한 Full Module이다. v2.0 상위 Override와 충돌하는 Theme 개수 등의 항목만 v2.0 기준으로 정정되었고, 그 외 상세 규칙은 보존한다.

## [INCORPORATED SOURCE] 미래AI랩 AX Design & Development System v6.5
## 업종 공통 AX MVP · Business AX · AI Ready · Product Shell · Cross-device Completion 표준


# v6.5 UPDATE — Visual Asset Quality Gate & Expansion Story Layer

> **v6.5 목적**
>
> v6.4의 Pre-Generated Visual Asset Pack을 실제 샘플 제작에 적용한 결과, 사진은 “있다/없다”보다 **어디에 얼마나 쓰고, 얼마나 선명하게 보이느냐**가 완성도를 크게 좌우했다.
>
> v6.5는 다음을 기본 품질 규칙으로 승격한다.
>
> 1. 고해상도 이미지 선명도 Gate
> 2. AX에서는 사진보다 KPI / AI Insight / Action이 항상 우위
> 3. 준비한 이미지 자산을 실제 첫 빌드부터 의도적으로 사용
> 4. Why AX / Presentation에서 향후 확장 가능성을 한눈에 보여주는 Expansion Story Layer
>
> v6.4 이하와 충돌하면 본 v6.5 UPDATE가 우선한다.

---

## 1. IMAGE SHARPNESS & PLACEMENT GATE — 필수

큰 이미지가 존재한다고 PASS가 아니다. 아래를 모두 충족해야 한다.

- Hero / Wide Banner / Why AX / Presentation 이미지가 확대되어 흐려지거나 깨지면 FAIL
- 원본 해상도가 컨테이너 크기에 충분해야 함
- 억지 width/height stretch 금지
- `object-fit`, `object-position`, responsive crop을 화면별로 조정
- mobile에서도 핵심 피사체가 살아 있어야 함
- desktop에서 선명하고 mobile에서 깨지는 것도 FAIL
- background image 위 텍스트에는 overlay / gradient / contrast control 적용
- 이미지가 UI보다 먼저 보일 수는 있으나, AX 핵심 화면에서는 KPI / AI 판단 / Action을 가리면 안 됨

### Why AX 이미지
`why_ax_01_current.jpg`
`why_ax_02_improved.jpg`
`why_ax_03_growth.jpg`

이 3장은 반드시 선명해야 하며,
`Current Problem → Improved Workflow → Growth / Scale-up`
메시지가 이미지와 함께 명확히 구분되어야 한다.

---

## 2. AX PHOTO-TO-UI HIERARCHY RULE — 필수

AX는 사진 중심 웹사이트가 아니다.

권장 우선순위:

**KPI / Status → AI Insight → Action → Core Operations → Evidence → Contextual Photo**

사진은 다음 영역에 우선 사용:
- Page Intro / Context Banner
- Why AX
- Presentation Mode
- 대표 업무 소개
- Evidence / Report 설명
- 실제 현장·작업 맥락 설명

사진을 카드마다 반복 삽입하여 데이터 밀도를 떨어뜨리지 않는다.

### 권장 자산 활용률
준비된 AX Asset Pack의 **30~50% 정도를 선별 활용**한다.
전부 억지로 사용하지 않는다.

---

## 3. VISUAL ASSET UTILIZATION GATE — 필수

이미 Asset Pack을 준비했다면 첫 구현부터 실제 배치한다.

FAIL 예:
- 이미지가 준비돼 있는데 Hero / Why AX / Presentation에 placeholder가 남아 있음
- 같은 사진을 여러 카드에서 반복 사용
- 모든 정비/상품/서비스 카드가 거의 동일한 crop
- 이미지 때문에 표·KPI·AI 판단이 밀림

PASS:
- 대표 자산은 강하게
- Detail 자산은 필요할 때만
- 사진별 crop / visual role이 구분됨
- 같은 브랜드 촬영 세트처럼 tone consistency 유지

---

## 4. FUTURE EXPANSION STORY LAYER — AX 전용 적용 규칙

AX-only 프로젝트에서는 고객용 플랫폼 Navigation을 억지로 만들지 않는다.
대신 `Why AX`, `Presentation`, `Growth Roadmap` 중 한 곳에서
**향후 확장 가능한 사업모델 / 운영범위 / 데이터 활용 방향 3~5개**를 보여준다.

예:
- 다점포 / 가맹점 통합
- B2B / 법인 고객
- 파트너 네트워크
- 멤버십 / 반복매출
- 데이터 리포트 / 산업 데이터 자산
- 외부 API / 공급망 연동
- 인접서비스 확장

규칙:
- 현재 구현된 기능처럼 오인시키지 말 것
- `향후 확장`, `Next Phase`, `Scale-up Option` 등으로 명확히 표시
- 회사 업종과 실제 성장 가능성이 있는 것만 선택
- 3~5개면 충분하며 과장 금지
- 정책자금·정부지원·투자자 관점에서 “현재 AX → 다음 성장 단계”가 한눈에 읽혀야 함

---

## 5. VISUAL ACCEPTANCE CHECK

최종 QA에 아래를 추가한다.

- [ ] Hero / Wide Banner / Why AX 이미지가 선명하다.
- [ ] 이미지가 desktop / mobile 모두 적절히 crop된다.
- [ ] 사진이 AX의 KPI / AI / Action보다 강하게 지배하지 않는다.
- [ ] 준비된 핵심 Asset이 실제 첫 빌드에 반영되어 있다.
- [ ] 동일 이미지 반복감이 과하지 않다.
- [ ] Why AX의 Current → Improved → Growth가 시각적으로 읽힌다.
- [ ] 향후 확장 방향 3~5개가 과장 없이 보인다.

---


# v6.4 UPDATE — Pre-Generated Visual Asset Pack Contract

> **v6.4 목적**
>
> v6.3이 Visual Polish / Contrast / Motion의 하한선을 올렸다면, v6.4는 실제 업종별 MVP 제작에서 반복적으로 발생하던 **“핵심 기능은 좋은데 사진·배경·썸네일이 비어 있어 첫인상이 약해지는 문제”**를 초기에 차단한다.
>
> 본 업데이트는 Claude에게 기능 구현을 맡기기 전에, 사용자가 **Codex App 등에서 먼저 생성해둘 이미지 자산(photos / backgrounds / thumbnails / hero visuals)** 을 한 번에 준비할 수 있게 하는 규격이다.
>
> 목표는 **처음부터 사진까지 포함된 완성형 MVP를 한 번에 생성**하게 하는 것이다. 만든 뒤에 “이 사진 넣어줘 / 저 배경 바꿔줘”를 반복하는 흐름을 최소화한다.
>
> v6.3 이하와 충돌하면 본 v6.4 UPDATE가 우선한다.

---

# PROMPT 최상단 ASSET PREP BLOCK — 신규 필수

실제 Claude용 마스터 프롬프트를 만들 때는, **깃허브용 프로젝트명 바로 아래**에 아래 형식의 `ASSET PREP BLOCK`을 먼저 둔다.

이 블록은 **사용자가 Codex App에서 먼저 이미지들을 생성하고 저장하기 위한 인간용 준비 블록**이다.  
사용자가 이미지를 모두 만든 뒤 Claude에 넘길 때는, 이 블록을 **지워도 되고 남겨도 되지만**, 남길 경우에도 Claude가 혼동하지 않도록 반드시 아래 문구를 포함한다.

```text
[ASSET PREP BLOCK — HUMAN ONLY]
Generate the following image assets first in Codex App.
Save each file with the exact filename below.
After generating them, upload them to Google Drive and share the folder link.
These lines are preparation notes for asset generation and are not part of the implementation task.
[/ASSET PREP BLOCK]
```

---

# AX VISUAL ASSET PACK — 기본 세트

AX 프로젝트는 일반 홈페이지보다 사진 수가 적어도 되지만, 다음 **핵심 8종**은 있으면 완성도가 크게 올라간다.  
업종에 따라 1~2개는 생략 가능하되, **1 / 2 / 4 / 6 / 8은 우선권이 높다.**

## 1) 대표 커버 이미지
- 파일명: `ax_cover_main.jpg`
- 프롬프트:
  - `Premium editorial business photo of [company industry], showing the core real-world operation of the company, clean premium lighting, realistic, high-end, trustworthy, no text`
- 용도:
  - AX 홈/소개 상단, `/present`, Why AX 도입부, 대표용 쇼케이스

## 2) 대표 서비스/생산 디테일 이미지
- 파일명: `ax_signature_operation.jpg`
- 프롬프트:
  - `Detailed premium photo of the company's signature operation or production process in [industry], close-up but clean, practical and realistic, refined commercial quality, no text`
- 용도:
  - 핵심업무 소개 카드, 상세설명 카드, 기획의도 중 “현재 업무” 설명 블록

## 3) 대표 제품 또는 결과물 이미지
- 파일명: `ax_signature_output.jpg`
- 프롬프트:
  - `Premium product/result photo for [industry], beautifully arranged, commercial quality, realistic, clean background, no text`
- 용도:
  - 결과물/상품/서비스 예시, 성과 카드, 썸네일 카드

## 4) 현장/작업공간 배경 이미지
- 파일명: `ax_workspace_bg.jpg`
- 프롬프트:
  - `Wide clean photo of a real [industry] workspace, facility, office, workshop, studio, showroom or field environment, premium realistic lighting, no text`
- 용도:
  - 섹션 배경, 큰 배너, present/intro, 모바일 미리보기 보조배경

## 5) 담당자/직원 업무 장면
- 파일명: `ax_staff_action.jpg`
- 프롬프트:
  - `Professional staff member in [industry] working with equipment, documents, tablet or workstation, realistic premium business photo, no text`
- 용도:
  - 운영 흐름 설명, 일정/현장/담당자 관련 화면, Tutorial/Guide 보조 이미지

## 6) 관리자/대표 태블릿·노트북 사용 장면
- 파일명: `ax_manager_tablet.jpg`
- 프롬프트:
  - `Business owner or manager in [industry] reviewing operations on a tablet or laptop, premium realistic photo, clean, trustworthy, no text`
- 용도:
  - 대시보드 소개, AI 브리핑, 대표 시점 설명 카드, mobile/pc preview 보조 이미지

## 7) 보고서·체크리스트·증빙 느낌 이미지
- 파일명: `ax_report_evidence.jpg`
- 프롬프트:
  - `Clean business document, checklist, report or evidence-style scene related to [industry], premium commercial photo, realistic, no text`
- 용도:
  - Evidence Log, Report, 품질관리, 체크리스트, 완료 리포트 화면

## 8) 기획의도/Why AX 스토리용 이미지 3종
- 파일명:
  - `why_ax_01_current.jpg`
  - `why_ax_02_improved.jpg`
  - `why_ax_03_growth.jpg`
- 프롬프트:
  - `Realistic business photo visualizing current manual workflow in [industry], slightly busy but professional, no text`
  - `Realistic business photo visualizing improved smart workflow in [industry], more organized and efficient, no text`
  - `Realistic business photo visualizing growth, scale-up, data-driven management in [industry], premium modern business scene, no text`
- 용도:
  - 기획의도 / Why AX / Story Section / 실증 및 성장 설명

---

# AX THUMBNAIL PACK — 선택 권장

업종 특성상 대표 상품·서비스가 여러 개라면, 아래 패턴으로 **3~6개 정도** 추가 생성한다.

- 파일명 패턴:
  - `thumb_service_01_[name].jpg`
  - `thumb_service_02_[name].jpg`
  - `thumb_service_03_[name].jpg`
- 프롬프트:
  - `Premium thumbnail photo for [specific service/product/process name] in [industry], clean background, realistic commercial quality, no text`
- 용도:
  - 서비스 카드, 상세 모듈 카드, 추천 카드, 튜토리얼 예시 카드

파일명은 절대 임의로 하지 말고, **무엇을 담았는지 바로 알 수 있게 저장**한다.

---

# CLAUDE 본문 내 ASSET ASSUMPTION — 신규 필수

`ASSET PREP BLOCK` 아래 실제 구현 지시문에서는, **이미 모든 이미지가 생성되어 Google Drive에 업로드되어 있다고 가정**하고 아래 문장을 넣는다.

```text
Assume the visual asset pack listed above has already been generated, uploaded to Google Drive, and is available to use.
Use those assets intentionally from the first build.
Do not leave major hero sections, thumbnails, Why AX story cards, or presentation sections with empty placeholders when a matching prepared asset exists.
```

또한 중반부 구현 지시에서 아래 매핑을 분명히 적는다.

- `ax_cover_main.jpg` → AX 홈/소개 Hero
- `ax_signature_operation.jpg` → 핵심업무·프로세스 소개
- `ax_signature_output.jpg` → 대표 결과물/상품/서비스 카드
- `ax_workspace_bg.jpg` → Intro/Present/large banner background
- `ax_staff_action.jpg` → 일정/현장/담당자 관련 섹션
- `ax_manager_tablet.jpg` → 대표 대시보드·AI 브리핑 설명
- `ax_report_evidence.jpg` → 리포트·증빙·Evidence 화면
- `why_ax_01~03` → 기획의도 / Why AX 스토리 순서대로 배치

---

# AX 자산 사용 규칙 — 강화 필수

- 사진을 무작정 많이 쓰지 말고, **핵심 화면마다 1개의 강한 이미지**를 쓰는 방식으로 절제한다.
- Background 사진 위에는 반드시 Overlay / Gradient / Contrast Control을 적용하여 텍스트 가독성을 보장한다.
- 썸네일 사진은 Card Radius / Ratio / Shadow / Crop 스타일을 통일한다.
- Hero 사진과 Thumbnail 사진의 무드가 너무 다르면 안 된다. 같은 브랜드 촬영처럼 맞춘다.
- 업종별 실제감이 가장 중요하다. Generic office stock 느낌만 나면 실패다.
- 사진이 없는 카드에는 억지 placeholder 대신 아이콘/일러스트로 처리할 수 있지만, **Hero / Present / Why AX / Signature Card는 가능하면 실사 기반 자산을 우선**한다.

---

# PROMPT LENGTH RULE — 신규 필수

이미지 생성 프롬프트는 길게 늘어놓지 않는다.  
각 사진 프롬프트는 **1문장 중심 + 업종 키워드 + 톤 키워드 + “no text”** 정도면 충분하다.

즉,  
- 너무 짧아 정체성이 없으면 안 되지만
- 너무 길어 창의력을 죽여도 안 된다.

본 규격에서는 **“짧지만 목적이 분명한 프롬프트”** 를 권장한다.

---



# v6.3 UPDATE — Visual Polish Minimum Floor & Contrast Layer

> **v6.3 목적**
>
> v6.2가 Product Shell Parity / Preview / Tutorial / Why AX / Theme / Navigation의 기능적 완결성을 강화했다면, v6.3은 실제 Reference MVP에서 확인된 **모델별 시각 품질 편차, Hover·Micro Interaction 누락, Dark Sidebar의 흐린 글자, Soft/Off-white Surface의 과다 사용으로 인한 뿌연 인상**을 규격 차원에서 차단한다.
>
> 본 업데이트의 목적은 기능 수를 늘리는 것이 아니라 **어떤 구현 모델을 사용하더라도 최소한의 고급감·가독성·반응성(Interaction)을 동일한 하한선 이상으로 유지**하는 것이다.
>
> v6.2 이하와 충돌하면 본 v6.3 UPDATE가 우선한다.

---

# MOTION & MICRO-INTERACTION STANDARD — 신규 필수

Motion / Hover는 더 이상 선택적 Polish가 아니다. **클릭 가능하거나 상태가 변하는 UI에는 시각적 반응이 반드시 존재해야 한다.**

## Desktop 기본 규칙

- Button / Clickable Card / List Row / Table Row / Navigation Item / Tab / Selectable KPI는 Hover State 필수.
- 기본 Hover transition: `140~180ms ease-out`.
- 권장 변화량은 작고 절제되게 사용한다.
  - background tint 약한 변화
  - border / shadow 1단계 상승
  - `translateY(-1px ~ -2px)` 범위
  - icon 또는 chevron의 미세 이동/색 변화
- Tooltip / Popover / Helper는 즉시 번쩍 뜨는 느낌보다 `80~160ms` 정도의 짧고 자연스러운 지연감을 허용한다.
- Tab / Accordion / Drawer / Modal / Bottom Sheet Open-Close는 `160~240ms` 범위의 Fade / Slide / Scale Transition을 사용한다.
- 페이지 또는 주요 Section 진입 시 필요한 경우 `120~180ms` Fade-up / subtle slide를 사용할 수 있다.
- Table Row는 Hover 시 읽고 있는 행을 쉽게 추적할 수 있도록 약한 Surface 변화가 있어야 한다.

## Mobile 기본 규칙

모바일에는 Hover를 강제하지 않는다. 대신:
- `pressed / active / selected` feedback 필수
- Tap 시 80~160ms 내 명확한 상태 변화
- Bottom Nav / List / Button / Card에 Touch feedback 제공

## 금지

- Bounce
- 큰 Scale-up
- 과한 Parallax
- Neon Glow
- 반복 Pulse
- 의미 없는 Particle
- 300ms 이상 느린 Hover
- 모든 Card가 계속 움직이는 UI

`prefers-reduced-motion` 또는 Motion 감소 설정이 활성화되면 장식 Motion은 줄이되 **상태 변화 인지에 필요한 feedback까지 제거하지 않는다.**

---

# THEME CONTRAST & PURE WHITE SURFACE RULE — 신규 필수

Theme는 **Canonical 7개 조합**을 유지한다. 임의로 6개로 축소하지 않는다.

대신 모든 Theme에 공통으로 다음 **Global Utility Token**을 추가한다.

```text
PURE_WHITE_SURFACE = #FFFFFF
PURE_WHITE_TEXT    = #FFFFFF
NEUTRAL_TEXT       = #111827 또는 동급의 고대비 Neutral
```

이 Token은 Theme의 6 Color Token과 별개인 공통 가독성 Token이다.

## Pure White 사용 규칙

특히 Deep Teal / Olive Stone / Cocoa Taupe처럼 Canvas·Soft가 따뜻하거나 회색 기운을 가지는 Theme에서:

- Primary Card
- Table Surface
- Modal / Dialog
- 주요 Form Surface
- 중요한 KPI Card
- Settings 주요 Card

중 적절한 영역은 반드시 `#FFFFFF` Surface를 사용하여 화면 전체가 뿌옇게 보이지 않게 한다.

권장 비율:
- Main Canvas / Section Background: Theme Canvas/Soft 사용 가능
- 주요 Raised Surface의 약 `60~80%`: Pure White 사용 권장
- Soft Color는 Section 구분 / Secondary Card / Tint에 제한적으로 사용

Theme 선택 때문에 화면 전체가 Beige / Gray / Green Tint로 덮이면 실패다.

---

# DARK SIDEBAR READABILITY RULE — 강화 필수

Dark Sidebar의 **Menu Text는 Theme Color의 영향을 거의 받지 않는다.** 색상 차별화는 Icon / Active Pill / Thin Accent에서 만든다.

기본:

```text
Active Menu Text   = #FFFFFF
Primary Menu Text  = #F3F4F6 ~ #FFFFFF
Inactive Menu Text = 최소 #E5E7EB 수준
Section Label      = #AEB7C3 전후
Muted Metadata     = 최소 #94A3B8 수준
```

금지:
- Sidebar Menu Text에 Theme Accent Color를 직접 적용
- `opacity: 0.5` 이하의 Menu Text
- 흐릿한 Gray-on-Dark
- Active / Inactive의 차이를 글자 명도 저하로만 표현

Active 상태는 `White Text + Accent Icon/Pill/Background Tint` 조합을 우선한다.

Sidebar Icon Color Mapping은 v6.2 규칙을 유지하되, **Icon은 Color / Text는 White 계열** 원칙을 우선한다.

---

# VISUAL POLISH COMPLETION GATE — 신규 필수

기능이 정상 작동해도 아래 Visual Polish 기준을 통과하지 못하면 완료로 보고하지 않는다.

## 필수 검증

1. Desktop에서 클릭 가능한 주요 Element의 Hover Coverage `90% 이상`.
2. Button / Card / Row / Tab에 Hover 또는 Active/Pressed State 존재.
3. Table Row Hover 또는 Selected Row Recognition 존재.
4. Drawer / Modal / Bottom Sheet / Accordion / Tab 전환에 자연스러운 Transition 존재.
5. Mobile에서 Hover 대신 Touch/Pressed Feedback 존재.
6. 주요 Loading State에 Skeleton 또는 동급의 자연스러운 Loading UI 최소 1종 이상 존재.
7. Focus State가 사라지지 않으며 Keyboard 사용 시 현재 위치를 식별할 수 있다.
8. Motion 때문에 내용 읽기나 클릭이 늦어지지 않는다.
9. Dark Sidebar Menu Text가 실제 화면에서 깨끗한 White 계열로 읽힌다.
10. Deep Teal / Olive / Cocoa 계열 Theme에서도 주요 Card Surface가 Pure White를 적절히 사용해 뿌옇게 보이지 않는다.

## Visual QA 시 실제 확인

```text
Dashboard → KPI Hover → AI Card Hover → Table Row Hover → Tab 전환
→ Drawer Open/Close → Modal Open/Close → Theme 7종 전환
→ Deep Teal / Olive / Cocoa에서 White Surface 확인
→ Sidebar Text Contrast 확인 → Mobile Tap/Pressed 확인
```

단순히 CSS Class가 존재하는지만 확인하지 말고 실제 렌더링 결과를 확인한다.

---

# v6.2 UPDATE — Product Shell Parity & Side-Feature Quality Layer

> **v6.2 목적**
>
> v6.1이 App Shell / Settings / Theme / Tutorial / Why AX를 SYSTEM CORE로 승격한 뒤에도 실제 Reference MVP에서 반복된 **PC↔Mobile 기능 불균형, Device Preview 재귀/잘림, Tutorial의 정적화, Why AX 비노출, Navigation 의미 불일치, 날짜/시각 누락, Theme 수 부족**을 규격 차원에서 차단한다.
>
> Business Core / AI / Data / Action / Evidence는 기존 강점을 유지하며, 이번 버전은 **사이드 기능도 핵심 업무기능과 같은 수준으로 완성**하는 데 목적이 있다.
>
> v6.1 이하와 충돌하면 본 v6.2 UPDATE가 우선한다.

---


# PRODUCT SHELL PARITY CONTRACT — 신규 필수

기능의 `존재 여부`만 확인하지 않는다. **PC / 실제 Mobile / Device Preview에서 사용자가 동일한 목적을 달성할 수 있는지**를 검증한다.

PASS 1에서 아래 Matrix를 PROJECT_SPEC.md에 만들고, 완료 전 실제로 채운다.

| 기능 | Desktop | 실제 Mobile | 반대 Device Preview | Discoverable | Behavior Parity |
|---|---|---|---|---|---|
| 전체 Navigation | 필수 | 필수 | 필수 | 필수 | 필수 |
| 날짜 + 현재시각 | 필수 | 필수 | 필수 | 필수 | 필수 |
| Theme | 필수 | 필수 | 필수 | 필수 | 필수 |
| Font Scale | 필수 | 필수 | 필수 | 필수 | 필수 |
| Role / Permission Preview | 필수 | 필수 | 필수 | 필수 | 필수 |
| Tutorial | 필수 | 필수 | 필수 | 필수 | 필수 |
| Why / Story | 필수 | 필수 | 필수 | 필수 | 필수 |
| Demo Reset | 필수 | 필수 | 필수 | 필수 | 필수 |
| Surface Switch | 해당 시 | 해당 시 | 해당 시 | 필수 | 필수 |

한 칸이라도 이유 없이 비어 있으면 완료로 보고하지 않는다.

## Responsive는 삭제가 아니라 재배치

공간이 부족하다는 이유로 중요한 정보를 모바일에서 없애지 않는다. 축약 / 2줄 / Drawer 이동 / More Sheet 등으로 재배치한다.

예: 날짜/시각
- Desktop: `2026.08.29 (토) 01:37:42`
- Mobile: `08.29 토` + `01:37:42`처럼 압축 가능
- 날짜를 통째로 삭제하고 시간만 남기는 것은 금지


---


# DEVICE PREVIEW SAFETY CONTRACT — P0

Device Preview는 장식이 아니라 **현재 동일 Route / 동일 Data / 동일 State를 다른 Viewport에서 확인하는 기능**이다.

## 기본 규칙

- Desktop 실제 환경에서는 `Mobile 보기`만 제공한다.
- Mobile 실제 환경에서는 `PC 보기`만 제공한다.
- 현재 Device와 동일한 Preview 버튼은 숨기거나 비활성화한다.
- Preview 내부에서 다시 Device Preview를 열 수 없게 한다.
- `Mobile → Mobile Preview`, `Desktop → Desktop Preview`, `Preview → Preview` 재귀 중첩 금지.

## True Viewport

Mobile Preview는 실제 390px 브라우저 첫 화면과 동일하게 보여야 한다.

반드시 확인:
- Header 상단 잘림 0
- Footer/Bottom Nav 하단 잘림 0
- `scrollTop = 0`에서 시작
- safe-area 적용
- fixed/sticky 위치 정상
- 부모 `transform` 때문에 fixed가 깨지지 않음
- 이전 Desktop scroll 위치를 상속하지 않음
- 상/하단이 잘리고 중간만 떠 있는 Frame 금지

## Escape Path

모든 Preview에는 명확한 종료 경로가 있다.
- X 닫기
- Backdrop Tap (Modal 방식일 때)
- ESC 가능 시 지원

닫은 뒤 backdrop / pointer-events / body scroll / focus lock을 완전히 복구한다.

## Route 규칙

없는 `/mobile-preview` 같은 Route를 무조건 만들지 않는다. 가능하면 현재 Route에 viewport mode만 적용한다. 별도 Route가 필요하면 모든 지원 Route가 실제 존재하는지 전수 검증한다. 404는 P0다.


---


# NAVIGATION SEMANTICS & DISCOVERABILITY GATE

사용자가 기능을 `찾을 수 있어야` 구현된 것으로 간주한다.

- `더보기`를 누르면 추가 메뉴가 Drawer / Bottom Sheet / Menu Popover로 나타나야 한다. 특정 단일 화면으로 이동하면 안 된다.
- `오늘의 AX`는 오늘의 AX 화면으로 이동한다.
- `설정`은 설정을 연다.
- `시연`은 Guided Product Demo를 시작한다.
- 메뉴 Label과 실제 행동이 다르면 P1 UX Bug로 판정한다.

## Discoverability

Why AX / Settings / Theme / Tutorial / Demo Reset / Surface Switch가 파일이나 Route에만 존재해서는 안 된다.

완료 전 실제 사용자가:
`Navigation 진입 → 기능 발견 → 실행 → 종료/복귀`
를 할 수 있어야 한다.


---


# TUTORIAL / PRESENTATION CONTRACT

## Tutorial

첫 사용자용 3~5 Step. **실제 App 화면 위에서** 작동한다.

각 Step은 필요 시 실제 Route로 자동 이동하고, 대상 Component가 렌더링된 뒤 Spotlight를 표시한다.

금지:
- 뒤 화면이 비어 있음
- 별도 정적 Slide만 보임
- 설명하는 기능과 배경 Route가 다름
- Step 종료 후 Blur/Backdrop 잔존

## Presentation Mode

영업/대표/심사용 8~12 Step의 **Guided Product Demo**다.

실제 Route를 자동 이동하며 실제 Dashboard / 핵심 업무 / AI / Evidence / Customer Surface 등을 보여준다. PowerPoint식 독립 Slide Show로 대체하지 않는다.

## Overlay Lifecycle

Next / Back / Skip / Finish / Exit 후:
- backdrop 제거
- blur 제거
- pointer-events 복구
- body scroll 복구
- focus lock 해제
- 다음 Route 클릭 정상

하나라도 실패하면 P0.


---


# WHY AX / 기획의도 — DISCOVERABLE STORY STANDARD

Why AX는 `Route가 존재한다`거나 `16 Section 데이터를 만들었다`는 이유만으로 완료가 아니다.

## 필수

- Sidebar / Navigation에서 실제 발견 가능
- Desktop에서 실제 진입 가능
- Mobile에서 실제 진입 가능
- 마지막에 Dashboard/주요 Surface로 복귀 CTA 존재
- 일반적인 카드형 개발문서가 아니라 회사 맞춤 Story

## Business AX / Hybrid 권장 구조

12~16 Section 정도의 설명 중심 Story를 기본으로 한다.

흐름 예:
1. 회사의 현재
2. 왜 지금 바꿔야 하는가
3. AX란 무엇인가
4. 업종에서 AX가 중요한 이유
5. 현재 업무 Flow
6. 반복되는 실제 문제
7. 지금까지 vs 바뀌는 방향
8. 업무효율화만이 목표가 아닌 이유
9. 매출/재방문/재주문 Growth
10. AI가 실제 하는 일
11. AI → Action → Result
12. Data가 회사 자산이 되는 구조
13. 정책/기술사업화 의미
14. 확장 가능성
15~16. 회사 맞춤 Summary / Roadmap

### 설명 방식

일반론 뒤에는 반드시 `이 회사라면`에 해당하는 회사 맞춤 해석을 붙인다.

Accordion / Before-After / Flow / Highlight / Timeline을 내용에 맞게 섞고, 동일 Card Grid만 반복하지 않는다.


---


# SIDEBAR / MENU ICON COLOR SYSTEM

왼쪽 Sidebar와 Mobile Drawer의 메뉴 Icon은 전부 무채색 단색으로 두지 않는다.

## 목표

목차를 빠르게 구분할 수 있도록 **적당한 색 차이**를 준다. 너무 형광색이거나 너무 옅어서 의미가 없어지면 실패다.

## 기본 규칙

- Icon 자체 또는 30~34px 정도의 작은 Icon Container에 색을 적용한다.
- Container 배경은 해당 색의 약 10~14% Tint, Icon은 중간 채도 Tone을 권장한다.
- Active 메뉴는 같은 Hue를 조금 더 진하게 사용하고, 배경/좌측 Bar 등으로 선택상태를 추가 표현한다.
- 동일 Category 안에서도 모든 Icon을 완전히 똑같은 색으로 만들 필요는 없지만, 전체 Palette는 6~8개 이내로 제한한다.
- Emoji 문자 자체를 남발하지 말고 Lucide/outline 계열 Icon + Color Token을 기본으로 한다.

### 권장 Group Accent — v4/v8

Sidebar는 메뉴 하나마다 다른 Rainbow Color를 주지 않는다. **같은 분류의 메뉴는 같은 Hue Family**를 사용한다.

- 운영 / Workflow Group: Blue `#5B8DEF`
- 고객·매출 / Growth Group: Amber `#D79A43`
- AX·실증 / Intelligence Group: Teal-Green `#3C9A75`
- 관리 / System Group: Slate `#718096`

같은 Group 안에서는 필요 시 기본색의 Light / Base / Deep 3단계까지만 허용한다.
예: 운영 Group의 일정·배차·현장 메뉴는 모두 Blue Family이며, 메뉴마다 전혀 다른 색을 만들지 않는다.

Mobile Drawer에도 같은 Icon Color Mapping을 유지하여 PC와 정보 인지방식을 맞춘다.


---


# THEME LIBRARY — 7개 조합 / 각 6색 — v2.0 CANONICAL

> **중요:** 7개는 Theme의 개수이며, 각 Theme는 6개의 핵심 Color Token을 가진다.
> 이 7개 Palette는 기존 AX 원본에 존재하던 7 Palette를 v2.0의 유일한 Canonical Theme Library로 승격한 것이다.
> `Canvas`는 Theme Color로 강제하지 않고 `PURE_WHITE_SURFACE / NEUTRAL_CANVAS / Theme Soft Tint` 조합으로 파생한다.

| Theme | Shell | Primary | Secondary | Accent | Highlight | Soft |
|---|---|---|---|---|---|---|
| 01 Deep Navy Blue | `#0B1830` | `#2457D6` | `#1687A7` | `#17A889` | `#E7C873` | `#DCE8F7` |
| 02 Navy Gold | `#111A2D` | `#2847A7` | `#A37A28` | `#D0A84B` | `#F0D995` | `#EFE8D7` |
| 03 Emerald Gold | `#11332B` | `#0E7663` | `#2C9277` | `#B4862A` | `#E8CE88` | `#E2F0EA` |
| 04 Forest Sage | `#17352C` | `#356E58` | `#73977E` | `#A58E4D` | `#D9D2AA` | `#E5ECE5` |
| 05 Deep Teal | `#08323A` | `#087A83` | `#1597A3` | `#D2704C` | `#E9B59B` | `#DDEDEF` |
| 06 Onyx Gold | `#15171C` | `#343942` | `#6A717C` | `#B89032` | `#E0C76F` | `#E6E8EC` |
| 07 Pure White | `#FFFFFF` | `#171B20` | `#343B44` | `#6B7680` | `#D47A4A` | `#FAFAF8` |

## Theme 강제 규칙

- Theme Picker가 필요한 Surface에서는 **7개 Theme가 모두 실제 동작**해야 한다.
- Business AX Settings에는 **7개 Theme Picker를 실제 구현**한다.
- Customer Platform은 Public 사용자에게 Theme Picker를 억지로 노출하지 않지만, **동일한 7개 Theme Library를 내부 디자인 시스템 / 관리자 / 시연 Preview에서 사용**한다.
- Hybrid Demo/Preview에서는 AX에서 선택한 Theme 상태가 Customer Surface에도 전달되어 동일한 Brand Family로 보이게 한다.
- Theme 전환 시 Shell / Header Accent / Active Navigation / Primary Button / KPI Accent / AI Surface / Chart Accent / Badge / Highlight / Customer CTA / 선택 상태가 함께 변경된다.
- 본문 Neutral Text, Table, Form, Modal, Raised Surface의 가독성은 Theme와 분리한다.
- Theme 변경은 Desktop / Mobile / Device Preview에서 동일 상태를 공유한다.
- 특정 업종의 Brand Reference가 명확하면 7개 중 가장 가까운 1개를 Default로 삼되, 나머지 6개도 Settings/Preview에서 정상 선택 가능해야 한다.
- Public Customer Surface의 브랜드 일관성이 중요한 경우 일반 고객에게 Picker UI는 숨길 수 있으나, 선택된 Theme Token은 Customer Surface 전체에 일관되게 적용한다.

---

# v6.2 COMPLETION GATE — 추가 필수

기존 Gate에 더해 다음을 반드시 실제 상호작용으로 검증한다.

1. **Discoverability Gate** — Why/Settings/Theme/Tutorial을 Navigation에서 실제 발견
2. **Cross-device Parity Gate** — Desktop/Mobile/Preview 기능 목적 동등
3. **True Viewport Gate** — Preview 상하 잘림/재귀/404/닫기불가 0
4. **Navigation Semantics Gate** — More/Menu Label과 실제 행동 일치
5. **Date-Time Gate** — PC/Mobile 모두 날짜+시각 유지
6. **Theme Gate** — 7 Theme 실제 전환, PC/Mobile 상태 공유
7. **Icon Recognition Gate** — Sidebar/Mobile Drawer Icon 적정 색 구분
8. **Escape Path Gate** — Modal/Drawer/Preview/Tutorial에 정상 종료 경로

하나라도 실패하면 `완료`로 보고하지 않는다.

---

# v6.2 WHOLE-PRODUCT ACCEPTANCE RUN

```text
Fresh Load
→ 날짜/시각 Desktop 확인
→ Sidebar Icon Color 확인
→ 모든 1차 메뉴 클릭
→ Tutorial 시작
→ 실제 Route 자동 이동/Spotlight 확인
→ Skip/Finish 후 Overlay 완전 제거
→ Settings 진입
→ Theme 7종 전환
→ Font Scale
→ Role
→ Mobile 실제 Layout
→ Mobile 날짜/시각 확인
→ Mobile Drawer
→ More 버튼 의미 확인
→ Mobile에서 PC Preview
→ Preview 닫기
→ Desktop에서 Mobile Preview
→ 상하단 잘림 0 / scrollTop 0
→ Preview 내부 Preview 버튼 없음
→ Why AX Navigation에서 발견/진입
→ Mobile Why AX
→ Demo Reset
→ 초기상태 재확인
```

---

# INHERITED BASE — v6.1

아래 v6.1 전체 규칙은 본 v6.2 UPDATE와 충돌하지 않는 범위에서 그대로 유지한다.



# 미래AI랩 AX Design & Development System v6.1
## 업종 공통 AX MVP · Business AX · Customer Front · AI Ready · 자율개발 · 멀티모델 인수인계 · 100점 MVP 표준

# v6.1 UPDATE — Product Shell & Completion Layer

> **v6.1의 목적**
>
> v6.0의 Business Logic / AI / Data / Closed Loop 강점을 그대로 유지하면서,
> 프로젝트 후반에 자주 누락되던 **App Shell, Settings, Theme, Tutorial, Why AX, Navigation Integrity, Whole-App QA**를
> “있으면 좋은 기능”이 아니라 **완료를 위해 반드시 통과해야 하는 SYSTEM CORE**로 승격한다.
>
> v6.0 이하 규칙과 충돌할 경우 이 v6.1 UPDATE가 우선한다.

---

# 0-A. SYSTEM CORE — 업무기능과 별개의 필수 완결성 레이어

모든 Business AX 프로젝트는 업종별 CORE와 별개로 다음 **SYSTEM CORE**를 반드시 가진다.

```text
SYSTEM CORE — 생략 불가
1. Global App Shell / Navigation
2. Settings
3. Theme System
4. Font Scale
5. Tutorial / Onboarding
6. Why AX / 기획의도
7. Role / Permission Preview
8. PC ↔ Mobile Preview
9. Demo Reset
10. Surface Switcher (Customer Front가 있을 때)
11. Navigation / Modal / Drawer Integrity
12. Final Product Completion Gate
```

### 강제 규칙

- 업종별 CORE가 아무리 잘 구현되어도 SYSTEM CORE가 미완료면 프로젝트를 `완료`로 보고하지 않는다.
- PLUS를 구현하기 전에 SYSTEM CORE의 필수 항목을 먼저 끝낸다.
- Master Prompt의 IMPLEMENTATION PRIORITY에는 업종 CORE와 함께 `SYSTEM CORE`를 별도 표기한다.
- “마지막에 시간이 남으면” 구현하는 부가항목으로 취급하지 않는다.

---

# 0-B. 구현 우선순위 v6.1 — 마지막으로 밀리지 않게 한다

기존처럼 Why AX / Settings / Tutorial을 최종 10순위에 몰아넣지 않는다.

권장 순서:

```text
PASS 1 — 설계 잠금

PASS 2-A — Product Foundation
1. App Shell / Navigation
2. Design Token / Theme Provider / Font Scale Provider
3. Route / Role / Demo Repository

PASS 2-B — Business CORE
4. Dashboard
5. 핵심 업무 Flow
6. AI / Action / Evidence
7. Customer Front / Data Bridge (해당 시)

PASS 2-C — Completion Layer
8. Settings 실제 동작
9. Tutorial 실제 동작
10. Why AX 완성
11. Device / Role / Surface Switch 실제 동작
12. Whole-App Acceptance Run
```

**Completion Layer가 끝나기 전 프로젝트 완료 금지.**

---

# 0-C. Theme System v6.1 — “보이는 선택지는 반드시 실제 동작”

기존 6-color palette 원칙은 유지한다.

다만 Theme 구현 완료기준을 다음처럼 강화한다.

## 최소 Theme Preset

모든 AX 프로젝트에서 [SUPERSEDED] 7개 Canonical Theme가 모두 실제 동작해야 한다. 대표 3종은 빠른 Smoke Test에 사용할 수 있으나 Full QA를 대체하지 않는다.

```text
1. Brand Default
2. Deep / Dark
3. Clean / Light
```

각 Preset은 6-color palette를 사용한다.

추가 Theme Preset은 PLUS로 둘 수 있다.

### 절대 규칙

- 화면에 Theme Dot / Theme Button이 보이면 전부 실제로 작동해야 한다.
- 색상 변경 시 Sidebar만 바뀌고 Card/Table/Accent가 그대로인 반쪽 구현 금지.
- 본문 text / neutral surface는 Theme에 물들지 않는다.
- Theme 변경은 새로고침 후에도 Demo Session 범위에서 유지하는 것을 권장한다.
- 모바일에서도 동일 Theme가 반영되어야 한다.

### Settings 필수 UI

```text
설정 > 화면
- 테마: Brand / Deep / Light
- 글자크기: 작게 / 기본 / 크게
- 모션 줄이기: On / Off
```

---

# 0-D. Settings Completion Standard

Settings는 빈 껍데기 페이지가 아니다.

최소:

```text
[화면]
Theme
Font Scale
Motion Preference

[사용자/권한]
Role Preview
Permission Matrix Preview

[데모]
Demo / Live 상태
Demo Reset
Tutorial 다시 보기

[데이터]
Data Source
마지막 업데이트
CSV 가져오기 / 샘플 / 필드 구조

[AI]
AI Ready 상태
AI가 보는 데이터 / 역할 / 향후 연결

[기술·사업화 자산]
해당 회사에 존재하는 경우만
```

Settings의 각 Toggle / Button / Picker는 실제 상태변화를 만들어야 한다.

---

# 0-E. Tutorial System Specification v6.1

Tutorial은 단순 Overlay 몇 장이 아니다.

## 기본 UX

권장 3~5 Step.

```text
[이전] [다음]
[건너뛰기]
[완료]
```

설정에서 `튜토리얼 다시 보기` 가능.

## Spotlight / Overlay 구현 규칙

Tutorial Overlay가 있는 경우 반드시 다음을 지킨다.

- spotlight 대상은 클릭 가능해야 하는 Step에서 실제 클릭 가능
- 설명만 하는 Step이면 대상 클릭을 막아도 되지만 CTA는 항상 클릭 가능
- Overlay가 종료되면 backdrop DOM 또는 active state를 즉시 제거
- `pointer-events`가 body/app root에 남지 않게 한다
- `overflow: hidden` / scroll lock을 종료 시 반드시 해제
- route 이동 시 이전 Tutorial backdrop 제거
- Drawer / Modal을 Tutorial Step에서 열었다면 Step 종료 시 정상 cleanup
- Mobile Drawer와 Tutorial Overlay z-index 충돌 금지
- ESC 또는 명시적 닫기 동작을 제공할 수 있다
- 페이지 재진입 시 ghost overlay가 남지 않는다

## 권장 Z-Index Scale

```text
base content      0~10
sticky/header     20~30
drawer            40
modal backdrop    50
modal             60
tutorial backdrop 70
tutorial target   80
tutorial popover  90
toast             100
```

프로젝트에서 다른 Scale을 써도 되지만 상대적 우선순위는 명확해야 한다.

## Tutorial 종료 Acceptance

다음이 모두 참이어야 한다.

- 화면이 더 이상 dim / blur 상태가 아님
- Sidebar 클릭 가능
- 모든 Button 클릭 가능
- Scroll 정상
- Mobile Drawer 정상
- Route 이동 정상

---

# 0-F. Navigation / Modal / Drawer Integrity

모든 Interactive Layer는 공통 상태규칙을 가진다.

### Modal / Drawer 닫기 후 반드시

```text
backdrop 제거
pointer-events 복구
body scroll 복구
focus 복구
route state 정상
```

### 금지 버그

- 화면만 흐리고 클릭 불가
- invisible overlay가 전체화면을 덮음
- Drawer 닫혔는데 backdrop 유지
- Modal 뒤에서 또 Modal이 열려 z-index 꼬임
- Mobile 메뉴를 닫은 뒤 본문 클릭 불가
- Browser Back 후 Scroll Lock 유지

이 중 하나라도 발견되면 **P0 Interaction Bug**로 취급하고 완료 전에 수정한다.

---

# 0-G. Why AX Enforcement v6.1

기존 12~16 Story Section / 3,000~5,000자 원칙을 유지한다.

추가 강제:

- `Why AX / 기획의도` Route가 실제 존재해야 한다.
- Sidebar 또는 Presentation Mode에서 접근 가능해야 한다.
- 회사 맞춤 Story가 없는 Placeholder 금지.
- 업종별 실제 Data Flow / Before-After / Revenue Growth / Data Asset / AI / Scale-up을 포함한다.
- Demo Company라면 Demo임을 밝히되 회사형 Story를 충분히 구성한다.
- Why AX가 없으면 프로젝트 완료 불가.

### Dashboard Entry Point 권장

Dashboard 하단 또는 Overview에:

```text
왜 이 AX를 만들었나요?
[기획의도 보기]
```

를 둘 수 있다.

---

# 0-H. Whole-App Acceptance Run — 체크리스트가 아니라 실제 동작검증

최종 QA는 문서상 체크 표시만 하는 것이 아니다.

Claude는 완료 보고 전에 최소 1회 다음 Journey를 실제로 순서대로 검증한다.

```text
Fresh Load
→ Tutorial Start
→ Next / Back
→ Skip 또는 Complete
→ Sidebar 1차 메뉴 모두 클릭
→ 주요 핵심 Flow 1회
→ AI Modal 열기 / 닫기
→ Settings 이동
→ Theme 3종 변경
→ Font Scale 변경
→ Role Switch
→ PC / Mobile Preview
→ Customer Front 이동 (해당 시)
→ Business AX 복귀
→ Why AX 진입
→ Demo Reset
→ 주요 화면 재확인
```

### 실패 조건

다음 중 하나라도 있으면 완료 보고 금지.

- 죽은 Sidebar Menu
- 클릭 안 되는 Button
- Overlay / Blur 고착
- Horizontal overflow
- Drawer / Modal cleanup 실패
- Theme 미반영
- Font Scale 미반영
- Role UI 미변경
- Why AX 부재
- Surface Switch 실패
- Demo Reset 후 상태 꼬임

---

# 0-I. Completion Gate — Definition of Done v6.1

아래 Gate를 모두 통과해야 `MVP COMPLETE`라고 보고한다.

## GATE 1 — Business
- 회사 핵심 Flow 동작
- KPI → Detail → Insight → Action 동작

## GATE 2 — AI
- 고가치 AI 위치 3~6곳
- 근거 설명
- Action 연결

## GATE 3 — Product Shell
- Navigation 정상
- Settings 정상
- Theme 정상
- Font Scale 정상
- Tutorial 정상
- Why AX 정상

## GATE 4 — Multi Surface / Role
- PC / Mobile 정상
- Role 차이 실제 반영
- Customer Front가 있으면 왕복 및 Data Bridge 정상

## GATE 5 — Interaction Integrity
- Modal / Drawer / Overlay P0 Bug 없음
- Empty / Loading / Error / Success 처리

## GATE 6 — Project Memory
- PROJECT_SPEC.md
- PROJECT_STATE.md
- DECISIONS.md
최신 상태

하나라도 실패하면 PROJECT_STATE에 `BLOCKED FOR COMPLETION`으로 기록하고 해당 범위부터 수정한다.

---

# 0-J. 기본 기술스택 권장 v6.1

신규 미래AI랩 AX 프로젝트의 기본값은 특별한 이유가 없으면:

```text
Next.js
TypeScript
Tailwind CSS
Vercel
Supabase (필요 시)
```

을 권장한다.

Vite + React도 충분히 사용 가능하지만 다음 경우에 선택한다.

- 기존 Repository가 Vite
- 순수 Client Dashboard
- 서버 Route가 불필요
- 사용자가 명시적으로 Vite 선택

Vercel의 Framework Preset만 바꿔서 Vite 코드를 Next.js로 간주하지 않는다.
기술스택 변경은 코드 구조 자체를 변경하는 작업이다.

---

# 0-K. Master Prompt 자동 삽입문 v6.1

회사별 Master Prompt에는 다음 취지를 자동 포함한다.

```text
[PRODUCT COMPLETION GATE]

이번 프로젝트에서 업무기능 구현만으로 완료로 간주하지 않는다.
업종 CORE와 별도로 SYSTEM CORE를 반드시 완료하라.

SYSTEM CORE:
- App Shell / Navigation
- Settings
- 최소 3개 실제 Theme Preset
- Font Scale
- Tutorial + Replay
- Why AX
- Role / Device Preview
- Demo Reset
- Surface Switcher(해당 시)
- Modal / Drawer / Overlay Integrity

마지막에는 Whole-App Acceptance Run을 실제 사용자 Journey 순서대로 1회 수행한다.
Overlay가 남거나, 메뉴가 클릭되지 않거나, Theme/Font/Role이 실제로 바뀌지 않거나,
Why AX가 없으면 프로젝트 완료로 보고하지 않는다.
```

---

# 0-L. v6.1 최종 원칙

> **기능이 많다는 것과 제품이 완성됐다는 것은 다르다.**
>
> 미래AI랩 AX의 완료기준은
> `Business Logic + AI + Data + Product Shell + Story + Interaction Integrity`가 함께 닫히는 것이다.




> **목적**
>
> 이 문서는 미래AI랩이 제조, 도소매, 외식, 물류, 서비스, 웰니스, 교육, 커머스, 전문서비스 등
> **어느 업종의 AX MVP를 만들더라도 기본값으로 적용하는 공통 설계·개발 기준**이다.
>
> 프로젝트별로 바뀌는 것은 **업무 로직, 데이터, 고객 흐름, 브랜드 표현, AI 적용 위치**이고,
> 아래의 가독성·정보위계·테마·반응형·기획의도·역할·AI Ready·QA 기준은 특별한 이유가 없으면 유지한다.

---



# 0. v6.0 핵심 추가 — “한 번 잘 설계하고, 모델이 바뀌어도 흔들리지 않는 AX 개발체계”

v6.0은 v5.0의 철학을 유지하면서 다음 6가지를 추가한다.

1. **첫 Master Prompt 자동 실행문 의무화**
2. **CORE / CONDITIONAL / PLUS 우선순위 체계**
3. **PROJECT_SPEC.md 자동 생성**
4. **PROJECT_STATE.md 자동 갱신**
5. **DECISIONS.md 설계결정 기록**
6. **특허·벤처·연구개발 등 기술자산을 AX 내부에서 실제 자산처럼 표시**

핵심 목표:

> **ChatGPT에서 깊게 기획한 내용을 Claude Code가 처음부터 정확히 적용하고,
> Fable → Opeus 등 모델이 바뀌어도 프로젝트의 목표·범위·진행상황이 끊기지 않도록 만든다.**

---

# 0-1. 회사별 첫 Master Prompt에 반드시 삽입할 실행문

앞으로 ChatGPT가 **회사별 첫 Master Prompt**를 생성할 때
다음 실행문을 **항상 맨 앞에 자동 삽입**한다.

사용자가 이 문장을 기억하거나 별도로 메모할 필요가 없도록 한다.

```text
[필수 시작 지시]

개발을 시작하기 전에 함께 제공된
「미래AI랩 AX Design & Development System v6.0」 전체를 먼저 읽고
공통 개발규격, 품질기준, 자율개발 원칙을 파악하라.

그 다음 이번 회사의 Master Prompt 전체를 읽고
이번 프로젝트의 회사별 최종목표와 기능범위를 확정하라.

함께 제공된 Front Design / Reference Image는
시각적 방향을 이해하기 위한 디자인 레퍼런스로 사용하라.

우선순위가 충돌할 경우 다음 순서를 따른다.

1. 사용자의 가장 최근 명시적 지시
2. 이번 회사 Master Prompt
3. PROJECT_SPEC.md
4. 미래AI랩 AX Design & Development System v6.0
5. Front Design / Reference Image
6. Claude의 자율 판단

세 자료를 모두 충분히 이해한 뒤,
별도 확인 질문 없이 개발을 시작한다.

다만 Hard Blocker에 해당하는 경우에만 사용자에게 확인을 요청한다.
```

### 중요

이 실행문은 **v6 안에만 적혀 있는 것으로 끝내지 않는다.**

회사별 첫 Master Prompt 생성 시
**반드시 실제 Master Prompt 첫머리에 다시 복사하여 삽입**한다.

---

# 0-2. 처음부터 MD만 따로 읽히는 별도 세션은 기본값이 아님

권장 시작 방식:

```text
v6.0 MD
+
회사 Master Prompt
+
Front Design Reference
→ 첫 요청에서 동시에 제공
```

먼저 MD만 보내고 “읽기만 해”라고 한 뒤
두 번째 요청에서 개발을 시작하는 방식은 기본값이 아니다.

이유:
- 왕복 증가
- 컨텍스트 분리
- 사용자의 추가 작업 증가

첫 요청 한 번에 읽고 → 해석하고 → 개발을 시작하도록 한다.

---

# 0-3. 초기 구현은 “사용자 1회 요청 / Claude 내부 2-Pass”로 진행

첫 실행에서 모든 기능을 무작정 동시에 코딩하지 않는다.

Claude 내부적으로 다음 두 Pass를 거친다.

## PASS 1 — 설계 잠금

먼저 코드 작성 전 또는 초기 코드와 함께 다음을 확정한다.

- PROJECT FINAL OBJECTIVE
- CORE / CONDITIONAL / PLUS
- Information Architecture
- Route
- Data Model
- Role
- Customer Front 필요성
- AI 적용 위치
- Theme / Design Token
- Data Source 전략
- Demo / Live 경계
- 1차 MVP 완료기준

그 결과를 `PROJECT_SPEC.md`에 기록한다.

## PASS 2 — 핵심 구현

PASS 1을 기반으로 바로 이어서:

- App Shell
- Dashboard
- 핵심 Business AX
- 필요한 Customer Front
- Responsive
- Theme
- Role
- AI Ready
- Demo Repository
- 핵심 Closed Loop

를 구현한다.

### 중요

PASS 1이 끝났다고 사용자에게 멈춰서 승인받지 않는다.
Hard Blocker가 없다면 PASS 2까지 연속으로 진행한다.

---

# 0-4. CORE / CONDITIONAL / PLUS

v6.0부터 모든 프로젝트 기능을 세 등급으로 분류한다.

## CORE — 반드시 구현

이 회사의 1차 MVP 목적을 달성하는 데 필수.

예:
- 큰 글자 / 반응형
- 핵심 업무흐름
- Dashboard
- KPI → Detail → Action
- Demo / Live 구분
- 기획의도
- 기본 QA
- 회사별 핵심 AI Ready 또는 계산 로직

CORE가 완성되지 않은 상태에서 PLUS 기능을 먼저 만들지 않는다.

## CONDITIONAL — 회사에 해당할 때만 구현

예:
- Customer Front
- 생산
- 수출
- 예약
- RLS
- 특허
- 벤처
- B2B
- AI API
- 외부 API

“좋아 보인다”는 이유만으로 자동 추가하지 않는다.

## PLUS — 시간·효과가 있을 때

예:
- Presentation Mode 고도화
- 7 Theme 전체 Premium Polish
- 고급 Motion
- Evidence Log 고도화
- Customer Front Premium Polish
- 추가 리포트
- 장식성 시각요소

PLUS는 CORE와 CONDITIONAL을 방해하지 않는 범위에서만 수행한다.

---

# 0-5. 개발 우선순위 강제 규칙

Claude가 다음 작업을 선택할 때:

```text
CORE 미완료
→ CORE

CORE 완료 + 필요한 CONDITIONAL 미완료
→ CONDITIONAL

둘 다 충분
→ PLUS
```

순서를 사용한다.

최종목표 달성에 관계없는 PLUS 기능을
“자율개발”이라는 이유로 계속 추가하지 않는다.

---


# 0. v5.0의 목적 — “처음 기획은 깊게, 이후 구현은 자율적으로”

v5.0은 단순 UI/UX 규격이 아니다.

미래AI랩의 실제 개발 방식에 맞춰 다음 운영방식을 기본값으로 정의한다.

```text
회사 분석 / AX 전략 / 최종목표 설계
        ↓
ChatGPT와 충분히 기획
        ↓
회사 전용 Master Prompt + 본 v5.0
        ↓
Claude Code가 큰 뼈대와 핵심 기능을 한 번에 구현
        ↓
뼈대가 안정된 이후에는 Claude Code와 직접 빠르게 조정
        ↓
최종 QA / 실데이터 / AI / Supabase / 정책자료 고도화
```

핵심 철학:

> **ChatGPT는 설계자·전략가 역할에 집중하고, Claude Code는 시공자·현장개발자 역할에 집중한다.**

화면과 데이터 구조가 이미 안정된 뒤 작은 색상·여백·문구·UI 조정까지
매번 ChatGPT를 거쳐 긴 프롬프트로 전달하는 것을 기본 흐름으로 삼지 않는다.

그 단계에서는 Claude Code와 직접 대화하여 빠르게 수정하는 것을 권장한다.

---

# 0-1. Source of Truth — v5.0은 압축하지 않는 원본 규격

본 문서는 미래AI랩 AX 개발의 **Canonical Source of Truth**다.

향후 Skill, CLAUDE 지침, Project Prompt 등을 만들더라도
본 문서의 핵심 내용을 과도하게 압축하여 대체하지 않는다.

권장 구조:

```text
[Full Spec]
미래AI랩 AX Design & Development System v5.0

[Thin Skill / Wrapper]
- 언제 v5.0을 적용하는지
- 프로젝트 정보를 어디에서 읽는지
- 어떤 순서로 작업하는지
- 완료기준이 무엇인지

[Company Master Prompt]
- 회사정보
- AX 아이디어
- 실제 업무
- 최종목표
- 핵심 기능
- 고객 플랫폼
- 정책/기술사업화 방향
```

즉 **Skill은 v5.0의 대체물이 아니라 v5.0을 정확히 적용시키는 실행 스위치**다.

---

# 0-2. 단계별 자율성

기존의 “자율성 약 55%”를 모든 개발단계에 동일하게 적용하지 않는다.

## A. 전략·기획 단계
자율성: **약 50~60%**

- 회사 업종과 실제 정보에 근거
- 사용자가 원하는 사업방향을 우선
- 과도한 기능 확장 금지
- 정책·시장성·고객 플랫폼·AI 적용 위치를 신중하게 결정

## B. 핵심 구현 단계
자율성: **약 75~85%**

최종목표·범위·정보구조가 이미 확정되었다면
Claude Code는 세부 구현을 사용자에게 매번 물어보지 않고 합리적으로 결정한다.

예:
- Component 분리
- State 구조
- Responsive 세부값
- Loading/Empty/Error
- Local demo store
- Minor UI detail
- 파일구조
- 반복되는 QA 수정

## C. 운영·폴리시·외부비용·비가역 결정
자율성: **낮음**

다음은 사용자 확인 없이 임의 결정하지 않는다.

- 유료 API 신규 결제
- 외부 서비스 가입
- 중요한 데이터 삭제
- Production DB 파괴적 변경
- 회사의 실제 가격/계약조건 결정
- 법률/세무/정책 관련 사실을 임의로 단정
- 고객에게 공개되는 중요한 브랜드 메시지 확정

---

# 0-3. 장시간 자율 실행 원칙

목표와 범위가 충분히 명확하면 Claude Code는
작은 작업이 끝날 때마다 “다음 단계 진행할까요?”라고 멈추지 않는다.

기본 지시:

> **현재 작업을 하나의 긴 실행 세션으로 간주하고,
> 최종목표와 완료기준에 도달할 때까지 합리적인 다음 작업을 스스로 선택하여 계속 진행한다.**

권장 실행 단위:

```text
Milestone 1 — 구조 / Design System / Routing
Milestone 2 — 핵심 Business AX
Milestone 3 — Customer Front / Platform
Milestone 4 — Role / Device / Theme / AI Ready
Milestone 5 — Closed Loop / Evidence / Demo
Milestone 6 — Responsive / QA / Polish
Milestone 7 — 사용자 작업 일괄정리
```

하나의 Milestone이 끝났다고 바로 멈추지 않는다.
다음 Milestone이 범위 안이면 계속한다.

단, 아래 **Hard Blocker**가 발생할 때만 중단해 사용자에게 요청한다.

---

# 0-4. Hard Blocker 규칙

Claude Code가 작업을 중단하고 사용자에게 즉시 물어봐야 하는 경우:

1. API Key / 비밀번호 / 인증코드 등 사용자만 제공할 수 있는 값
2. Production 데이터 삭제·초기화 등 되돌리기 어려운 작업
3. 비용이 발생하는 외부 서비스 활성화
4. 회사 사업방향을 바꿀 정도의 중요한 선택
5. 법률·세무·정책상 실제 확인이 필수인 사실
6. 서로 다른 선택지가 아키텍처를 크게 바꾸고 어느 쪽도 합리적 기본값이 아닌 경우

그 외:

- CSS 미세조정
- 파일 분리
- 임시 데이터 구조
- 테스트 데이터
- 반응형 수정
- 컴포넌트 구성
- UI 세부결정

등은 스스로 처리한다.

---

# 0-5. 사용자 작업 요청은 최대한 “한 번에 몰아서”

개발 중 다음과 같은 요청을 반복해서 사용자에게 던지지 않는다.

```text
SQL 실행해주세요.
다음 SQL도 실행해주세요.
환경변수 넣어주세요.
다음 단계에서 또 SQL 넣어주세요.
```

대신 **USER ACTION QUEUE**를 유지한다.

예:

```text
USER ACTION QUEUE

[DB]
1. migration_001.sql 실행
2. migration_002_rls.sql 실행

[ENV]
3. NEXT_PUBLIC_SUPABASE_URL 추가
4. NEXT_PUBLIC_SUPABASE_ANON_KEY 추가

[OPTIONAL]
5. OPENAI_API_KEY 또는 ANTHROPIC_API_KEY 추가

[ASSET]
6. 실제 제품사진 업로드
```

기술적으로 가능한 경우:
- Migration 파일 생성
- Seed 파일 생성
- RLS 파일 생성
- `.env.example` 생성
- Setup Script 생성

까지 Claude Code가 먼저 준비한다.

그리고 **사용자가 직접 해야만 하는 작업을 최종 또는 주요 Checkpoint에서 일괄 안내**한다.

단, SQL 실행이 없으면 이후 모든 기능 구현이 불가능한 진짜 Hard Blocker라면
그 시점에는 한 번 요청할 수 있다.

---

# 0-6. “최종목표”가 모든 자율개발의 기준

Claude Code가 장시간 자율적으로 작업하려면
단순 기능목록보다 **Project Final Objective**가 먼저 정의되어야 한다.

회사별 Master Prompt에는 반드시 다음 Section을 포함한다.

```text
PROJECT FINAL OBJECTIVE
```

그 아래:

1. 회사가 현재 어디에 있는지
2. 가장 중요한 사업문제가 무엇인지
3. AX로 어떤 변화를 만들 것인지
4. 어떤 데이터가 쌓여야 하는지
5. AI가 어떤 판단을 돕는지
6. Customer Front가 왜 필요한지
7. 매출상승 경로가 무엇인지
8. 정책자금·정부지원·벤처·특허 등 기술사업화에서 어떤 설명력을 만들 것인지
9. 1차 MVP가 어디까지 구현되면 성공인지
10. 2차 이후 무엇으로 확장할지

를 회사별로 작성한다.

---

# 0-7. Final Objective Generator

회사 정보를 받으면 아래 축으로 최적의 최종목표를 생성한다.

## A. Demand Proof
- 실제 고객
- 매출
- 반복구매
- 거래처
- 예약
- 수출
- 주문량

## B. Operating Pain
- 돈이 새는 곳
- 시간이 새는 곳
- 오류
- 누락
- 대표 의존
- 직원 의존

## C. Revenue Growth
- 전환
- 객단가
- 재구매
- 교차판매
- 이탈방지
- 신규고객
- B2B
- 수출

## D. Data Asset
- 무엇을 기록하고
- 무엇을 비교하고
- 무엇이 시간이 갈수록 회사 자산이 되는지

## E. AI Decision
- 사람이 놓치기 쉬운 판단
- 여러 지표를 함께 봐야 하는 판단
- 자연어 설명이 필요한 판단

## F. Customer Platform
- 고객이 직접 예약·구매·요청·추천·문의·재구매할 필요가 있는지
- 기존 Front가 충분하면 교체하지 않고 AX Layer만 붙일지

## G. Policy / Growth Story
정책자금과 정부지원 “합격을 꾸미기 위한 화면”을 만드는 것이 아니라,
**실제 AX 도입·데이터·운영성과를 증거로 보여주는 구조**를 만든다.

회사에 적합한 경우:
- 중진공
- 신보
- 기보
- 정부지원
- 벤처
- 특허
- 연구개발

설명력을 높인다.

## H. Scale-up
- 현재 고객
→ 회원화
→ 재구매/업셀
→ 추천
→ 인접 서비스
→ 인접지역
→ 업종 플랫폼

가능성을 객관적으로 검토한다.

---

# 0-8. 회사별 최종목표 예시

## 화장품 / K-Beauty

> 다채널 판매·상품·재고·생산·고객 행동 데이터를 연결하여
> 어떤 제품을 언제 더 생산하고 어느 채널에서 어떤 고객에게 판매해야 하는지
> 빠르게 판단할 수 있는 데이터 기반 K-Beauty 운영체계를 만든다.
>
> Customer Front에서는 제품탐색·개인화 추천·재구매 데이터를 축적하고,
> Business AX에서는 이를 매출·재고·생산 의사결정에 연결한다.
>
> 1차 MVP는 실제 데이터를 넣기 쉬운 구조, AI Ready, Role, 실증,
> Customer↔AX 연결까지 보여주는 것을 완료기준으로 한다.

## 제조업

> 견적·수주·생산·재고·납기·원가 데이터를 연결하여
> 납기지연·과잉재고·원가누락을 줄이고,
> 생산계획과 영업 우선순위를 데이터 기반으로 판단할 수 있는 AX 운영체계를 만든다.
>
> AI는 수요·납기·원가·거래처 상황을 함께 읽어 예외상황과 다음 행동을 설명한다.

## 외식 / 프랜차이즈

> POS 매출·메뉴·원가·시간대·인력·재방문 데이터를 연결하여
> 매장별 수익성과 메뉴 전략, 인력운영, 재구매를 개선한다.
>
> 장기적으로 가맹점 운영데이터를 표준화하여 다점포 운영 플랫폼으로 확장 가능한 구조를 만든다.

---

# 0-9. “다음 단계 진행” 명령의 해석

사용자가 Claude Code에게:

```text
다음 단계 진행해줘.
계속 고도화해줘.
목표까지 진행해줘.
```

라고만 말해도 다음 순서로 스스로 판단한다.

1. `PROJECT FINAL OBJECTIVE` 재확인
2. `Acceptance Test` 확인
3. 아직 미달인 가장 중요한 항목 선정
4. 가치 대비 비용이 가장 높은 개선부터 수행
5. 범위 안이면 계속 다음 개선 수행
6. Hard Blocker 또는 완료기준 도달 시에만 멈춤

단순히 “다음 페이지 하나 만들기”로 해석하지 않는다.

---

# 0-10. Polish Saturation Rule — 어느 순간부터 긴 프롬프트가 효율이 떨어지는 이유

UI 뼈대와 Design System이 이미 안정된 뒤에는
긴 외부 프롬프트가 항상 큰 개선을 만들지 않는다.

이유:

- 기존 Component 제약이 생김
- 이미 구축된 Design Token이 우선함
- 긴 요청 중 일부가 현재 코드와 충돌
- 전체맥락보다 로컬 수정이 더 중요한 단계로 진입

따라서 다음 단계부터는 **Claude Code와 직접 짧게 수정**하는 것이 기본이다.

### ChatGPT를 다시 호출하면 좋은 경우

- 정보구조를 다시 짜야 함
- 새로운 사업모델 추가
- Customer Platform을 새로 설계
- 정책/지원/벤처 Story 재설계
- 기능 우선순위가 흔들림
- 전체 UX를 객관적으로 재평가
- 개발범위/계약범위 재정의
- 특허/기술구조와 연결

### Claude와 바로 대화하는 게 좋은 경우

- “이 카드 조금 더 크게”
- “모바일에서 여기 두 줄”
- “색이 탁하다”
- “버튼 위치 변경”
- “이 Modal 추가”
- “Hover 조금 약하게”
- “이 화면에서 값 하나 더 보여줘”

---


# 0. v4.0 핵심 변경점

v2.0 대비 다음을 강화한다.

1. **색상 시스템 전면 강화**
   - 테마당 4색이 아니라 **6색 Theme Palette**를 기본값으로 사용
   - 본문 글자색·카드·표 등 중립색은 테마와 분리하여 항상 선명하게 유지
   - Dashboard 아이콘에 명확한 Module Color 적용
   - `Business AX` Wordmark는 Sidebar 배경과 분리되는 Premium Accent 사용

2. **기획의도(Why AX) 전면 고도화**
   - 단순 소개 페이지 금지
   - 회사별 실제 데이터·사업구조·문제·성장·정책환경을 연결한 **맞춤형 Story Page**
   - 제이랩테크·선진산업 수준의 정보량과 설명력을 기본값으로 지정
   - 2026년 정책환경은 **프로젝트 제작 시점의 공식기관 자료를 웹으로 재확인** 후 반영

3. **실시간 날짜·시간**
   - 하드코딩된 2025년 날짜 금지
   - 오늘 날짜, 요일, 현재시각(초 단위)을 기본 표시
   - 기간 필터 역시 현재 날짜 기준으로 자동 생성

4. **화면 전환 구조**
   - Business AX ↔ Customer Front를 1클릭으로 왕복
   - 대표 화면 ↔ 직원 화면을 Demo Role Switcher로 즉시 비교
   - PC ↔ Mobile Preview를 1클릭으로 확인

5. **RLS / 권한 체감형 Demo**
   - 단순 문서 설명이 아니라 역할별로 실제 메뉴·KPI·데이터가 보이거나 숨는 모습을 확인

6. **AI Ready Marker**
   - AI API가 실제 연결될 핵심 위치를 미리 표시
   - 버튼 클릭 시 “왜 AI가 필요한지 / 어떤 데이터를 보고 / 어떤 결과를 주는지” 설명

7. **90점 MVP → 98점 MVP 개선 기준 추가**
   - Action Lifecycle
   - Drill-down
   - Data Freshness
   - Demo/Live 구분
   - Empty/Loading/Error
   - AX Evidence Log
   - Presentation Mode
   - Cross-screen deep link

---


# 0-1. v4.0 핵심 추가 — “정보가 없어도 멈추지 않는 100점 MVP”

v4.0의 가장 중요한 원칙은 다음과 같다.

> **실제 고객 데이터·AI API·실운영 DB가 아직 없어도 MVP 제작은 멈추지 않는다.**
>
> 다만 실제 정보가 있는 부분은 적극적으로 실데이터를 반영하고,
> 정보가 없는 부분은 명확한 DEMO / SAMPLE / AI READY 상태로 설계하여
> 향후 실제 데이터와 API를 넣기 쉬운 구조까지 미리 완성한다.

즉, “정보가 없어서 기능을 빼버리는 MVP”가 아니라

```text
실데이터 있음
→ 실제 반영

실데이터 없음
→ 고품질 Demo Seed + 교체 가능한 Data Adapter

AI API 있음
→ 핵심 1개 기능 실제 연결

AI API 없음
→ 규칙 기반 Preview + AI Ready 설명 + 향후 연결지점 명확화

실 Auth/RLS 있음
→ 실제 권한 적용

실 Auth/RLS 없음
→ Demo Role Switcher + Permission Preview
```

방식을 사용한다.

이 원칙은 회사별 Claude Code 마스터 프롬프트를 만들 때도 그대로 적용한다.

---

# 0-2. “100점 MVP”의 정의

이 문서에서 말하는 100점은 **완성형 ERP·상용 SaaS·대규모 Production System의 100점이 아니다.**

다음 조건을 만족하는 **MVP 기준 100점**을 의미한다.

1. 첫 화면부터 제품처럼 보인다.
2. 회사 업종과 실제 업무가 화면에 녹아 있다.
3. PC·모바일에서 모두 사용할 수 있다.
4. 내부 AX와 고객 화면의 관계가 명확하다.
5. 대표/직원/고객의 권한 차이를 눈으로 확인할 수 있다.
6. KPI → Detail → Insight → Action 흐름이 이어진다.
7. AI가 어디에 왜 들어가는지 설명할 수 있다.
8. 실제 데이터가 없더라도 향후 교체 가능한 구조다.
9. 실제 데이터가 일부 있으면 즉시 일부 반영할 수 있다.
10. Demo / Live / Data Source가 명확하다.
11. 기획의도가 회사 맞춤형으로 충분히 깊다.
12. 3~5분 시연만으로 AX 도입 이유와 가치를 설명할 수 있다.

---

# 0-3. 프로젝트 입력정보가 부족할 때의 기본 대응

Claude Code용 마스터 프롬프트를 생성할 때 고객정보가 부족해도 사용자에게
사소한 내용을 모두 다시 물으며 작업을 멈추지 않는다.

### 반드시 필요한 정보가 없을 때

아래 3단계로 대응한다.

```text
A. 확실히 아는 정보
→ 실제 정보 사용

B. 합리적인 구조는 알지만 값이 없음
→ Demo Data 사용

C. 회사 특성상 추측하면 위험한 정보
→ Placeholder / 미입력 상태로 남김
```

예:

```text
실제 상품명 없음
→ Product 01, Product 02 또는 “상품명 입력 예정”

실제 매출 없음
→ DEMO DATA Badge가 붙은 샘플 매출

실제 원가 없음
→ 샘플 원가 또는 “미입력”

실제 효능/의료적 표현 없음
→ 임의 Claim 생성 금지

실제 거래처 없음
→ “거래처 A / 거래처 B” Demo

실제 API Key 없음
→ AI Ready Mode
```

**실제정보처럼 보이는 거짓 데이터를 만들지 않는다.**

---


# 1. 미래AI랩 AX의 한 줄 정의

> **고급스러운 SaaS처럼 보이되, 대표와 직원이 실제 업무를 더 빨리 이해하고 행동하도록 만드는
> 큰 글자·명확한 위계·데이터 기반 의사결정 중심의 AX 운영 시스템**

Customer Front는 다음과 같이 정의한다.

> **예쁜 홈페이지로 끝나지 않고 추천·예약·구매·문의·재구매 등 고객 행동을 만들고,
> 그 행동 데이터를 내부 Business AX와 연결하는 고객 플랫폼**

---

# 2. 최상위 UX 원칙 — Executive Readability First

## 2.1 기본 철학

- 일반 SaaS보다 **15~25% 큰 글자**
- 작은 회색 글자를 “세련됨”으로 착각하지 않는다
- PC 모니터는 모바일보다 멀리 두고 보기 때문에 PC 글자를 임의로 작게 만들지 않는다
- 40~60대 대표·임원·현장 담당자도 별도 확대 없이 읽을 수 있어야 한다

## 2.2 기본 Typography

| 용도 | 기본값 |
|---|---:|
| Root | **19px** |
| 글자 작게 | **17px** |
| 글자 기본 | **19px** |
| 글자 크게 | **21~21.5px** |
| Page Title | **32~36px** |
| Section Title | **23~26px** |
| Card Title | **19~21px** |
| Body | **18~19px** |
| Secondary Text | **16~17px** |
| Caption Floor | **16px 권장** |
| Sidebar Menu | **18~20px** |
| Button | **17~19px** |
| KPI | **36~44px** |
| KPI Large | **44~52px** |

## 2.3 한글 안전장치

- `word-break: keep-all`
- 긴 회사명·상품명·주소·이메일은 `overflow-wrap:anywhere`
- 중요한 정보에 `truncate` 남발 금지
- 버튼 텍스트 줄바꿈 금지
- 숫자는 `tabular-nums`

---

# 3. Business AX 기본 Layout

| 항목 | 기본값 |
|---|---:|
| Sidebar | **280px** |
| Workspace Max | **1600~1720px** |
| Desktop Padding | **32px** |
| Tablet Padding | **20~24px** |
| Mobile Padding | **16px** |
| Section Gap | **28~36px** |
| Card Gap | **16~20px** |
| Header Height | **60~68px** |

기본 구조:

```text
Dark / Theme Sidebar
│
├─ Brand / Business AX Wordmark
├─ 핵심 운영
├─ 성장·성과
├─ 운영도구
├─ 관리
└─ 사용자 / 제작사 / 외부 바로가기

Light Workspace
│
├─ Utility Header
├─ Page Header
├─ KPI
├─ Action
├─ Data / Chart
├─ AI Insight
└─ Detail / Report
```

---

# 4. `Business AX` Wordmark 표준

## 4.1 문제

Sidebar의 `Business AX` 글자가 Sidebar 배경과 너무 비슷하거나,
단순 흰색/회색으로 표시되면 제품 이름이 묻힌다.

## 4.2 기본 원칙

회사명은 **White / Near White**,
`Business AX` 또는 프로젝트 고유 AX 이름은 **Premium Signature Accent**로 분리한다.

예:

```text
MIRYEO
Business AX
```

- `MIRYEO` → White
- `Business AX` → Champagne Gold / Premium Accent

## 4.3 추천 기본 Accent

Deep Navy 계열 Sidebar:
- Champagne Gold: `#E7C873`
- Soft Gold: `#DDBA63`
- Warm Ivory Gold: `#F1D998`

Emerald / Forest Sidebar:
- Champagne: `#E8CE88`
- Warm Pearl: `#F2E7CB`

Warm Accent Sidebar:
- Rose Champagne: `#E9C6B2`
- Soft Copper Gold: `#D9AB82`

Onyx Sidebar:
- Platinum Gold: `#DBC77C`
- Silver Pearl: `#DDE3EA`

## 4.4 금지

- Sidebar 배경과 같은 Hue의 흐린 글자
- 낮은 대비의 투명도 텍스트
- 형광 노랑
- 지나치게 채도 높은 Gold

---

# 5. Dashboard Icon Color System

## 5.1 목적

Dashboard 아이콘이 모두 한 색이면 첫인상이 밋밋하고,
KPI의 의미 구분도 약하다.

## 5.2 원칙

아이콘은 **Module Color Tile**을 사용한다.

예:

| 의미 | 기본 Tone |
|---|---|
| 매출 / 성장 | Blue `#3B82F6` |
| 상품 / SKU | Violet `#7C5CE7` |
| 재고 / 위험 | Amber `#D99016` |
| 생산 | Orange `#D96D32` |
| B2B / 거래처 | Teal `#148C8C` |
| 수출 / 글로벌 | Cyan `#1687A7` |
| AI | Indigo `#5965D8` |
| 고객 | Rose `#C76C86` |
| 리포트 / 실증 | Emerald `#2F8A63` |
| 설정 / 시스템 | Slate `#64748B` |

### 구현

아이콘 자체만 컬러로 두기보다:

```text
[연한 Tone Background]
      Icon
```

형태의 40~48px Tile을 권장한다.

예:

```css
.icon-tile-sales {
  background: #EFF6FF;
  color: #2563EB;
}
```

## 5.3 색상 수

한 화면에서 눈에 보이는 Accent는 **최대 5~6계열**로 제한한다.

“컬러풀”과 “알록달록”은 다르다.

---

# 6. Theme System v3 — 6 Color Palette

## 6.1 핵심 철학

테마를 바꿀 때 **글자·카드·표가 같이 물들지 않는다.**

테마는 “분위기”를 바꾸고,
가독성은 항상 고정한다.

### 항상 고정되는 Neutral

```text
--neutral-bg
--neutral-surface
--neutral-surface-2
--neutral-text
--neutral-text-secondary
--neutral-border
--neutral-shadow
```

### 테마가 바꾸는 6개 Color

```text
--theme-shell
--theme-primary
--theme-secondary
--theme-accent
--theme-highlight
--theme-soft
```

Theme Picker에는 **6개의 Color Dot**을 보여준다.

---

# 7. 권장 7개 Theme Palette

> 아래 값은 기본 Seed다. 프로젝트 브랜드에 맞춰 Hue는 조정할 수 있으나
> `neutral-text`와 카드 가독성은 바꾸지 않는다.

## 7.1 Deep Navy Blue

1. Shell `#0B1830`
2. Primary `#2457D6`
3. Secondary `#1687A7`
4. Accent `#17A889`
5. Highlight `#E7C873`
6. Soft `#DCE8F7`

## 7.2 Navy Gold

1. Shell `#111A2D`
2. Primary `#2847A7`
3. Secondary `#A37A28`
4. Accent `#D0A84B`
5. Highlight `#F0D995`
6. Soft `#EFE8D7`

## 7.3 Emerald Gold

1. Shell `#11332B`
2. Primary `#0E7663`
3. Secondary `#2C9277`
4. Accent `#B4862A`
5. Highlight `#E8CE88`
6. Soft `#E2F0EA`

## 7.4 Forest Sage

1. Shell `#17352C`
2. Primary `#356E58`
3. Secondary `#73977E`
4. Accent `#A58E4D`
5. Highlight `#D9D2AA`
6. Soft `#E5ECE5`

## 7.5 Deep Teal

1. Shell `#08323A`
2. Primary `#087A83`
3. Secondary `#1597A3`
4. Accent `#D2704C`
5. Highlight `#E9B59B`
6. Soft `#DDEDEF`

## 7.6 Onyx Gold

1. Shell `#15171C`
2. Primary `#343942`
3. Secondary `#6A717C`
4. Accent `#B89032`
5. Highlight `#E0C76F`
6. Soft `#E6E8EC`

## 7.7 Pure White

1. Shell `#FFFFFF`
2. Primary `#171B20`
3. Secondary `#343B44`
4. Accent `#6B7680`
5. Highlight `#D47A4A`
6. Soft `#FAFAF8`

Pure White는 “하얗게 보이는 Tint Theme”가 아니라 실제 `#FFFFFF` 중심의 Neutral Theme다.

- Main Canvas / Raised Surface는 `#FFFFFF`를 기본으로 한다.
- 본문은 `#171B20`, 보조 텍스트는 `#343B44 ~ #6B7680` 범위를 우선한다.
- Accent는 CTA / Selected / Key Signal에만 제한적으로 사용한다.
- Warm / Gray / Beige Tint를 전체 Canvas에 씌우지 않는다.
- Pure White Shell에서는 Dark Sidebar용 White Text 규칙을 적용하지 않고, Dark Neutral Text를 사용한다.

---

# 8. 테마 가독성 강제 규칙

## 8.1 Dark / Tinted Theme의 Hue 오염 방지

어두운 색상 Theme라고 해서:

- 본문 글씨가 자주색으로 변함
- 카드 배경이 자줏빛으로 변함
- 표가 전체적으로 뿌옇게 변함

현상을 허용하지 않는다.

### 강제 규칙

```text
본문 Text         = Neutral 고정
Secondary Text    = Neutral 고정
Card              = Neutral White / Ivory 고정
Table              = Neutral 고정
Border             = Neutral 고정
Success/Warning    = 의미색 고정
Theme              = Sidebar + Primary + Accent + Selected State 위주
```

## 8.2 Contrast

- 일반 텍스트: WCAG 4.5:1 권장
- 큰 텍스트: 3:1 이상
- Sidebar 텍스트는 opacity로 흐리게 만들지 않는다
- `text-white/60` 같은 방식은 핵심 메뉴에서 금지

---

# 9. Customer Front 색상 개선 원칙

Customer Front가 너무 White + Navy만 사용되면 깔끔하지만 밋밋할 수 있다.

## 권장 비율

```text
Neutral / White      65~70%
Theme Soft Surface   15~20%
Primary / Secondary  7~10%
Accent / Highlight   5~8%
```

### 활용 위치

- Hero Background
- Category Icon
- Product Badge
- AI Finder Section
- Personal Routine
- Brand Story
- CTA Strip

### 금지

모든 섹션에 다른 배경색을 넣는 방식.

**색은 섹션 구분과 행동유도에 사용한다.**

---

# 10. Customer Front “덜 밋밋하게” 만드는 8가지

1. Hero에 Brand Gradient / Product Composition 활용
2. Category 아이콘에 4~6개의 통제된 Tone 적용
3. 추천 Product Card에 AI Badge / Best / New 등 시각적 Label
4. Product hover 시 이미지 1.03~1.05 Zoom
5. Editorial Style Brand Story Section
6. Personalized Routine Section에 별도 Soft Surface
7. Benefit / Trust 카드에 Module Icon Color
8. CTA Section은 Primary 대비를 확실히 준다

---

# 11. 실시간 날짜·요일·시각 표준

## 11.1 하드코딩 금지

다음과 같은 고정 날짜 사용 금지:

```text
2025.05.01 ~ 2025.05.31
```

## 11.2 기본 표시

Utility Header 또는 Sidebar 하단:

```text
2026년 8월 28일 금요일
13:52:08
```

초 단위 갱신.

## 11.3 구현

기본:

```ts
new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
```

Timezone은 프로젝트 설정으로 바꿀 수 있게 한다.

## 11.4 기간 Filter

기본값:

- 오늘
- 이번 주
- 이번 달
- 지난 30일
- 사용자 지정

현재 날짜 기준으로 자동 계산한다.

---

# 12. Surface Switcher — AX ↔ Customer Front

## 12.1 MVP 기본 기능

Business AX와 Customer Front가 함께 존재하는 프로젝트는
**1클릭 왕복 버튼을 반드시 제공**한다.

Business AX:

```text
[고객 화면 보기]
```

Customer Front:

대표/직원 Demo Mode 또는 관리자 계정에서:

```text
[Business AX 보기]
```

일반 고객에게는 관리자 버튼을 노출하지 않는다.

## 12.2 목적

- 개발 시 양쪽 화면 확인
- 대표 시연
- 정책자금/벤처 심사 시 구조 설명
- 내부 데이터 ↔ 고객 행동 데이터 연결을 직관적으로 보여줌

---

# 13. Device Preview Switcher — PC ↔ Mobile

PC에서 반드시 다음을 제공한다.

```text
[PC] [Mobile]
```

또는:

```text
Desktop Icon | Smartphone Icon
```

### Business AX
- PC AX
- Mobile AX

### Customer Front
- PC Customer Front
- Mobile Customer Front

를 각각 확인할 수 있어야 한다.

## 13.1 Preview Mode

모바일 Preview는 실제 Responsive CSS를 활용한 **Phone Frame** 또는
Viewport Resize 방식으로 구현한다.

가짜 Screenshot 이미지를 띄우는 방식은 사용하지 않는다.

---

# 14. Role Switcher — 대표 ↔ 직원

MVP Demo에서는 대표/직원의 차이를 바로 보여줄 수 있게 한다.

```text
[대표 화면] [직원 화면]
```

## 대표 화면 예

- 전체 매출
- 마진
- 현금흐름
- 거래처 전체
- 전략 AI
- 보고서
- 사용자/권한
- 정책/실증

## 직원 화면 예

- 본인 업무
- 담당 거래처
- 주문/재고/생산
- 업무 Action
- 업무용 AI
- 필요한 리포트

민감한:

- 전체 이익률
- 자금조달
- 대표 전략
- 직원 인사
- 전체 계정관리

등은 역할에 따라 숨길 수 있다.

---

# 15. RLS Preview — “권한이 다르다”를 눈으로 보여주기

## 15.1 단순 설명 금지

설정 페이지에 RLS라는 글자만 적지 않는다.

### UI 예시

```text
대표
✓ 전체 매출
✓ 전체 거래처
✓ AI 전략
✓ 사용자 관리

직원
△ 담당 매출
✓ 담당 거래처
✓ 업무 Action
× 전체 손익
× 사용자 관리

고객
× 내부 AX
✓ 본인 주문
✓ 본인 리포트
✓ 본인 요청
```

## 15.2 실제 MVP Role Switch

Role Switcher를 누르면:

- Sidebar Menu
- KPI
- Action
- Detail
- Button

이 실제로 바뀌어야 한다.

## 15.3 Supabase 연결 시

Demo Role Switcher를 실제:

```text
auth.users
profiles.role
RLS Policy
```

구조로 전환.

---

# 16. AI Ready Marker

## 16.1 목적

초기 MVP에서 실제 GPT / Claude API를 아직 연결하지 않았더라도
**“AI가 어디에, 왜 들어가는지”를 명확히 보여준다.**

## 16.2 표시

핵심 의사결정 화면에:

```text
[✨ AI 연동 예정]
```

또는

```text
[AI Ready]
```

Button / Badge 제공.

모든 카드에 넣지 않는다.

**프로젝트당 3~6개의 고가치 위치만 선택한다.**

## 16.3 클릭 Modal

제목:

```text
이 기능에는 AI API가 연결될 예정입니다
```

본문 예:

```text
무엇을 보나요?
- 최근 판매량
- 재고
- 제품별 마진
- 채널 성장률

AI가 무엇을 하나요?
- 여러 지표를 함께 읽고 이상징후를 해석
- 우선순위를 정리
- 다음 행동과 이유를 자연어로 설명

왜 필요한가요?
- 담당자가 여러 화면을 직접 비교하는 시간을 줄이고
- 놓치기 쉬운 위험이나 기회를 빠르게 발견하기 위함입니다.
```

하단:

```text
현재 MVP: 규칙 기반 계산
향후: GPT / Claude 등 LLM API 연결 가능
```

## 16.4 추천 AI Ready 위치

### Business AX
- Growth Center
- 상품 / 재고 Insight
- 생산량 추천
- 채널별 전략
- 고객/거래처 위험
- 보고서 자동 요약

### Customer Front
- 추천 Finder
- 개인화 Routine
- 상담 / Concierge

---

# 17. AI 적용 위치 선정 기준

AI는 “멋있어 보이는 곳”이 아니라 다음에 넣는다.

1. 사람이 여러 데이터를 함께 비교해야 하는 곳
2. 누락 위험이 큰 곳
3. 우선순위 결정이 필요한 곳
4. 자연어 설명이 중요한 곳
5. 매번 판단 방식이 조금씩 달라지는 곳

반대로:

- 단순 합계
- 단순 성장률
- 재고일수
- 날짜 계산
- 정렬
- 필터

는 코드 / SQL 로직으로 처리한다.

---

# 18. 기획의도(Why AX) — 가장 중요한 Story Page

## 18.1 목표

기획의도는 “굳이 안 봐도 되는 소개 페이지”가 되면 실패다.

대표, 정책기관 심사자, 투자자, 직원이 읽고:

```text
왜 지금 AX인가?
왜 이 회사인가?
무엇이 달라지는가?
왜 이 기능이 필요한가?
데이터가 어떻게 자산이 되는가?
매출이 어떻게 올라가는가?
정책환경과 무슨 관계인가?
향후 무엇으로 확장되는가?
```

를 이해해야 한다.

## 18.2 분량

권장:

- **12~16개 Story Section**
- 한국어 기준 대략 **3,000~5,000자 전후**
- 모바일에서는 Card / Timeline으로 분할
- 단순 긴 문단 금지

---

# 19. 기획의도 표준 Story Flow

## 01. 회사의 현재 위치

실제:

- 매출
- 고객 수
- 거래처
- 반복구매
- 유통채널
- 수출
- 생산
- 예약
- 운영량

등 **Demand Proof**를 사용한다.

---

## 02. 왜 지금 바꿔야 하는가

회사가 성장하면서:

- 데이터가 흩어지고
- 직원 의존도가 높아지고
- 판단이 늦어지고
- 매출 기회가 새고
- 대표가 직접 확인해야 하는 업무가 늘어나는

구조를 설명.

---

## 03. 현재 업무 흐름

```text
고객/주문
→ 직원
→ Excel / POS / ERP / 메신저
→ 대표 확인
→ 판단
→ 후속조치
```

실제 회사 방식에 맞게 변형.

---

## 04. 현재의 Pain Point

단순 “비효율”이 아니라:

- 돈이 새는 곳
- 시간이 새는 곳
- 오류가 발생하는 곳
- 고객이 이탈하는 곳
- 매출을 놓치는 곳

으로 구체화.

---

## 05. AX란 무엇인가

중학생도 이해할 수 있게:

> 회사의 일을 하나의 데이터 흐름으로 연결하고,
> 반복 업무는 시스템이 처리하며,
> 중요한 판단에는 AI가 근거와 다음 행동을 제안하도록 만드는 것.

---

## 06. `OO회사라면`

**반드시 회사 맞춤형 Section을 둔다.**

예:

```text
가연인터내셔널이라면
판매채널이 여러 곳이고 OEM 생산까지 연결되기 때문에,
판매속도와 재고·생산 판단을 하나로 묶는 것이 핵심입니다.
```

---

## 07. 회사 맞춤 AX Architecture

```text
Customer / Market
↕
Customer Front
↕
Business AX
↕
Data Layer
↕
AI Growth Layer
```

회사의 실제 흐름으로 재구성.

---

## 08. 핵심 기능과 이유

기능명만 쓰지 않는다.

```text
재고 예측
왜 필요한가?
→ 품절과 과잉재고를 동시에 줄이기 위해

고객 재구매 추천
왜 필요한가?
→ 기존 고객에서 반복매출을 만들기 위해
```

---

## 09. Before / After

### Before
사람 / Excel / 감 / 전화 / 메신저

### After
한 번 입력 / 자동연결 / 데이터 축적 / AI Action

---

## 10. 매출 상승 구조

최소 1개 이상 반드시 포함:

- 전환율
- 객단가
- 재구매
- 교차판매
- 이탈방지
- 판매채널 최적화
- 재고 품절방지
- 신규고객
- 추천인
- B2B 확대

---

## 11. 데이터 자산화

```text
업무 발생
→ 기록
→ 축적
→ 비교
→ Pattern
→ AI
→ 더 나은 판단
```

---

## 12. AI 적용 구조

**AI Ready Marker**와 연결.

- 어디서 AI가 필요한지
- 규칙 기반 계산과 LLM의 역할 차이
- 향후 API 연결 위치

표시.

---

## 13. 2026 정책환경

### 매우 중요

정책 관련 문구는 고정된 과거 내용을 무조건 복사하지 않는다.

**프로젝트 제작 당일 또는 가장 최근 시점의 공식기관 공개자료를 웹으로 확인한 뒤 작성한다.**

반드시 우선 확인할 기관:

- 중소벤처기업부
- 중소벤처기업진흥공단
- 신용보증기금
- 기술보증기금
- 지역신용보증재단
- 창업진흥원
- 관련 산업부처 / 지자체 / 지원기관

### 기본 분석 축

#### 중진공
- AI 도입·활용기업
- AX / 스마트화
- 혁신성장
- 생산성·사업모델 고도화
- 정책자금 연결 가능성

#### 신보
- 성장성
- 시장검증
- 확장성
- AI·데이터 기반 사업고도화
- 보증/투자 연결 가능성

#### 기보
다음 AX 관점으로 점검:

1. 전략·의지
2. 자원·조직
3. 기술·데이터
4. 활용·성과

#### 정부지원사업
- AX / AI 전환
- 스마트서비스
- 제조 AI
- 데이터
- 수출
- 사업화
- R&D

### 표시

정책환경 Card에는 가능하면:

```text
기관
핵심 흐름
우리 회사와 연결점
확인 기준일
공식 출처
```

를 표시한다.

---

## 14. 특허 / 벤처 / 연구개발 연결

회사에 실제 적합할 때만:

- 특허
- 벤처기업확인
- 연구개발전담부서
- 정부 R&D
- 기업부설연구소

등과 AX 데이터 / 시스템의 연결을 설명.

---

## 15. 1 → 2 → 3단계 확장

### 1단계
업무 효율 + 기존 매출 상승

### 2단계
Customer Front / AI 추천 / 반복매출 / 신규서비스

### 3단계
업종 특화 플랫폼 / 외부 고객 / SaaS / 산업 확장

단, 3단계가 허황되면 억지로 크게 쓰지 않는다.

---

## 16. 우리가 얻는 것

마지막에 매우 간단하게 정리:

```text
업무시간 ↓
누락 ↓
데이터 ↑
매출기회 ↑
반복매출 ↑
회사 자체 기술·데이터 자산 ↑
정책·투자 설명력 ↑
```

---

# 20. 기획의도 디자인 규격

사용 권장:

- Story Number
- 큰 제목
- 2~4줄 설명
- Flow Chip
- Before / After
- 숫자 Card
- Company Note
- 정책 Card
- Timeline
- Architecture Diagram

금지:

- 흰 카드에 긴 문단만 반복
- Generic AI 문구
- 어느 회사에 붙여도 똑같은 설명

---

# 21. KPI → Detail Drill-down

90점 MVP와 98점 MVP의 차이 중 하나.

KPI Card는 가능하면 클릭 가능하게 한다.

예:

```text
재고 위험 12개
       ↓ click
재고 위험 목록
       ↓
상품 Detail
       ↓
AI Insight
       ↓
Action
```

숫자만 보여주는 Dashboard에서 끝나지 않는다.

---

# 22. Action Lifecycle

AI 추천이나 업무 Action에 상태를 둔다.

```text
추천됨
→ 확인
→ 실행중
→ 완료
```

또는:

```text
보류
무시
```

무시할 때는 선택적으로 이유를 기록.

### 이유

AX가 단순 “추천을 보여주는 앱”에서
**추천 → 행동 → 결과 데이터**를 축적하는 시스템으로 변한다.

---

# 23. AX Evidence Log

정책·벤처·실증 가치가 큰 기능.

예:

```text
2026-08-28
AI 추천: A상품 추가 생산 검토

2026-08-29
대표 승인

2026-09-02
생산 요청

2026-09-15
품절 없이 판매 유지
```

### 활용

- AX 도입 실증
- 정부지원 결과보고
- 대표 경영기록
- AI 추천 성과 측정
- 향후 모델 고도화

MVP에서는 간단한 Demo라도 구조를 만든다.

---

# 24. Data Freshness / Provenance

각 중요 화면에 가능하면:

```text
마지막 업데이트 13:52
Demo Data
CSV 반영
Supabase Live
API Sync
```

중 하나를 표시.

“이 숫자가 어디에서 왔는가?”가 보이면 제품 신뢰도가 크게 올라간다.

---

# 25. Demo Mode / Live Mode

MVP:

```text
DEMO
```

를 정직하게 표시.

향후 실데이터 연결 후:

```text
LIVE
```

로 전환 가능하게 한다.

Demo인데 Live처럼 위장하지 않는다.

---

# 26. Presentation Mode

대표·심사자 시연용.

```text
[시연 모드]
```

클릭 시:

- 불필요한 설정 제거
- 핵심 KPI
- Before/After
- AI Action
- Customer Front
- 실증
- 기획의도

순서로 3~5분 Demo Story 제공.

이 기능은 일반 업무 메뉴와 별개여도 좋다.

---

# 27. 용어 설명 / 중학생 가독성

전문용어가 필요한 경우:

```text
SKU (상품을 구분하는 관리번호)
RLS (사용자별로 볼 수 있는 데이터를 나누는 보안기능)
API (다른 프로그램과 데이터를 자동으로 주고받는 연결통로)
```

처럼 첫 등장 시 설명.

툴팁 `?`도 적극 활용.

---

# 28. Customer Front ↔ Business AX Data Bridge

[SUPERSEDED] Customer/Partner Front가 있는 경우 단순 1개 예시가 아니라 Primary Conversion Goal과 핵심 Journey Event가 내부 KPI/Insight/Action/Workflow로 연결되는지 검증한다.

예:

```text
Customer Front
AI 추천 클릭 42회
↓
Business AX
관심도 상승 SKU
↓
상품/재고 Action
```

또는:

```text
고객 수거 요청
↓
내부 일정 자동 반영
```

[SUPERSEDED] 초기 Demo라도 Primary Journey의 핵심 Event→내부 반영→처리→상태/경험 Feedback의 대표 Closed Loop를 끝까지 보여준다.

---

# 29. Motion System

| 요소 | 권장 |
|---|---:|
| Hover | 0.15~0.25s |
| Modal | 0.2~0.3s |
| Drawer | 0.25~0.35s |
| Page Reveal | 0.3~0.5s |
| Stagger | 0.05~0.08s |

### Hover
- Card lift: -2~-3px
- Shadow 강화
- Product image: 1.03~1.05
- 과도한 Bounce 금지

---

# 30. Card System

1. KPI Card
2. Data Card
3. AI Insight Card
4. Action Card
5. Story Card
6. Policy Card

모든 카드가 똑같은 흰 박스가 되지 않게 한다.

---

# 31. Customer Front 기본 규격

| 항목 | 값 |
|---|---:|
| Max Width | **1200~1280px** |
| Body | **18~19px** |
| Product Title | **18~20px** |
| Hero | **44~64px** |
| Card Radius | **18~24px** |
| CTA | **48~56px** |
| Mobile Product Grid | **2열** |

---

# 32. Customer Journey

추천·예약·진단형은 Step-by-Step 적용.

```text
1. 대상
2. 문제/고민
3. 선호
4. 세부조건
5. 확인
6. 결과
```

완료 단계는 재진입 가능.

---

# 33. 반응형

최소 QA:

- 360
- 390
- 430
- 768
- 1024
- 1280
- 1440
- 1920

추가:

- Mobile Landscape
- Font Large
- Theme 7종
- 대표/직원 Role
- PC/Mobile Preview

---

# 34. 90점 → 98점 QA Checklist

## Visual
- [ ] `Business AX` Wordmark가 Sidebar에서 살아 있는가
- [ ] Dashboard 아이콘이 Module별 Color를 갖는가
- [ ] 한 화면 Accent가 5~6개 이내인가
- [ ] Theme Picker가 7개 Canonical Theme Preview/Swatch를 보여주는가
- [ ] 모든 Dark Theme에서도 본문·카드·표가 깨끗한 Neutral을 유지하는가
- [ ] Customer Front가 지나치게 White-only가 아닌가

## Story
- [ ] 기획의도가 12~16개 Section인가
- [ ] 회사 실제 정보가 충분히 들어갔는가
- [ ] 2026 정책환경이 최신 공식자료 기반인가
- [ ] 중진공/신보/기보 관점이 회사와 연결되는가
- [ ] Before/After가 구체적인가
- [ ] 매출상승 로직이 있는가

## Product
- [ ] Business AX ↔ Customer Front 1클릭
- [ ] 대표 ↔ 직원 1클릭
- [ ] PC ↔ Mobile 1클릭
- [ ] Role 변경 시 실제 UI가 달라지는가
- [ ] KPI → Detail → Action이 연결되는가
- [ ] Action 상태를 변경할 수 있는가
- [ ] Data Freshness가 보이는가
- [ ] Demo/Live 구분이 보이는가

## AI
- [ ] AI Fit Gate를 통과한 가치 높은 1~6곳에 AI/Logic Ready Marker가 있는가
- [ ] AI Modal에 데이터/역할/효과가 설명되는가
- [ ] 단순 계산과 LLM의 역할이 구분되는가
- [ ] AI Action에 근거가 있는가
- [ ] AI 추천 결과가 업무 Action과 연결되는가

## Operations
- [ ] Empty State
- [ ] Loading State
- [ ] Error State
- [ ] Success Toast
- [ ] Undo / 취소가 필요한 작업 처리
- [ ] 권한 없는 메뉴 숨김
- [ ] 예정 기능 명확히 표시

---

# 35. 신규 프로젝트 시작 절차

## STEP 1 — AX 기획

회사 정보를 바탕으로:

- 내부 효율화
- 기존 매출 상승
- 신규사업
- Customer Front
- AI 적용
- 데이터
- 정책환경
- 기술사업화

아이디어 도출.

## STEP 2 — 회사 맞춤 Information Architecture

업무 순서를 기준으로 메뉴 구성.

## STEP 3 — 본 MD 적용

본 문서의:

- Typography
- Layout
- Theme
- Motion
- Role
- AI Ready
- Story
- QA

기준 적용.

## STEP 4 — Claude Code Master Prompt

회사별 기능/데이터와 본 MD 규격을 합쳐 상세 Prompt 생성.

---

# 36. Claude Code 공통 지시문

```text
Hybrid 프로젝트에서는 미래AI랩 AX + Platform Unified Design & Development System v3.0을 최상위 Source of Truth로 적용한다. [AX v6.0 단독 지시 SUPERSEDED]

중요:
1. 일반 SaaS보다 큰 글자를 사용한다.
2. Sidebar는 약 280px.
3. Business AX Wordmark는 Sidebar와 분리되는 Premium Accent로 표현한다.
4. Dashboard KPI/Icon은 Module별 색상 타일을 사용한다.
5. 테마는 6-color palette를 사용하되 본문/카드/표의 neutral은 고정한다.
6. 어떤 Theme에서도 본문 글자가 물들거나 흐려지면 안 된다.
7. 날짜·요일·현재시각을 실시간으로 표시한다. 날짜 하드코딩 금지.
8. Business AX와 Customer Front를 1클릭으로 왕복할 수 있게 한다.
9. PC에서 AX/Customer Front의 모바일 화면을 즉시 Preview할 수 있게 한다.
10. 대표/직원 Demo Role Switcher를 구현하고 역할 변경 시 메뉴/KPI/데이터가 실제로 달라져야 한다.
11. RLS 구조를 체감할 수 있는 권한 Preview를 제공한다.
12. AI Fit Gate를 통과한 핵심 위치 1~6개에만 AI/Logic Ready Marker를 둔다. 개수를 채우기 위한 억지 AI는 금지한다.
13. AI Ready 버튼을 누르면 어떤 데이터로 어떤 판단을 하고 왜 필요한지 설명하는 Modal을 띄운다.
14. 기획의도는 Generic 소개가 아니라 회사 맞춤 12~16 Section Story Page로 만든다.
15. 정책 관련 내용은 프로젝트 제작 시점의 2026 최신 공식기관 자료를 확인한 내용을 반영할 수 있는 구조로 만든다.
16. KPI → Detail → AI Insight → Action으로 연결한다.
17. Action에는 추천/확인/실행중/완료 등의 상태를 둘 수 있게 설계한다.
18. Demo Data와 Live Data를 명확히 구분한다.
19. 데이터 마지막 업데이트와 출처/연결방식을 표시한다.
20. 범위 밖 기능은 임의 추가하지 않는다.
```

---

# 37. 업종별 변형 원칙

본 MD는 **업종 공통**이다.

다음만 프로젝트별로 바꾼다.

### 제조
생산 / 원가 / 불량 / 납기 / 재고

### 도소매·커머스
SKU / 채널 / 재고 / 마진 / 재구매

### 외식
메뉴 / POS / 시간대 / 원가 / 인력 / 재방문

### 물류
거래처 / 일정 / 차량 / 동선 / 적재 / 처리량

### 서비스
예약 / 고객 / 이용권 / 재방문 / 상담 / 직원

### 교육
수강생 / 과정 / 출결 / 학습 / 상담 / 재등록

### 웰니스
고객 기록 / 프로그램 / 예약 / 이용권 / 추천 / 홈케어

하지만 **Design System 자체를 업종마다 새로 만들지 않는다.**

---

# 38. 이 문서의 사용법

최적 사용방법:

```text
[회사 정보]
+
[AX 아이디어 / 기능기획]
+
[미래AI랩 AX Design & Development System v4.0]
=
[회사 전용 Claude Code Master Prompt]
```

즉 이 MD는 **어느 업종에나 공통으로 재사용하는 기본틀**이며,
회사별 AX 기능과 Customer Journey만 새로 설계한다.

---

# 39. 최종 목표 수준

### 90점 MVP
- 예쁜 화면
- 기능 시연
- 반응형
- Demo Data

### 95점 MVP
- 회사 맞춤 데이터 구조
- Role
- Customer Front 연결
- AI Action
- 기획의도

### 98점 MVP
- Drill-down
- Action Lifecycle
- RLS Preview
- AI Ready 설명
- Live Clock
- Device Preview
- Data Freshness
- AX Evidence
- 최신 정책 Story
- 실제 데이터 일부 적용

### 100점에 가까운 운영형
- Supabase/Auth/RLS 실제 적용
- 실제 고객 데이터
- 외부 API
- 실제 LLM API
- Audit Log
- 운영 QA
- 백업/보안/모니터링

---

# 40. 기반 레퍼런스

- 비원미래
- 제이랩테크
- 선진산업
- B-AI-Control
- Sample Animal Beauty Booking
- Sample Localmat Commerce
- MIRYEO K-Beauty Growth AX 1차 MVP

향후 실제 고객 프로젝트를 추가 분석하면서 계속 보정한다.


---

# 41. Real Data Adapter — 실제 고객 데이터가 있을 때만 강화

## 41.1 기본 정책

실제 고객 데이터를 처음부터 대량으로 요구하지 않는다.

MVP 제작을 시작하기 위해 반드시 수십 개 Excel 파일이나 전체 ERP Dump가 필요한 구조로 만들지 않는다.

### 권장 최소 실데이터

가능하면 아래 중 **1~3종만 받아도 충분**하다.

- 상품/서비스 목록
- 최근 매출 일부
- 거래처/고객 일부
- 재고 일부
- 예약/주문 일부
- 제품 사진/서비스 사진
- 현재 사용 중인 Excel 샘플 1개

## 41.2 실데이터가 있는 경우

전체 MVP 데이터의 **10~20% 정도만 실제 데이터로 섞어도 좋다.**

예:

```text
실제 제품 5개
+ Demo 제품 5개

실제 최근 1개월 매출
+ Demo 과거 추세

실제 거래처 상위 5개
+ Demo 거래처
```

실데이터에는 가능하면 `LIVE`, `REAL DATA`, `CSV IMPORTED` 등 출처를 표시한다.

## 41.3 실데이터가 없는 경우

MVP 제작을 멈추지 않는다.

```text
Demo Seed Data
+
Data Repository Layer
+
Import / Replace Point
```

를 만든다.

### 프롬프트 자동 규칙

사용자가 회사 실제 데이터를 제공하지 않았다면 Claude Code 프롬프트에는 다음을 삽입한다.

```text
현재 실제 운영 데이터가 충분히 제공되지 않았으므로
전체 MVP는 명확한 DEMO DATA 모드로 구현한다.

실제 데이터인 것처럼 위장하지 않는다.
향후 실제 상품·거래처·매출·재고 데이터를 교체하기 쉽도록
Demo Data를 중앙 Repository에 분리한다.

실제 회사 정보가 확인된 부분만 실제 값을 사용한다.
확인되지 않은 숫자·거래처·제품 Claim은 임의로 사실처럼 작성하지 않는다.
```

---

# 42. AI Connection Policy — 실제 AI는 “있으면 1개”, 없으면 AI Ready

## 42.1 핵심

MVP 첫 제작 때 GPT / Claude API Key가 없어도 실패가 아니다.

**실제 AI 연결은 필수 선행조건이 아니다.**

## 42.2 API Key / 사용승인이 있는 경우

가장 가치가 높은 **1개 기능만 우선 실제 연결**한다.

예:

- 대표용 경영 Insight
- 재고/생산 판단
- 고객 상담 요약
- 상품 추천 이유
- 거래처 위험 요약

한 번에 10개의 AI 기능을 붙이지 않는다.

### 흐름

```text
Code / SQL 계산
→ Structured Data
→ LLM
→ 판단 설명
→ 근거
→ 다음 Action
```

## 42.3 API가 없는 경우

다음을 구현한다.

```text
1. 규칙 기반 계산
2. 예시 Insight
3. AI Ready Badge
4. AI 적용 설명 Modal
5. 향후 API 연결 함수 Interface
```

### 프롬프트 자동 규칙

API Key 또는 실제 AI 연동 요청이 없으면:

```text
실제 외부 LLM API를 임의로 호출하지 않는다.

이번 MVP에서는 계산 가능한 값은 코드로 계산하고,
AI가 들어갈 핵심 위치에는 AI Ready Marker를 배치한다.

사용자가 AI Ready를 누르면:
- 어떤 데이터를 읽는지
- 어떤 판단을 도울지
- 어떤 결과 형태가 나올지
- 왜 이 위치에 AI가 필요한지
를 설명한다.

향후 GPT/Claude API를 연결하기 쉬운 service interface는 준비한다.
```

---

# 43. Customer Front → Business AX “최소 1개 연결” 규칙

Customer Front가 존재하는 프로젝트에서는
**최소 1개의 고객 행동이 Business AX에 연결되는 구조를 반드시 보여준다.**

## 실제 Backend가 있을 때

실제로 저장한다.

예:

```text
Customer
제품 추천 저장
↓
customer_events
↓
Business AX
“관심 증가 제품”
```

## Backend가 없을 때

Shared Demo Store로라도 실제 UI 상태를 연결한다.

예:

```text
Customer Front에서 “관심제품 저장”
↓
Demo Event Store
↓
Business AX “고객 관심도” 숫자 증가
```

페이지 두 개가 각각 독립된 가짜 화면으로 끝나는 것보다
이 연결 하나가 훨씬 중요하다.

---

# 44. Action Closed Loop — MVP에서도 기본 구현

실제 고객 데이터가 없어도 구현 가능하므로 **기본값**으로 적용한다.

```text
추천됨
↓
확인
↓
실행중
↓
완료
↓
결과
```

추가 상태:

```text
보류
무시
```

### 최소 기능

- 상태 변경
- 변경시간
- 담당자
- 간단한 메모

### Demo에서도 상태는 실제 UI에서 변경되어야 한다.

가능하면 localStorage / Demo Store에 유지한다.

---

# 45. Role / RLS — 조건부 실제 구현 + 필수 Demo 구현

## 실제 Supabase/Auth가 있으면

- `profiles.role`
- RLS
- Menu Permission
- Row Permission

을 실제 적용.

## 아직 없으면

**Role Switcher 자체는 반드시 구현한다.**

```text
대표
직원
고객
```

전환 시:

- Menu
- KPI
- Detail
- Action Button
- Sensitive Data

가 실제로 달라진다.

설정 페이지에는 **Permission Matrix Preview**를 제공한다.

---

# 46. Data Freshness는 모든 MVP에서 필수

실데이터 유무와 상관없이 주요 Dashboard에 표시한다.

예:

```text
DEMO DATA
마지막 업데이트 14:32:18

CSV IMPORTED
마지막 업데이트 10:20

LIVE · SUPABASE
마지막 동기화 14:31:52
```

### 목적

- 데이터 신뢰도
- Demo와 실제 구분
- “이 숫자가 어디서 왔는지” 설명

---

# 47. Presentation Mode는 기본 권장 기능

MVP는 실제 직원뿐 아니라:

- 대표
- 고객
- 정책기관
- 보증기관
- 투자자
- 파트너

에게 보여주는 경우가 많다.

따라서 다음을 권장한다.

```text
[시연 모드]
```

## 기본 3~5분 흐름

```text
1. 회사가 왜 AX를 하는가
2. Dashboard 핵심 KPI
3. 가장 중요한 업무 기능
4. AI Action
5. Customer Front
6. Customer → AX 연결
7. 실증 / Before After
8. 향후 확장
```

Presentation Mode는 기능을 새로 만드는 것이 아니라
**이미 구현된 화면을 가장 좋은 순서로 보여주는 Navigation Layer**다.

---

# 48. Demo Reset

Demo MVP에서는 다음 버튼을 권장한다.

```text
[데모 초기화]
```

역할:

- Action 상태 원복
- 고객 이벤트 원복
- Sample 입력값 원복
- Tutorial 재실행

시연 중 상태가 꼬이는 것을 방지한다.

---

# 49. Data Intake Ready

실데이터를 나중에 받을 것을 대비한다.

가능하면 설정 또는 데이터 화면에:

```text
CSV 가져오기
샘플 파일 보기
필드 구조 보기
```

를 둔다.

실제 복잡한 Mapping Wizard까지 1차 MVP에서 만들 필요는 없다.

### 목적

고객에게:

> “나중에 실제 데이터를 어디에 넣는지”

가 보이게 한다.

---

# 50. Customer Front 서비스 범위 정책 — “적게 약속하고 많이 해준다”

## 50.1 기본 원칙

모든 AX 계약에서 **고급 브랜드 홈페이지 제작을 기본 의무로 약속하지 않는다.**

Customer Front가 사업적으로 필요한 경우 기본 제공 범위는:

- 브랜드에 맞는 깔끔한 Front
- 로그인/추천/예약/구매요청 등 핵심 Customer Journey
- 모바일 반응형
- 고객 행동 데이터 구조
- Business AX 연결

까지다.

## 50.2 기본 제공에 포함하지 않는 것

별도 합의가 없다면 다음은 “고급 Front 제작” 범위다.

- 완전 맞춤형 브랜드 Art Direction
- 촬영
- 3D Product Rendering
- 고급 영상 Hero
- 복잡한 WebGL
- 다수의 Custom Illustration
- 수십 개 Landing Section
- 전문 Copywriting 전면 작업
- 대규모 Motion Design

## 50.3 실제 운영 원칙

> **표준 Front는 충분히 예쁘고 제품처럼 만든다.**
>
> 다만 고급 브랜드 홈페이지 수준까지 계약상 약속하지 않는다.
>
> 시간이 허용되면 Hero, Product Card, Story Section, Motion 등을 한 단계 더 고도화하여
> “예상보다 잘 만들어줬다”는 경험을 만든다.

즉:

```text
약속 = 실용적이고 예쁜 Customer Front MVP
실제 제공 = 여유가 있으면 Premium Polish 추가
```

방식이 기본이다.

---

# 51. Customer Front Premium Polish — 시간이 있을 때 우선 적용할 순서

고객화면을 더 예쁘게 만들 시간이 생기면
무작정 Section을 늘리지 않고 아래 순서로 투자한다.

1. **Hero**
2. **핵심 CTA**
3. **Product / Service Card**
4. **추천·예약 Step Flow**
5. **Brand Story 1개**
6. **Mobile**
7. **Hover / Motion**
8. 나머지 Detail

이 20%가 전체 첫인상의 80%를 결정한다.

---

# 52. “프론트 디자인 스킬” 사용 원칙

별도 Front-end Design Skill 또는 디자인 레퍼런스를 사용할 수 있다면
**Customer Front가 실제 매출·고객획득에 중요한 프로젝트에 우선 사용**한다.

### 적극 활용
- 화장품
- 패션
- 식품 커머스
- 예약 플랫폼
- 웰니스
- 교육 B2C
- 여행
- 라이프스타일

### 기본 Design System만으로 충분할 가능성이 높은 경우
- 내부 직원용 도구
- 단순 제조 내부 AX
- 물류 배차
- 회계/정산
- B2B 관리도구

즉 모든 프로젝트에 동일한 디자인 작업량을 쓰지 않는다.

---

# 53. Claude Code Prompt Generator용 “정보 유무 분기”

회사 전용 마스터 프롬프트를 만들 때 반드시 먼저 아래 상태를 판단한다.

| 항목 | 있음 | 없음 |
|---|---|---|
| 실제 회사정보 | 실제 반영 | Placeholder |
| 실제 상품/서비스 | 실제 일부 반영 | Demo |
| 매출/재고 | 실제 일부 반영 | Demo |
| 고객/거래처 | 실제 일부 반영 | 익명 Demo |
| 제품사진 | 실제 사용 | Placeholder |
| Customer Front 필요 | 구현 | 생략 가능 |
| Supabase | Live 구조 | Demo Repository |
| Auth/RLS | 실제 구현 | Role Preview |
| AI API | 핵심 1개 연결 | AI Ready |
| 외부 API | 필요한 범위 연결 | Integration Ready |
| 정책자료 | 최신 확인 | Generic 문구 최소화 |

### 중요

**없는 정보를 억지로 채우기 위해 프로젝트 진행을 멈추지 않는다.**

다만 법률·의료·재무·효능·실적처럼
거짓 정보가 위험한 부분은 절대 임의로 실제처럼 만들지 않는다.

---

# 54. Master Prompt 자동 삽입문 — 실제 데이터가 부족한 고객

```text
[실제 데이터 부족 시 개발 원칙]

현재 고객사의 실제 운영 데이터가 충분하지 않더라도 MVP 개발을 중단하지 않는다.

확인된 회사정보만 실제값으로 사용하고,
나머지는 DEMO DATA / SAMPLE / 미입력 상태로 명확히 구분한다.

Demo Data는 화면에 직접 흩어놓지 말고 중앙 Repository/Seed Layer에 분리한다.
향후 실제 데이터가 들어오면 UI를 재작성하지 않고 Data Layer만 교체할 수 있어야 한다.

실제 데이터인 것처럼 보이는 가짜 거래처명, 실적, 효능, 계약, 인증 등을 만들지 않는다.
```

---

# 55. Master Prompt 자동 삽입문 — AI API가 없는 고객

```text
[AI API 미연결 상태]

현재 실제 GPT/Claude 등 외부 AI API가 연결되지 않은 경우
API 연결을 개발 완료의 필수조건으로 보지 않는다.

계산 가능한 것은 코드/SQL/규칙으로 구현한다.

AI가 가장 가치 있는 위치 3~6개에는 AI Ready Marker를 표시하고,
클릭 시:
1. 어떤 데이터를 읽는지
2. AI가 어떤 판단을 돕는지
3. 어떤 결과 형태가 나오는지
4. 왜 AI가 필요한지
5. 향후 어떤 API를 연결할 수 있는지
를 설명한다.

향후 실제 API를 붙이기 쉬운 service interface를 준비한다.
```

---

# 56. 100점 MVP Acceptance Test

아래 기준을 모두 만족하면 “MVP 기준 100점에 가까운 상태”로 본다.

## A. 첫인상
- [ ] 회사 브랜드와 AX 이름이 분명하다
- [ ] Business AX Wordmark가 살아 있다
- [ ] 색상이 밋밋하지 않으면서 정돈돼 있다
- [ ] 글자가 충분히 크다
- [ ] PC/Mobile 모두 안정적이다

## B. 구조
- [ ] KPI → Detail → Insight → Action 연결
- [ ] Business AX ↔ Customer Front 연결
- [ ] PC ↔ Mobile Preview
- [ ] 대표 ↔ 직원 Role Switch
- [ ] Data Source / Freshness 표시

## C. 행동
- [ ] 핵심 CTA가 실제로 동작
- [ ] Action 상태 변경 가능
- [ ] Demo Reset 가능
- [ ] 최소 1개 Cross-screen 데이터 연결
- [ ] Empty / Loading / Error 존재

## D. AI
- [ ] 계산과 LLM 역할 구분
- [ ] 실제 AI가 있으면 핵심 1개 동작
- [ ] 없으면 AI Ready 3~6개
- [ ] AI 판단 근거 표현
- [ ] AI → Action 연결

## E. 권한
- [ ] Role마다 메뉴가 달라짐
- [ ] 민감정보가 역할에 따라 달라짐
- [ ] RLS Preview 존재
- [ ] 실제 Backend가 있으면 실제 RLS 적용

## F. Story
- [ ] 기획의도 12~16 Section
- [ ] 회사 맞춤 데이터/업무 반영
- [ ] Before / After
- [ ] 매출 상승 구조
- [ ] AI / 데이터 자산화
- [ ] 최신 정책환경
- [ ] 향후 확장

## G. 시연
- [ ] 3~5분 Presentation Mode
- [ ] Demo/Live 상태 명확
- [ ] 시연 중 막힌 링크 없음
- [ ] 예정 기능은 예정임을 표시

---

# 57. v4.0 최종 제작 철학

> **100점 MVP는 모든 것을 실제로 연결한 시스템이 아니다.**
>
> 정보가 없는 상태에서도 억지로 거짓을 만들지 않고,
> 실제 정보가 들어왔을 때 자연스럽게 교체되며,
> 사용자가 화면을 눌러보는 것만으로
> “이 회사에서 무엇을 바꾸고, AI가 어디에 들어가고,
> 앞으로 어떻게 실제 운영으로 확장되는지” 이해할 수 있는 제품이다.

따라서 미래AI랩의 기본 전략은:

```text
적게 약속
→ 빠르게 MVP
→ 기대 이상의 UI/UX
→ 실제 데이터 일부 반영
→ 핵심 AI 1개
→ 운영 데이터 축적
→ 단계적 고도화
```

로 한다.

---

# 58. 버전

**v6.0 — 2026-08-28**

v4.0 주요 추가:
- Real Data Conditional Adapter
- AI Conditional Adapter
- Customer → AX 최소 연결
- Action Closed Loop
- Role/RLS 조건부 실제화
- Data Freshness 필수화
- Presentation Mode
- Demo Reset
- Data Intake Ready
- Customer Front 범위 정책
- Premium Polish 우선순위
- Prompt Generator 정보 유무 분기
- 100점 MVP Acceptance Test


---

# 59. 권장 실제 개발 Workflow

미래AI랩의 권장 방식은 **완전 ChatGPT 중심도, 완전 Claude 중심도 아닌 Hybrid**다.

## Phase 0 — 회사정보 수집
입력:
- 사업자등록증
- 회사소개
- 매출/제품/서비스
- 현재 문제
- 기존 시스템
- 대표 요청

## Phase 1 — ChatGPT 전략설계
ChatGPT가:
- AX 아이디어
- 플랫폼 필요성
- AI 적용위치
- 매출상승
- 데이터 구조
- 정책/기술사업화
- 최종목표
- 1차/2차 범위

를 설계한다.

## Phase 2 — Company Master Prompt 생성

```text
회사정보
+
PROJECT FINAL OBJECTIVE
+
핵심 기능
+
v5.0 Design & Development System
```

을 하나의 Master Prompt로 만든다.

## Phase 3 — Claude Code 장시간 자율구현

첫 실행에서 가능한 한:
- Design Token
- Layout
- Route
- 핵심 AX
- Customer Front
- Role
- Theme
- Mobile
- AI Ready
- Demo Data
- Closed Loop

를 연속적으로 진행한다.

작은 Checkpoint마다 사용자 승인 요청을 하지 않는다.

## Phase 4 — Claude 직접 Polish

뼈대가 완성되면 사용자가 Claude와 직접:
- UI
- 간격
- 색
- 문구
- 작은 기능
- 버그

을 빠르게 조정한다.

## Phase 5 — 필요 시 ChatGPT 재투입

아키텍처·사업전략·정책·기능 우선순위를 다시 봐야 할 때만
ChatGPT를 다시 사용한다.

## Phase 6 — 실제화

가능한 경우:
- 실데이터 일부
- Supabase
- Auth/RLS
- AI API 1개
- 외부 API

를 붙인다.

---

# 60. One-Shot Execution Prompt

회사 전용 Master Prompt 마지막에는 다음 취지의 지시를 넣는다.

```text
[장시간 자율 실행]

위 최종목표와 범위를 충분히 이해했다면
작은 단계가 끝날 때마다 사용자 확인을 요청하지 말고
완료기준에 가까워질 때까지 합리적인 다음 작업을 스스로 선택하여 계속 진행한다.

설계된 범위 안의 UI/UX·컴포넌트·반응형·데모데이터·QA 세부결정은 자율적으로 처리한다.

사용자만 할 수 있는 SQL 실행, 환경변수, API Key, 외부 콘솔 설정 등은
가능하면 작업을 중단하지 말고 USER ACTION QUEUE에 누적한다.

Migration, SQL, Seed, env.example, Setup Guide 등
미리 생성 가능한 파일은 먼저 모두 준비한다.

Hard Blocker가 아니라면 구현을 계속한다.

최종 또는 주요 Checkpoint에서:
1. 완료한 내용
2. 남은 내용
3. 사용자 직접 작업
4. 실제 데이터로 교체할 위치
5. 2차 개발 후보
만 간결하게 보고한다.
```

---

# 61. 토큰·시간 사용에 대한 원칙

목표는 “많은 토큰을 쓰는 것” 자체가 아니다.

> **완료기준에 도달하기 위해 필요한 만큼 충분히 깊게 작업하는 것**

이 목적이다.

따라서:
- 같은 화면을 이유 없이 반복 재작성하지 않는다.
- 자체평가 → 전면재작성 무한루프 금지
- 발견된 실제 문제는 수정
- 의미 없는 미세개선은 중단
- 범위 밖 기능 추가 금지

장시간 실행 권한은 **집중된 연속 작업**을 위한 것이지
무한한 polish를 위한 것이 아니다.

---

# 62. SQL / Supabase Batch Delivery Standard

Supabase를 사용하는 프로젝트는 가능하면 다음 구조로 준비한다.

```text
/supabase
  /migrations
    001_base_schema.sql
    002_indexes.sql
    003_rls.sql
    004_seed.sql

.env.example
SETUP.md
```

사용자에게는:

```text
SUPABASE 최종 설정 — 총 4단계
```

처럼 한 번에 안내한다.

가능하면 SQL 하나씩 Chat에서 복사하도록 하지 말고
Migration 파일로 관리한다.

### Setup Guide 예

```text
1. Supabase 프로젝트 생성
2. migration 실행
3. 환경변수 2개 등록
4. Vercel 재배포
```

AI API도 같은 방식으로 별도 Optional Section으로 분리한다.

---

# 63. 목표 품질 우선순위

Claude Code가 “다음에 무엇을 할지” 판단할 때 아래 순서를 사용한다.

### Priority 1 — Broken
- 오류
- 잘림
- 접근불가
- 데이터 불일치

### Priority 2 — Core Flow
- 핵심 업무
- Customer Journey
- 저장/조회
- Action

### Priority 3 — Explainability
- AI 근거
- 기획의도
- 역할
- 데이터 출처

### Priority 4 — Product Feel
- Typography
- Color
- Motion
- Hover
- Empty/Loading/Error

### Priority 5 — Extra Polish
- 장식
- 추가 애니메이션
- 부가 화면

항상 위 순서를 우선한다.

---

# 64. v5.0 완료선

v5.0 기준의 좋은 첫 MVP는 다음과 같다.

> **처음 한 번의 깊은 기획과 긴 구현 세션만으로
> 회사 맞춤 Business AX의 뼈대, 고객 플랫폼, 데이터 구조, AI 적용 위치,
> 역할·모바일·테마·기획의도·실증 흐름까지 거의 완성되어 있고,
> 이후에는 사용자가 Claude Code와 직접 짧게 소통하면서
> 현장감 있는 디테일을 빠르게 다듬을 수 있는 상태.**

이 상태가 미래AI랩의 표준 개발 출발점이다.

---

# 65. 버전

**v6.0 — 2026-08-28**

v5.0 주요 추가:
- ChatGPT ↔ Claude 역할분리
- Full Spec Source of Truth
- 단계별 자율성 50~85%
- 장시간 연속 실행
- Hard Blocker 규칙
- USER ACTION QUEUE
- SQL / Supabase Batch 처리
- PROJECT FINAL OBJECTIVE
- 회사별 Final Objective Generator
- “다음 단계” 자동판단
- Polish Saturation Rule
- Hybrid 개발 Workflow
- One-Shot Execution Prompt
- 목표기반 개발 우선순위


---

# 66. PROJECT_SPEC.md — 이 회사 전용 설계도

## 66.1 정의

`PROJECT_SPEC.md`는 v6 전체 규격과 회사 Master Prompt를 읽은 뒤
**이번 회사에 실제로 적용할 내용만 추려 만든 프로젝트 전용 설계도**다.

쉽게 말하면:

> **v6 = 모든 집에 적용되는 건축법**
>
> **Master Prompt = 건축주 요구사항**
>
> **PROJECT_SPEC = 이번 집의 최종 설계도**

이다.

## 66.2 첫 실행 시 자동 생성

Claude Code는 첫 실행 PASS 1에서 다음 파일을 생성한다.

```text
/docs/PROJECT_SPEC.md
```

또는 프로젝트 Root:

```text
PROJECT_SPEC.md
```

## 66.3 반드시 포함할 내용

```text
1. PROJECT FINAL OBJECTIVE
2. 회사 핵심정보
3. 핵심 사용자
4. CORE 기능
5. CONDITIONAL 기능
6. PLUS 기능
7. 제외 범위
8. Business AX 메뉴
9. Customer Front 구조
10. Data Model
11. Role / Permission
12. AI 적용 위치
13. Demo / Live 전략
14. 디자인 적용방향
15. PC / Mobile
16. 완료기준
```

## 66.4 이후 사용

Opeus 등 후속 모델은 일상 개발 시:

```text
PROJECT_SPEC.md
```

를 우선 읽는다.

애매하거나 충돌하는 경우에만
원본 v6와 Master Prompt를 다시 확인한다.

---

# 67. PROJECT_STATE.md — 현재 공사 진행상황

## 67.1 정의

`PROJECT_STATE.md`는 설계도가 아니라
**현재 어디까지 만들어졌는지 기록하는 공사일지**다.

쉽게 말하면:

```text
SPEC = 어디까지 갈 것인가
STATE = 지금 어디까지 왔는가
```

이다.

## 67.2 파일

```text
PROJECT_STATE.md
```

## 67.3 기록 항목

```text
PROJECT FINAL OBJECTIVE

현재 상태
- Planning
- Building
- QA
- Demo Ready
- Live Ready

현재 구현률

완료
- ...

진행중
- ...

미완료
- ...

현재 Demo 기능
- ...

실제 연결된 기능
- ...

알려진 문제
- ...

다음 최우선 작업
1.
2.
3.

USER ACTION QUEUE
- ...

최근 주요 변경
- ...
```

## 67.4 업데이트 주기

다음 시점에 갱신한다.

- 큰 Milestone 완료
- 모델 교체 전
- 장시간 개발세션 종료
- 사용자 직접 작업이 누적되었을 때
- 실제 데이터/API 연결 이후

사소한 CSS 수정마다 기록하지 않는다.

---

# 68. Fable → Opeus 모델 인수인계 규칙

첫 Fable 세션 종료 시 반드시:

1. `PROJECT_SPEC.md` 최신 상태 확인
2. `PROJECT_STATE.md` 최신 상태 기록
3. `USER ACTION QUEUE` 정리
4. 중요 설계결정 `DECISIONS.md` 기록
5. 다음 우선순위 명시

후속 Opeus 세션 시작 시:

```text
먼저 PROJECT_SPEC.md와 PROJECT_STATE.md를 읽고
PROJECT FINAL OBJECTIVE와 현재 미완료 우선순위를 파악한 뒤
Hard Blocker가 없으면 바로 개발을 계속한다.
```

를 기본으로 한다.

---

# 69. DECISIONS.md — 중요한 설계결정만 기록

## 69.1 목적

개발이 길어지면:

> 왜 이 화면을 이렇게 만들었지?
> 왜 Customer Front를 별도로 뒀지?
> 왜 이 기능은 2차로 뺐지?

가 생긴다.

이를 방지한다.

## 69.2 기록 대상

다음과 같은 **큰 결정만** 기록한다.

- Customer Front 신규 구축 vs 기존 홈페이지 연동
- Supabase 사용
- 실제 AI 연결 위치
- 핵심 데이터 구조
- 메뉴 구조 큰 변경
- 1차/2차 범위 변경
- Role 구조
- 특허 기술구조와 연결되는 기능
- 외부 API를 2차로 미룬 이유

## 69.3 기록하지 않는 것

- 버튼 위치
- Card Padding
- 작은 문구
- 단순 색상조정
- 사소한 버그

---

# 70. Instruction Priority — 충돌 해결 순서

지시가 서로 충돌할 경우 다음 순서를 사용한다.

```text
1. 사용자의 가장 최근 명시적 지시
2. 회사별 Master Prompt
3. PROJECT_SPEC.md
4. PROJECT_STATE.md의 현재 제약/진행상황
5. 미래AI랩 AX Design & Development System v6.0
6. Front Design / Reference
7. Claude 자율판단
```

### 보충

`PROJECT_STATE.md`는 설계규칙보다 진행상황 기록이므로
회사 목표를 바꾸는 문서가 아니다.

---

# 71. 특허 / 기술자산 표시 시스템

미래AI랩 AX 프로젝트는
실제 업과 AX 기술구조를 연결하여 특허·벤처·R&D 등
기술사업화 자산으로 발전시키는 경우가 많다.

단, **실제 존재하는 자산만 실제 상태로 표시**한다.

## 71.1 Sidebar 하단 Tech Asset

DEMO DATA 영역 근처에 선택적으로:

```text
TECH ASSET

특허 출원 완료
10-2026-XXXXXXXX
```

표시.

또는:

```text
기술자산 1건
```

## 71.2 클릭 Modal

실제 출원된 경우:

```text
발명의 명칭
출원번호
출원일
출원인
현재상태
```

표시.

## 71.3 아직 미출원인 경우

```text
특허 연계 검토중
출원예정
해당없음
```

중 정확한 상태만 표시.

**출원하지 않은 특허를 출원된 것처럼 표시하지 않는다.**

---

# 72. 설정 > 기술·사업화 자산

회사에 해당하는 경우 설정 또는 별도 상세에서:

```text
기술·사업화 자산

[특허]
출원번호
발명의 명칭
출원일
상태

[벤처기업확인]
상태
유형
확인일 / 유효기간

[연구개발]
연구개발전담부서
기업부설연구소
연구과제

[인증]
ISO
기업인증
산업별 인증
```

구조를 둘 수 있다.

### 조건

해당 회사에 없는 항목은 숨기거나 `해당없음` 처리한다.

---

# 73. 기획의도에서 특허를 다루는 원칙

특허가 실제 출원됐거나
실제 출원계획이 구체적으로 잡힌 경우에만 기획의도에 반영한다.

추천 위치:

```text
AX 도입
→ 데이터 축적
→ 의사결정 구조 표준화
→ 자체 기술자산화
→ 특허 / 연구개발 / 벤처
```

### 표현

특허 자체를 과장하기보다:

> “운영 데이터를 축적하고,
> 회사 고유의 처리·추천·최적화 구조를 기술자산으로 발전시킨다.”

라는 흐름으로 설명한다.

---

# 74. Tech Asset와 정책자금 표현 주의

특허·벤처·AX 화면은
정책기관 심사에서 “있어 보이기 위한 장식”으로 만들지 않는다.

항상:

```text
실제 업무
→ 실제 데이터
→ 실제 기능
→ 기술구조
→ 기술자산
```

순서로 설명한다.

실제 출원번호·확인서·연구조직이 있으면
그 사실을 증거로 보여주는 것이다.

---

# 75. Master Prompt 자동 생성 시 CORE/CONDITIONAL/PLUS 의무 출력

앞으로 ChatGPT가 회사별 첫 Master Prompt를 생성할 때
반드시 아래 Section을 만든다.

```text
IMPLEMENTATION PRIORITY

CORE
- ...

CONDITIONAL
- ...

PLUS
- ...
```

### 원칙

CORE는 가능하면 5~10개 정도로 제한한다.

CONDITIONAL은 회사 조건에 따라 선택.

PLUS는 초기 구현 시간이 부족하면 생략 가능.

---

# 76. Master Prompt 첫머리 자동 삽입 확인 Checklist

회사별 첫 Master Prompt 생성 전:

- [ ] v6 먼저 읽기 지시
- [ ] Master Prompt 우선순위 명시
- [ ] Front Reference 역할 명시
- [ ] 별도 확인 없이 개발 시작
- [ ] Hard Blocker 예외
- [ ] PROJECT_SPEC 자동 생성
- [ ] 2-Pass 실행
- [ ] PROJECT_STATE 작성
- [ ] USER ACTION QUEUE
- [ ] CORE / CONDITIONAL / PLUS

중 하나라도 빠지면 Master Prompt 완성 전 보완한다.

---

# 77. 최초 Claude Code 실행용 표준 패키지

사용자가 첫 세션에서 Claude Code에 주는 자료는 원칙적으로 3개다.

```text
1. 미래AI랩 AX Design & Development System v6.0.md
2. 이번 회사 Master Prompt
3. Front Design / Reference Image
```

필요시 추가:

```text
4. 사업자등록증 / 회사소개
5. 제품·서비스 이미지
6. 실제 데이터 일부
```

이미 회사정보가 Master Prompt에 충분히 정리되어 있다면
4~6은 선택사항이다.

---

# 78. 첫 실행이 끝났을 때 생성되어 있어야 하는 파일

최소:

```text
PROJECT_SPEC.md
PROJECT_STATE.md
DECISIONS.md
```

Supabase가 있으면 추가:

```text
/supabase/migrations/*
.env.example
SETUP.md
```

이를 통해 개발세션이 바뀌어도
프로젝트 기억을 코드 저장소 안에 남긴다.

---

# 79. “다음 단계 진행” 표준 해석 v6

사용자가:

```text
다음 단계 가자
계속해줘
목표까지 고도화해줘
```

라고만 하면:

1. PROJECT_SPEC 확인
2. PROJECT_STATE 확인
3. CORE 미완료 확인
4. CONDITIONAL 필요항목 확인
5. PLUS 필요성 판단
6. 가장 가치 높은 미완료 항목 구현
7. STATE 갱신
8. Hard Blocker가 아니면 계속

한다.

---

# 80. v6.0의 최종 개발 운영모델

```text
ChatGPT
회사분석 + AX전략 + 최종목표
        ↓
회사 Master Prompt
        ↓
Claude 첫 실행
v6 + Master Prompt + Front Reference
        ↓
PROJECT_SPEC
        ↓
2-Pass 구현
        ↓
PROJECT_STATE / DECISIONS
        ↓
후속 모델
SPEC + STATE 읽고 개발 계속
        ↓
사용자 ↔ Claude 직접 Polish
        ↓
큰 방향 변경 시 ChatGPT 재투입
```

이 구조가 미래AI랩의 기본 개발방식이다.

---

# 81. 버전

**v6.0 — 2026-08-28**

v6.0 주요 추가:
- 첫 Master Prompt 실행문 자동 삽입
- 첫 요청에서 v6 + Master Prompt + Front Reference 동시 투입
- 2-Pass 첫 실행
- CORE / CONDITIONAL / PLUS
- PROJECT_SPEC.md
- PROJECT_STATE.md
- DECISIONS.md
- 모델 인수인계 규칙
- Instruction Priority
- 특허 / 기술자산 UI
- 설정 > 기술·사업화 자산
- 기획의도 특허 연결 원칙
- Master Prompt 생성 Checklist

# ============================================================
# PART B — FULL PLATFORM STANDARD v2.5 INCORPORATED
# ============================================================

> 아래는 플랫폼전용 v2.5의 상세 규칙을 통합한 Full Module이다. Public Picker 노출정책은 유지하되, 내부 Theme Library는 v2.0 Canonical 7 Palette를 사용하도록 정정했다.

## [INCORPORATED SOURCE] 미래AI랩 Platform Web App Design & Development System v2.5
## 소형 플랫폼 · 서비스형 홈페이지 · 예약/커머스/매칭/회원형 반응형 Web App 표준


# v2.5 UPDATE — Customer Visual Density & Future Expansion Navigation Layer

> **v2.5 목적**
>
> 고객용 플랫폼의 완성도는 기능 수보다 **브랜드 첫인상, 사진 밀도, 서비스 썸네일, 향후 확장 가능성이 얼마나 자연스럽게 보이는지**에 크게 좌우된다.
>
> v2.5는 다음을 필수 규칙으로 승격한다.
>
> 1. Customer Visual Density Rule
> 2. Image Sharpness / Responsive Crop Gate
> 3. Prepared Asset Utilization Gate
> 4. Future Expansion Navigation Layer
>
> v2.4 이하와 충돌하면 본 v2.5 UPDATE가 우선한다.

---

## 1. CUSTOMER VISUAL DENSITY RULE — 신규 필수

Customer Platform은 내부 AX보다 사진과 실제 서비스 이미지를 더 풍부하게 사용한다.

기본 권장 구조:
- Main Hero 1장
- 핵심 서비스 / 상품 / 프로그램 썸네일 3~6장
- 중간 Brand Story / Trust Banner 1~2장
- 예약 / 상담 / 주문 CTA 보조 이미지 1장
- Review / Trust / Experience 이미지 1장
- 모바일 세로 카드 또는 프로모 이미지 1장

### 권장 자산 활용률
준비된 Customer Asset Pack의 **60~80% 정도**를 실제 화면에 활용한다.

단:
- 사진을 많이 넣는 것 자체가 목표가 아님
- 같은 사진 반복 금지
- 섹션마다 사진의 역할이 달라야 함
- 상품형 플랫폼은 thumbnail 다양성이 중요
- 예약형 플랫폼은 고객 경험 / 예약 장면이 중요
- 포트폴리오형 플랫폼은 결과물 / 공간 / Before-After가 중요

---

## 2. IMAGE SHARPNESS & RESPONSIVE CROP GATE — 필수

- Hero / Story / Wide Banner가 확대되어 깨지면 FAIL
- 원본 해상도가 실제 표시 크기에 충분해야 함
- 억지 stretch 금지
- `object-fit`, `object-position`, responsive crop 적용
- mobile에서도 사람 얼굴 / 상품 / 차량 / 핵심 피사체가 잘리지 않도록 조정
- 텍스트가 이미지 위에 있다면 overlay / gradient 필수
- Customer 주요 사진은 첫 빌드부터 실제 자산 사용

Why / Brand Story / Trust 이미지도 저화질이면 FAIL이다.

---

## 3. PHOTO ROLE DIVERSITY RULE

서비스 카드들이 전부 같은 구도처럼 보이면 완성도가 떨어진다.

한 플랫폼 안에서도 다음을 섞는다.
- Close-up
- Full service scene
- Customer experience
- Space / facility
- Product / output
- Staff action
- Delivery / completion

같은 서비스 계열이라도 crop과 focal point를 달리한다.

---

# 4. FUTURE EXPANSION NAVIGATION LAYER — 신규 핵심 규칙

Customer Platform의 현재 핵심 메뉴만 보여주면
“현재 기능”은 설명되지만 “사업의 다음 단계”는 잘 보이지 않는다.

따라서 업종에 맞는 경우,
상단 Navigation / 좌측 Navigation / `더보기` / Footer 중 한 곳에
**향후 구현 가능한 확장 메뉴 3~6개**를 의도적으로 노출한다.

### 목적
고객:
> “이 플랫폼에 나중에는 이런 것까지 붙일 수 있겠구나.”

정책자금 / 정부지원 / 투자자:
> “현재 서비스가 B2B, 반복매출, 파트너, 지역, 데이터 사업으로 확장될 수 있겠구나.”

를 메뉴만 보고도 상상할 수 있어야 한다.

---

## 4.1 추천 Future Menu Pool

모든 항목을 넣지 않는다.
업종에 맞는 것만 **3~6개 선택**한다.

### B2B / Enterprise
- 기업·단체 문의
- 법인 전용
- 기업 견적
- 대량구매 / Bulk Order
- Fleet / Business Account

### Recurring Revenue
- 멤버십
- 구독
- 정기관리
- 정기배송
- 재예약 / 재주문 프로그램

### Partner / Supply Expansion
- 파트너·제휴
- 전문가 / 사업자 등록
- 입점 문의
- 공급사 등록
- 파트너센터

### Geographic / Network Scale-up
- 지역 / 지점 찾기
- 가맹점
- 제휴센터
- 서비스 지역 확대
- Partner Network

### Data / Customer Asset
- 내 기록
- 데이터 리포트
- 이력 관리
- 통합 리포트
- AI Insight

### Growth / Acquisition
- 추천인 / 리워드
- 친구초대
- 브랜드 제휴
- 광고·입점 문의
- 프로모션 파트너

### Content / Ecosystem
- 가이드 / 매거진
- 전문가 콘텐츠
- 교육 / 아카데미
- 커뮤니티
- API / 외부서비스 연동

---

## 4.2 Future Menu Selection Rule

현재 핵심 메뉴 : 미래 확장 메뉴 비율은 대략 **70~80 : 20~30**을 권장한다.

예:
현재 핵심 8개 + 미래 확장 3개

또는
현재 핵심 6개 + `더보기` 안에 미래 확장 4개

과도하게 미래 메뉴를 늘리지 않는다.

### 특히 좋은 신호
- B2B 확장
- 반복매출
- 파트너 공급망
- 지역 / 다점포
- 데이터 자산
- 추가 수익모델

이 중 회사에 맞는 2~4개 축이 보이면 충분하다.

---

## 4.3 NOT FAKE IMPLEMENTATION RULE — 매우 중요

아직 구현하지 않은 미래 메뉴를
실제 완성된 서비스처럼 보이게 만들면 안 된다.

클릭 시 권장 방식:
- `향후 확장 기능`
- `Coming Next`
- `Next Phase`
- `확장 검토`
- `Preview`

등으로 표시된 작은 Sheet / Drawer / Preview Page를 연다.

예:
`법인·Fleet 차량관리`
- 법인 차량 일괄등록
- 정기점검 계약
- 차량별 유지비 관리
- 센터 자동배정

정도만 보여준다.

### 금지
- 404
- 빈 페이지
- 구현된 것처럼 가짜 데이터로 전체 서비스 운영
- 현재 계약 범위와 혼동되는 표현

---

## 4.4 AD / LISTING INQUIRY RULE

`광고문의`, `입점문의`는 모든 플랫폼의 기본메뉴가 아니다.

다음 조건에서만 넣는다.
- 향후 트래픽 / 회원 / 공급자 생태계가 생길 가능성이 있음
- 브랜드 / 제조사 / 지역사업자 광고가 자연스러움
- 업종상 입점 / 제휴 상품이 현실적임

그렇지 않다면
`기업·단체`, `파트너·제휴`, `멤버십`, `지역·지점`
등이 더 자연스럽다.

---

## 5. CUSTOMER VISUAL ACCEPTANCE CHECK

최종 QA에 추가:

- [ ] Customer 화면이 AX보다 사진 활용이 풍부하다.
- [ ] Hero + Service Thumbnail + Story / Trust 이미지가 실제 배치되어 있다.
- [ ] 큰 사진이 깨지거나 흐리지 않다.
- [ ] 서비스 카드가 동일 구도 반복처럼 보이지 않는다.
- [ ] 준비된 핵심 Customer Asset의 60~80%가 문맥에 맞게 사용되었다.
- [ ] Future Expansion Menu가 3~6개 이하로 업종에 맞게 구성되었다.
- [ ] 미래 메뉴는 현재 구현 기능과 명확히 구분된다.
- [ ] 미래 메뉴 클릭 시 404가 아니라 Preview / Sheet / Drawer가 열린다.
- [ ] 메뉴만 봐도 B2B / 반복매출 / 파트너 / 지역 / 데이터 중 일부 성장 방향이 읽힌다.

---


# v2.4 UPDATE — Pre-Generated Customer Visual Asset Pack Contract

> **v2.4 목적**
>
> v2.3이 Customer Platform의 Motion / Surface / Navigation Quality를 끌어올렸다면, v2.4는 실제 고객용 플랫폼 제작에서 자주 발생하는 **Hero 이미지 부족, 서비스 썸네일 부재, 배경사진 미준비로 인한 첫인상 저하**를 초기에 막는다.
>
> 본 업데이트는 Claude가 플랫폼을 구현하기 전에, 사용자가 **Codex App 등에서 먼저 생성해둘 브랜드용 실사 자산 세트**를 빠르게 준비할 수 있게 하는 규격이다.
>
> 목표는 플랫폼 첫 버전부터 **사진·썸네일·히어로·배너까지 포함된 고객 친화형 MVP**를 한 번에 만드는 것이다.
>
> v2.3 이하와 충돌하면 본 v2.4 UPDATE가 우선한다.

---

# PROMPT 최상단 CUSTOMER ASSET PREP BLOCK — 신규 필수

플랫폼용 마스터 프롬프트를 만들 때는, **깃허브용 프로젝트명 바로 아래**에 아래 형식의 준비 블록을 둔다.

```text
[ASSET PREP BLOCK — HUMAN ONLY]
Generate the following customer-facing image assets first in Codex App.
Save each file with the exact filename below.
After generating them, upload them to Google Drive and share the folder link.
These lines are preparation notes for asset generation and are not part of the implementation task.
[/ASSET PREP BLOCK]
```

이 블록은 사용자가 이미지를 먼저 만들기 위한 인간용 블록이며, Claude에 최종 전달할 때는 지워도 된다.

---

# PLATFORM VISUAL ASSET PACK — 기본 세트

Customer Platform은 사진이 브랜드 인상을 크게 좌우하므로 다음 **핵심 10종**을 권장한다.  
업종에 따라 제품형 / 서비스형 / 예약형 / 포트폴리오형으로 일부 이름만 바꿔 쓴다.

## 1) 메인 히어로 이미지
- 파일명: `hero_main.jpg`
- 프롬프트:
  - `Premium hero image for a [industry] customer platform, showing the signature service, product, or brand experience, realistic, beautiful, commercial quality, no text`
- 용도:
  - 메인 Hero Section

## 2) 서브 히어로 또는 배너 이미지
- 파일명: `hero_secondary.jpg`
- 프롬프트:
  - `Secondary premium brand image for [industry], refined and trustworthy, realistic commercial quality, no text`
- 용도:
  - 중간 CTA 배너, About, Story, section divider

## 3) 대표 서비스/프로그램 썸네일 3종
- 파일명:
  - `service_01_[name].jpg`
  - `service_02_[name].jpg`
  - `service_03_[name].jpg`
- 프롬프트:
  - `Premium thumbnail photo for [specific service/program name] in [industry], clean, realistic, commercial quality, no text`
- 용도:
  - 서비스 카드, 프로그램 카드, 추천 카드

## 4) 대표 상품/패키지/메뉴 썸네일 3종
- 파일명:
  - `offer_01_[name].jpg`
  - `offer_02_[name].jpg`
  - `offer_03_[name].jpg`
- 프롬프트:
  - `Premium product or offer thumbnail for [specific item name] in [industry], realistic, attractive, commercial quality, no text`
- 용도:
  - 상품 카드, 패키지 카드, 상세 페이지, 추천 영역

## 5) 브랜드 스토리 / 공간 이미지
- 파일명: `brand_story_space.jpg`
- 프롬프트:
  - `Premium interior, facility, studio, store, showroom, clinic, classroom, restaurant, or workspace photo for [industry], realistic, beautiful, no text`
- 용도:
  - About, Brand Story, 소개 섹션

## 6) 고객 사용 장면 이미지
- 파일명: `customer_experience.jpg`
- 프롬프트:
  - `Realistic premium photo of a customer experiencing the core service or product of [industry], warm and trustworthy, no text`
- 용도:
  - 후기 유도, 신뢰구간, 서비스 흐름 설명

## 7) 예약/상담/주문용 보조 이미지
- 파일명: `booking_or_order_scene.jpg`
- 프롬프트:
  - `Clean premium photo representing booking, consultation, ordering, or request flow for [industry], realistic, no text`
- 용도:
  - 예약/신청/주문 섹션, 모달 보조 시각물

## 8) 리뷰/신뢰 배너용 이미지
- 파일명: `trust_banner.jpg`
- 프롬프트:
  - `Premium trust-building brand photo for [industry], refined and friendly, no text`
- 용도:
  - 후기/신뢰/CTA 배너

## 9) 모바일 카드용 세로형 이미지
- 파일명: `mobile_card_vertical.jpg`
- 프롬프트:
  - `Vertical premium image for mobile card use in [industry], realistic, clean, elegant, no text`
- 용도:
  - 모바일 주요 카드, 스토리 카드, 세로 배너

## 10) 대표 썸네일 / 오픈그래프용 이미지
- 파일명: `og_main_thumb.jpg`
- 프롬프트:
  - `Clean premium marketing thumbnail for [industry] brand platform, realistic, stylish, no text`
- 용도:
  - 대표 썸네일, 링크 공유 이미지, 시연 커버

---

# PLATFORM 자산 배치 규칙 — 신규 필수

실제 구현 지시문 중반부에는, 이미지가 모두 준비되었다고 가정하고 다음을 명시한다.

```text
Assume all prepared customer-facing visual assets already exist and are accessible from the shared Google Drive folder.
Use them from the first implementation pass.
Do not leave hero sections, key service cards, trust banners, or brand-story sections visually empty when a matching prepared asset exists.
```

권장 매핑:
- `hero_main.jpg` → 메인 Hero
- `hero_secondary.jpg` → 중간 CTA / Story / Divider
- `service_01~03` → 핵심 서비스 카드
- `offer_01~03` → 상품/패키지/메뉴 카드
- `brand_story_space.jpg` → 브랜드 소개
- `customer_experience.jpg` → 고객 경험 / 후기 문맥
- `booking_or_order_scene.jpg` → 예약/상담/주문 흐름
- `trust_banner.jpg` → 신뢰 배너
- `mobile_card_vertical.jpg` → 모바일 전용 프로모 카드
- `og_main_thumb.jpg` → 시연 커버 / 썸네일

---

# PLATFORM 사진 사용 원칙 — 강화 필수

- Hero는 **1장 강하게**, 서비스/오퍼 카드는 **3~6장 체계적으로** 사용한다.
- 예약형 플랫폼은 예약/상담/신청 흐름에 맞는 장면이 반드시 1장 이상 있어야 한다.
- 커머스형 플랫폼은 상품/패키지 썸네일 품질이 중요하다.
- 포트폴리오형 플랫폼은 공간/결과물/전후 비교 등 신뢰 이미지를 우선한다.
- 배경사진 위에는 Overlay를 써서 CTA와 텍스트 가독성을 지킨다.
- 썸네일은 Ratio / Radius / Shadow / Crop 언어를 통일한다.
- Stock 느낌만 강하고 업종성이 약하면 실패다. **해당 업종의 실제 서비스 감각**이 살아야 한다.

---

# PROMPT LENGTH RULE — 신규 필수

각 사진 프롬프트는 짧고 분명하게 유지한다.  
`대상 + 업종 + 톤 + realistic/commercial quality + no text` 정도면 충분하다.

---



# v2.3 UPDATE — Premium Interaction & Surface Clarity Layer

> **v2.3 목적**
>
> v2.2가 Customer Journey / Mobile Navigation / Preview / Discoverability의 완결성을 높였다면, v2.3은 Customer Platform이 기능적으로는 완성되어도 **Hover·Micro Interaction이 빠져 정적으로 느껴지거나, Off-white Surface가 과도해 화면이 뿌옇고, Dark Navigation의 글자가 흐려지는 문제**를 방지한다.
>
> 본 업데이트는 Public Platform의 브랜드 일관성을 해치지 않으면서도 **최소한의 Premium Interaction과 깨끗한 Surface Contrast를 완료조건으로 승격**한다.
>
> v2.2 이하와 충돌하면 본 v2.3 UPDATE가 우선한다.

---

# PLATFORM MOTION & MICRO-INTERACTION STANDARD — 신규 필수

Customer Platform의 Hover / Motion은 장식이 아니라 **CTA 인지와 서비스 완성도를 높이는 상호작용 Feedback**으로 사용한다.

## Desktop

- Header Navigation / CTA / Product·Program Card / Portfolio Card / Service Card / Booking Slot / List Row 등 클릭 가능 요소는 Hover State 필수.
- 기본 Transition: `140~180ms ease-out`.
- 권장 효과:
  - 약한 Surface Tint
  - Shadow 1단계 상승
  - `translateY(-1px ~ -2px)`
  - 이미지가 있는 Card는 필요 시 `scale(1.01~1.03)`의 매우 약한 Zoom
  - Arrow / Icon 미세 이동
- Tooltip / Popover / Helper는 `80~160ms` 수준의 짧은 Delay 허용.
- Modal / Drawer / Bottom Sheet / Accordion은 `160~240ms` Fade / Slide / Scale.
- Hero / Story Section은 필요한 경우 `120~180ms` 정도의 절제된 Reveal을 사용할 수 있다.

## Mobile

- Hover 의존 금지.
- CTA / Card / Bottom Nav / Booking Slot에 `pressed / active / selected` feedback 필수.
- Tap 직후 상태 변화가 명확해야 한다.

## 금지

Bounce / Neon / 강한 Parallax / 의미 없는 Loop Animation / 300ms 이상 느린 Hover / Motion 때문에 CTA가 늦게 활성화되는 구조.

---

# PLATFORM PURE WHITE SURFACE RULE — 신규 필수

Platform Theme / Brand Palette는 유지하되, 모든 프로젝트에 다음 공통 Token을 허용한다.

```text
PURE_WHITE_SURFACE = #FFFFFF
PURE_WHITE_TEXT    = #FFFFFF
```

Warm Ivory / Soft Gray / Sage / Taupe 등 브랜드 배경색이 있어도:

- Form
- Booking Panel
- Product / Service Main Card
- Modal
- Checkout / Confirmation
- My / Account 주요 Card

등 정보 정확성이 중요한 Surface에는 `#FFFFFF`를 적극 사용한다.

브랜드 분위기를 만든다는 이유로 모든 Card까지 Off-white로 통일하여 화면이 탁해지는 것은 금지한다.

권장:
- Background / large section = Brand Canvas 가능
- Primary Raised Surface = Pure White 우선
- Secondary Tint = Soft Color

Public Customer Front의 Theme Picker 정책은 v2.2 규칙을 그대로 유지한다. **Canonical 7개 Theme Library를 유지하며 임의 축소하지 않는다.**

---

# DARK HEADER / DRAWER READABILITY RULE — 신규 필수

Dark Header / Mobile Drawer / Admin Sidebar가 있는 Platform에서는:

```text
Active / Primary Navigation = #FFFFFF
Inactive Navigation         = 최소 #E5E7EB 수준
Section Label               = #AEB7C3 전후
```

Theme에 따라 Menu Text가 Burgundy / Purple / Blue / Olive 색으로 변하지 않게 한다.

색상 차이는:
- Icon
- Active underline
- Active pill
- Focus / selected tint

에서 만들고 **Navigation Text 자체는 White 계열을 우선**한다.

---

# PLATFORM VISUAL POLISH COMPLETION GATE — 신규 필수

다음 중 하나라도 빠지면 Platform Completion으로 보고하지 않는다.

1. Desktop 주요 CTA / Card / Navigation의 Hover Coverage `90% 이상`.
2. Booking / Purchase / Request Journey의 선택 요소에 selected/pressed feedback 존재.
3. Drawer / Modal / Bottom Sheet / Accordion Open-Close Transition 존재.
4. Mobile에서 Hover 대신 Touch Feedback 존재.
5. Loading Journey에 Skeleton 또는 동급 Loading UI 최소 1종 이상.
6. Form Focus State 명확.
7. Primary Raised Surface가 필요 이상으로 Off-white에 묻히지 않고 Pure White 대비를 확보.
8. Dark Header/Drawer Navigation Text가 실제 렌더링에서 깨끗한 White 계열로 읽힘.
9. Motion은 Primary Journey의 속도를 늦추지 않음.
10. `prefers-reduced-motion` / Motion 감소 환경에서도 기능 Feedback은 유지.

실제 QA 예:

```text
Home CTA Hover → Program/Product Card Hover → Detail CTA
→ Booking/Order Selection → Modal/Drawer → Complete
→ Mobile Tap Feedback → Dark Drawer Text Contrast
→ White Surface Clarity → Loading / Focus 확인
```

---

# v2.2 UPDATE — Cross-device UX & Platform Shell Parity Layer

> **v2.2 목적**
>
> v2.1의 Customer Journey / Interaction Integrity를 유지하면서, 실제 Reference MVP에서 확인된 **모바일 Header/메뉴 불일치, Device Preview 잘림·재귀, More 메뉴 의미 불일치, Story 비노출, PC↔Mobile 보조기능 불균형**을 차단한다.
>
> v2.1 이하와 충돌하면 본 v2.2 UPDATE가 우선한다.

---


# PRODUCT SHELL PARITY CONTRACT — 신규 필수

기능의 `존재 여부`만 확인하지 않는다. **PC / 실제 Mobile / Device Preview에서 사용자가 동일한 목적을 달성할 수 있는지**를 검증한다.

PASS 1에서 아래 Matrix를 PROJECT_SPEC.md에 만들고, 완료 전 실제로 채운다.

| 기능 | Desktop | 실제 Mobile | 반대 Device Preview | Discoverable | Behavior Parity |
|---|---|---|---|---|---|
| 전체 Navigation | 필수 | 필수 | 필수 | 필수 | 필수 |
| 날짜 + 현재시각 | 필수 | 필수 | 필수 | 필수 | 필수 |
| Theme | 필수 | 필수 | 필수 | 필수 | 필수 |
| Font Scale | 필수 | 필수 | 필수 | 필수 | 필수 |
| Role / Permission Preview | 필수 | 필수 | 필수 | 필수 | 필수 |
| Tutorial | 필수 | 필수 | 필수 | 필수 | 필수 |
| Why / Story | 필수 | 필수 | 필수 | 필수 | 필수 |
| Demo Reset | 필수 | 필수 | 필수 | 필수 | 필수 |
| Surface Switch | 해당 시 | 해당 시 | 해당 시 | 필수 | 필수 |

한 칸이라도 이유 없이 비어 있으면 완료로 보고하지 않는다.

## Responsive는 삭제가 아니라 재배치

공간이 부족하다는 이유로 중요한 정보를 모바일에서 없애지 않는다. 축약 / 2줄 / Drawer 이동 / More Sheet 등으로 재배치한다.

예: 날짜/시각
- Desktop: `2026.08.29 (토) 01:37:42`
- Mobile: `08.29 토` + `01:37:42`처럼 압축 가능
- 날짜를 통째로 삭제하고 시간만 남기는 것은 금지


---


# DEVICE PREVIEW SAFETY CONTRACT — P0

Device Preview는 장식이 아니라 **현재 동일 Route / 동일 Data / 동일 State를 다른 Viewport에서 확인하는 기능**이다.

## 기본 규칙

- Desktop 실제 환경에서는 `Mobile 보기`만 제공한다.
- Mobile 실제 환경에서는 `PC 보기`만 제공한다.
- 현재 Device와 동일한 Preview 버튼은 숨기거나 비활성화한다.
- Preview 내부에서 다시 Device Preview를 열 수 없게 한다.
- `Mobile → Mobile Preview`, `Desktop → Desktop Preview`, `Preview → Preview` 재귀 중첩 금지.

## True Viewport

Mobile Preview는 실제 390px 브라우저 첫 화면과 동일하게 보여야 한다.

반드시 확인:
- Header 상단 잘림 0
- Footer/Bottom Nav 하단 잘림 0
- `scrollTop = 0`에서 시작
- safe-area 적용
- fixed/sticky 위치 정상
- 부모 `transform` 때문에 fixed가 깨지지 않음
- 이전 Desktop scroll 위치를 상속하지 않음
- 상/하단이 잘리고 중간만 떠 있는 Frame 금지

## Escape Path

모든 Preview에는 명확한 종료 경로가 있다.
- X 닫기
- Backdrop Tap (Modal 방식일 때)
- ESC 가능 시 지원

닫은 뒤 backdrop / pointer-events / body scroll / focus lock을 완전히 복구한다.

## Route 규칙

없는 `/mobile-preview` 같은 Route를 무조건 만들지 않는다. 가능하면 현재 Route에 viewport mode만 적용한다. 별도 Route가 필요하면 모든 지원 Route가 실제 존재하는지 전수 검증한다. 404는 P0다.


---


# NAVIGATION SEMANTICS & DISCOVERABILITY GATE

사용자가 기능을 `찾을 수 있어야` 구현된 것으로 간주한다.

- `더보기`를 누르면 추가 메뉴가 Drawer / Bottom Sheet / Menu Popover로 나타나야 한다. 특정 단일 화면으로 이동하면 안 된다.
- `오늘의 AX`는 오늘의 AX 화면으로 이동한다.
- `설정`은 설정을 연다.
- `시연`은 Guided Product Demo를 시작한다.
- 메뉴 Label과 실제 행동이 다르면 P1 UX Bug로 판정한다.

## Discoverability

Why AX / Settings / Theme / Tutorial / Demo Reset / Surface Switch가 파일이나 Route에만 존재해서는 안 된다.

완료 전 실제 사용자가:
`Navigation 진입 → 기능 발견 → 실행 → 종료/복귀`
를 할 수 있어야 한다.


---

# PLATFORM MOBILE NAV CONTRACT

- Hamburger는 전체 Navigation을 여는 역할을 기본으로 한다.
- `더보기`는 실제 Secondary Menu Sheet/Drawer를 열어야 한다.
- Bottom Navigation 항목은 Label과 Destination이 일치해야 한다.
- Desktop Header를 단순 축소하지 않는다.
- 중요한 기능을 모바일에서 삭제하지 말고 재배치한다.

---


# TUTORIAL / PRESENTATION CONTRACT

## Tutorial

첫 사용자용 3~5 Step. **실제 App 화면 위에서** 작동한다.

각 Step은 필요 시 실제 Route로 자동 이동하고, 대상 Component가 렌더링된 뒤 Spotlight를 표시한다.

금지:
- 뒤 화면이 비어 있음
- 별도 정적 Slide만 보임
- 설명하는 기능과 배경 Route가 다름
- Step 종료 후 Blur/Backdrop 잔존

## Presentation Mode

영업/대표/심사용 8~12 Step의 **Guided Product Demo**다.

실제 Route를 자동 이동하며 실제 Dashboard / 핵심 업무 / AI / Evidence / Customer Surface 등을 보여준다. PowerPoint식 독립 Slide Show로 대체하지 않는다.

## Overlay Lifecycle

Next / Back / Skip / Finish / Exit 후:
- backdrop 제거
- blur 제거
- pointer-events 복구
- body scroll 복구
- focus lock 해제
- 다음 Route 클릭 정상

하나라도 실패하면 P0.


---

# PLATFORM STORY / 기획의도 — 접근성 강화

순수 Platform의 Story는 Business AX보다 짧게 유지한다(보통 5~7 Section). 다만 Reference MVP/심사용 프로젝트에서는 실제 Navigation 또는 Demo Control에서 발견 가능해야 한다.

권장:
1. 왜 이 플랫폼인가
2. 고객의 현재 불편
3. 핵심 Journey
4. 기존 방식과 차이
5. 데이터가 남는 구조
6. 재방문/반복사용
7. 향후 확장

파일만 존재하거나 숨은 Route만 있는 상태는 미완료.

---


# SIDEBAR / MENU ICON COLOR SYSTEM

왼쪽 Sidebar와 Mobile Drawer의 메뉴 Icon은 전부 무채색 단색으로 두지 않는다.

## 목표

목차를 빠르게 구분할 수 있도록 **적당한 색 차이**를 준다. 너무 형광색이거나 너무 옅어서 의미가 없어지면 실패다.

## 기본 규칙

- Icon 자체 또는 30~34px 정도의 작은 Icon Container에 색을 적용한다.
- Container 배경은 해당 색의 약 10~14% Tint, Icon은 중간 채도 Tone을 권장한다.
- Active 메뉴는 같은 Hue를 조금 더 진하게 사용하고, 배경/좌측 Bar 등으로 선택상태를 추가 표현한다.
- 동일 Category 안에서도 모든 Icon을 완전히 똑같은 색으로 만들 필요는 없지만, 전체 Palette는 6~8개 이내로 제한한다.
- Emoji 문자 자체를 남발하지 말고 Lucide/outline 계열 Icon + Color Token을 기본으로 한다.

### 권장 Group Accent — v4/v8

Sidebar는 메뉴 하나마다 다른 Rainbow Color를 주지 않는다. **같은 분류의 메뉴는 같은 Hue Family**를 사용한다.

- 운영 / Workflow Group: Blue `#5B8DEF`
- 고객·매출 / Growth Group: Amber `#D79A43`
- AX·실증 / Intelligence Group: Teal-Green `#3C9A75`
- 관리 / System Group: Slate `#718096`

같은 Group 안에서는 필요 시 기본색의 Light / Base / Deep 3단계까지만 허용한다.
예: 운영 Group의 일정·배차·현장 메뉴는 모두 Blue Family이며, 메뉴마다 전혀 다른 색을 만들지 않는다.

Mobile Drawer에도 같은 Icon Color Mapping을 유지하여 PC와 정보 인지방식을 맞춘다.


---

# PLATFORM THEME LIBRARY — 7개 조합 / Public Picker는 선택적

Public Customer Front에는 일반 사용자용 Theme Picker를 기본 노출하지 않는다. 그러나 디자인 시스템과 관리자/시연 Preview는 **Canonical 7개 Theme Library**를 사용한다. 프로젝트 시작 시 Brand에 맞는 1개를 Default로 선택한다.


# THEME LIBRARY — 7개 조합 / 각 6색 — v2.0 CANONICAL

> **중요:** 7개는 Theme의 개수이며, 각 Theme는 6개의 핵심 Color Token을 가진다.
> 이 7개 Palette는 기존 AX 원본에 존재하던 7 Palette를 v2.0의 유일한 Canonical Theme Library로 승격한 것이다.
> `Canvas`는 Theme Color로 강제하지 않고 `PURE_WHITE_SURFACE / NEUTRAL_CANVAS / Theme Soft Tint` 조합으로 파생한다.

| Theme | Shell | Primary | Secondary | Accent | Highlight | Soft |
|---|---|---|---|---|---|---|
| 01 Deep Navy Blue | `#0B1830` | `#2457D6` | `#1687A7` | `#17A889` | `#E7C873` | `#DCE8F7` |
| 02 Navy Gold | `#111A2D` | `#2847A7` | `#A37A28` | `#D0A84B` | `#F0D995` | `#EFE8D7` |
| 03 Emerald Gold | `#11332B` | `#0E7663` | `#2C9277` | `#B4862A` | `#E8CE88` | `#E2F0EA` |
| 04 Forest Sage | `#17352C` | `#356E58` | `#73977E` | `#A58E4D` | `#D9D2AA` | `#E5ECE5` |
| 05 Deep Teal | `#08323A` | `#087A83` | `#1597A3` | `#D2704C` | `#E9B59B` | `#DDEDEF` |
| 06 Onyx Gold | `#15171C` | `#343942` | `#6A717C` | `#B89032` | `#E0C76F` | `#E6E8EC` |
| 07 Pure White | `#FFFFFF` | `#171B20` | `#343B44` | `#6B7680` | `#D47A4A` | `#FAFAF8` |

## Theme 강제 규칙

- Theme Picker가 필요한 Surface에서는 **7개 Theme가 모두 실제 동작**해야 한다.
- Business AX Settings에는 **7개 Theme Picker를 실제 구현**한다.
- Customer Platform은 Public 사용자에게 Theme Picker를 억지로 노출하지 않지만, **동일한 7개 Theme Library를 내부 디자인 시스템 / 관리자 / 시연 Preview에서 사용**한다.
- Hybrid Demo/Preview에서는 AX에서 선택한 Theme 상태가 Customer Surface에도 전달되어 동일한 Brand Family로 보이게 한다.
- Theme 전환 시 Shell / Header Accent / Active Navigation / Primary Button / KPI Accent / AI Surface / Chart Accent / Badge / Highlight / Customer CTA / 선택 상태가 함께 변경된다.
- 본문 Neutral Text, Table, Form, Modal, Raised Surface의 가독성은 Theme와 분리한다.
- Theme 변경은 Desktop / Mobile / Device Preview에서 동일 상태를 공유한다.
- 특정 업종의 Brand Reference가 명확하면 7개 중 가장 가까운 1개를 Default로 삼되, 나머지 6개도 Settings/Preview에서 정상 선택 가능해야 한다.
- Public Customer Surface의 브랜드 일관성이 중요한 경우 일반 고객에게 Picker UI는 숨길 수 있으나, 선택된 Theme Token은 Customer Surface 전체에 일관되게 적용한다.

---

# v2.2 COMPLETION GATE — 추가

1. Primary Journey Complete
2. Mobile Navigation Semantics
3. Desktop/Mobile 주요 기능 Parity
4. Device Preview True Viewport
5. Recursive Preview 0
6. Discoverability (Story/Settings가 필요한 프로젝트)
7. Escape Path
8. Sidebar/Drawer Icon Recognition (내부/관리자 Shell이 있는 경우)

---

# INHERITED BASE — v2.1

아래 v2.1 전체 규칙은 본 v2.2 UPDATE와 충돌하지 않는 범위에서 그대로 유지한다.



# 미래AI랩 Platform Web App Design & Development System v2.1
## 소형 플랫폼 · 서비스형 홈페이지 · 예약/커머스/매칭/회원형 반응형 Web App 표준

# v2.1 UPDATE — Platform Completion & Interaction Integrity Layer

> **v2.1 목적**
>
> Platform v2.0의 Front Reference First / Customer Journey / Platform UX를 유지하면서,
> 고객용 화면이 예쁘기만 하고 CTA·Drawer·Modal·Mobile Journey가 끊기거나,
> 내부 시연용 Story / Settings / Preview가 빠지는 문제를 방지한다.
>
> v2.0 이하 규칙과 충돌할 경우 이 v2.1 UPDATE가 우선한다.

---

# 0-A. PLATFORM SYSTEM CORE

모든 Platform 프로젝트는 서비스별 CORE와 별도로 다음을 검사한다.

```text
1. Global Header / Navigation
2. Mobile Header / Bottom Navigation
3. Primary Conversion Journey
4. Modal / Drawer / Bottom Sheet Integrity
5. Responsive
6. Empty / Loading / Error / Success
7. Demo Reset 또는 Demo State 복구 (Demo 프로젝트)
8. Platform Story / 기획의도 (Reference MVP / 심사용 프로젝트)
9. Device Preview (관리자/시연용 프로젝트)
10. Final Platform Completion Gate
```

---

# 0-B. Customer Journey Completion Gate

Primary Conversion Goal이 무엇이든 반드시 끝까지 동작한다.

예:

```text
탐색 → 상세 → 선택 → 입력 → 확인 → 완료
예약 → 일정선택 → 정보입력 → 확인 → 예약완료
상품 → 장바구니 → 주문 Preview → 완료
문의 → 유형선택 → 내용 → 제출 → 접수완료
```

실제 결제/외부 API가 없는 경우 `Demo Complete` 또는 `연동 예정`을 정직하게 표시한다.
중간 Dead End 금지.

---

# 0-C. Public Theme Policy

Public Customer Front에는 일반 사용자용 Theme Picker를 기본 노출하지 않는다.
브랜드 사이트는 일관된 Brand Theme를 유지하는 것이 기본이다.

다만 개발/관리자/Presentation Preview에서는 필요할 경우:

```text
Brand Default
Dark Preview
Light Preview
```

를 제공할 수 있다.

### 핵심

- Public Theme consistency가 우선.
- “색 변경 기능이 있어 보이기 위한” Theme Picker 금지.
- AX와 결합된 프로젝트의 Theme Picker는 Business AX Settings에서 제공하는 것을 기본값으로 한다.

---

# 0-D. Modal / Drawer / Bottom Sheet Integrity v2.1

Platform은 모바일 상호작용이 많으므로 다음을 P0 품질기준으로 둔다.

- 닫힌 Drawer의 backdrop이 남지 않는다.
- Bottom Sheet 종료 후 body scroll이 복구된다.
- Modal 뒤 invisible overlay가 남지 않는다.
- 모바일 메뉴와 Login Modal이 중첩돼도 z-index가 꼬이지 않는다.
- Browser Back / route change 후 overlay cleanup.
- Focus trap이 종료되면 원래 Trigger로 focus 복귀 권장.
- `pointer-events: none`이 App Root에 잔존하지 않는다.

P0 Interaction Bug가 하나라도 있으면 완료 금지.

---

# 0-E. Tutorial / Guided Onboarding

Platform Tutorial은 모든 프로젝트에서 강제하지 않는다.

다음과 같은 플랫폼에서는 권장 또는 CORE:

- Step Journey가 복잡함
- B2B Portal
- 회원 전용 Dashboard
- 예약 / 신청 과정이 낯섦
- Reference MVP에서 기능 설명이 중요함

구현하는 경우 AX v6.1 Tutorial Cleanup 원칙과 동일하게:

- Skip / Complete
- Replay
- Overlay Cleanup
- pointer-events 복구
- scroll lock 복구
- mobile drawer 충돌 방지

를 지킨다.

---

# 0-F. Platform Story / 기획의도 v2.1

일반 소비자용 Public Navigation에 `기획의도`를 억지로 넣지 않는다.

다만 미래AI랩 Reference MVP / 정책·투자·대표 시연 프로젝트에는 별도 Story Route 또는 Presentation Section을 둔다.

포함:

- 현재 고객 Journey
- 불편 / 전환손실
- Platform 도입 전후
- 고객 Data Loop
- 매출상승 경로
- AI / 개인화 위치
- Business AX와 연결 시 Data Bridge
- 향후 확장

즉 Public User UX와 `왜 이 플랫폼을 만들었는가`를 설명하는 Demonstration Story를 분리할 수 있다.

---

# 0-G. Reference Fidelity Acceptance v2.1

Front Reference가 제공된 경우 완료 전 실제로 확인한다.

```text
Hero Mood
Color
Typography 분위기
Density
Radius
Card Feel
Image Ratio
Mobile Composition
CTA Hierarchy
```

Reference를 그대로 복사하지 않되 첫인상이 다른 Template로 변질되지 않아야 한다.

---

# 0-H. Whole-Platform Acceptance Run

최종 완료 전에 최소 1회:

```text
Fresh Load
→ Header / Mobile Menu
→ Search / Filter 또는 Primary Entry
→ Card / Detail
→ Primary CTA
→ Modal / Drawer / Bottom Sheet
→ Final Action Complete
→ My Page / Result 확인 (해당 시)
→ PC / Mobile
→ Login / Demo Role (해당 시)
→ Story / Presentation (Reference MVP인 경우)
→ Demo Reset
```

### 실패 조건

- 죽은 CTA
- 모바일 메뉴 고착
- blur / backdrop 잔존
- 폼 제출 후 완료상태 없음
- Mobile overflow
- Hero만 고급이고 내부 급격한 품질저하
- Reference와 완전히 다른 Mood

---

# 0-I. Platform Completion Gate v2.1

## GATE 1 — First Impression
- Reference / Brand Mood 유지
- Hero / CTA / Typography 완료

## GATE 2 — Journey
- Primary Conversion Goal 끝까지 동작

## GATE 3 — Interaction
- Modal / Drawer / Bottom Sheet P0 Bug 없음

## GATE 4 — Responsive
- PC / Mobile 모두 실제 Layout

## GATE 5 — Data / State
- Demo/Live 정직한 표시
- Empty/Loading/Error/Success

## GATE 6 — Reference MVP Story
- 필요한 프로젝트에서는 Platform Story / Presentation 완료

모두 통과 후 완료 보고.

---

# 0-J. 기본 기술스택 권장 v2.1

신규 Platform Web App의 기본 권장:

```text
Next.js
TypeScript
Tailwind CSS
Vercel
Supabase (Auth/Data가 필요할 때)
```

단, Vite가 기존 구조이거나 순수 Client SPA가 더 적합한 경우 유지 가능하다.
Framework Preset만 변경하여 코드 Framework를 바꾸지 않는다.

---

# 0-K. v2.1 최종 원칙

> **Platform의 완성도는 Hero의 예쁨이 아니라, 고객이 실제 행동을 끝까지 마칠 수 있는가로 판단한다.**
>
> `Brand First Impression + Journey + Interaction Integrity + Mobile + Data Loop`가 함께 닫혀야 한다.




> **목적**
>
> 이 문서는 미래AI랩이 고객사에 **소형 플랫폼 / 서비스형 홈페이지 / 예약·커머스·매칭·회원형 MVP / 반응형 웹앱**을 빠르게 구축할 때 공통으로 적용하는 설계·디자인·개발 기준이다.
>
> Business AX가 중심이면 「미래AI랩 AX Design & Development System v6.0」을 우선 적용하고, 고객용 플랫폼이 별도로 필요하면 본 문서를 함께 적용한다. 내부 AX 없이 고객용 서비스만 필요한 프로젝트는 본 문서를 단독 기준으로 사용한다.

---

# 0. 최종 목표

본 시스템이 만드는 것은 일반적인 회사소개 홈페이지가 아니다. 또한 처음부터 대형 SaaS나 수만 명 규모의 마켓플레이스도 아니다.

> **첫 화면은 브랜드 홈페이지처럼 예쁘지만, 사용자가 검색하고 고르고 비교하고 저장하고 예약·구매·신청·문의까지 실제 행동할 수 있는 “플랫폼형 반응형 웹앱 MVP”**

즉 다음을 결합한다.

```text
홈페이지의 첫인상
+
플랫폼의 탐색성
+
앱의 사용성
+
MVP의 빠른 구현성
```

100점에 가까운 결과물의 기준은 다음이다.

> “홈페이지 하나 만들었구나”가 아니라 **“작지만 실제 서비스 하나를 만들었구나”**라는 인상을 주어야 한다.

---


# 0-1. v2.0 핵심 원칙 — Front Reference First

미래AI랩 플랫폼 프로젝트는 가능하면 **개발 시작 시 Front Design / Reference Image를 함께 제공하는 것을 기본값**으로 한다.

이 레퍼런스는 단순 참고 이미지가 아니라,
**고객이 실제로 보게 될 화면의 시각적 우선 기준**이다.

### 가장 중요한 원칙

> **Front Reference가 제공되어 있다면, 고객용 화면의 시각적 방향은 본 MD의 일반 스타일보다 Front Reference를 우선한다.**

본 MD는:
- 가독성
- 반응형
- 구조
- 플랫폼 UX
- Card/Detail/Journey
- QA
- Data Layer
- 프로젝트 운영규칙

을 보장하는 **공통 뼈대**이고,

Front Reference는:
- 색상
- 이미지 톤
- 여백
- 구성 밀도
- Hero
- Card 느낌
- Typography 분위기
- Radius
- Motion 감도
- Brand Mood

를 정하는 **프로젝트별 외관 기준**이다.

즉:

```text
Platform v2 = 구조와 품질의 기준
Front Reference = 이번 회사의 얼굴
```

로 이해한다.

---

# 0-2. Front Reference가 있을 때의 Visual Priority

시각적 결정이 충돌하면 다음 순서를 따른다.

```text
1. 사용자의 최신 명시적 디자인 지시
2. 이번 프로젝트의 Front Design / Reference Image
3. 회사 Master Prompt의 브랜드·디자인 지시
4. PROJECT_SPEC.md의 Visual Direction
5. 본 Platform v2.0의 일반 디자인 규칙
6. Claude의 자율 판단
```

단, 기능·업무범위·데이터구조·보안은 별도 우선순위를 따른다.

### 기능/범위 우선순위

```text
1. 사용자의 최신 명시적 지시
2. 회사 Master Prompt
3. PROJECT_SPEC.md
4. 본 Platform v2.0
5. Reference Image에서 추론 가능한 범위
6. Claude 자율판단
```

**이미지만 보고 계약범위에 없는 기능을 새로 추가하지 않는다.**

---

# 0-3. Front Reference가 처음에 없을 때

Front Reference가 없다고 개발을 멈추지 않는다.

대신 초기 구현은:

```text
NEUTRAL PREMIUM MODE
```

로 진행한다.

기본:
- White / Ivory 중심
- 단정한 Brand Placeholder
- 과도하지 않은 Accent
- 1200~1280px Layout
- Localmat 계열의 정보밀도
- 표준 Card / Search / Category / Journey
- 고급스럽지만 특정 브랜드색에 과도하게 종속되지 않는 구성

그리고 `PROJECT_STATE.md`에 다음을 기록한다.

```text
FRONT_REFERENCE_STATUS: PENDING
```

## 나중에 Reference가 들어오면

새 Front Reference가 제공되는 즉시:

1. 기존 기능을 유지
2. Reference 분석
3. Visual Direction 재정의
4. Hero / Header / Card / Detail / Mobile 우선 수정
5. 전체 Customer Front에 톤 통일
6. 그 다음 추가 Polish 진행

한다.

즉 **Reference가 늦게 들어왔다고 처음부터 다시 만들지 않는다.**
기능 뼈대는 유지하고 Visual Layer를 재정렬한다.

---

# 0-4. Reference Interpretation — 복제가 아니라 재해석

Front Reference를 그대로 Screenshot처럼 복사하는 것이 목표가 아니다.

Claude는 먼저 다음 8개 축을 추출한다.

```text
1. Layout
2. Typography
3. Color
4. Density
5. Card Geometry
6. Image / Illustration Style
7. Motion / Interaction
8. Brand Mood
```

그리고 이를 이번 회사 서비스 구조에 맞게 재해석한다.

예:

```text
Reference:
큰 Hero + 둥근 Product Card + Soft Cream + Dark Green

우리 회사:
같은 분위기 유지
+
우리 서비스에 맞는 Search / Booking / Detail / My Page 구조
```

### 금지

- 이미지 속 메뉴를 의미 없이 그대로 복제
- 다른 업종의 기능까지 따라함
- 텍스트를 Screenshot처럼 베낌
- Reference가 가진 단점을 그대로 복제
- 모바일에서 PC Reference를 단순 축소

---

# 0-5. FRONT_REFERENCE_MAP

Front Reference가 제공되면 첫 PASS에서 다음 내용을
`PROJECT_SPEC.md` 안의 `VISUAL REFERENCE MAP` Section으로 정리한다.

```text
VISUAL REFERENCE MAP

Reference Status:
- PROVIDED / PENDING

Must Preserve:
- 전체 Mood
- 핵심 Color
- Hero 느낌
- Card 형태
- 정보 밀도
- 이미지 표현

Adapt:
- 서비스 메뉴
- 고객 Journey
- 검색/필터
- Detail
- Mobile

Do Not Copy:
- 타사 Brand
- 타사 문구
- 불필요 기능
```

별도 파일을 무조건 추가하지 않아도 된다.
일상 개발 기준은 `PROJECT_SPEC.md` 하나로 유지한다.

---

# 0-6. Anti-Template Rule

미래AI랩이 여러 플랫폼을 제작하더라도
모든 프로젝트가 같은 Template처럼 보여서는 안 된다.

각 프로젝트는 최소 **3개의 Project Signature**를 가져야 한다.

예:

```text
Signature 1 — Hero Composition
Signature 2 — Category / Icon Style
Signature 3 — Card / Detail Interaction
```

또는:

```text
Signature 1 — Brand Color Layer
Signature 2 — Search Experience
Signature 3 — Personalized Section
```

### 금지

- 같은 Hero 구조 반복
- 같은 Gradient 반복
- 같은 Category Icon 반복
- 같은 Product Card 구조를 업종만 바꿔 재사용
- 다른 미래AI랩 프로젝트의 문구/배치를 그대로 복제

공통 Component는 재사용해도 되지만,
**보이는 결과물은 회사별로 재해석한다.**

---

# 0-7. Primary Conversion Goal

모든 플랫폼은 첫 기획에서 **최우선 고객행동 1개**를 정한다.

예:

```text
구매
예약완료
상담신청
회원가입
매칭요청
견적요청
재방문
```

회사별 Master Prompt에는 반드시:

```text
PRIMARY CONVERSION GOAL
```

을 넣는다.

### 예

```text
PRIMARY CONVERSION GOAL:
고객이 서비스 탐색 후 전화 없이 예약을 완료하는 것
```

Secondary Goal은 최대 2개.

플랫폼의 디자인과 CTA는 이 목표를 중심으로 구성한다.

---

# 0-8. Conversion-driven UX

각 주요 화면은 다음 질문에 답해야 한다.

```text
이 화면의 목적은 무엇인가?
사용자가 다음에 무엇을 해야 하는가?
그 행동을 막는 정보부족은 무엇인가?
```

CTA는 단순 버튼 장식이 아니다.

예:

```text
Home
→ 상품 둘러보기

List
→ 상세보기 / 저장

Detail
→ 예약하기 / 구매하기

Result
→ 저장 / 다음 행동
```

---

# 0-9. Event Tracking Ready

실제 Analytics를 처음부터 붙이지 않더라도
핵심 고객행동 Event 구조를 정의한다.

예:

```text
view_home
search
select_category
view_item
save_item
start_booking
complete_booking
add_to_cart
submit_inquiry
signup
return_visit
```

MVP에서는:
- Demo Event Store
- localStorage
- console-safe event layer

등으로 구조만 만들어도 된다.

향후:
- GA4
- PostHog
- Supabase
- 자체 Event Table

로 교체 가능하게 한다.

### 원칙

모든 클릭을 추적하지 않는다.
PRIMARY CONVERSION GOAL과 관련된 핵심 Event만 정의한다.

---

# 0-10. Public Web Quality — 고객용 화면의 기본품질

Customer-facing Platform은 내부 AX보다
공개 웹 품질이 중요하다.

따라서 다음을 CORE QA에 포함한다.

## SEO / Metadata

- Page Title
- Meta Description
- Open Graph
- Favicon
- Canonical 필요 여부
- 의미 있는 Heading 구조

## Performance

- 이미지 최적화
- Lazy Loading
- 불필요한 대형 Animation 방지
- Layout Shift 최소화
- 초기 화면 렌더링 속도 고려

## Accessibility

- 충분한 Contrast
- Keyboard Focus
- aria-label
- Form Label
- 44px Touch Target
- Motion 감소 환경 고려

## Mobile Web

- Safe Area
- Sticky CTA
- Bottom Nav
- Input Zoom 문제 방지
- 가로 Overflow 금지

### 목표

정식 납품 전에는 가능한 범위에서
Lighthouse의 Performance / Accessibility / Best Practices / SEO를 확인한다.

수치 자체를 계약상 보장하지는 않지만
명백한 저품질 상태로 납품하지 않는다.

---

# 0-11. Reference가 없는 상태에서 과도한 디자인 결정 금지

Front Design을 추후 제공할 가능성이 있다면
초기 단계에서 다음을 과도하게 확정하지 않는다.

- 강한 Brand Gradient
- 특이한 Font
- 복잡한 Background Illustration
- 고유 Card Shape
- 특정 컬러에 종속된 전체 Layout

먼저 기능과 Platform Structure를 안정화하고,
Reference가 들어온 뒤 시각적 Signature를 확정한다.

---

# 0-12. Reference 도착 후 우선 수정 순서

나중에 Front Design이 제공되면 다음 순서로 적용한다.

```text
1. Global Color / Type / Radius
2. Header / Navigation
3. Hero
4. Core Card
5. List / Search
6. Detail
7. Main Journey
8. Mobile
9. My Page
10. Secondary Section
11. Motion
```

기능을 다시 만드는 것보다
**가장 보이는 20%를 먼저 바꾸어 전체 인상을 빠르게 통일**한다.

---


# 1. 기준 레퍼런스

## 1.1 Localmat Commerce 계열 — 기본 뼈대 65%

강점:
- 1200~1280px 중심 레이아웃
- 플랫폼다운 글자 크기
- 모바일 2열 Product Grid
- 검색 / 카테고리 / 추천 / 시즌 / 스토리 / 마이페이지
- Product Card 정보 위계
- Hover Image Zoom
- Quick Action
- 고객이 “둘러보기 → 선택 → 행동”하는 흐름
- 과하지 않은 Soft Shadow
- 모바일 Horizontal Scroll

**본 문서의 기본 Typography와 Commerce/Card 구조는 이 계열을 우선 참고한다.**

## 1.2 Animal Beauty Booking 계열 — Journey UX 35%

강점:
- 예약 Step Indicator
- 완료 단계 재진입
- 서비스 Category
- 후기 / Trust
- CTA
- 모바일 중심 예약 UX
- Fade / Scale / Slide / Pop Motion

단, 해당 레퍼런스의 매우 큰 Font Scale 전체를 그대로 사용하지 않는다. **Step Journey 구조와 모바일 예약 UX만 적극 차용하고 Typography는 Localmat 계열 수준을 기본값으로 한다.**

---

# 2. 미래AI랩 Platform의 정의

> **“예쁜 회사 홈페이지”가 아니라, 고객이 실제로 행동하고 데이터가 남는 작은 플랫폼.**

일반 홈페이지:

```text
회사소개
제품소개
연락처
문의
```

Platform Web App:

```text
탐색
→ 선택
→ 비교
→ 저장
→ 신청/예약/구매/문의
→ 마이페이지
→ 다시 방문
```

최소 3단계 이상의 고객 행동이 이어져야 한다.

---

# 3. 최상위 UX 원칙 12

1. Homepage ≠ Brochure
2. 첫 화면에서 무엇을 할 수 있는지 즉시 보여준다.
3. 사용자는 최대 3클릭 안에 핵심 행동에 도달한다.
4. 검색·카테고리·필터를 적극 사용한다.
5. 주요 Card는 다음 행동을 가진다.
6. 모바일을 축소판 PC로 만들지 않는다.
7. 글자는 크되 과도하게 크지 않는다.
8. 예쁜 디자인보다 정보 위계가 우선이다.
9. Demo라도 죽은 버튼을 만들지 않는다.
10. 실제 데이터가 없으면 Demo임을 명확히 한다.
11. 핵심 Journey는 마지막 단계까지 완주 가능해야 한다.
12. 여유가 있으면 Premium Polish를 더하지만 기본 약속 범위는 통제한다.

---

# 4. Platform Type Selector

회사별 Master Prompt 생성 시 먼저 유형을 선택한다.

## TYPE A — Commerce
예: 농산물, 화장품, 패션, 생활용품, 식품

```text
상품 탐색 → 상품 상세 → 찜/장바구니 → 구매채널/구매요청 → 마이페이지
```

## TYPE B — Booking
예: 미용, 반려동물, 웰니스, 공간, 클래스

```text
서비스 선택 → 날짜 → 시간 → 담당자/지점 → 예약확인 → 예약내역
```

## TYPE C — Matching
예: 전문가, 산책, 인력, 지역서비스

```text
조건 입력 → 후보 추천 → 비교 → 상세 → 요청 → 진행상태
```

## TYPE D — Membership / Personalized Service
예: 교육, 웰니스, 구독, 추천 서비스

```text
진단/입력 → 추천 → 저장 → 개인화 페이지 → 재방문
```

## TYPE E — Local / Community
예: 로컬푸드, 관광, 지역상권, 지역서비스

```text
지역 탐색 → 카테고리 → 상세 → 저장/문의/예약 → 스토리
```

## TYPE F — Hybrid
최대 2개 유형까지만 결합한다.

예:
```text
Commerce + Membership
Booking + Matching
Local + Commerce
```

---

# 5. PLATFORM FINAL OBJECTIVE

회사별 Master Prompt에는 반드시 `PLATFORM FINAL OBJECTIVE`를 넣는다.

좋은 예:

### 농산물 커머스
> 지역 생산자의 상품을 고객이 쉽게 탐색하고 생산자 이야기와 상품정보를 확인한 뒤 저장·구매·정기배송으로 연결되는 모바일 중심 커머스 플랫폼 MVP를 구축한다.

### 예약
> 고객이 전화나 메신저 문의 없이도 서비스·담당자·날짜·시간을 선택하고 예약 완료와 내역 확인까지 할 수 있는 반응형 예약 플랫폼을 구축한다.

### 전문가 매칭
> 고객의 조건을 짧게 입력받아 적합한 전문가 후보를 추천하고 프로필 비교·상담요청·진행상태 확인까지 연결되는 매칭 MVP를 구축한다.

---

# 6. 플랫폼처럼 보이는 핵심 요소

다음 중 최소 5개 이상 권장:

1. Search
2. Category
3. Filter / Sort
4. Card List / Grid
5. Detail
6. Save / Wishlist
7. User Action
8. My Page / History

추가:
- Recommendation
- Recently Viewed
- Popular / New
- Status
- Notification
- Personalized Section

---

# 7. Global Layout

## Desktop

```text
Header
├─ Logo
├─ Search
├─ Main Nav
└─ User Actions

Main
├─ Hero
├─ Category / Quick Action
├─ Core Content
├─ Recommendation / Popular
├─ Conversion Section
├─ Story / Trust
└─ CTA

Footer
```

| 항목 | 기본값 |
|---|---:|
| Max Width | 1200~1280px |
| Desktop Padding | 24~32px |
| Tablet Padding | 20px |
| Mobile Padding | 16px |
| Section Gap Desktop | 56~80px |
| Section Gap Mobile | 40~56px |
| Card Gap | 16~24px |

---

# 8. Typography — “진짜 플랫폼 같은 크기”

Animal Booking 계열처럼 전체를 지나치게 크게 만들지 않는다. Localmat 계열의 균형을 기본으로 한다.

| 용도 | 기본값 |
|---|---:|
| Root | 18~19px |
| Body | 17~19px |
| Small | 14.5~16px |
| Card Title | 18~20px |
| Section Title | 28~36px |
| Hero Desktop | 44~60px |
| Hero Mobile | 32~40px |
| Button | 16~18px |
| Input | 16~18px |
| Price / Key Value | 20~26px |
| Nav | 15.5~17px |

모바일이라고 12px 수준으로 과도하게 줄이지 않는다.

---

# 9. Header

Desktop Standard:

```text
Logo | Search | Main Menu | My / Save / Cart
```

Search가 핵심인 서비스면 Header 중심에 둔다.

메뉴는 최대 2단계, 소형 플랫폼에서 10개 이상 메뉴는 지양한다.

---

# 10. Mobile Header / Bottom Navigation

Mobile Header:

```text
Menu | Logo | Search | User/Cart
```

검색 중요도가 높으면 Header 아래 별도 Search Row.

Bottom Navigation은 필요할 때 최대 4~5개.

예:

```text
홈 / 카테고리 / 핵심행동 / 마이 / 더보기
```

예약형:

```text
홈 / 검색 / 예약 / 내예약 / 마이
```

---

# 11. Hero

Hero는 회사소개보다 행동 유도가 우선이다.

구성:
- Strong Headline
- 1~2줄 Body
- Primary CTA
- Secondary CTA
- Product / Service Visual

좋은 예:
> 오늘 도착하는 제철 농산물을 만나보세요.

금지:
> 고객과 함께 성장하는 OO기업입니다.

같은 Generic 문구를 Hero 중심에 두지 않는다.

---

# 12. Category / Quick Action

Desktop 6~8개.
Mobile 4~6개 우선 + Horizontal Scroll.

아이콘은 단색으로만 두지 말고 필요하면 Soft Color Tile + Icon 구조를 사용한다.

---

# 13. Card Design System

기본:
- Radius 16~20px
- Thin Border
- Soft Shadow
- Padding 16~24px

Card Type:
1. Product
2. Service
3. Expert
4. Content
5. Booking
6. Recommendation
7. Review
8. Status

---

# 14. Product Card

가능 요소:

```text
Image
Badge
Wishlist
Brand / Seller
Product Name
Short Description
Discount
Price
Rating
Stock / Delivery
Quick Action
```

Desktop Hover:
- Image Scale 1.03~1.05
- Card Lift -2px
- Quick Action 등장 가능

Mobile:
- Hover 의존 금지
- 핵심 Action 항상 노출
- 기본 2열 Grid

---

# 15. Service / Booking Card

```text
Image
Service Name
Duration
Price
Rating
Available Status
CTA
```

행동은 예약하기 / 상담신청 / 일정보기 / 자세히 등 서비스에 맞게 사용.

---

# 16. Expert / Matching Card

```text
Photo
Name
Category
Experience
Tags
Rating
Available
Price/Fee
Compare
Request
```

매칭형은 2~3명 비교 기능을 검토할 수 있다.

---

# 17. Search

플랫폼 느낌의 핵심 요소.

- 실제 탐색대상을 Placeholder에 표시
- Search Result
- Empty State
- Recent Search 선택
- 자동완성은 필요 시

예:
```text
상품, 농장, 지역을 검색해보세요
```

---

# 18. Filter / Sort

Desktop: Horizontal Filter 또는 Sidebar.
Mobile: Bottom Sheet / Drawer.

예:
```text
가격 / 지역 / 카테고리 / 평점 / 배송 / 예약가능
```

Sort:
```text
추천순 / 인기순 / 최신순 / 가격순
```

---

# 19. Detail Page

Detail은 Conversion Page다.

상단:
```text
Visual
Name
Value Proposition
Price / Status
Primary CTA
Secondary Action
```

하단:
```text
핵심정보
추천 이유
상세설명
리뷰
관련상품
FAQ
```

모바일에서는 필요 시 하단 Sticky CTA.

---

# 20. Step Journey

예약·추천·매칭·진단에는 Step-by-Step 구조를 적극 사용한다.

```text
1. 카테고리
2. 조건
3. 옵션
4. 날짜/예산
5. 확인
6. 결과
```

완료 단계는 재진입 가능.
진행률은 한눈에 보이게.

---

# 21. 최종 Action Flow

실결제가 없는 MVP라도 흐름은 마지막까지 끝내야 한다.

```text
선택 → 확인 → 신청완료
```

Commerce:
```text
장바구니 → 주문정보 → 결제예정 화면
```

실 PG가 없으면 `DEMO CHECKOUT / 결제는 2차 연동 예정`을 명확히 표시한다.

---

# 22. My Page

플랫폼이면 My Page 또는 History 구조가 중요하다.

기본:
```text
Profile
Saved
History
Orders / Booking / Request
Recent
Settings
```

유형별로 필요한 것만 선택.

---

# 23. Personalization

적합한 경우:

```text
OO님을 위한 추천
최근 본 상품
다시 예약하기
관심 카테고리
재구매 추천
```

MVP에서는 Demo Store / localStorage도 허용.

---

# 24. Customer Data Loop

최소 하나의 행동을 기록한다.

예:
```text
찜
최근 본 상품
검색
추천결과 저장
예약
문의
```

Backend가 없으면 Demo Store / localStorage, 있으면 Supabase.

---

# 25. Homepage Section Formula

모든 섹션을 다 넣지 않는다.

기본:
```text
Hero
→ Category / Quick Action
→ Recommended / Popular
→ Core Conversion
→ Story / Trust
→ Secondary Recommendation
→ CTA
```

Commerce:
```text
Hero → Category → 추천상품 → 시즌상품 → 정기배송 → 생산자스토리 → Trust
```

Booking:
```text
Hero → Category → 인기서비스 → 추천매장/전문가 → 예약흐름 → Review → Trust
```

---

# 26. “홈페이지 느낌” 줄이기

다음이 많으면 홈페이지처럼 보인다.
- 회사소개가 상단 절반
- 긴 대표 인사말
- 연혁
- 조직도
- 인증서 나열
- Contact만 존재
- Card가 클릭되지 않음

플랫폼에서는:
```text
회사소개 < 고객행동
```

Story는 Home 후반 또는 별도 페이지.

---

# 27. Brand Visual System

Customer Platform도 **동일한 7개 Theme Library를 디자인 시스템 차원에서 보유**한다. 다만 Public 고객 화면에는 Theme Picker를 기본 노출하지 않고, 선택된 1개 Brand Theme의 일관성을 유지한다.

5~6 Color Token:
```text
Brand Primary
Brand Secondary
Accent
Soft Surface
Neutral Surface
Text
```

비율:
```text
Neutral 65~75%
Brand 15~20%
Accent 5~10%
```

---

# 28. 색상과 아이콘

무채색만 쓰면 밋밋하고, 너무 많은 색은 저가형 앱처럼 보인다.

색상 활용:
- Category Icon
- Badge
- CTA
- Highlight
- Soft Section
- Status

Status Color는 의미를 고정한다.

```text
Success Green
Warning Amber
Error Red
Info Blue
```

---

# 29. Motion

| 요소 | 권장 |
|---|---:|
| Hover | 0.15~0.25s |
| Modal | 0.2~0.3s |
| Drawer | 0.25~0.35s |
| Page Reveal | 0.3~0.45s |
| Toast | 0.2~0.3s |

권장:
- Fade Up
- Scale
- Slide
- Product Zoom
- Soft Pop
- Check Animation

금지:
- 모든 카드가 계속 움직임
- 과한 Bounce
- 긴 Parallax
- 모바일 성능을 떨어뜨리는 효과

---

# 30. Responsive QA

최소:
```text
360 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1920
```

확인:
- Text Clip 금지
- Button Overflow 금지
- Modal Overflow 금지
- Product Card 깨짐 금지
- Mobile 2열 확인
- Bottom Nav Safe Area
- Sticky CTA
- Landscape

---

# 31. Mobile First Modification

PC를 단순 축소하지 않는다.

Desktop:
```text
정보량 + 비교 + Hover
```

Mobile:
```text
핵심행동 + Scroll + Bottom Sheet + Sticky CTA
```

Touch Target은 최소 44px 전후 권장.

---

# 32. Modal / Drawer / Bottom Sheet

Desktop:
- Modal
- Side Drawer

Mobile:
- Bottom Sheet
- Full Screen Modal

현재 Context를 잃지 않도록 한다.

---

# 33. Empty / Loading / Error

Empty:
```text
아직 찜한 상품이 없습니다.
관심 있는 상품을 저장해보세요.
[상품 둘러보기]
```

Loading:
- Skeleton 우선
- Layout Shift 방지

Error:
```text
상품을 불러오지 못했습니다.
잠시 후 다시 시도해주세요.
[다시 시도]
```

Toast:
```text
찜 목록에 저장했습니다.
예약이 완료되었습니다.
```

---

# 34. Demo Data

실제 자료가 없어도 개발은 진행한다.

권장 구조:
```text
src/lib/demo/
products.ts
services.ts
users.ts
reviews.ts
orders.ts
bookings.ts
```

Component 내부에 Demo Array를 흩뿌리지 않는다.

Demo라면 `DEMO / SAMPLE DATA`, 실제 연결이면 `LIVE`로 명확히 구분한다.

---

# 35. Data Adapter

UI와 Data Source를 분리한다.

```text
UI
↓
Repository
↓
Demo / Supabase / API
```

나중에 실데이터를 넣을 때 UI 전체를 재작성하지 않는다.

---

# 36. Authentication

로그인이 필요한 경우:
- 예약내역
- 저장
- 구매이력
- 개인화
- 진행상태
- 회원전용

Demo Account도 가능.

---

# 37. Supabase / Backend

실제 Backend가 필요한 경우 기본 후보:
- Auth
- Postgres
- Storage
- RLS

처음부터 무조건 붙이지 않는다.

---

# 38. Mini Admin

순수 Customer Platform에 대형 관리자 시스템을 자동 추가하지 않는다.

필요하면 Mini Admin만:
```text
상품
예약
문의
회원
간단한 통계
```

Business AX가 별도 존재하면 Admin 중복개발을 피한다.

---

# 39. Platform + AX 결합 규칙

AX 프로젝트와 함께 만들 때 최소 1개 연결.

```text
Customer Platform
↓
Customer Event
↓
Business AX
↓
Action / Insight
```

예:
```text
상품 찜 증가 → 관심 급증 SKU
예약 증가 → 인력/시간대 Action
문의 증가 → 고객 니즈 Insight
```

---

# 40. 기존 홈페이지가 있는 회사

무조건 새 홈페이지를 만들지 않는다.

먼저 확인:
- 디자인 품질
- 모바일
- 수정 가능성
- 코드 접근
- API
- DB
- 회원
- 결제

기존 Front가 좋으면 `교체`보다 `Platform/AI/AX 기능 Layer 추가`를 우선한다.

---

# 41. 핵심 KPI

Platform Type별 3~5개만 선택.

Commerce:
```text
Product View / Wishlist / Add to Cart / Conversion / Repeat
```

Booking:
```text
Search / Start Booking / Completion / Rebooking
```

Matching:
```text
Condition Input / Profile View / Request / Match
```

Membership:
```text
Login / Recommendation / Save / Return
```

---

# 42. Trust / Review

신뢰요소:
- Review
- Certification
- Delivery
- Refund / Policy
- Seller / Expert Profile
- Brand Story
- FAQ

실제 인증·후기·실적만 사용.
가짜 실사용자 Review를 실제처럼 만들지 않는다.

---

# 43. Image Strategy

실제 이미지가 있으면 적극 사용.

없으면:
- Premium Placeholder
- Brand Gradient
- Abstract Product Shape
- Clean Illustration

업종과 무관한 Stock Image 남발 금지.

---

# 44. Premium Polish Priority

시간이 부족하면 이 순서로 투자한다.

1. Hero
2. Header
3. Core Card
4. Product/Service Detail
5. Main Journey
6. Mobile
7. My Page
8. Story
9. Motion
10. Secondary Page

상위 20%가 첫인상 80%를 결정한다.

---

# 45. 5초 테스트

5초만 봐도 다음이 보여야 한다.
- 무슨 서비스인지
- 무엇을 눌러야 하는지
- 핵심가치가 무엇인지

플랫폼 테스트:
- Home에서 실제 행동까지 이어지는가?

모바일 테스트:
- 한 손으로 주요 행동이 가능한가?

---

# 46. CORE / CONDITIONAL / PLUS

## CORE
- Home
- 핵심 탐색
- Detail
- 핵심 User Action
- Responsive
- Mobile
- 기본 My/History 또는 완료화면
- QA

## CONDITIONAL
- Login
- Cart
- Payment
- Booking
- Matching
- Review
- Recommendation
- Admin
- Supabase
- AI
- Map
- Notification

## PLUS
- Premium Motion
- Rich Story
- Personalized Feed
- Advanced Filter
- Compare
- Coupon
- Subscription
- Complex Admin

CORE가 끝나기 전 PLUS를 우선하지 않는다.

---

# 47. 범위 통제

첫 MVP 기본:

```text
핵심 Journey 1개
+
보조 Journey 1개
+
My Page 또는 완료/History
```

정도면 충분하다.

---

# 48. Customer Journey First

페이지 목록부터 만들지 않는다.

먼저 질문:
```text
고객이 왜 들어오나?
무엇을 찾나?
무엇을 비교하나?
무엇을 결정하나?
완료 후 무엇을 보나?
왜 다시 오나?
```

---

# 49. 플랫폼용 기획의도

AX의 긴 정책형 기획의도와 다르게 순수 플랫폼은 짧게.

권장 5~7 Section:
1. 왜 이 플랫폼인가
2. 고객의 현재 불편
3. 핵심 Journey
4. 기존 방식과 차이
5. 데이터가 남는 구조
6. 재방문/반복사용
7. 향후 확장

고객용 화면에는 API/DB/Architecture 설명을 과도하게 노출하지 않는다.

---

# 50. First Master Prompt 필수 시작 지시

회사별 첫 Master Prompt에는 다음 취지의 실행문을 **항상 맨 앞에 자동 삽입**한다.

```text
개발 시작 전 함께 제공된
「미래AI랩 Platform Web App Design & Development System v2.0」
전체를 먼저 읽고 공통 개발규격과 품질기준을 파악하라.

그 다음 이번 회사 Master Prompt를 읽고
Platform Type, PLATFORM FINAL OBJECTIVE,
CORE / CONDITIONAL / PLUS를 확정하라.

함께 제공된 Front Design / Reference Image는
시각적 방향을 이해하기 위한 레퍼런스로 사용하라.

충돌 시:
1. 최신 사용자 지시
2. 회사 Master Prompt
3. PROJECT_SPEC.md
4. 본 Platform v2.0
5. Reference Image
6. Claude 자율판단

순서를 따른다.

Hard Blocker가 없다면 별도 확인 없이 개발을 시작한다.
```

---

# 51. PROJECT_SPEC.md

첫 실행 PASS 1에서 자동 생성.

```text
PLATFORM FINAL OBJECTIVE
Platform Type
Target User
CORE
CONDITIONAL
PLUS
Route
Main Journey
Data Model
Responsive
Brand/UI
Demo/Live
Excluded
Acceptance Test
```

쉽게 말해 **이번 플랫폼의 최종 설계도**다.

---

# 52. PROJECT_STATE.md

큰 Milestone 후 갱신.

```text
완료
진행중
미완료
Known Issues
Next Priority
USER ACTION QUEUE
```

쉽게 말해 **현재 공사 진행상황**이다.

---

# 53. DECISIONS.md

큰 결정만 기록.

예:
- PG는 2차
- Login 1차 포함
- Customer Front 신규 구축
- Supabase 사용
- Booking Flow 5 Step

사소한 CSS 수정은 기록하지 않는다.

---

# 54. 초기 구현 2-Pass

## PASS 1 — 설계 잠금
- Final Objective
- Platform Type
- Journey
- Route
- Data
- Design
- Spec

## PASS 2 — 핵심 구현
- Shared Layout
- Home
- Core List
- Detail
- Core Action
- My / Result
- Mobile
- QA

PASS 1 후 멈추지 않고 PASS 2로 진행한다.

---

# 55. 장시간 자율 실행

목표와 범위가 확정되었으면 작은 단계마다 사용자에게 묻지 않는다.

Hard Blocker 외에는 계속 진행한다.

사용자만 해야 하는 작업은 USER ACTION QUEUE에 누적:
- Supabase
- ENV
- API Key
- Domain
- 실제 Asset
- 외부 Console

가능하면 마지막 또는 주요 Checkpoint에 한 번에 정리한다.

---

# 56. Claude Direct Polish

큰 뼈대 완성 후에는 사용자가 Claude와 직접 짧게 수정하는 것이 효율적이다.

예:
```text
Hero 조금 덜 비어보이게.
모바일 Card 높이 맞춰줘.
검색창 더 플랫폼답게.
CTA 더 강하게.
```

큰 방향, 사업모델, 정보구조가 흔들릴 때만 ChatGPT를 다시 사용한다.

---

# 57. AX와 함께 사용할 때

```text
AX v6
+
Platform v2
```

적용:
- 내부 Business AX → AX v6
- Customer Platform → Platform v2
- 공통 개발운영 → 회사 Master Prompt 우선
- 데이터 연결 → 두 문서 모두 참고

---

# 58. 순수 Platform 프로젝트일 때

AX v6는 필수가 아니다.

```text
Platform v2
+
회사 Master Prompt
+
Front Reference
```

만으로 시작 가능.

---

# 59. 업종별 빠른 적용

## 농산물 / 식품
생산자 / 지역 / 제철 / 배송 / 정기배송 / Story

## 화장품
고민 / Category / 추천 / Routine / Product / Save

## 반려동물
서비스 / 매장 / 담당자 / 날짜 / 예약

## 교육
Course / Instructor / Schedule / Apply / My Learning

## 전문가
Category / Condition / Expert / Compare / Request

## 웰니스
Program / Condition / Recommendation / Booking / History

---

# 60. 권장 Repository Structure

```text
src/
  app/
  components/
    layout/
    ui/
    cards/
    journey/
  lib/
    demo/
    data/
    utils/
  types/

docs/
  PROJECT_SPEC.md

PROJECT_STATE.md
DECISIONS.md
```

---

# 61. Shared Component First

권장:
```text
Header
MobileBottomNav
SearchBar
PageContainer
SectionHeader
ProductCard / ServiceCard
Badge
Button
Modal
Drawer
BottomSheet
EmptyState
LoadingSkeleton
Toast
```

---

# 62. Interaction First QA

디자인보다 먼저:

```text
누른다
→ 바뀐다
→ 저장된다
→ 다음으로 간다
```

가 정상인지 확인한다.

그다음 Visual QA:
- Alignment
- Spacing
- Typography
- Color
- Icon
- Image
- Motion

---

# 63. 98~100점 MVP Acceptance Test

## First Impression
- [ ] 5초 안에 서비스 목적 이해
- [ ] Homepage가 아니라 Platform처럼 보임
- [ ] Hero/CTA가 강함
- [ ] Font가 과도하게 크거나 작지 않음

## Platform
- [ ] Search / Category 중 필요한 것 동작
- [ ] List → Detail 연결
- [ ] 핵심 CTA 실제 동작
- [ ] Core Journey 마지막까지 완주
- [ ] My / History / Result 존재
- [ ] Cross-page State 유지

## Mobile
- [ ] 360~430 안정
- [ ] Mobile Grid 안정
- [ ] Bottom Nav / Sticky CTA 필요 시 동작
- [ ] Touch Target 충분

## Data
- [ ] Demo/Live 구분
- [ ] Demo Data 중앙화
- [ ] 실데이터 교체 가능 Repository
- [ ] 가짜 실적/후기/인증 없음

## Polish
- [ ] Empty/Loading/Error
- [ ] Toast
- [ ] Hover/Motion 적절
- [ ] Hero와 Core Card의 품질이 내부 페이지까지 유지
- [ ] 죽은 버튼 없음

---

# 64. 계약 / 영업 범위 원칙

본 문서는 개발품질 기준이지 모든 고급 디자인 작업을 기본계약에 포함한다는 뜻이 아니다.

기본 약속:
```text
핵심 플랫폼 MVP
+
반응형
+
핵심 Journey
```

여유가 있으면:
- Hero Polish
- Motion
- Story
- Personalized Section

을 추가해 **적게 약속하고 많이 제공**하는 전략을 사용할 수 있다.

---

# 65. 금지 패턴

- 회사소개 Template처럼 보임
- Hero만 멋지고 내부는 급격히 저품질
- 모든 Card가 똑같음
- 모바일에서 PC Header 그대로
- Carousel 남발
- 12px 회색글씨
- 무의미한 Gradient
- 가짜 Review / 실적
- 죽은 CTA
- 기능 없는 Icon
- 한 화면에 8개 Accent Color
- 예약/구매 흐름이 중간에서 끊김

---

# 66. 최종 프로젝트 제작 공식

```text
회사정보
+
고객 Journey
+
Platform Type
+
PLATFORM FINAL OBJECTIVE
+
Platform v2.0
+
Front Reference
=
회사 전용 Claude Code Master Prompt
```

---

# 67. 최종 개발 운영 흐름

```text
ChatGPT
회사분석 + Platform 기획
↓
Master Prompt
↓
Claude
Platform v2 + Master Prompt + Front Reference
↓
PROJECT_SPEC
↓
2-Pass 구현
↓
PROJECT_STATE
↓
사용자 ↔ Claude 직접 Polish
↓
필요 시 실데이터 / Supabase / API
```

---

# 68. 버전

**v2.0 — 2026-08-28**

핵심 기반:
- Sample Localmat Commerce의 플랫폼형 정보밀도·Product UX
- Sample Animal Beauty Booking의 Step Journey·예약 UX
- 미래AI랩 AX Design & Development System v6.0에서 축적된 가독성·반응형·Demo/Live·자율개발·PROJECT_SPEC/STATE 운영원칙

향후 실제 플랫폼 MVP를 반복 제작하며 업데이트한다.


---

# 82. Master Prompt Generator — Reference 우선 자동 삽입문

앞으로 ChatGPT가 회사별 첫 Master Prompt를 생성할 때
다음 취지의 내용을 자동으로 포함한다.

```text
[FRONT REFERENCE PRIORITY]

이번 프로젝트에 Front Design / Reference Image가 함께 제공되었다면
고객용 화면의 시각적 방향은 해당 Reference를 최우선 기준으로 삼는다.

본 Platform v2.0은 구조·가독성·반응형·Journey·QA 기준이며,
Reference는 이번 회사의 실제 외관과 Mood를 결정하는 기준이다.

Reference를 그대로 복사하지 말고
Layout / Typography / Color / Density / Card / Image / Motion / Brand Mood를 추출하여
이번 회사 서비스에 맞게 재해석한다.

Front Reference가 아직 제공되지 않았다면
NEUTRAL PREMIUM MODE로 구현하고
FRONT_REFERENCE_STATUS: PENDING으로 기록한다.

추후 Reference가 제공되면 기능을 다시 만들지 말고
Visual Layer를 우선 재정렬한다.
```

사용자가 이 문구를 별도로 기억할 필요가 없도록 한다.

---

# 83. Reference First Acceptance Test

Front Reference가 있는 프로젝트 완료 전:

- [ ] Reference의 전체 Mood가 느껴지는가
- [ ] Reference와 전혀 다른 Generic Template이 되지 않았는가
- [ ] Color / Typography / Density가 일관적인가
- [ ] Hero가 Reference 방향과 맞는가
- [ ] Core Card가 Reference의 시각언어를 반영하는가
- [ ] Mobile에서도 같은 브랜드 느낌이 유지되는가
- [ ] 타사 상표·문구·기능을 그대로 복제하지 않았는가
- [ ] 회사별 Project Signature가 최소 3개 있는가
- [ ] PRIMARY CONVERSION GOAL이 화면에서 명확한가
- [ ] CTA 우선순위가 분명한가

---

# 84. 플랫폼 평가 Scorecard

최종 QA 시 100점 기준으로 내부평가할 수 있다.

| 영역 | 배점 |
|---|---:|
| Brand / Reference Fidelity | 15 |
| Platform Feel | 15 |
| Primary Journey | 20 |
| Mobile / Responsive | 15 |
| Card / Detail Quality | 10 |
| Conversion Clarity | 10 |
| Data / State / Interaction | 5 |
| Performance / Accessibility / SEO | 5 |
| Polish / Motion | 5 |

### 판정

```text
90 미만
→ 아직 납품용 Polish 부족

90~94
→ 좋은 MVP

95~97
→ 고품질 MVP

98~100
→ 소형 플랫폼 MVP 기준 최상급
```

점수를 억지로 100으로 만들기 위해
범위 밖 기능을 추가하지 않는다.

---

# 85. v2.0 개발 시작 패키지

권장:

```text
1. Platform v2.0 MD
2. 회사 Master Prompt
3. Front Design / Reference Image
```

Reference가 없는 경우:

```text
1. Platform v2.0 MD
2. 회사 Master Prompt
```

로 바로 시작.

나중에 Reference만 추가해도 된다.

---

# 86. v2.0 최종 철학

> **공통규격은 모든 플랫폼을 비슷하게 만들기 위한 것이 아니다.**
>
> 공통규격은 품질 하한선을 일정하게 만들고,
> Front Reference와 회사별 기획이 최종 결과물의 개성을 결정하게 하기 위한 것이다.

따라서 미래AI랩 플랫폼 개발은:

```text
공통 구조는 재사용
+
시각적 결과는 회사별 재해석
+
핵심 고객행동은 명확
+
모바일은 실제 앱처럼
```

을 기본으로 한다.

---

# 87. 버전

**v2.0 — 2026-08-28**

v2.0 주요 추가:
- Front Reference First
- Visual Priority와 Functional Priority 분리
- Reference 미제공 시 Neutral Premium Mode
- Reference 추후 제공 시 Visual Layer 재정렬
- VISUAL REFERENCE MAP
- Anti-Template Rule
- 회사별 Project Signature 3개
- Primary Conversion Goal
- Event Tracking Ready
- Public Web Quality
- SEO / Metadata / Performance / Accessibility
- Reference First Acceptance Test
- Platform Scorecard

# ============================================================
# PART C — FULL UNIFIED v1.4 CROSS-SURFACE STANDARD INCORPORATED
# ============================================================

> 아래는 기존 Unified v1.4의 Cross-Surface 상세 규칙을 보존한 Module이다. v2.0은 이 부분을 요약해 없애지 않고 그대로 계승한다.

## [INCORPORATED SOURCE] 미래AI랩 AX + Platform Unified Design & Development System v1.4
## Business AX · Customer Platform · Hybrid Project 전용 통합 규격


# v1.4 UPDATE — Hybrid Visual Quality & Future Expansion Navigation Layer

> **v1.4 목적**
>
> Hybrid MVP 실전 제작 결과,
> Customer Platform은 사진·브랜드 경험이 풍부할수록 실제 서비스처럼 보였고,
> Business AX는 사진을 절제하고 KPI / AI / Action을 앞세울수록 기술적 완성도가 높아졌다.
>
> 또한 고객 플랫폼 Navigation에 현재 기능만 두는 것보다,
> **향후 확장 메뉴를 소수 노출했을 때 고객·정책기관·투자자가 성장 시나리오를 훨씬 빠르게 이해**할 수 있다.
>
> v1.4는 다음을 Source of Truth로 추가한다.
>
> 1. Customer > AX Visual Density Ratio
> 2. Image Sharpness / Placement Gate
> 3. Prepared Asset Utilization Gate
> 4. Future Expansion Navigation Layer
> 5. Current vs Future Capability Separation
>
> Unified v1.3 이하와 충돌하면 본 v1.4 UPDATE가 우선한다.

---

# 1. CUSTOMER > AX VISUAL DENSITY CONTRACT — 필수

Hybrid에서는 두 Surface의 사진 사용 밀도가 같으면 안 된다.

## Customer Platform
사진을 적극 활용한다.
- Hero
- Service / Product / Program Thumbnail
- Brand Story
- Trust
- Customer Experience
- Booking / Order CTA
- Review / Completion
- Mobile visual card

준비한 Customer Asset의 **60~80% 정도 활용**을 권장한다.

## Business AX
사진을 절제한다.
- Page Intro
- Context Banner
- Why AX
- Presentation
- Evidence 설명
- 실제 업무 맥락

준비한 AX Asset의 **30~50% 정도 선별 활용**을 권장한다.

### AX의 시각 우선순위
**KPI / Status → AI Insight → Action → Operations → Evidence → Photo**

사진이 이 순서를 깨면 FAIL이다.

---

# 2. IMAGE SHARPNESS & RESPONSIVE PLACEMENT GATE

큰 이미지의 존재 여부가 아니라 **선명도까지 완료조건**이다.

- Hero / Wide Banner / Why AX / Before-After 이미지가 깨지면 FAIL
- 원본 해상도가 컨테이너 크기에 충분해야 함
- stretch 금지
- `object-fit`, `object-position`, responsive crop 필수
- mobile 핵심 피사체 보호
- text-on-image에는 overlay / gradient 적용
- Customer / AX 모두 브랜드 톤 일관성 유지

### Why AX 필수
- `why_ax_01_current.jpg`
- `why_ax_02_improved.jpg`
- `why_ax_03_growth.jpg`

세 장 모두 선명하게 사용하며
**Current Problem → Improved Workflow → Growth / Scale-up**
순서가 읽혀야 한다.

---

# 3. PHOTO ROLE DIVERSITY

같은 구도의 사진을 서비스 카드마다 반복하지 않는다.

가능하면 아래 역할을 분리한다.
- close-up
- service scene
- customer interaction
- facility
- product / result
- staff action
- completion / delivery

같은 이미지 재사용은 필요한 경우에만 한다.

---

# 4. FUTURE EXPANSION NAVIGATION LAYER — Hybrid 신규 핵심

Customer Platform Navigation에는
현재 서비스만 보여주는 것이 아니라,
**업종에 맞는 향후 확장 메뉴 3~6개**를 추가로 보여줄 수 있다.

목표:
- 고객에게 확장 기대감 제공
- 정책자금 / 정부지원 심사자에게 사업모델 확장성 전달
- 투자자에게 반복매출 / B2B / 네트워크 / 데이터 자산 가능성 전달

---

## 4.1 FUTURE MENU POOL

회사에 맞는 것만 선택한다.

### B2B / Enterprise
- 기업·단체 문의
- 법인 전용
- 기업 견적
- 대량구매
- Fleet / Business Account

### Recurring Revenue
- 멤버십
- 구독
- 정기관리
- 정기배송
- 재예약 / 재주문

### Partner / Supply
- 파트너·제휴
- 전문가 / 사업자 등록
- 입점 문의
- 공급사 등록
- 파트너센터

### Geographic Scale
- 지역 / 지점 찾기
- 가맹점
- 제휴센터
- 서비스 지역 확대
- Partner Network

### Data Asset
- 내 기록
- 데이터 리포트
- 이력 관리
- AI Insight
- 통합 리포트

### Growth / Monetization
- 추천인 / 리워드
- 친구초대
- 광고·브랜드 제휴
- 광고문의
- 프로모션 파트너

### Content / Ecosystem
- 가이드 / 매거진
- 전문가 콘텐츠
- 아카데미
- 커뮤니티
- API / 외부서비스 연동

---

## 4.2 70/30 NAVIGATION RULE

현재 핵심 메뉴가 항상 우선이다.

권장:
**Current Core 70~80% / Future Expansion 20~30%**

미래메뉴는 보통 3~6개 이하.

Desktop:
- 상단 / 좌측 Navigation
- 또는 `더보기`
- 또는 Footer Expansion

Mobile:
- Drawer / More Sheet 안에 자연스럽게 배치

---

## 4.3 CURRENT vs FUTURE CAPABILITY SEPARATION — 필수

아직 구현하지 않은 미래메뉴를
현재 동작하는 기능처럼 보이게 하지 않는다.

미래 메뉴 클릭 시:
- `향후 확장`
- `Coming Next`
- `Next Phase`
- `Preview`
- `확장 검토`

중 하나를 명확히 표시한다.

그리고 3~5개 수준의 예상 기능만 보여주는
Preview Sheet / Drawer / Light Page를 연다.

### 절대 금지
- 404
- Empty Page
- 현재 계약범위로 오해시키는 표현
- 미래 기능을 실제 구현된 것처럼 과장

---

# 5. GROWTH SIGNAL SELECTION RULE

미래 메뉴는 단순 장식이 아니다.

메뉴만 보고 아래 중 최소 2개 이상이 읽히면 좋다.

- B2B 매출
- 반복매출
- 공급자 / 파트너 생태계
- 지역 / 다점포 확장
- 데이터 자산
- 추가 수익모델
- 인접서비스 확장

단, 회사의 실제 업종·시장성·현재 고객관계와 연결되지 않으면 넣지 않는다.

---

# 6. ADVERTISING / LISTING CAUTION

`광고문의`와 `입점문의`는
플랫폼 트래픽이나 공급자 생태계가 현실적으로 확장될 수 있을 때만 사용한다.

무조건적인 기본 메뉴가 아니다.

경우에 따라 다음이 더 우선:
- 기업·단체
- 파트너·제휴
- 멤버십
- 법인전용
- 제휴센터
- 사업자 등록
- 지역 확장

---

# 7. HYBRID VISUAL & EXPANSION ACCEPTANCE GATE

최종 QA에 아래를 추가한다.

### Visual
- [ ] Customer Platform이 AX보다 사진 활용이 풍부하다.
- [ ] Customer 핵심 Asset의 60~80% 정도가 문맥에 맞게 사용된다.
- [ ] AX Asset은 30~50% 정도만 선별 사용된다.
- [ ] Hero / Banner / Why AX 이미지가 선명하다.
- [ ] mobile crop이 자연스럽다.
- [ ] 서비스 이미지 반복감이 심하지 않다.
- [ ] AX에서 KPI / AI / Action이 사진보다 우선한다.

### Expansion
- [ ] Future Expansion Menu가 업종에 맞게 3~6개 이하로 존재한다.
- [ ] Current Core와 Future Menu가 시각적으로 구분된다.
- [ ] 미래 메뉴 클릭 시 Preview / Sheet / Drawer가 열린다.
- [ ] 404 / 빈화면이 없다.
- [ ] B2B / 반복매출 / 파트너 / 지역 / 데이터 / 신규수익 중 최소 일부 성장방향이 읽힌다.
- [ ] 미래 확장 내용이 Why AX / Growth Story와 서로 모순되지 않는다.

---


# v1.3 UPDATE — Pre-Generated Hybrid Asset Pack Contract

> **v1.3 목적**
>
> v1.2가 Hybrid Project의 Motion / Surface / Cross-quality 하한선을 끌어올렸다면, v1.3은 실제 혼합형 프로젝트에서 남는 마지막 공백인 **사진 자산 준비 문제**를 해결한다.
>
> Hybrid 프로젝트는 Customer Platform과 Business AX가 함께 있기 때문에, 사진도 한쪽만 준비해서는 안 된다.  
> 본 업데이트는 사용자가 **처음부터 Customer용 사진 + AX용 사진을 함께 준비**하여, Claude가 첫 빌드부터 완성형 Hybrid MVP를 만들도록 하는 규격이다.
>
> 목표는 **플랫폼과 AX 모두 사진·배경·썸네일이 채워진 일관된 결과물**을 한 번에 얻는 것이다.
>
> Unified v1.2 이하와 충돌하면 본 v1.3 UPDATE가 우선한다.

---

# HYBRID PROMPT 최상단 ASSET PREP BLOCK — 신규 필수

Hybrid 마스터 프롬프트에서는, **깃허브용 프로젝트명 바로 아래**에 아래 준비 블록을 둔다.

```text
[ASSET PREP BLOCK — HUMAN ONLY]
Generate all of the following visual assets first in Codex App.
Save each file with the exact filename below.
After generating them, upload them to Google Drive and share the folder link.
These lines are preparation notes for asset generation and are not part of the implementation task.
[/ASSET PREP BLOCK]
```

이 블록은 사람이 이미지를 미리 준비하기 위한 것이며, 최종 Claude 입력 시 지워도 된다.

---

# HYBRID ASSET PACK — 구조

Hybrid는 **Customer Pack + AX Pack** 두 덩어리로 나눠 준비한다.

## A. Customer Pack — 핵심 8종

1. `hero_main.jpg`
- `Premium hero image for a [industry] customer platform, showing the signature service, product, or customer experience, realistic, beautiful, commercial quality, no text`

2. `hero_secondary.jpg`
- `Secondary premium brand image for [industry], refined and trustworthy, realistic commercial quality, no text`

3. `service_01_[name].jpg`
4. `service_02_[name].jpg`
5. `service_03_[name].jpg`
- `Premium thumbnail photo for [specific service/program name] in [industry], clean, realistic, commercial quality, no text`

6. `offer_01_[name].jpg`
7. `offer_02_[name].jpg`
8. `offer_03_[name].jpg`
- `Premium product or offer thumbnail for [specific item name] in [industry], realistic, attractive, commercial quality, no text`

추가 권장:
- `brand_story_space.jpg`
- `customer_experience.jpg`
- `booking_or_order_scene.jpg`
- `trust_banner.jpg`
- `mobile_card_vertical.jpg`

## B. AX Pack — 핵심 8종

1. `ax_cover_main.jpg`
- `Premium editorial business photo of [company industry], showing the core real-world operation of the company, clean premium lighting, realistic, high-end, trustworthy, no text`

2. `ax_signature_operation.jpg`
- `Detailed premium photo of the company's signature operation or production process in [industry], clean, realistic, commercial quality, no text`

3. `ax_signature_output.jpg`
- `Premium product/result photo for [industry], beautifully arranged, realistic commercial quality, no text`

4. `ax_workspace_bg.jpg`
- `Wide clean photo of a real [industry] workspace, facility, showroom, office, workshop or field environment, premium realistic lighting, no text`

5. `ax_staff_action.jpg`
- `Professional staff member in [industry] actively working, realistic premium business photo, no text`

6. `ax_manager_tablet.jpg`
- `Business owner or manager in [industry] reviewing operations on a tablet or laptop, premium realistic photo, no text`

7. `ax_report_evidence.jpg`
- `Clean business report, checklist, or evidence-style scene related to [industry], premium realistic photo, no text`

8. `why_ax_01_current.jpg`
9. `why_ax_02_improved.jpg`
10. `why_ax_03_growth.jpg`
- `Realistic business photo visualizing current manual workflow / improved smart workflow / growth and scale-up in [industry], premium, no text`

---

# HYBRID 본문 구현 지시에서 반드시 넣을 문장 — 신규 필수

```text
Assume the full hybrid visual asset pack has already been generated, uploaded to Google Drive, and is available to use.
Use those assets intentionally from the first build.
Do not leave key customer-facing sections or Why AX / present / intro sections with empty placeholders when a matching prepared asset exists.
```

또한 아래 매핑을 명시한다.

## Customer Mapping
- `hero_main.jpg` → 메인 Hero
- `hero_secondary.jpg` → 중간 CTA/Story
- `service_01~03` → 핵심 서비스 카드
- `offer_01~03` → 상품/패키지/메뉴/오퍼 카드
- 추가 customer assets → About / Review / Booking / Mobile card

## AX Mapping
- `ax_cover_main.jpg` → AX 소개 / Present 상단
- `ax_signature_operation.jpg` → 핵심업무 카드
- `ax_signature_output.jpg` → 대표 결과물/서비스 카드
- `ax_workspace_bg.jpg` → 배경 배너 / Intro
- `ax_staff_action.jpg` → 현장/일정/담당자 문맥
- `ax_manager_tablet.jpg` → 대표 대시보드 / AI 브리핑 문맥
- `ax_report_evidence.jpg` → 리포트 / Evidence
- `why_ax_01~03` → 기획의도 / Why AX 스토리

---

# HYBRID 사진 사용 원칙 — 강화 필수

- Customer와 AX의 사진 무드는 **같은 브랜드 프로젝트처럼 맞아야 한다.**
- Customer는 친화적·브랜드형, AX는 신뢰·업무형이되, 톤 차이가 너무 크면 안 된다.
- Background는 Overlay를 사용해 가독성을 확보한다.
- Hero / Signature Card / Why AX / Present는 가능하면 실제감 있는 사진 자산을 우선 사용한다.
- 사진 자산을 초기에 준비했다면, 첫 빌드부터 실제 배치까지 끝낸다.  
  **“나중에 이미지 대입 예정” placeholder 남발은 실패**다.

---

# PROMPT LENGTH RULE — 신규 필수

사진용 프롬프트는 길게 쓰지 않는다.  
각 프롬프트는 **대상 + 업종 + 톤 + realistic/commercial quality + no text** 정도의 짧고 선명한 구조를 권장한다.

---



# v1.2 UPDATE — Hybrid Visual Polish & Surface Clarity Completion

> **v1.2 목적**
>
> v1.1이 Hybrid의 Surface 왕복 / Cross-device Parity / Preview / Why AX / Tutorial / Theme를 강제했다면, v1.2는 실제 구현에서 남을 수 있는 **모델별 Visual Polish 편차, Customer/AX의 정적인 Interaction, Dark Sidebar 가독성 저하, Off-white Surface 과다 사용으로 인한 뿌연 화면**을 차단한다.
>
> 본 업데이트는 Customer Platform과 Business AX 모두에 **같은 수준의 Interaction Quality와 Surface Contrast 하한선**을 적용한다. 핵심 업무기능뿐 아니라 제품의 촉감까지 Hybrid Completion의 일부로 본다.
>
> Unified v1.1 이하와 충돌하면 본 v1.2 UPDATE가 우선한다.

---

# HYBRID MOTION & MICRO-INTERACTION CONTRACT — 신규 필수

Customer와 Business Surface 모두 클릭 가능 UI에는 상태 Feedback이 있어야 한다.

## Business AX Desktop

- Sidebar Item / KPI / AI Insight / Action Card / Table Row / Tab / Filter / Button Hover 필수.
- 기본 Transition: `140~180ms ease-out`.
- 권장: 약한 Tint / Shadow / `translateY(-1px~-2px)` / Icon 미세 이동.
- Table Row Hover는 필수에 가깝게 적용하여 Data Tracking을 돕는다.

## Customer Desktop

- Header / CTA / Program·Product·Portfolio·Service Card / Booking Slot / My Action에 Hover State 필수.
- Image Card는 필요한 경우 `scale(1.01~1.03)` 이내의 절제된 Zoom 가능.

## 공통 Layer

- Tooltip / Popover: `80~160ms` 정도의 짧은 자연스러운 Delay 허용.
- Drawer / Modal / Bottom Sheet / Accordion: `160~240ms` Fade / Slide / Scale.
- Story / Why AX Section은 필요한 경우 `120~180ms` Reveal.
- Mobile에서는 Hover 대신 `pressed / active / selected` feedback 필수.

금지: Bounce / Neon / 큰 Scale / 지속 Pulse / 과한 Parallax / 장식성 Loop Motion / 느린 300ms+ Hover.

Motion 감소 설정에서는 장식 Motion을 줄이되 **상태 변화 Feedback 자체는 유지**한다.

---

# HYBRID PURE WHITE SURFACE CONTRACT — 신규 필수

Theme는 **Canonical 7개 조합**을 유지한다. 임의로 6개로 축소하지 않는다.

7개 Theme와 별개로 모든 Surface가 공유하는 Global Utility Token:

```text
PURE_WHITE_SURFACE = #FFFFFF
PURE_WHITE_TEXT    = #FFFFFF
NEUTRAL_TEXT       = #111827 또는 동급
```

## Business AX

Deep Teal / Olive / Cocoa / Warm Theme에서:
- KPI / Table / Modal / Form / Settings 주요 Card / Main Data Card의 상당 부분은 Pure White 사용.
- Soft/Canvas Color는 Main Background와 Secondary Tint 중심.
- 화면 전체가 한 가지 Off-white/Colored Tint로 덮이지 않게 한다.

## Customer Platform

Public Brand Canvas가 Warm Ivory / Beige / Soft Color여도:
- Booking / Form / My / Confirmation / Primary Product Card 등 정확한 정보가 중요한 Surface는 Pure White 사용 가능·권장.
- Public Customer에게 Theme Picker를 억지로 노출하지 않는 기존 정책은 유지.

권장 Raised Surface 중 `60~80%`는 Pure White 또는 동급의 깨끗한 Neutral을 사용할 수 있다.

---

# DARK SHELL READABILITY CONTRACT — 신규 필수

Business AX의 Dark Sidebar와 Customer Platform의 Dark Header/Drawer는 다음을 우선한다.

```text
Active Navigation   = #FFFFFF
Primary Navigation  = #F3F4F6 ~ #FFFFFF
Inactive Navigation = 최소 #E5E7EB 수준
Section Label        = #AEB7C3 전후
Muted Metadata       = 최소 #94A3B8 수준
```

Theme에 따라 Navigation Text 자체를 Accent Hue로 Recolor하지 않는다.

**Text는 White 계열, 색상 차별화는 Icon / Active Pill / Underline / Tint**에서 만든다.

Sidebar/Mobile Drawer의 컬러 아이콘 규칙은 v1.1을 유지한다.

---

# HYBRID VISUAL POLISH COMPLETION GATE — 신규 필수

Hybrid는 Customer와 Business 중 한쪽만 고급스럽게 보여도 완료가 아니다.

## Business AX 필수

1. 주요 Clickable Element Hover Coverage `90% 이상`.
2. KPI / AI / Table / Action / Tab에 상태 Feedback 존재.
3. Table Row Hover / Selected Recognition 존재.
4. Dark Sidebar Text가 깨끗한 White 계열.
5. Deep Teal / Olive / Cocoa 등에서도 주요 Raised Surface가 Pure White 대비 확보.

## Customer Platform 필수

6. 주요 CTA / Navigation / Service·Product·Program Card Hover Coverage `90% 이상`.
7. 예약/구매/요청 선택상태와 Mobile Pressed Feedback 존재.
8. Modal / Drawer / Bottom Sheet / Accordion Transition 존재.
9. Form Focus State / Loading State가 명확.

## 공통

10. Desktop과 Mobile 모두 Interaction Feedback 존재.
11. Motion이 주요 Journey 또는 Action 실행을 지연하지 않는다.
12. `prefers-reduced-motion` / Motion 감소 설정 대응.
13. Theme 변경 후 Customer/AX가 서로 다른 품질 수준으로 보이지 않는다.
14. 실제 렌더링 QA를 통해 확인하며 CSS Class 존재만으로 PASS하지 않는다.

### v1.2 Whole-Hybrid Visual Run 추가

```text
Fresh Load(Customer)
→ Header/CTA Hover
→ Customer Card Hover
→ Booking/Primary Journey 선택 Feedback
→ Business AX 이동
→ Sidebar Text Contrast
→ Sidebar Icon Color
→ KPI/AI/Table Hover
→ Theme 7종
→ Deep Teal / Olive / Cocoa White Surface 확인
→ Modal/Drawer Transition
→ Mobile Customer Tap Feedback
→ Mobile Business Tap Feedback
→ Motion 감소 설정
→ Customer ↔ AX 왕복 후 Interaction 상태 정상
```

위 Visual Run은 v1.1 Whole-Hybrid Acceptance Run에 추가하여 수행한다.

---

# v1.1 UPDATE — Hybrid Product Shell Parity & Round-trip Completion

> **v1.1 목적**
>
> Unified v1.0이 Business AX와 Customer Platform의 Closed Data Loop를 잘 만들었지만, 실제 Hybrid Reference 검증에서 **Surface 왕복 단절, Device Preview 재귀/잘림, Mobile/PC 기능 불균형, Why AX 비노출, Tutorial 정적화, Theme/Navigation 보조기능 누락**이 반복되었다.
>
> v1.1은 Hybrid의 핵심 업무기능을 더 늘리는 버전이 아니라 **두 Surface를 감싸는 Product Shell을 핵심 기능과 동일한 수준으로 강제**한다.
>
> Unified v1.0 이하와 충돌하면 본 v1.1 UPDATE가 우선한다.

---


# SURFACE ROUND-TRIP GATE — Hybrid/다중 Surface 필수

Surface Switch는 한 방향 링크가 아니다.

관리자 / Demo Role에서 반드시 실제로 검증:

```text
Customer Desktop → Business Desktop → Customer Desktop
Customer Mobile  → Business Mobile  → Customer Mobile
```

- 각 Surface에서 다른 Surface로 이동할 수 있어야 한다.
- 돌아오는 경로도 반드시 존재한다.
- 대표 도메인 `/`이 Customer Front인 경우에도 Demo/Admin 사용자는 Business AX 진입점을 발견할 수 있어야 한다.
- 일반 고객 Role에서는 Business AX 진입점을 숨긴다.
- Demo/Admin 모드에서는 얇은 Demo Control Bar 또는 명확한 Surface Switch를 사용할 수 있다.

한쪽 방향만 되면 Gate 실패.


---


# PRODUCT SHELL PARITY CONTRACT — 신규 필수

기능의 `존재 여부`만 확인하지 않는다. **PC / 실제 Mobile / Device Preview에서 사용자가 동일한 목적을 달성할 수 있는지**를 검증한다.

PASS 1에서 아래 Matrix를 PROJECT_SPEC.md에 만들고, 완료 전 실제로 채운다.

| 기능 | Desktop | 실제 Mobile | 반대 Device Preview | Discoverable | Behavior Parity |
|---|---|---|---|---|---|
| 전체 Navigation | 필수 | 필수 | 필수 | 필수 | 필수 |
| 날짜 + 현재시각 | 필수 | 필수 | 필수 | 필수 | 필수 |
| Theme | 필수 | 필수 | 필수 | 필수 | 필수 |
| Font Scale | 필수 | 필수 | 필수 | 필수 | 필수 |
| Role / Permission Preview | 필수 | 필수 | 필수 | 필수 | 필수 |
| Tutorial | 필수 | 필수 | 필수 | 필수 | 필수 |
| Why / Story | 필수 | 필수 | 필수 | 필수 | 필수 |
| Demo Reset | 필수 | 필수 | 필수 | 필수 | 필수 |
| Surface Switch | 해당 시 | 해당 시 | 해당 시 | 필수 | 필수 |

한 칸이라도 이유 없이 비어 있으면 완료로 보고하지 않는다.

## Responsive는 삭제가 아니라 재배치

공간이 부족하다는 이유로 중요한 정보를 모바일에서 없애지 않는다. 축약 / 2줄 / Drawer 이동 / More Sheet 등으로 재배치한다.

예: 날짜/시각
- Desktop: `2026.08.29 (토) 01:37:42`
- Mobile: `08.29 토` + `01:37:42`처럼 압축 가능
- 날짜를 통째로 삭제하고 시간만 남기는 것은 금지


---


# DEVICE PREVIEW SAFETY CONTRACT — P0

Device Preview는 장식이 아니라 **현재 동일 Route / 동일 Data / 동일 State를 다른 Viewport에서 확인하는 기능**이다.

## 기본 규칙

- Desktop 실제 환경에서는 `Mobile 보기`만 제공한다.
- Mobile 실제 환경에서는 `PC 보기`만 제공한다.
- 현재 Device와 동일한 Preview 버튼은 숨기거나 비활성화한다.
- Preview 내부에서 다시 Device Preview를 열 수 없게 한다.
- `Mobile → Mobile Preview`, `Desktop → Desktop Preview`, `Preview → Preview` 재귀 중첩 금지.

## True Viewport

Mobile Preview는 실제 390px 브라우저 첫 화면과 동일하게 보여야 한다.

반드시 확인:
- Header 상단 잘림 0
- Footer/Bottom Nav 하단 잘림 0
- `scrollTop = 0`에서 시작
- safe-area 적용
- fixed/sticky 위치 정상
- 부모 `transform` 때문에 fixed가 깨지지 않음
- 이전 Desktop scroll 위치를 상속하지 않음
- 상/하단이 잘리고 중간만 떠 있는 Frame 금지

## Escape Path

모든 Preview에는 명확한 종료 경로가 있다.
- X 닫기
- Backdrop Tap (Modal 방식일 때)
- ESC 가능 시 지원

닫은 뒤 backdrop / pointer-events / body scroll / focus lock을 완전히 복구한다.

## Route 규칙

없는 `/mobile-preview` 같은 Route를 무조건 만들지 않는다. 가능하면 현재 Route에 viewport mode만 적용한다. 별도 Route가 필요하면 모든 지원 Route가 실제 존재하는지 전수 검증한다. 404는 P0다.


---


# NAVIGATION SEMANTICS & DISCOVERABILITY GATE

사용자가 기능을 `찾을 수 있어야` 구현된 것으로 간주한다.

- `더보기`를 누르면 추가 메뉴가 Drawer / Bottom Sheet / Menu Popover로 나타나야 한다. 특정 단일 화면으로 이동하면 안 된다.
- `오늘의 AX`는 오늘의 AX 화면으로 이동한다.
- `설정`은 설정을 연다.
- `시연`은 Guided Product Demo를 시작한다.
- 메뉴 Label과 실제 행동이 다르면 P1 UX Bug로 판정한다.

## Discoverability

Why AX / Settings / Theme / Tutorial / Demo Reset / Surface Switch가 파일이나 Route에만 존재해서는 안 된다.

완료 전 실제 사용자가:
`Navigation 진입 → 기능 발견 → 실행 → 종료/복귀`
를 할 수 있어야 한다.


---


# TUTORIAL / PRESENTATION CONTRACT

## Tutorial

첫 사용자용 3~5 Step. **실제 App 화면 위에서** 작동한다.

각 Step은 필요 시 실제 Route로 자동 이동하고, 대상 Component가 렌더링된 뒤 Spotlight를 표시한다.

금지:
- 뒤 화면이 비어 있음
- 별도 정적 Slide만 보임
- 설명하는 기능과 배경 Route가 다름
- Step 종료 후 Blur/Backdrop 잔존

## Presentation Mode

영업/대표/심사용 8~12 Step의 **Guided Product Demo**다.

실제 Route를 자동 이동하며 실제 Dashboard / 핵심 업무 / AI / Evidence / Customer Surface 등을 보여준다. PowerPoint식 독립 Slide Show로 대체하지 않는다.

## Overlay Lifecycle

Next / Back / Skip / Finish / Exit 후:
- backdrop 제거
- blur 제거
- pointer-events 복구
- body scroll 복구
- focus lock 해제
- 다음 Route 클릭 정상

하나라도 실패하면 P0.


---


# WHY AX / 기획의도 — DISCOVERABLE STORY STANDARD

Why AX는 `Route가 존재한다`거나 `16 Section 데이터를 만들었다`는 이유만으로 완료가 아니다.

## 필수

- Sidebar / Navigation에서 실제 발견 가능
- Desktop에서 실제 진입 가능
- Mobile에서 실제 진입 가능
- 마지막에 Dashboard/주요 Surface로 복귀 CTA 존재
- 일반적인 카드형 개발문서가 아니라 회사 맞춤 Story

## Business AX / Hybrid 권장 구조

12~16 Section 정도의 설명 중심 Story를 기본으로 한다.

흐름 예:
1. 회사의 현재
2. 왜 지금 바꿔야 하는가
3. AX란 무엇인가
4. 업종에서 AX가 중요한 이유
5. 현재 업무 Flow
6. 반복되는 실제 문제
7. 지금까지 vs 바뀌는 방향
8. 업무효율화만이 목표가 아닌 이유
9. 매출/재방문/재주문 Growth
10. AI가 실제 하는 일
11. AI → Action → Result
12. Data가 회사 자산이 되는 구조
13. 정책/기술사업화 의미
14. 확장 가능성
15~16. 회사 맞춤 Summary / Roadmap

### 설명 방식

일반론 뒤에는 반드시 `이 회사라면`에 해당하는 회사 맞춤 해석을 붙인다.

Accordion / Before-After / Flow / Highlight / Timeline을 내용에 맞게 섞고, 동일 Card Grid만 반복하지 않는다.


---


# SIDEBAR / MENU ICON COLOR SYSTEM

왼쪽 Sidebar와 Mobile Drawer의 메뉴 Icon은 전부 무채색 단색으로 두지 않는다.

## 목표

목차를 빠르게 구분할 수 있도록 **적당한 색 차이**를 준다. 너무 형광색이거나 너무 옅어서 의미가 없어지면 실패다.

## 기본 규칙

- Icon 자체 또는 30~34px 정도의 작은 Icon Container에 색을 적용한다.
- Container 배경은 해당 색의 약 10~14% Tint, Icon은 중간 채도 Tone을 권장한다.
- Active 메뉴는 같은 Hue를 조금 더 진하게 사용하고, 배경/좌측 Bar 등으로 선택상태를 추가 표현한다.
- 동일 Category 안에서도 모든 Icon을 완전히 똑같은 색으로 만들 필요는 없지만, 전체 Palette는 6~8개 이내로 제한한다.
- Emoji 문자 자체를 남발하지 말고 Lucide/outline 계열 Icon + Color Token을 기본으로 한다.

### 권장 Group Accent — v4/v8

Sidebar는 메뉴 하나마다 다른 Rainbow Color를 주지 않는다. **같은 분류의 메뉴는 같은 Hue Family**를 사용한다.

- 운영 / Workflow Group: Blue `#5B8DEF`
- 고객·매출 / Growth Group: Amber `#D79A43`
- AX·실증 / Intelligence Group: Teal-Green `#3C9A75`
- 관리 / System Group: Slate `#718096`

같은 Group 안에서는 필요 시 기본색의 Light / Base / Deep 3단계까지만 허용한다.
예: 운영 Group의 일정·배차·현장 메뉴는 모두 Blue Family이며, 메뉴마다 전혀 다른 색을 만들지 않는다.

Mobile Drawer에도 같은 Icon Color Mapping을 유지하여 PC와 정보 인지방식을 맞춘다.


---


# THEME LIBRARY — 7개 조합 / 각 6색 — v2.0 CANONICAL

> **중요:** 7개는 Theme의 개수이며, 각 Theme는 6개의 핵심 Color Token을 가진다.
> 이 7개 Palette는 기존 AX 원본에 존재하던 7 Palette를 v2.0의 유일한 Canonical Theme Library로 승격한 것이다.
> `Canvas`는 Theme Color로 강제하지 않고 `PURE_WHITE_SURFACE / NEUTRAL_CANVAS / Theme Soft Tint` 조합으로 파생한다.

| Theme | Shell | Primary | Secondary | Accent | Highlight | Soft |
|---|---|---|---|---|---|---|
| 01 Deep Navy Blue | `#0B1830` | `#2457D6` | `#1687A7` | `#17A889` | `#E7C873` | `#DCE8F7` |
| 02 Navy Gold | `#111A2D` | `#2847A7` | `#A37A28` | `#D0A84B` | `#F0D995` | `#EFE8D7` |
| 03 Emerald Gold | `#11332B` | `#0E7663` | `#2C9277` | `#B4862A` | `#E8CE88` | `#E2F0EA` |
| 04 Forest Sage | `#17352C` | `#356E58` | `#73977E` | `#A58E4D` | `#D9D2AA` | `#E5ECE5` |
| 05 Deep Teal | `#08323A` | `#087A83` | `#1597A3` | `#D2704C` | `#E9B59B` | `#DDEDEF` |
| 06 Onyx Gold | `#15171C` | `#343942` | `#6A717C` | `#B89032` | `#E0C76F` | `#E6E8EC` |
| 07 Pure White | `#FFFFFF` | `#171B20` | `#343B44` | `#6B7680` | `#D47A4A` | `#FAFAF8` |

## Theme 강제 규칙

- Theme Picker가 필요한 Surface에서는 **7개 Theme가 모두 실제 동작**해야 한다.
- Business AX Settings에는 **7개 Theme Picker를 실제 구현**한다.
- Customer Platform은 Public 사용자에게 Theme Picker를 억지로 노출하지 않지만, **동일한 7개 Theme Library를 내부 디자인 시스템 / 관리자 / 시연 Preview에서 사용**한다.
- Hybrid Demo/Preview에서는 AX에서 선택한 Theme 상태가 Customer Surface에도 전달되어 동일한 Brand Family로 보이게 한다.
- Theme 전환 시 Shell / Header Accent / Active Navigation / Primary Button / KPI Accent / AI Surface / Chart Accent / Badge / Highlight / Customer CTA / 선택 상태가 함께 변경된다.
- 본문 Neutral Text, Table, Form, Modal, Raised Surface의 가독성은 Theme와 분리한다.
- Theme 변경은 Desktop / Mobile / Device Preview에서 동일 상태를 공유한다.
- 특정 업종의 Brand Reference가 명확하면 7개 중 가장 가까운 1개를 Default로 삼되, 나머지 6개도 Settings/Preview에서 정상 선택 가능해야 한다.
- Public Customer Surface의 브랜드 일관성이 중요한 경우 일반 고객에게 Picker UI는 숨길 수 있으나, 선택된 Theme Token은 Customer Surface 전체에 일관되게 적용한다.

---

# HYBRID DEMO CONTROL LAYER

대표 도메인 `/`이 Customer Front일 때 Demo/Admin 사용자가 Business AX 존재를 놓치지 않도록 작은 Demo Control Layer 또는 명확한 `[Business AX 보기]` 진입점을 제공한다.

Business AX에는 `[고객 화면 보기]`가 있고, Customer Front Demo/Admin에는 `[Business AX 보기]`가 있어야 한다.

일반 Customer Role에서는 Business AX 진입점을 숨긴다.

---

# v1.1 CROSS-SURFACE ACCEPTANCE MATRIX

완료 전 최소 다음을 실제 수행:

```text
Customer Desktop → Business Desktop → Customer Desktop
Business Desktop → Mobile Preview → 닫기 → 원래 Business Desktop
Customer Mobile → Business Mobile → Customer Mobile
Mobile 실제 화면 → PC Preview → 닫기 → 원래 Mobile
```

모든 이동에서 Route / Data / Role / Theme 상태가 의도대로 유지되어야 한다.

---

# v1.1 COMPLETION GATE — 신규 필수

기존 GATE A~H에 추가:

## GATE I — Surface Round-trip
Desktop/Mobile 양쪽 왕복 성공.

## GATE J — Cross-device Feature Parity
Theme / Font / Tutorial / Why / Date-Time / Role / Reset / Navigation 목적 동등.

## GATE K — Preview Safety
재귀 Preview 0, 상하단 잘림 0, 404 0, 닫기불가 0.

## GATE L — Discoverability
Why / Settings / Surface Switch / Tutorial을 실제 Navigation에서 발견 가능.

## GATE M — Navigation Semantics
`더보기`, `오늘의 AX`, `설정`, `시연` 등의 Label과 행동 일치.

## GATE N — Story
Why AX 12~16 Story를 Desktop/Mobile에서 실제 진입하고 복귀 가능.

## GATE O — Theme & Icon Visual System
7 Theme 실제 동작 + Sidebar/Mobile Drawer Icon 적정 색 구분.

하나라도 실패하면 완료 보고 금지.

---

# v1.1 WHOLE-HYBRID ACCEPTANCE RUN

```text
Fresh Load(Customer 대표 도메인)
→ Demo/Admin에서 Business AX 진입점 발견
→ Business AX 이동
→ Customer로 복귀
→ Sidebar Icon Color 확인
→ 날짜+시각 확인
→ Tutorial 실제 Route Guided 진행
→ Settings
→ Theme 7종
→ Font
→ Role
→ Why AX 발견/진입/복귀
→ Desktop Mobile Preview
→ 상하단 잘림 0
→ Preview 내부 Preview 금지
→ 실제 Mobile
→ 날짜+시각 확인
→ Mobile Drawer
→ More 메뉴 확인
→ Mobile에서 PC Preview
→ 닫기
→ Customer Mobile 이동
→ Business Mobile 복귀
→ Primary Customer Journey
→ Customer Event → AX 반영
→ AX Action → Customer 상태 반영
→ Demo Reset
→ 초기상태 재확인
```

---

# INHERITED BASE — Unified v1.0

아래 Unified v1.0 전체 규칙은 본 v1.1 UPDATE와 충돌하지 않는 범위에서 그대로 유지한다.



# 미래AI랩 AX + Platform Unified Design & Development System v1.0
## Business AX · Customer Platform · Hybrid Project 전용 통합 규격

> **목적**
>
> Business AX와 Customer Platform을 하나의 프로젝트에서 함께 구축할 때,
> AX 문서와 Platform 문서를 두 개 동시에 넣어 발생할 수 있는 **중복규칙·우선순위 충돌·후반 누락**을 줄이기 위한 통합 Source of Truth다.
>
> 이 문서는 문자 그대로 두 MD를 이어붙인 파일이 아니다.
> AX v6.1과 Platform v2.1에서 공통되는 규칙은 하나로 합치고,
> Business Surface와 Customer Surface에 필요한 규칙은 명확히 분리한다.

---

# 0. 언제 어떤 MD를 사용하는가

```text
Business AX만 구축
→ 미래AI랩 AX Design & Development System v6.1

Customer Platform만 구축
→ 미래AI랩 Platform Web App Design & Development System v2.1

Business AX + Customer Platform 동시 구축
→ 본 Unified System v1.0 하나만 사용
```

### 권장

Hybrid 프로젝트에서 AX v6.1 + Platform v2.1 + Unified v1.0을 세 개 동시에 넣지 않는다.
**Unified v1.0이 두 문서의 역할을 대신한다.**

---

# 1. HYBRID FINAL OBJECTIVE

Hybrid 프로젝트의 목표는 두 개의 사이트를 따로 만드는 것이 아니다.

```text
Customer Front
고객이 탐색 / 예약 / 구매 / 요청 / 문의 / 재구매
        ↓
Customer Event / Request / Behavior Data
        ↓
Business AX
운영 / 매출 / 재고 / 일정 / 고객 / 생산 / 서비스 판단
        ↓
AI Insight
        ↓
Action
        ↓
Business Result
        ↓
다음 Customer Experience 개선
```

즉 **Customer Experience와 Business Operation이 같은 Data Loop 안에서 닫혀야 한다.**

---

# 2. Instruction Priority

충돌 시:

```text
1. 사용자의 가장 최근 명시적 지시
2. 회사 Master Prompt
3. PROJECT_SPEC.md
4. 본 Unified v1.0
5. Front Design / Reference Image — Customer Front의 Visual에 한함
6. Claude 자율 판단
```

### Front Reference 예외

Customer Front의 시각적 방향에서는:

```text
사용자 최신 디자인 지시
> Front Reference
> Master Prompt Brand Direction
> PROJECT_SPEC Visual Direction
> Unified 일반 디자인 규칙
```

Business AX의 업무 구조를 Front Reference가 덮어쓰지 않는다.

---

# 3. HYBRID SYSTEM CORE — 생략 불가

```text
1. Shared Design Token
2. Business AX App Shell
3. Customer Front Global Shell
4. Business ↔ Customer Surface Switch
5. PC ↔ Mobile Preview
6. Role / Permission
7. Settings
8. AX Theme / Font Scale
9. Tutorial / Onboarding
10. Why AX / Platform Story
11. Demo Reset
12. Modal / Drawer / Overlay Integrity
13. Data Bridge
14. Whole-App Acceptance Run
```

하나라도 빠지면 Hybrid 프로젝트 완료가 아니다.

---

# 4. Business AX Surface

Business AX는 일반 ERP가 아니다.

반드시:

```text
KPI
→ Detail
→ Insight
→ Action
→ Result
→ Evidence
```

구조를 가진다.

업종별 핵심축:

- 제조: 생산 / 원가 / 불량 / 납기 / 재고
- 도소매: SKU / 채널 / 재고 / 마진 / 재구매
- 외식: 메뉴 / POS / 시간대 / 원가 / 인력 / 재방문
- 서비스: 예약 / 고객 / 직원 / 일정 / 재방문 / 상담
- 물류: 거래처 / 일정 / 차량 / 동선 / 적재 / 처리량
- 교육: 수강 / 과정 / 출결 / 상담 / 재등록
- 웰니스: 고객기록 / 프로그램 / 예약 / 이용권 / 추천

---

# 5. Customer Platform Surface

첫 화면은 브랜드 홈페이지처럼 예쁘되,
실제 행동이 가능한 플랫폼이어야 한다.

```text
First Impression
+
Explore
+
Detail
+
Primary Action
+
Completion
+
My / Result
```

Platform Type에 따라:

- Commerce
- Booking
- B2B Portal
- Matching
- Membership
- Service Request
- Education
- Customer Care

등으로 변형한다.

---

# 6. Visual System

## Business AX

- Executive Readability First
- Sidebar 약 280px
- 일반 SaaS보다 큰 글자
- Module Color
- Neutral surface 선명
- Brand Default / Deep / Light 최소 3 Theme Preset

## Customer Front

- Front Reference First
- Public 사용자는 Theme Picker 기본 노출 안 함
- Hero / CTA / Card / Image / Mobile 첫인상 우선
- 홈페이지 Template가 아닌 Platform UX

## Shared

- 동일 회사 브랜드의 Color DNA는 공유
- 하지만 AX와 Customer Front의 정보밀도는 다를 수 있다
- 두 Surface가 완전히 다른 회사처럼 보이지 않게 한다

---

# 7. Theme / Settings

### Business AX Settings 필수

```text
화면
- Theme
- Font Scale
- Motion

권한
- Role Preview
- Permission Matrix

데모
- Demo / Live
- Demo Reset
- Tutorial Replay

데이터
- Source / Freshness / Import Ready

AI
- AI Ready / 연결상태
```

Customer Front의 공개 사용자에게 AX Theme Picker를 노출하지 않는다.

---

# 8. AI Policy

AI는 멋있어 보이는 곳이 아니라:

1. 여러 데이터를 함께 비교
2. 누락 위험
3. 우선순위 결정
4. 자연어 설명
5. 반복 판단이 매번 조금씩 달라짐

이 있는 곳에 3~6개 핵심 Engine으로 배치한다.

단순 합계 / 정렬 / 날짜 / 재고일수 등은 코드 / SQL.

AI 미연결 시:

```text
AI READY / AI PREVIEW
현재: 규칙 기반 Demo
향후: GPT / Claude / 기타 API
```

정직하게 표시.

---

# 9. Customer ↔ Business Data Bridge — Hybrid의 핵심

최소 1개가 아니라 **권장 2개 이상** Closed Loop를 실제 Demo로 만든다.

### Customer → AX

```text
고객 요청 / 구매 / 예약 / 관심
→ Business AX Event
→ 담당자 / 재고 / 일정 / 영업 Action
```

### AX → Customer

```text
내부 처리 / 상태변경 / 추천
→ Customer Portal 상태 / 알림 / 추천 / 리포트 반영
```

---

# 10. Surface Switcher

관리자 / 대표 Demo:

Business AX:
`[고객 화면 보기]`

Customer Front:
`[Business AX 보기]`

일반 고객에게 관리자 전환 버튼 노출 금지.

---

# 11. Role / Permission

권장 Role:

```text
대표
관리자/직원
현장/실무자 (해당 시)
고객
```

Role 변경 시:

- Menu
- KPI
- Data
- Action
- Sensitive Information

이 실제로 달라져야 한다.

---

# 12. Tutorial / Onboarding

Hybrid에서는 두 Surface의 Tutorial 목적을 구분한다.

## AX Tutorial

- Dashboard
- 핵심 업무
- AI
- Customer Bridge

## Customer Onboarding

복잡한 Journey가 있을 때만:

- 기능 발견
- Step 안내
- 완료 방법

### Overlay Integrity 공통

- 종료 후 backdrop 삭제
- pointer-events 복구
- scroll lock 복구
- route change cleanup
- drawer / modal 충돌 없음
- dim / blur ghost 상태 금지

---

# 13. Modal / Drawer / Overlay Integrity

P0 Interaction Bug:

- 보이지 않는 backdrop이 클릭을 막음
- Tutorial 종료 후 blur 유지
- Drawer 닫힘 후 body 클릭 불가
- Mobile menu와 modal z-index 충돌
- route 이동 후 scroll lock 유지

하나라도 존재하면 완료 금지.

---

# 14. Why AX + Platform Story

Hybrid 프로젝트에서는 하나의 통합 Story Page로 구성할 수 있다.

권장 12~16 Section:

```text
01 회사의 현재
02 고객 Journey
03 내부 업무 Flow
04 현재 손실 / Pain
05 왜 AX + Platform인가
06 Customer Front가 바꾸는 것
07 Business AX가 바꾸는 것
08 Data Bridge
09 AI Decision Layer
10 Before / After
11 Revenue Growth Loop
12 Operation Efficiency
13 Data Asset
14 Evidence / 실증
15 Scale-up
16 향후 확장
```

Public Customer Navigation에는 기획의도를 억지로 노출하지 않아도 된다.
대표/관리자/Presentation Mode에서 접근 가능하면 된다.

---

# 15. Presentation Mode

3~5분 권장:

```text
Why
→ Customer Front
→ Customer Action
→ Business AX 반영
→ Dashboard / Core Business
→ AI Insight
→ Action
→ Customer 상태 반영
→ Evidence
→ Scale-up
```

---

# 16. Data / Demo / Live

Demo Project:

- DEMO 명확히 표시
- Data Freshness
- Demo Repository
- Reset
- CSV / Supabase / API Replace Point

실데이터가 없어도 개발을 멈추지 않는다.

---

# 17. 기본 기술스택

신규 기본 권장:

```text
Next.js
TypeScript
Tailwind CSS
Vercel
Supabase (필요 시)
```

Vite는 기존 Repository / 순수 Client SPA / 명시적 선택 시 사용 가능.
Vercel Preset만 변경해 Framework를 바꾸지 않는다.

---

# 18. Implementation Priority

## SYSTEM CORE

- Shell / Navigation
- Theme / Font / Settings
- Tutorial
- Story
- Role / Device / Surface
- Interaction Integrity

## BUSINESS CORE

회사별 가장 중요한 5~10개 기능.

## PLATFORM CORE

Primary Customer Journey를 끝까지 완성하는 핵심 기능.

## CONDITIONAL

- Supabase
- Auth/RLS
- 실제 AI API
- 외부 API
- GPS / Payment / Notification 등

## PLUS

CORE 완료 후만.

---

# 19. 2-Pass 실행

## PASS 1 — 설계 잠금

PROJECT_SPEC.md에:

- Hybrid Final Objective
- Business IA
- Customer IA
- Shared Data Model
- Data Bridge
- AI Engines
- Roles
- Theme
- CORE / CONDITIONAL / PLUS
- Acceptance Test

기록.

## PASS 2 — 구현

```text
Foundation
→ Business CORE
→ Platform CORE
→ Data Bridge
→ AI / Action / Evidence
→ Completion Layer
→ QA
```

중간 승인 때문에 멈추지 않는다.

---

# 20. Whole-App Acceptance Run

완료 전에 반드시 실제 Journey 1회:

```text
Fresh Load
→ AX Tutorial
→ Sidebar 전체 1차 메뉴
→ AX 핵심 Flow
→ AI Modal
→ Settings
→ Theme 3종
→ Font Scale
→ Role Switch
→ Mobile Preview
→ Customer Front 이동
→ Mobile Menu
→ Primary Customer Journey 끝까지
→ Customer Event 발생
→ AX로 복귀
→ Event 반영 확인
→ Action 처리
→ Customer 상태 반영 확인
→ Why / Story
→ Demo Reset
→ 재확인
```

---

# 21. Unified Completion Gate

## GATE A — Business
핵심 업무가 실제 동작

## GATE B — Customer
Primary Journey 완료

## GATE C — Bridge
[SUPERSEDED] 단순 개수 기준은 폐기. Primary Conversion Goal과 직결되는 핵심 Customer Event는 AX KPI/Insight/Action/Workflow 중 하나 이상으로 이어지고, 주요 Journey별 의미 있는 Closed Loop Coverage를 검증한다.

## GATE D — AI
Insight → Action → Result

## GATE E — Product Shell
Settings / Theme / Font / Tutorial / Why / Role / Device / Surface

## GATE F — Interaction
Modal / Drawer / Overlay P0 Bug 없음

## GATE G — Responsive
AX / Customer 모두 PC + Mobile

## GATE H — Memory
PROJECT_SPEC / STATE / DECISIONS 최신

하나라도 실패하면 완료 보고 금지.

---

# 22. Project Memory Files

반드시:

```text
PROJECT_SPEC.md
PROJECT_STATE.md
DECISIONS.md
```

Hybrid PROJECT_STATE에는 Surface별 상태를 나눈다.

```text
BUSINESS AX
CUSTOMER FRONT
DATA BRIDGE
SYSTEM CORE
USER ACTION QUEUE
KNOWN ISSUES
```

---

# 23. Master Prompt 시작문 — Hybrid

```text
[필수 시작 지시 — HYBRID]

이 프로젝트는 미래AI랩 AX + Platform Unified Design & Development System v3.0을 유일한 Source of Truth로 사용한다. [v1.0 문구 SUPERSEDED]
별도의 AX v6.1 / Platform v2.1 문서를 동시에 적용하지 않는다.

먼저 Unified 전체를 읽고,
그 다음 이번 회사 Master Prompt와 Front Reference를 읽어
Business AX / Customer Platform / Data Bridge의 최종목표를 PROJECT_SPEC.md에 잠근다.

업무기능만 구현하고 완료하지 않는다.
SYSTEM CORE와 Unified Completion Gate까지 모두 통과해야 완료다.
Hard Blocker가 없으면 PASS 1 이후 PASS 2까지 연속 진행한다.
```

---

# 24. 최종 철학

> **Hybrid AX의 가치는 화면이 두 개 있다는 데 있지 않다.**
>
> 고객이 한 행동이 내부 운영과 AI 판단을 바꾸고,
> 내부의 결정이 다시 고객 경험으로 돌아오는 **Closed Data Loop**가 있어야 한다.
>
> 그리고 그 모든 기능을 App Shell / Story / Settings / Tutorial / QA가 하나의 완성된 제품으로 감싸야 한다.

---

# 25. 버전

**Unified v1.0 — 2026-08-28**

기반:
- 미래AI랩 AX Design & Development System v6.1
- 미래AI랩 Platform Web App Design & Development System v2.1
- 2026-08-28 실제 Reference MVP 검토에서 발견된 Completion / Tutorial / Theme / Why AX / Overlay QA 개선사항

---

# PART D — v2.0 CROSS-SURFACE INTEGRATION & FINAL ACCEPTANCE

# D-1. CUSTOMER ↔ AX BRIDGE — 최소 1개가 아니라 핵심 Journey마다 연결 검토

Hybrid 프로젝트에서는 Customer Front에서 발생한 핵심 Event가 AX에 실제 의미 있는 입력으로 연결되어야 한다.

권장:

```text
예약 → 일정/수요/인력
주문 → 매출/재고/구매
문의 → CRM/영업우선순위
회원가입 → 고객자산/재방문
리뷰 → VOC/서비스개선
요청 → 작업 Queue/처리 SLA
재주문 → 수요예측/재고
```

모든 이벤트를 억지로 연결할 필요는 없지만, **대표적인 1개만 형식적으로 연결하고 끝내지 않는다.**
프로젝트의 Primary Conversion Goal과 직결되는 Event는 반드시 AX KPI/Insight/Action 중 하나로 이어지게 설계한다.

---

# D-2. CROSS-SURFACE DESIGN CONSISTENCY

Customer와 AX가 완전히 같은 UI일 필요는 없다.

```text
Customer = 브랜드 / 탐색 / 전환 / 신뢰 / 감성
AX       = 정보밀도 / 판단 / 업무 / 실행 / 증빙
```

다만 같은 회사 제품군으로 느껴져야 한다.

공유:
- Theme Family
- Radius language
- Icon family
- Typography family
- Motion timing family
- Status semantics
- Brand mark
- 주요 Accent logic

분리:
- Customer는 사진·썸네일 풍부
- AX는 KPI / AI / Action 우선

---

# D-3. 7-THEME CROSS-SURFACE ACCEPTANCE MATRIX — P0

각 Theme 7개에 대해 최소 아래 Matrix를 확인한다.

| 항목 | AX Desktop | AX Mobile | Customer Desktop | Customer Mobile |
|---|---|---|---|---|
| Shell/Header | PASS | PASS | PASS | PASS |
| Primary CTA | PASS | PASS | PASS | PASS |
| Active Navigation | PASS | PASS | PASS | PASS |
| KPI/Highlight | PASS | PASS | 해당 시 PASS | 해당 시 PASS |
| AI Surface | PASS | PASS | 해당 시 PASS | 해당 시 PASS |
| Card/Surface Neutral | PASS | PASS | PASS | PASS |
| Modal/Drawer | PASS | PASS | PASS | PASS |
| Chart/Badge | PASS | PASS | 해당 시 PASS | 해당 시 PASS |
| Residual Old Accent | 0 | 0 | 0 | 0 |
| Error Red Semantic Only | PASS | PASS | PASS | PASS |

7개 중 하나라도 Theme switch가 이름만 바뀌고 실제 Surface 변화가 없으면 완료가 아니다.

---

# D-4. ROUTE & FEATURE INVENTORY GATE

마지막 QA 전에 실제 Route와 기능을 Inventory로 만든다.

```text
Route
Purpose
Primary Action
Desktop QA
Mobile QA
Theme QA
Modal/Drawer QA
Data State
Demo/Live
Customer↔AX Link
```

이 Inventory에 없는 Route가 존재하면 누락 가능성이 있으므로 추가 확인한다.

---

# D-5. VISUAL DETAIL REGRESSION GATE

다음은 기능이 동작해도 시각적으로 퀄리티가 낮아지는 대표 Regression이다.

- 글자 크기 갑작스러운 변화
- Card padding 불일치
- Header/Sidebar 높이 불일치
- Mobile에서 줄바꿈 때문에 카드 높이 폭증
- 버튼 텍스트 2줄
- 아이콘 크기/색상 랜덤
- Off-white 과다
- Dark Sidebar 흐린 글자
- 특정 Theme에서 빨강/보라 잔존
- Modal 배경 이중 Overlay
- Device Preview 안에 또 Preview가 생기는 Recursive Preview
- 이미지 crop으로 얼굴/상품 핵심부 잘림
- Hero만 고급스럽고 Detail Page는 기본 템플릿 느낌
- Customer는 고급스러운데 AX는 ERP 기본화면처럼 보임
- AX는 잘 만들었는데 Customer가 단순 회사소개 홈페이지로 끝남

하나라도 발견하면 “기능 완료”와 별개로 Visual Completion을 통과하지 못한다.

---

# D-6. FINAL 100-POINT ACCEPTANCE — v2.0

## A. Product Shell 15
- Desktop/Mobile Navigation
- Escape Path
- Settings
- Tutorial
- Presentation
- Device Preview

## B. Business AX 20
- KPI → Detail
- Insight → Action
- Action Lifecycle
- Evidence
- Freshness/Provenance
- Role/RLS 또는 Preview

## C. Customer Platform 20
- Explore
- Detail
- Primary Conversion Journey
- Completion
- My/Result
- Trust/Review

## D. Cross-Surface 15
- Surface Switcher
- Customer Event → AX Data
- Theme state consistency
- Shared brand language

## E. Visual / Interaction 15
- Hover/Pressed
- Motion
- White Surface contrast
- Responsive
- Asset sharpness
- No overflow

## F. Theme Integrity 10
- 7 Theme 모두 실제 동작
- Residual old accent 0
- Semantic Color 분리
- Desktop/Mobile parity

## G. Story / Growth 5
- Why AX
- Current → Improved → Growth
- Future Expansion

### 완료 기준

- 98점 이상 권장.
- P0 Gate 실패 시 총점과 무관하게 FAIL.
- P0: Primary Journey / Mobile usability / Overlay integrity / Theme switching / Residual Accent / Customer↔AX 핵심 연결 / 404 / Recursive Preview.

---

# D-7. UPDATE HANDOVER RULE — 앞으로 v2.1+ 업데이트 시

본 파일의 다음 버전을 만들 때 반드시 아래 작업을 먼저 한다.

1. 현재 파일 전체 Section Inventory 생성.
2. 새 요청사항을 `ADD / MODIFY / SUPERSEDE`로 분류.
3. 삭제는 기본 금지.
4. Theme 7개 유지 여부 검사.
5. 기존 QA Gate 수가 줄지 않았는지 검사.
6. AX Full / Platform Full / Cross-Surface 세 모듈 모두 보존 여부 검사.
7. 새 파일 Line Count와 Byte Size 기록.
8. 이전보다 작아졌다면 이유를 Audit Note에 명시.
9. “압축/간소화/Hybrid 요약”을 업데이트 방법으로 사용하지 않는다.
10. 최종 파일 하나만으로 개발 가능한지 다시 검증한다.

---

# D-8. v2.0 BUILD AUDIT NOTE

본 v2.0은 다음 세 파일의 상세 규칙을 기반으로 재구축되었다.

- AX v6.5 Full Standard
- Platform v2.5 Full Standard
- Unified v1.4 Cross-Surface Standard

v2.0 상위 Override에서:

- 기존 6 Theme 고정 규칙을 폐기하고 원본 7 Palette를 Canonical로 복원.
- Customer Platform에도 동일한 7 Palette Library를 내부 디자인 시스템으로 적용.
- Theme 변경 후 장식성 Red/Old Accent 잔존을 P0 Regression으로 지정.
- 향후 Unified 업데이트에서 압축/생략을 금지.
- 모델 변경과 무관한 동일 Quality Floor를 강제.

---

# END OF MASTER FILE