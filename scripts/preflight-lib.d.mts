export interface Check {
  level: "ok" | "warn" | "error";
  key: string;
  text: string;
}
export function checkEnv(env: Record<string, string | undefined>): Check[];
export function checkDb(query: (sql: string) => Promise<Record<string, unknown>[]>): Promise<Check[]>;
export function summarize(checks: Check[]): { text: string; errors: number; warns: number };
