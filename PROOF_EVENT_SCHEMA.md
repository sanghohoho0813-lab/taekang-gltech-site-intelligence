# PROOF_EVENT_SCHEMA — 위험 대응 실증 기록

> Proof Event = "위험을 감지했고(Trigger) → 사람이 판단·승인했고(Decision · Approval) → 실제로 조치했고(Action) → 결과가 남았다(Result · KPI 전후)"를 한 줄로 묶은 기록.
> 목적은 **화면이 좋아 보이는지가 아니라, 업무 행동이 실제로 바뀌었는지**를 나중에 증명하는 것.

- 코드 정의: `src/lib/domain/types.ts` → `ProofEvent`
- 생성 경로: `src/lib/data/commands.ts` → `completeAction()` (조치 완료 시 자동 생성), `confirmProofEvent()` (결과 확인)
- DB 스키마(READY, 미실행): `supabase/migrations/001_base_schema.sql` → `proof_events`
- 화면: `/evidence` (목록·원본 필드 보기·결과 확인), `/report` (대표 보고서 요약), `/insights` 조치 카드 배지

## 1. 필드

| 필드 | 타입 | 필수 | 의미 | MVP에서 채우는 값 |
|---|---|---|---|---|
| `proof_event_id` | string(uuid) | ✔ | 고유 ID | `pe_…` |
| `event_type` | `RISK_RESPONSE` \| `PARTNER_REQUEST` | ✔ | 기록 종류 | 현재 생성 경로는 `RISK_RESPONSE`만. `PARTNER_REQUEST`는 타입만 예약(NEXT) |
| `site_id` | string | ✔ | 현장 | `site-a` 등 |
| `trigger` | string | ✔ | 무엇이 감지됐나 | 위험 신호 제목 (예: `설계변경 추가원가 4,000만 원 — 변경공사 미등록`) |
| `decision` | string | ✔ | 무엇을 하기로 했나 | 조치 제목 (예: `추가공사 청구 가능성 검토`) |
| `decision_method` | string | ✔ | 판단 방식 | `RULE v1 — 결정론적 규칙 기반 진단 (AI API 미연결)` |
| `why` | string[] | ✔ | 근거 수치 | 신호의 근거 문장 (예: 이익률 15% → 11%, 자재비 예산 +7.9%) |
| `human_approval` | `{by, at}` | ✔ | 누가 언제 승인했나 | 조치 생성·배정을 승인한 사용자와 시각 |
| `action` | string | ✔ | 실행한 조치 + 담당 | `… (담당: 최성민 현장소장 (가상))` |
| `action_id` | string | ✔ | 조치 원본 | `act_…` |
| `result` | string | ✔ | 결과 | 담당자 입력 + (선택) `변경공사 청구 검토 4,000만 원 등록(승인 전, 이익 미반영)` |
| `kpi_before` | object | ✔ | 조치 생성 시점 지표 | 예상이익률·예상이익·EAC·청구 검토/승인대기 변경공사 |
| `kpi_after` | object | ✔ | 완료 시점 지표 | 같은 항목, 완료 시점 재계산값 |
| `data_source` | `DEMO_LOCAL` | ✔ | 데이터 출처 | **항상 `DEMO_LOCAL`** — 실증 성과로 쓰지 않음 |
| `user_id` | string | ✔ | 기록자 | 완료 처리한 사용자 |
| `created_at` | ISO datetime | ✔ | 기록 시각 | 완료 시각 |
| `status` | `recorded` \| `confirmed` | ✔ | 확인 상태 | 완료 직후 `recorded`, 관리자·대표 확인 후 `confirmed` |
| `result_confirmed_at` / `confirmed_by` | ISO / string | | 결과 확인 | 확인 시 기록 |
| `evidence_link` | string | | 근거 화면 | `/sites/{id}` |
| `response_minutes` | number | | 감지 → 완료 소요(분) | **시연 측정값** (실제 리드타임 아님, 화면에도 그렇게 표기) |

## 2. 상태 흐름

```
위험 신호(RULE v1, 매번 재계산 · 저장 안 함)
  └─ 조치 생성·배정 (사람 승인 = human_approval)      ← L2 Recommend → L3 사람 승인
       └─ 진행 중 → 완료 (결과 입력)  ──▶ Proof Event status=recorded
                                         └─ 결과 확인(관리자·대표) ──▶ status=confirmed
```
- 조치 상태: `recommended → assigned → in_progress → done` (+ `on_hold`, `dismissed`). 허용되지 않은 전이는 `CommandError(STATE)`.
- 같은 요청 반복(더블 클릭)은 `idempotencyKey`로 1회만 기록.
- 이미 `confirmed`인 기록은 다시 확인할 수 없음.

## 3. 계산 원칙 (Proof의 숫자가 거짓이 되지 않도록)
- KPI 전후 값은 저장된 원가 이벤트·계약·승인 변경공사로 **코드가 다시 계산**한 값. 손으로 입력하지 않음.
- 승인 전 변경공사(청구 검토·제출)는 계약금액·이익에 **넣지 않음** → 조치 완료 후에도 이익률이 그대로일 수 있고, 화면에 그 이유를 표기.
- `response_minutes`는 시연 클릭 간격이므로 성과 지표로 인용 금지.

## 4. 실데이터 전환 시 추가할 것 (NEXT)
| 항목 | 이유 |
|---|---|
| `company_id` + RLS | 회사·현장 단위 접근 제어 (002_rls.sql 준비됨) |
| `data_source = PILOT_LIVE` | DEMO와 실제 기록 구분 |
| `baseline_ref` | Week 0 Baseline 측정값과 연결해야 개선 폭을 말할 수 있음 |
| `evidence_files` | 회신 메일·변경공사 승인서 등 근거 파일 (개인정보·도면은 제외) |
| `PARTNER_REQUEST` 생성 경로 | 발주처 요청 → 회신 완료 시 Proof Event 자동 생성 |
