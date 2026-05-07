import { describe, it, expect, vi, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lookupPrForBranch } from "./branch-lookup.ts";

const execFileAsync = promisify(execFile);

afterEach(() => {
  vi.restoreAllMocks();
});

/** Create a minimal git repo in a tmpdir. Returns the path. */
async function makeTmpGitDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shippable-bl-"));
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  // Need at least one commit so HEAD resolves
  await fs.writeFile(path.join(dir, "README.md"), "hello");
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

function fakeFetch(pulls: unknown[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "Content-Type": "application/json" }),
        json: () => Promise.resolve(pulls),
      }),
    ),
  );
}

const MATCHED_PR = {
  number: 42,
  title: "My feature",
  state: "open",
  merged: false,
  html_url: "https://github.com/owner/repo/pull/42",
};

describe("lookupPrForBranch — HTTPS remote, PR found", () => {
  it("returns matched PR for HTTPS remote", async () => {
    const dir = await makeTmpGitDir();
    try {
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "https://github.com/owner/repo.git"],
        { cwd: dir },
      );
      fakeFetch([MATCHED_PR]);
      const result = await lookupPrForBranch(dir, () => "ghp_token");
      expect(result.matched).not.toBeNull();
      expect(result.matched!.number).toBe(42);
      expect(result.matched!.title).toBe("My feature");
      expect(result.matched!.host).toBe("github.com");
      expect(result.matched!.owner).toBe("owner");
      expect(result.matched!.repo).toBe("repo");
      expect(result.matched!.state).toBe("open");
      expect(result.matched!.htmlUrl).toBe("https://github.com/owner/repo/pull/42");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lookupPrForBranch — SSH remote", () => {
  it("parses git@github.com:owner/repo.git and returns matched PR", async () => {
    const dir = await makeTmpGitDir();
    try {
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "git@github.com:owner/repo.git"],
        { cwd: dir },
      );
      fakeFetch([MATCHED_PR]);
      const result = await lookupPrForBranch(dir, () => "ghp_token");
      expect(result.matched).not.toBeNull();
      expect(result.matched!.number).toBe(42);
      expect(result.matched!.host).toBe("github.com");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lookupPrForBranch — no remotes", () => {
  it("returns { matched: null } when no remotes are configured", async () => {
    const dir = await makeTmpGitDir();
    try {
      const result = await lookupPrForBranch(dir, () => "ghp_token");
      expect(result.matched).toBeNull();
      expect("tokenRequiredForHost" in result).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lookupPrForBranch — non-GitHub remote", () => {
  it("returns { matched: null } for a non-parseable remote", async () => {
    const dir = await makeTmpGitDir();
    try {
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "svn+ssh://svn.example.com/repo"],
        { cwd: dir },
      );
      const result = await lookupPrForBranch(dir, () => "ghp_token");
      expect(result.matched).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lookupPrForBranch — token absent", () => {
  it("returns { matched: null, tokenRequiredForHost } when no token", async () => {
    const dir = await makeTmpGitDir();
    try {
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "https://github.com/owner/repo.git"],
        { cwd: dir },
      );
      const result = await lookupPrForBranch(dir, () => undefined);
      expect(result.matched).toBeNull();
      expect((result as { tokenRequiredForHost: string }).tokenRequiredForHost).toBe(
        "github.com",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lookupPrForBranch — empty pulls response", () => {
  it("returns { matched: null } when GitHub returns empty array", async () => {
    const dir = await makeTmpGitDir();
    try {
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "https://github.com/owner/repo.git"],
        { cwd: dir },
      );
      fakeFetch([]);
      const result = await lookupPrForBranch(dir, () => "ghp_token");
      expect(result.matched).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lookupPrForBranch — multiple remotes", () => {
  it("uses the first GitHub remote found (origin wins over upstream)", async () => {
    const dir = await makeTmpGitDir();
    try {
      // `upstream` is added first alphabetically but `origin` appears first in
      // `git remote -v` output because it was added before upstream.
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "https://github.com/owner/repo.git"],
        { cwd: dir },
      );
      await execFileAsync(
        "git",
        ["remote", "add", "upstream", "https://github.com/fork/repo.git"],
        { cwd: dir },
      );
      fakeFetch([MATCHED_PR]);
      const result = await lookupPrForBranch(dir, () => "ghp_token");
      // Should use origin (owner/repo), not upstream (fork/repo)
      expect(result.matched).not.toBeNull();
      expect(result.matched!.owner).toBe("owner");
      expect(result.matched!.repo).toBe("repo");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lookupPrForBranch — HTTPS remote with embedded credentials", () => {
  it("strips userinfo from the host so the auth-store key is clean", async () => {
    const dir = await makeTmpGitDir();
    try {
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "https://x-access-token:abc123@github.com/owner/repo.git"],
        { cwd: dir },
      );
      fakeFetch([MATCHED_PR]);
      const result = await lookupPrForBranch(dir, () => "ghp_token");
      expect(result.matched).not.toBeNull();
      expect(result.matched!.host).toBe("github.com");
      expect(result.matched!.owner).toBe("owner");
      expect(result.matched!.repo).toBe("repo");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lookupPrForBranch — HTTPS remote without .git suffix", () => {
  it("parses HTTPS URL without .git and returns matched PR", async () => {
    const dir = await makeTmpGitDir();
    try {
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "https://github.com/owner/my-repo"],
        { cwd: dir },
      );
      fakeFetch([MATCHED_PR]);
      const result = await lookupPrForBranch(dir, () => "ghp_token");
      expect(result.matched).not.toBeNull();
      expect(result.matched!.repo).toBe("my-repo");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
