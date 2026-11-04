/**
 * 휴대폰 점검 (계약 2단계 ③ 실기기 확인 · D-46) — 판정·안내 규칙 (순수 함수)
 * 현장 휴대폰에서 위치·사진·저장 공간·인터넷·알림·홈 화면·브라우저를 확인하고, 결과(좌표 없이)를 본사에 보낸다.
 * 실제 현장 문제의 대부분은 휴대폰 설정(위치 막힘, 카카오톡 안 브라우저, 아이폰 홈 화면 미추가)이다.
 */

export const DEVICE_CHECK_KEYS = ["network", "location", "photo", "storage", "push", "home", "browser"] as const;
export type DeviceCheckKey = (typeof DEVICE_CHECK_KEYS)[number];
export type DeviceCheckStatus = "ok" | "warn" | "fail" | "skip";
export type DevicePlatform = "ios" | "android" | "other";

export interface DeviceCheck {
  userId: string;
  /** 점검한 시각 (서버) */
  at: string;
  platform: DevicePlatform;
  /** 예) 삼성 인터넷 25 / Safari 17.4 / 카카오톡 안 브라우저 */
  browser: string;
  /** 앱 안 브라우저(카카오톡·네이버 등)로 열었는지 */
  inApp?: boolean;
  items: Partial<Record<DeviceCheckKey, DeviceCheckStatus>>;
  /** 위치 정확도 (10m 단위로 반올림 — 좌표는 보내지 않음) */
  accuracyM?: number;
}

export const DEVICE_CHECK_LABEL: Record<DeviceCheckKey, string> = {
  network: "인터넷 연결",
  location: "위치 잡기",
  photo: "사진 찍어 올리기",
  storage: "휴대폰 저장 공간",
  push: "휴대폰 알림",
  home: "홈 화면 아이콘",
  browser: "브라우저",
};

/** 사용자 에이전트(UA) → 휴대폰 종류·브라우저 (개인정보 없음, 이름만) */
export function summarizeUa(ua: string): { platform: DevicePlatform; browser: string; inApp: boolean; old: boolean } {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua));
  const android = /Android/.test(ua);
  const platform: DevicePlatform = ios ? "ios" : android ? "android" : "other";
  const inAppName = /KAKAOTALK/i.test(ua) ? "카카오톡" : /NAVER\(inapp|NAVER\//.test(ua) ? "네이버 앱" : /Line\//.test(ua) ? "라인" : /Instagram/.test(ua) ? "인스타그램" : /FBAN|FBAV/.test(ua) ? "페이스북" : /BAND\//.test(ua) ? "밴드" : "";
  const num = (re: RegExp) => {
    const m = re.exec(ua);
    return m ? Number(m[1]) : NaN;
  };
  let browser: string;
  let old = false;
  if (inAppName) browser = `${inAppName} 안 브라우저`;
  else if (/SamsungBrowser\/(\d+)/.test(ua)) {
    const v = num(/SamsungBrowser\/(\d+)/);
    browser = `삼성 인터넷 ${v}`;
    old = v < 20;
  } else if (ios && /CriOS\/(\d+)/.test(ua)) browser = `Chrome ${num(/CriOS\/(\d+)/)} (아이폰)`;
  else if (/(?:Edg|EdgA|EdgiOS)\/(\d+)/.test(ua)) browser = `Edge ${num(/(?:Edg|EdgA|EdgiOS)\/(\d+)/)}`;
  else if (/(?:Firefox|FxiOS)\/(\d+)/.test(ua)) browser = `Firefox ${num(/(?:Firefox|FxiOS)\/(\d+)/)}`;
  else if (/Chrome\/(\d+)/.test(ua)) {
    const v = num(/Chrome\/(\d+)/);
    browser = `Chrome ${v}`;
    old = v < 103;
  } else if (ios || /Safari\//.test(ua)) {
    const m = /Version\/(\d+)(?:\.(\d+))?/.exec(ua) ?? /OS (\d+)_(\d+)/.exec(ua);
    const major = m ? Number(m[1]) : NaN;
    const minor = m?.[2] ? Number(m[2]) : 0;
    browser = Number.isFinite(major) ? `Safari ${major}${minor ? `.${minor}` : ""}` : "Safari";
    // 아이폰 웹 알림은 16.4부터
    old = ios && Number.isFinite(major) && (major < 16 || (major === 16 && minor < 4));
  } else browser = "알 수 없는 브라우저";
  return { platform, browser, inApp: !!inAppName, old };
}

/** 전체 판정: 하나라도 ❌ → 고쳐야 함, ⚠️ → 확인 권장 */
export function deviceVerdict(c: Pick<DeviceCheck, "items">): "ready" | "warn" | "fail" {
  const v = Object.values(c.items);
  return v.includes("fail") ? "fail" : v.includes("warn") ? "warn" : "ready";
}
export const VERDICT_LABEL = { ready: "준비됨", warn: "확인 권장", fail: "고쳐야 함" } as const;

/** 항목별 고치는 방법 (현장 직원이 혼자 따라 할 수 있게) */
export function deviceFix(key: DeviceCheckKey, status: DeviceCheckStatus, platform: DevicePlatform, inApp = false): string {
  if (status === "ok") return "";
  if (inApp && (key === "location" || key === "push" || key === "browser" || key === "home"))
    return "카카오톡·네이버 앱 안에서 열면 위치·알림이 잘 안 됩니다. 오른쪽 위(또는 아래) 메뉴 → ‘다른 브라우저로 열기’를 누르세요.";
  const ios = platform === "ios";
  switch (key) {
    case "network":
      return status === "warn" ? "인터넷이 느립니다. 보고를 보낼 때 시간이 걸릴 수 있어요. 끊겨도 ‘휴대폰에 보관’했다가 자동으로 보냅니다." : "인터넷에 연결되지 않습니다. 와이파이 또는 데이터가 켜져 있는지 확인하세요.";
    case "location":
      if (status === "warn") return "위치가 정확하지 않습니다(건물 안·지하일 수 있음). 하늘이 보이는 곳에서 다시 점검해 보세요.";
      return ios ? "위치가 막혀 있습니다. 설정 → 개인정보 보호 및 보안 → 위치 서비스 → 켬, 아래 Safari 웹 사이트 → ‘앱을 사용하는 동안’." : "위치가 막혀 있습니다. 휴대폰 위쪽을 내려 ‘위치’를 켜고, 브라우저 주소창 왼쪽 자물쇠 → 권한 → 위치 → 허용.";
    case "photo":
      return status === "skip" ? "사진 점검을 건너뛰었습니다. 보고할 때 사진이 안 올라가면 다시 점검해 주세요." : ios ? "사진을 올리지 못했습니다. 설정 → Safari → 카메라 → ‘허용’을 확인하세요." : "사진을 올리지 못했습니다. 브라우저 주소창 자물쇠 → 권한 → 카메라 → 허용을 확인하세요.";
    case "storage":
      return status === "warn" ? "휴대폰 저장 공간이 부족합니다. 안 쓰는 사진·앱을 지워 주세요." : "휴대폰에 임시 저장을 할 수 없습니다(비공개·시크릿 창일 수 있음). 일반 창에서 여세요. 인터넷이 끊기면 보고가 보관되지 않습니다.";
    case "push":
      if (status === "skip") return "";
      return ios ? "알림이 꺼져 있습니다. 먼저 홈 화면에 추가한 아이콘으로 열고, ‘내 정보’에서 ‘알림 켜기’를 누르세요." : "알림이 꺼져 있습니다. ‘내 정보’에서 ‘알림 켜기’를 누르면 본사 지시가 바로 옵니다.";
    case "home":
      return ios ? "홈 화면에 추가하면 앱처럼 바로 열리고 알림도 받을 수 있습니다. Safari 아래 공유 버튼 → ‘홈 화면에 추가’." : "홈 화면에 추가하면 앱처럼 바로 열립니다. 크롬 오른쪽 위 점 세 개 → ‘홈 화면에 추가’.";
    case "browser":
      return ios ? "iOS가 오래되었습니다. 설정 → 일반 → 소프트웨어 업데이트를 해 주세요 (알림은 iOS 16.4부터)." : "브라우저가 오래되었습니다. 플레이 스토어에서 크롬(또는 삼성 인터넷)을 업데이트해 주세요.";
  }
}
