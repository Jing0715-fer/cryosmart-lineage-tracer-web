"use strict";

/**
 * Windows launcher for `npm`.
 *
 * The dashboard starts a project environment with
 *   spawn("npm", ["run", "dev"], { shell: false })
 * A shell-less spawn on Windows can only start a real executable image, but
 * npm is shipped as `npm.cmd` (a batch file) plus `npm` (a POSIX shell
 * script). CreateProcess can run neither, so the spawn dies with
 * "spawn npm ENOENT" before npm is ever reached.
 *
 * This file is compiled into `node_modules/.bin/npm.exe` - the first entry
 * of the PATH the dashboard builds for the child process - and simply
 * re-executes the real npm CLI (npm-cli.js) through node.exe.
 *
 * It can also be run directly:  node scripts/npm-win-shim.cjs run dev
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MARKER = "cryosmart-npm-shim";

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

function pathEntries() {
  return (process.env.PATH || "").split(path.delimiter).filter(Boolean);
}

function findOnPath(names) {
  for (const dir of pathEntries()) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** Locate npm-cli.js: the script that contains npm's real CLI. */
function npmCliPath() {
  const candidates = [];

  if (process.env.NPM_CLI_JS) candidates.push(process.env.NPM_CLI_JS);

  // npm installed as a dependency of this project:
  //   <project>/node_modules/npm/bin/npm-cli.js
  candidates.push(
    path.join(__dirname, "..", "node_modules", "npm", "bin", "npm-cli.js")
  );

  // npm shipped next to the node.exe on PATH:
  //   <prefix>/npm.cmd  ->  <prefix>/node_modules/npm/bin/npm-cli.js
  for (const dir of pathEntries()) {
    if (isFile(path.join(dir, "npm.cmd")) || isFile(path.join(dir, "npm"))) {
      candidates.push(
        path.join(dir, "node_modules", "npm", "bin", "npm-cli.js")
      );
    }
  }

  for (const candidate of candidates) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** Locate the node.exe that should run npm-cli.js. */
function nodeExePath() {
  if (
    isFile(process.execPath) &&
    /node(\.exe)?$/i.test(path.basename(process.execPath))
  ) {
    return process.execPath;
  }
  return findOnPath(["node.exe", "node"]);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  });
  if (result.error) return 1;
  return typeof result.status === "number" ? result.status : 1;
}

const argv = process.argv.slice(2);
const npmCli = npmCliPath();
const nodeExe = nodeExePath();

if (npmCli && nodeExe) {
  process.exit(run(nodeExe, [npmCli, ...argv]));
}

// Fallback for machines without an npm installation: bun understands
// `bun run <script>` the same way npm understands `npm run <script>`.
const bun = findOnPath(["bun.exe", "bun"]);
if (bun) {
  process.exit(run(bun, argv));
}

process.stderr.write(
  `${MARKER}: could not find npm-cli.js (set NPM_CLI_JS to its path)\n`
);
process.exit(127);
