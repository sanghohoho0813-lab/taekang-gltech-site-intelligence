/**
 * 금액을 보면 안 되는 사람(현장 직원·발주처)에게 보내는 글에서 금액·이익 정보를 지운다 (D-66 점검 반영).
 * 활동 이력 문구는 본사용으로 만들어져 ‘예상 총원가 8.5억 원 → 8.9억 원’ 같은 내용이 들어간다.
 */

/** 8.5억 원 · 1억 5,000만 원 · 3,000만 원 · 5,000원 · +4,000만 원 · −1.2억 */
const MONEY = /[+−-]?\d[\d,]*(?:\.\d+)?\s*억(?:\s*\d[\d,]*(?:\.\d+)?\s*만)?(?:\s*원)?|[+−-]?\d[\d,]*(?:\.\d+)?\s*만(?:\s*원)?|[+−-]?\d[\d,]*\s*원(?![가-힣])/g;
/** ‘→ 예상 총원가 …’·‘(예상 총원가 …)’·‘· 예상이익 …’·‘이익률 …’처럼 손익을 말하는 구절 통째로 */
const PROFIT_CLAUSE = /\s*[→·]?\s*\(?\s*(?:예상 총원가|예상이익률?|이익률|계약금액|실행예산)[^·()]*\)?/g;

export function hasMoney(text: string): boolean {
  MONEY.lastIndex = 0;
  return MONEY.test(text) || /예상 총원가|이익률|예상이익/.test(text);
}

export function stripMoney(text: string): string {
  return text
    .replace(PROFIT_CLAUSE, "")
    .replace(MONEY, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,·)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s→·,+]+$/g, "")
    .trim();
}
