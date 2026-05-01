import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(scriptDir);
const tauriDir = path.join(rootDir, "src-tauri");
const tauriConfigPath = path.join(tauriDir, "tauri.conf.json");
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));

const productName = tauriConfig.productName;
const version = tauriConfig.version;

if (!productName || !version) {
  throw new Error(`Expected productName and version in ${tauriConfigPath}`);
}

const archSuffix =
  process.arch === "arm64"
    ? "aarch64"
    : process.arch === "x64"
      ? "x64"
      : process.arch;

const appPath = path.join(
  tauriDir,
  "target",
  "release",
  "bundle",
  "macos",
  `${productName}.app`,
);
const dmgDir = path.join(tauriDir, "target", "release", "bundle", "dmg");
const dmgPath = path.join(dmgDir, `${productName}_${version}_${archSuffix}.dmg`);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("cargo", ["tauri", "build", "-b", "app"], tauriDir);

if (!existsSync(appPath)) {
  throw new Error(`Expected bundled app at ${appPath}`);
}

mkdirSync(dmgDir, { recursive: true });
rmSync(dmgPath, { force: true });

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "shippable-dmg-"));
const volumeDir = path.join(tempRoot, productName);

try {
  mkdirSync(volumeDir);
  cpSync(appPath, path.join(volumeDir, `${productName}.app`), {
    recursive: true,
  });
  symlinkSync("/Applications", path.join(volumeDir, "Applications"));

  run(
    "hdiutil",
    [
      "create",
      "-volname",
      productName,
      "-srcfolder",
      volumeDir,
      "-ov",
      "-format",
      "UDZO",
      dmgPath,
    ],
    rootDir,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`DMG ready at ${dmgPath}`);
