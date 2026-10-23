# EVIDENCE_PLAN — 12주 실증 계획 (안)

> 현재 단계: **DEMO** (가상 데이터, 실제 사용자 없음). 아래는 대표 미팅 후 Pilot을 진행할 경우의 계획안이며, **어떤 개선 수치도 아직 측정되지 않았다.**
> Baseline: **REQUIRED / UNKNOWN — Baseline not yet established** · Target: **DO NOT INVENT** (Baseline 확보 후 협의)

## 1. 무엇을 증명하려 하나
"현장 원가 입력 1회 → 손익 자동 재계산 → 위험 감지 → 담당자 조치 → 기록" 흐름이 실제 현장에서
① 원가 초과를 **더 빨리** 알게 하고, ② 설계변경 추가원가의 **청구 누락을 줄이고**, ③ 본사 인원 증가 없이 **관리 가능한 현장 수를 늘리는지**.

## 2. Money KPI 3

| 구분 | KPI | 측정 방법 (데이터 위치) | Baseline 확보 방법 (Week 0) | 현재 |
|---|---|---|---|---|
| COST | 원가 초과 인지 리드타임 (일) | 원가 발생일 `cost_entries.date` → 위험 감지 → `actions.created_at` | 최근 준공 현장 1~2곳에서 "원가 초과를 처음 안 시점" 인터뷰·엑셀 이력 확인 | UNKNOWN |
| REVENUE | 설계변경 추가원가 → 청구 검토 전환율 (%) | 사유=설계변경 원가 합계 대비 `change_orders` 등록 금액 | 최근 1년 설계변경 건수·청구 건수·미청구 사례 확인 | UNKNOWN |
| SCALE | 본사 관리자 1인당 관리 현장 수 · 월 손익 집계 시간 | 사용자·현장 수, 월말 보고 작성 소요시간 | 현재 월말 손익 집계에 드는 시간 실측 (1회) | UNKNOWN |

## 3. 12주 일정

| 주차 | 단계 | 할 일 | 산출물 | 판단 기준 |
|---|---|---|---|---|
| Week 0 | Baseline Lock | Pilot 현장 1~2곳 선정, 현재 원가 집계 방식·소요시간·설계변경 청구 이력 인터뷰, KPI 3종 Baseline 측정, 데이터 위치(엑셀·카톡·회계) 확인 | Baseline 시트, Pilot 동의 | Baseline 3종 중 2종 이상 확보 |
| Week 1~4 | Adoption · First Proof Events | 실데이터 전환(CSV 또는 Supabase), 현장소장 모바일 보고 습관화(주 3회 이상), 첫 위험 감지 → 조치 기록 | 실제 원가 이벤트, 첫 Proof Event (`PILOT_LIVE`) | 주간 보고 입력률, 조치 완료 건수 |
| Week 5~8 | Business Lift | 청구 검토 전환·조기 인지 사례 누적, 위험 기준값(이익률 하락 3%p 등)을 회사 실정에 맞게 보정 | 보정된 RULE v2, 사례 3건 이상 | 사례별 Before/After 설명 가능 여부 |
| Week 9~12 | Enterprise Value · Judge Pack | Before/After 비교, Proof Event 묶음, 표준 Workflow 문서화, 확장(다현장·발주처 포털) 판단 | 실증 보고서, 확장 여부 결정 | KPI 3종 Baseline 대비 변화 (측정값만 기재) |

## 4. 기록 규칙
- 모든 실증 기록은 Proof Event로 남긴다 (`PROOF_EVENT_SCHEMA.md`). DEMO 기록(`DEMO_LOCAL`)은 실증 성과에 포함하지 않는다.
- 개선율은 Baseline과 같은 방법으로 측정한 값만 쓴다. 추정·목표치를 성과처럼 쓰지 않는다.
- 정책자금·보증·인증 결과와 연결하지 않는다 (각 기관의 독립 심사이며 보장 불가).

## 5. Pilot 시작 전 필요한 것 (USER ACTION QUEUE)
1. 대표 승인: Pilot 현장 1~2곳, 참여 현장소장·본사 관리자 지정
2. 데이터: 현장별 계약금액·예산(원가 항목 5종)·현재까지 발생원가 (CSV 샘플 형식, `/settings`)
3. 인프라: Supabase 프로젝트·키 (기기 간 공유·실제 로그인/권한 필요 시)
4. (선택) AI 요약 1개 기능: 대표 명시 승인 + API Key (서버 전용)
