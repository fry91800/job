// Calls to the API (same origin: the dev server proxies /api). Errors carry the API's
// error code, which the interface translates (FRONTEND.md §3).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, options: { body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal: options.signal,
      headers: options.body === undefined ? {} : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "network_error", "The server can't be reached");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiError(response.status, "invalid_response", `Unexpected answer (${response.status})`);
  }
  if (!response.ok) {
    const error = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(response.status, error?.code ?? "http_error", error?.message ?? response.statusText);
  }
  return json as T;
}
