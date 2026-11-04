import type { Check } from "./preflight-lib.mjs";
export function smokeCheck(baseUrl: string, fetchFn?: (url: string, init?: RequestInit) => Promise<Response>): Promise<Check[]>;
export function smokeSummary(checks: Check[]): { text: string; errors: number; warns: number };
