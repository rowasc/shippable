import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import {
  handleAuthSet,
  handleAuthClear,
  handleAuthList,
} from "./endpoints.ts";
import { hasCredential, resetForTests } from "./store.ts";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      if (req.method === "POST" && req.url === "/api/auth/set") {
        return await handleAuthSet(req, res, null);
      }
      if (req.method === "POST" && req.url === "/api/auth/clear") {
        return await handleAuthClear(req, res, null);
      }
      if (req.method === "GET" && req.url === "/api/auth/list") {
        return await handleAuthList(req, res, null);
      }
      res.writeHead(404);
      res.end();
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  resetForTests();
});

async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

describe("POST /api/auth/set", () => {
  it("sets an anthropic credential", async () => {
    const r = await post("/api/auth/set", {
      credential: { kind: "anthropic" },
      value: "sk-test",
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(hasCredential({ kind: "anthropic" })).toBe(true);
  });

  it("sets a github credential", async () => {
    const r = await post("/api/auth/set", {
      credential: { kind: "github", host: "github.com" },
      value: "ghp_test",
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(hasCredential({ kind: "github", host: "github.com" })).toBe(true);
  });

  it("rejects a missing credential", async () => {
    const r = await post("/api/auth/set", { value: "sk-test" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_credential");
  });

  it("rejects a credential with unknown kind", async () => {
    const r = await post("/api/auth/set", {
      credential: { kind: "slack" },
      value: "x",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_credential");
  });

  it("rejects a github credential without host", async () => {
    const r = await post("/api/auth/set", {
      credential: { kind: "github" },
      value: "x",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_credential");
  });

  it("rejects a missing value", async () => {
    const r = await post("/api/auth/set", {
      credential: { kind: "anthropic" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("missing_value");
  });

  it("rejects an empty value", async () => {
    const r = await post("/api/auth/set", {
      credential: { kind: "anthropic" },
      value: "",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("missing_value");
  });

  it("rejects a blocked github host", async () => {
    const r = await post("/api/auth/set", {
      credential: { kind: "github", host: "localhost" },
      value: "ghp_x",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("host_blocked");
  });

  it("rejects an invalid JSON body", async () => {
    const res = await fetch(`${baseUrl}/api/auth/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/clear", () => {
  it("clears an existing credential", async () => {
    await post("/api/auth/set", {
      credential: { kind: "anthropic" },
      value: "sk-test",
    });
    const r = await post("/api/auth/clear", {
      credential: { kind: "anthropic" },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(hasCredential({ kind: "anthropic" })).toBe(false);
  });

  it("is a no-op on an unset credential", async () => {
    const r = await post("/api/auth/clear", {
      credential: { kind: "github", host: "github.com" },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  it("rejects a missing credential", async () => {
    const r = await post("/api/auth/clear", {});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_credential");
  });
});

describe("GET /api/auth/list", () => {
  it("returns an empty list initially", async () => {
    const r = await get("/api/auth/list");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ credentials: [] });
  });

  it("returns the configured credentials without their values", async () => {
    await post("/api/auth/set", {
      credential: { kind: "anthropic" },
      value: "sk-secret",
    });
    await post("/api/auth/set", {
      credential: { kind: "github", host: "github.com" },
      value: "ghp_secret",
    });
    const r = await get("/api/auth/list");
    expect(r.status).toBe(200);
    expect(r.body.credentials).toEqual([
      { kind: "anthropic" },
      { kind: "github", host: "github.com" },
    ]);
    expect(JSON.stringify(r.body)).not.toContain("secret");
  });

  it("normalises hosts at the wire boundary so /set and /list agree", async () => {
    // Send a mixed-case host on the way in; /list should reflect the
    // canonical form. Without normalization in parseCredential the caller
    // would write under GitHub.Com and read back github.com — confusing for
    // anyone watching either side of the wire.
    await post("/api/auth/set", {
      credential: { kind: "github", host: "GitHub.Com" },
      value: "ghp_x",
    });
    const r = await get("/api/auth/list");
    expect(r.body.credentials).toEqual([
      { kind: "github", host: "github.com" },
    ]);
  });
});
