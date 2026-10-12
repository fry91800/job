// fetch wrapper that records every call for the request log panel.

export type ApiError = { code: string; message: string; issues?: { path: string; message: string }[] };
export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

export type LogEntry = { id: number; method: string; path: string; body?: unknown; status: number; response: unknown };

let nextId = 1;
let listener: ((entry: LogEntry) => void) | undefined;

export function onApiCall(callback: (entry: LogEntry) => void) {
  listener = callback;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : undefined;
  listener?.({ id: nextId++, method, path, body, status: response.status, response: json });

  if (response.ok) return { ok: true, status: response.status, data: json as T };
  return { ok: false, status: response.status, error: json?.error ?? { code: "http_error", message: response.statusText } };
}

export function errorText(result: ApiResult<unknown>): string {
  if (result.ok) return "";
  const issues = result.error.issues?.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
  return `${result.status} ${result.error.code}: ${result.error.message}${issues ? ` (${issues})` : ""}`;
}
