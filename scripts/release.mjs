import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(scriptDir);
const tauriDir = path.join(rootDir, "src-tauri");
const tauriConfig = JSON.parse(
  readFileSync(path.join(tauriDir, "tauri.conf.json"), "utf8"),
);

const productName = tauriConfig.productName;
const version = tauriConfig.version;
if (!productName || !version) {
  fail("Expected productName and version in src-tauri/tauri.conf.json");
}

const tag = `v${version}`;
const skipBuild = process.argv.includes("--skip-build");
const allowDirty = process.argv.includes("--allow-dirty");

const TARGETS = [
  {
    triple: "aarch64-apple-darwin",
    archSuffix: "aarch64",
  },
  {
    triple: "x86_64-apple-darwin",
    archSuffix: "x64",
  },
];

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

function exec(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd ?? rootDir,
    stdio: opts.stdio ?? "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0 && !opts.allowFailure) {
    fail(`${command} ${args.join(" ")} exited ${result.status}`);
  }
  return result;
}

function capture(command, args) {
  const r = spawnSync(command, args, { cwd: rootDir, encoding: "utf8" });
  return { status: r.status, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}

function preflight() {
  if (capture("git", ["rev-parse", "--git-dir"]).status !== 0) {
    fail("not in a git repository");
  }
  const status = capture("git", ["status", "--porcelain"]).stdout;
  if (status && !allowDirty) {
    fail(`working tree is dirty. Commit or stash first, or pass --allow-dirty:\n${status}`);
  }
  const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout;
  if (branch !== "main") {
    console.warn(`release: warning — releasing from branch '${branch}', not 'main'`);
  }

  const localTag = capture("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]);
  if (localTag.status === 0) fail(`tag ${tag} already exists locally`);
  const remoteTag = capture("git", ["ls-remote", "--tags", "origin", tag]);
  if (remoteTag.stdout) fail(`tag ${tag} already exists on origin`);

  const installed = capture("rustup", ["target", "list", "--installed"]).stdout;
  for (const { triple } of TARGETS) {
    if (!installed.split("\n").includes(triple)) {
      fail(`rust target ${triple} not installed. Run: rustup target add ${triple}`);
    }
  }

  if (capture("gh", ["auth", "status"]).status !== 0) {
    fail("gh is not authenticated. Run: gh auth login");
  }
}

function buildDmgs() {
  if (skipBuild) {
    console.log("release: --skip-build set, assuming DMGs already built");
    return TARGETS.map(dmgPathFor);
  }
  const out = [];
  for (const target of TARGETS) {
    console.log(`\nrelease: building ${target.triple}...`);
    exec("node", ["scripts/build-dmg.mjs", `--target=${target.triple}`]);
    const dmg = dmgPathFor(target);
    if (!existsSync(dmg)) fail(`expected DMG at ${dmg}`);
    out.push(dmg);
  }
  return out;
}

function dmgPathFor({ triple, archSuffix }) {
  return path.join(
    tauriDir,
    "target",
    triple,
    "release",
    "bundle",
    "dmg",
    `${productName}_${version}_${archSuffix}.dmg`,
  );
}

function previousTag() {
  const r = capture("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"]);
  return r.status === 0 ? r.stdout : null;
}

function tagAndPush() {
  exec("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
  exec("git", ["push", "origin", tag]);
}

function buildNotes() {
  const prev = previousTag();
  const range = prev ? `${prev}..HEAD` : "HEAD";
  const log = capture("git", ["log", range, "--pretty=format:- %s (%h)", "--no-merges"]).stdout;
  const changes = log || "_no commits since last release_";
  const compare = prev
    ? `\n\n**Full diff:** [\`${prev}...${tag}\`](https://github.com/rowasc/shippable/compare/${prev}...${tag})`
    : "";

  return `## Install

1. Download the DMG that matches your Mac:
   - **Apple Silicon (M1+):** \`${productName}_${version}_aarch64.dmg\`
   - **Intel:** \`${productName}_${version}_x64.dmg\`
2. Open the DMG and drag **${productName}.app** to **Applications**.
3. The app is unsigned, so the first launch is blocked by Gatekeeper. Either:
   - Right-click the app in Finder → **Open** → confirm once, **or**
   - Run once in Terminal: \`xattr -dr com.apple.quarantine /Applications/${productName}.app\`

This is a **prototype** — don't trust the review output yet. AI features need an Anthropic API key (paste it on first launch).

## Changes

${changes}${compare}
`;
}

function createRelease(dmgs) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "shippable-release-"));
  const notesFile = path.join(tmpDir, "notes.md");
  try {
    writeFileSync(notesFile, buildNotes(), "utf8");
    exec("gh", [
      "release",
      "create",
      tag,
      ...dmgs,
      "--prerelease",
      "--title",
      tag,
      "--notes-file",
      notesFile,
    ]);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  const url = capture("gh", ["release", "view", tag, "--json", "url", "-q", ".url"]).stdout;
  console.log(`\nrelease: published ${tag}`);
  if (url) console.log(url);
}

preflight();
const dmgs = buildDmgs();
tagAndPush();
createRelease(dmgs);
