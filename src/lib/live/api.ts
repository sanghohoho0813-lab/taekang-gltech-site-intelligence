/** LIVE 화면용 작은 API 도우미 — JSON 요청과 오류(필드별 메시지) 정리 */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  fieldErrors: Record<string, string>;
}

export async function api<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const r = await fetch(url, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data: r.ok ? (j as T) : null, error: r.ok ? null : (j?.error ?? "요청을 처리하지 못했습니다."), fieldErrors: j?.fieldErrors ?? {} };
  } catch {
    return { ok: false, status: 0, data: null, error: "서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.", fieldErrors: {} };
  }
}
