"use strict";

/**
 * Installs `node_modules/.bin/npm.exe` from scripts/npm-win-shim.cjs.
 *
 * Why this exists: the dashboard spawns the project's start command with
 * `shell: false`, so on Windows `npm` has to exist as a real executable.
 * npm only ships npm.cmd / npm (batch + shell script), so the spawn fails
 * with ENOENT. The dashboard puts <project>/node_modules/.bin first on the
 * child's PATH, so a working npm.exe there is what gets executed.
 *
 * Runs from the package.json "postinstall" hook and never fails an
 * install: a missing shim only breaks the dashboard's spawn, not the
 * project itself.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const source = path.join(__dirname, "npm-win-shim.cjs");
const binDir = path.join(root, "node_modules", ".bin");
const target = path.join(binDir, "npm.exe");

function log(message) {
  process.stdout.write(`[npm-win-shim] ${message}\n`);
}

function isFile(candidate) {
  try {
    return (
      typeof candidate === "string" &&
      candidate.length > 0 &&
      fs.statSync(candidate).isFile()
    );
  } catch {
    return false;
  }
}

function findOnPath(names) {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function main() {
  if (process.platform !== "win32") return;

  if (!isFile(source)) {
    log(`source missing (${source}) - skipped`);
    return;
  }

  const bun = findOnPath(["bun.exe", "bun"]);
  if (!bun) {
    log("bun not found on PATH - skipped");
    return;
  }

  fs.mkdirSync(binDir, { recursive: true });

  // A stale bunx manifest next to npm.exe makes bun reject the launcher
  // with "bin metadata is corrupt (validate)" - npm.exe is a standalone
  // binary, so no manifest belongs to it.
  const staleManifest = path.join(binDir, "npm.bunx");
  if (fs.existsSync(staleManifest)) {
    fs.rmSync(staleManifest, { force: true });
    log("removed stale npm.bunx manifest");
  }

  // bun appends ".exe" to the output name on Windows, so the staging file
  // has to end in ".exe" for the rename below to find it.
  const staging = path.join(binDir, "npm-shim-build.exe");
  const result = spawnSync(
    bun,
    ["build", source, "--compile", "--outfile", staging],
    { stdio: "inherit", cwd: root, windowsHide: true }
  );

  if (result.status === 0 && isFile(staging)) {
    fs.renameSync(staging, target);
    log(`installed ${path.relative(root, target)}`);
    return;
  }

  try {
    if (fs.existsSync(staging)) fs.rmSync(staging, { force: true });
  } catch {
    // best effort cleanup
  }

  // Fallback: bun itself understands `bun run <script>`, which is what
  // `npm run <script>` does. Running the shim through bun keeps the same
  // command surface if the standalone build is unavailable.
  try {
    fs.copyFileSync(bun, target);
    log(`installed ${path.relative(root, target)} (bun fallback)`);
  } catch (error) {
    log(`could not install launcher: ${(error && error.message) || error}`);
  }
}

try {
  main();
} catch (error) {
  log(`skipped: ${(error && error.message) || error}`);
}

process.exit(0);
