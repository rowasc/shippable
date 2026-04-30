import { apiUrl } from "./apiUrl";

// Streams /api/review responses, decoding the SSE frames the server emits.
// The server's event contract (see server/src/review.ts):
//   { type: "text", text: string }
//   { type: "done", stop_reason?, usage? }
//   { type: "error", error: string }

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export type RunEvent =
  | { type: "text"; text: string }
  | { type: "done"; stop_reason?: string | null; usage?: Usage }
  | { type: "error"; error: string };

export interface RunHandlers {
  onText: (text: string) => void;
  onDone: (info: { stop_reason?: string | null; usage?: Usage }) => void;
  onError: (error: string) => void;
}

export interface RunOptions {
  text: string;
  system?: string;
  signal?: AbortSignal;
}

export async function runPrompt(opts: RunOptions, handlers: RunHandlers): Promise<void> {
  let res: Response;
  try {
    res = await fetch(await apiUrl("/api/review"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: opts.text, ...(opts.system ? { system: opts.system } : {}) }),
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) return;
    handlers.onError(err instanceof Error ? err.message : String(err));
    return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail = body || res.statusText;
    // The server returns JSON-shaped errors; surface their `error` field
    // directly rather than dumping the raw payload at the user.
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) detail = parsed.error;
    } catch {
      // not JSON — keep the raw body
    }
    handlers.onError(`HTTP ${res.status} — ${detail}`);
    return;
  }
  if (!res.body) {
    handlers.onError("response had no body");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE messages are separated by blank lines (\n\n).
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const message = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        dispatchMessage(message, handlers);
        idx = buffer.indexOf("\n\n");
      }
    }
    // Flush a trailing message without the blank-line terminator.
    if (buffer.trim().length > 0) {
      dispatchMessage(buffer, handlers);
    }
  } catch (err) {
    if (opts.signal?.aborted) return;
    handlers.onError(err instanceof Error ? err.message : String(err));
  }
}

function dispatchMessage(raw: string, handlers: RunHandlers): void {
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data) continue;
    let parsed: RunEvent;
    try {
      parsed = JSON.parse(data) as RunEvent;
    } catch {
      continue;
    }
    if (parsed.type === "text") {
      handlers.onText(parsed.text);
    } else if (parsed.type === "done") {
      handlers.onDone({ stop_reason: parsed.stop_reason, usage: parsed.usage });
    } else if (parsed.type === "error") {
      handlers.onError(parsed.error);
    }
  }
}
