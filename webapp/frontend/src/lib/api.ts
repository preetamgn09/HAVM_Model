export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function parse<T>(r: Response): Promise<T> {
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!r.ok) {
    const e = body?.error;
    throw new ApiError(r.status, e?.code ?? "http_error",
      e?.message ?? `The server returned ${r.status}.`);
  }
  return body as T;
}

export async function get<T = any>(path: string, signal?: AbortSignal): Promise<T> {
  let r: Response;
  try { r = await fetch(path, { signal, headers: { Accept: "application/json" } }); }
  catch (e: any) {
    if (e?.name === "AbortError") throw e;
    throw new ApiError(0, "network", "The API could not be reached. Check that the server is running.");
  }
  return parse<T>(r);
}

export async function post<T = any>(path: string, body: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "network", "The API could not be reached. Check that the server is running.");
  }
  return parse<T>(r);
}

export type Envelope<T = any> = { data: T; meta: Record<string, any> };
