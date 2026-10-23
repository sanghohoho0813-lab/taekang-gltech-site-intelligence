/** 저장소 키와 첫 페인트 전 적용 스크립트 (서버 컴포넌트에서도 import 가능한 순수 모듈) */
import { DEFAULT_THEME } from "@/lib/theme/themes";

export const DB_KEY = "tk-site-intel:db:v1";
export const PREFS_KEY = "tk-site-intel:prefs:v1";

/** 레이아웃 <head> 인라인 스크립트: Theme·Font·Frame·Device 속성을 첫 페인트 전에 적용 (깜빡임 방지) */
export const PREFS_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var p=JSON.parse(localStorage.getItem(${JSON.stringify(
  PREFS_KEY,
)})||"{}");d.dataset.theme=p.theme||${JSON.stringify(DEFAULT_THEME)};var f=p.fontScale||"md";d.dataset.font=f;d.style.setProperty("--font-scale",{sm:"0.9",md:"1",lg:"1.12"}[f]||"1");d.dataset.motion=p.reduceMotion?"reduce":"full";var fr=false;try{fr=window.self!==window.top}catch(e){fr=true}d.dataset.frame=fr?"1":"0";}catch(e){}})();`;
