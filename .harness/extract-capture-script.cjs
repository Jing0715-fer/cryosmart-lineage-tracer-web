// Extracts the capture-script template literal from smart-capture-panel.tsx,
// un-escapes it the way the browser receives it, and syntax-checks it.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "src", "app", "components", "cryosmart", "smart-capture-panel.tsx"),
  "utf8"
);
const lines = src.split("\n");

// find the declaration line: const captureScript = `
const declIdx = lines.findIndex((l) => /const captureScript = `$/.test(l));
if (declIdx < 0) throw new Error("captureScript declaration not found");
let out = [];
for (let i = declIdx + 1; i < lines.length; i++) {
  if (lines[i] === "`.trim();") break;
  out.push(lines[i]);
}
if (out.length === 0) throw new Error("empty script");
let script = out.join("\n");

// The template literal escapes: \\\\ -> \\, \\` -> `, \\$ -> $.
// The only backslash sequences present are \\\\ and the ${webAppUrl}
// interpolation; assert that before unescaping.
const rawInterp = script.match(/\$\{[^}]*\}/g) || [];
if (rawInterp.some((s) => s !== "${webAppUrl}")) {
  throw new Error("unexpected interpolation in script: " + JSON.stringify(rawInterp));
}
script = script.split("\\\\").join("\\");
script = script.replace("${webAppUrl}", "http://localhost:3000");
if (/\\\$\{/.test(script) || script.includes("${")) {
  throw new Error("leftover interpolation after unescape");
}

fs.writeFileSync("/tmp/capture-script-check.js", script);
console.log("extracted", script.length, "chars");
