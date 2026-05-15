import { apiUrl } from "./apiUrl";

type ErrorEnvelope = { error: string };

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(await apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(await apiUrl(path));
  return unwrap<T>(res);
}

// Body-less DELETE — the id goes in the query string (caller builds the URL).
// Don't copy-paste for a DELETE that needs a request body; add a new helper.
export async function deleteJson<T>(path: string): Promise<T> {
  const res = await fetch(await apiUrl(path), { method: "DELETE" });
  return unwrap<T>(res);
}

async function unwrap<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T | ErrorEnvelope;
  if (
    !res.ok ||
    (typeof json === "object" && json !== null && "error" in json)
  ) {
    const msg =
      typeof json === "object" && json !== null && "error" in json
        ? (json as ErrorEnvelope).error
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return json as T;
}
