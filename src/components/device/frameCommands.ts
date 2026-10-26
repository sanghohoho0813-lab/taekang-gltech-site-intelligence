"use client";

/**
 * 시연 모드(부모 화면) → 모바일 Frame에 보내는 화면 명령.
 * 데이터를 바꾸지 않고 화면 상태(입력 시트 열기/닫기)만 바꾼다. 입력·저장은 항상 사람이 모바일에서 직접 누른다.
 * 같은 Origin·부모 창에서 온 메시지만 받는다 (DeviceStage FrameBridge에서 검증).
 */
import { useEffect, useRef } from "react";

export type FrameCmd = "open-report" | "close-report";
export const FRAME_CMDS: readonly FrameCmd[] = ["open-report", "close-report"];
export const CMD_MSG = "tk:cmd";
const EVT = "tk:frame-cmd";
const TTL_MS = 4000;

let pending: { cmd: FrameCmd; at: number } | null = null;

/** 부모 화면: 모바일 Frame에 명령 전송 (Frame이 없으면 아무 일도 하지 않음) */
export function sendFrameCmd(cmd: FrameCmd) {
  const frame = document.querySelector<HTMLIFrameElement>('[data-testid="device-frame"]');
  frame?.contentWindow?.postMessage({ type: CMD_MSG, cmd }, window.location.origin);
}

/** Frame 안: 받은 명령을 화면에 전달. 아직 해당 화면이 없으면 잠시 보관했다가 화면이 열릴 때 처리 */
export function deliverFrameCmd(cmd: FrameCmd) {
  pending = { cmd, at: Date.now() };
  window.dispatchEvent(new CustomEvent<FrameCmd>(EVT, { detail: cmd }));
}

/** 화면 컴포넌트: 처리했으면 true 반환 → 보관 중인 명령 소멸 */
export function useFrameCommand(handler: (cmd: FrameCmd) => boolean) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const take = (cmd: FrameCmd) => {
      if (ref.current(cmd)) pending = null;
    };
    if (pending && Date.now() - pending.at < TTL_MS) take(pending.cmd);
    const on = (e: Event) => take((e as CustomEvent<FrameCmd>).detail);
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
}
