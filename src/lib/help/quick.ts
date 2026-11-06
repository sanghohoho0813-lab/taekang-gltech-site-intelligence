/**
 * 현장 직원 그림 안내 1장 (D-52) — 하루 순서대로, 화면에 보이는 버튼 이름 그대로.
 * 그림: public/guide/*.jpg (시연 화면을 찍은 것 · 다시 찍기: DEMO 서버를 켜고 `npm run guide:shots`)
 * labels: 실제 화면에 있는 버튼 이름 — 화면 이름이 바뀌면 시험(tests/unit/quickGuide.test.ts)이 알려준다.
 */
export interface QuickStep {
  no: number;
  img: string;
  alt: string;
  title: string;
  text: string;
  labels: string[];
}

export const QUICK_STEPS: QuickStep[] = [
  {
    no: 1,
    img: "/guide/01-checkin.jpg",
    alt: "첫 화면 맨 위 초록색 ‘출근하기’ 버튼",
    title: "현장에 오면 ‘출근하기’",
    text: "처음 한 번은 위치 기록 동의를 물어요. 읽고 ‘동의하고 출근하기’를 누르세요. 누를 때만 위치를 한 번 확인합니다.",
    labels: ["출근하기", "동의하고"],
  },
  {
    no: 2,
    img: "/guide/02-crew.jpg",
    alt: "‘오늘 작업 인원 알리기’ 버튼",
    title: "아침에 ‘오늘 작업 인원 알리기’",
    text: "팀별 인원을 고르고 단체 사진 한 장. (현장소장·반장)",
    labels: ["오늘 작업 인원 알리기"],
  },
  {
    no: 3,
    img: "/guide/03-actions.jpg",
    alt: "빨간 숫자가 붙은 ‘본사 요청’ 버튼",
    title: "빨간 숫자가 보이면 ‘본사 요청’",
    text: "받으면 ‘확인했어요’, 일이 끝나면 ‘다 했어요’를 누르세요.",
    labels: ["본사 요청", "확인했어요", "다 했어요"],
  },
  {
    no: 4,
    img: "/guide/04-report.jpg",
    alt: "주황색 ‘오늘 보고하기’ 버튼",
    title: "일이 끝나면 ‘오늘 보고하기’",
    text: "현장 → 작업 → 사진 → 문제 → 비용 순서로 물어봐요. 누르기만 하고 마지막에 ‘본사로 보내기’.",
    labels: ["오늘 보고하기", "본사로 보내기"],
  },
  {
    no: 5,
    img: "/guide/05-checkout.jpg",
    alt: "출근 시각이 보이고 아래에 ‘퇴근하기’ 버튼",
    title: "나갈 때 ‘퇴근하기’",
    text: "출근하면 같은 자리에 ‘퇴근하기’가 생겨요. 누르면 한 번 더 물어요 → ‘네, 퇴근할게요’. 깜빡했으면 6번으로 요청하세요.",
    labels: ["퇴근하기", "네, 퇴근할게요"],
  },
  {
    no: 6,
    img: "/guide/06-fix.jpg",
    alt: "‘출퇴근이 잘못 찍혔나요? 수정 요청하기’ 글자",
    title: "출퇴근이 잘못 찍혔으면",
    text: "첫 화면 ‘출퇴근이 잘못 찍혔나요? 수정 요청하기’ → 날짜·내용 누르기 → 본사가 확인해요.",
    labels: ["출퇴근이 잘못 찍혔나요? 수정 요청하기"],
  },
];

export const QUICK_TIPS: { text: string; img?: string; alt?: string; labels: string[] }[] = [
  { text: "글씨가 작으면 오른쪽 위 ‘글자 크게’", img: "/guide/00-font.jpg", alt: "오른쪽 위 ‘가 글자 크게’ 버튼", labels: ["글자 크게"] },
  { text: "인터넷이 안 되면 출퇴근·보고는 휴대폰에 저장됐다가, 연결되면 저절로 보내져요.", labels: [] },
  { text: "앱이 불편하면 ‘내 정보 → 앱 의견 보내기’로 알려 주세요.", labels: ["앱 의견 보내기"] },
];
