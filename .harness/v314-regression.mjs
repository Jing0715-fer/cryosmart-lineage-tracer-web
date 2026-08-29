#!/usr/bin/env bun
/**
 * v3.14 regression suite — verifies the audit fixes against the live dev server.
 *
 * Covers:
 *  1. SVG stored-XSS rejected (declared image/svg+xml with <script> payload)
 *  2. Raster sniffing still accepts PNG (declared as octet-stream AND as image/png)
 *  3. Session image responses carry CSP + nosniff defense headers
 *  4. Report HTML onerror fallback is XSS-safe (data-proxy-src attribute, no
 *     JS-string interpolation) for a crafted fileid
 *  5. Direct absolute CryoSmart URLs proxy correctly through the app (no
 *     mangled nested-origin path)
 *  6. POST /api/cryosmart/import with null body → 400 (was 500)
 *  7. Session tokens are crypto-random (16-hex entropy, not 8)
 *  8. Staged-rescue: legacy import with a staged token applies to THAT session
 *  9. Source contracts: final-results probe gating, SVG image names, files[] dedupe
 */
const BASE = "http://localhost:3000";
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG_B64 = "/9j/4AAQSkZJRgABAQEAYABgAAD//gA7Q1JFQVRPUgo="; // jpeg magic

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ FAIL: ${m}`); };
const j = (r) => r.json();

// ── 1+2+3+7: image upload sniffing + response headers + token entropy ──
console.log("── 1. SVG payload rejected / raster sniffing / CSP headers ──");
{
  const sess = await fetch(`${BASE}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "P314", cryosmart_origin: "http://10.9.9.9:8080" }),
  }).then(j);
  ok(`session created ${sess.token}`);
  const is16Hex = /-([0-9a-f]{16})$/.test(sess.token);
  is16Hex ? ok("token carries 16-hex crypto entropy (was 8-hex Math.random)")
          : bad("token entropy looks like the old 8-hex Math.random format");

  const svgPayload =
    "data:image/svg+xml;base64," + Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(document.cookie)</script></svg>'
    ).toString("base64");
  const r1 = await fetch(`${BASE}/api/cryosmart/import/session/${sess.token}/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { fileid: "svg_evil", data: svgPayload },
      { fileid: "png_octet", data: "data:application/octet-stream;base64," + PNG_B64 },
      { fileid: "png_lied", data: "data:image/png;base64," + JPEG_B64 },
    ]}),
  }).then(j);
  r1.stored === 2 ? ok("SVG rejected, 2 raster images stored") : bad(`stored=${r1.stored}, expected 2`);

  const rSvg = await fetch(`${BASE}/api/cryosmart/import/session/${sess.token}/image/svg_evil`);
  rSvg.status === 404 ? ok("svg_evil 404 (never stored)") : bad(`svg_evil status=${rSvg.status}`);

  const rPng = await fetch(`${BASE}/api/cryosmart/import/session/${sess.token}/image/png_octet`);
  const csp = rPng.headers.get("content-security-policy") || "";
  const nosniff = rPng.headers.get("x-content-type-options") || "";
  rPng.status === 200 && /png/i.test(rPng.headers.get("content-type") || "")
    ? ok("octet-stream declared PNG sniffed + stored as image/png")
    : bad(`png_octet status=${rPng.status} ct=${rPng.headers.get("content-type")}`);
  /default-src 'none'/.test(csp) ? ok("CSP sandbox header present") : bad(`CSP="${csp}"`);
  /nosniff/i.test(nosniff) ? ok("nosniff header present") : bad(`nosniff="${nosniff}"`);

  const rLied = await fetch(`${BASE}/api/cryosmart/import/session/${sess.token}/image/png_lied`);
  // Declared image/png but bytes are JPEG → sniffed mime wins
  /jpeg/i.test(rLied.headers.get("content-type") || "")
    ? ok("declared-png-but-jpeg bytes served as image/jpeg (bytes always win)")
    : bad(`png_lied ct=${rLied.headers.get("content-type")}`);
}

// ── 4: report onerror XSS-safety ─────────────────────────────────────
console.log("── 2. Report onerror fallback is XSS-safe ──");
{
  // Directly exercise the sink (reportImgTag is exported).
  const { reportImgTag } = await import("../src/lib/cryosmart/report-html.ts");
  const crafted = 'http://10.9.9.9:8080/api/log_image/x";alert(document.cookie);//';
  const tag = reportImgTag("J1", "evil", crafted, "", "image", {
    session: { baseUrl: "http://10.9.9.9:8080", cookie: "session=abc" },
  });
  const hasJsStringInjection = /this\.src="\/api\/proxy-image\/x";alert/.test(tag);
  const hasDataAttr = /data-proxy-src="[^"]*alert/.test(tag) && /this\.dataset\.proxySrc/.test(tag);
  !hasJsStringInjection ? ok("no raw fileid inside the onerror JS string")
                        : bad("fileid still interpolated into onerror JS string!");
  hasDataAttr ? ok("proxy URL carried via data-proxy-src + dataset read-back")
              : bad("data-proxy-src fallback not found");
  const breakout = /onerror="[^"]*this\.src="x"/.test(tag);
  !breakout ? ok("no attribute-context breakout") : bad("attribute breakout detected");
  // Sanity: a normal fileid still produces a working fallback chain.
  const sane = reportImgTag("J1", "plot", "http://10.9.9.9:8080/api/log_image/abc123", "", "image", {
    session: { baseUrl: "http://10.9.9.9:8080" },
  });
  sane.includes('data-proxy-src="/api/proxy-image/abc123?base=http%3A%2F%2F10.9.9.9%3A8080"')
    ? ok("sane fileid → well-formed data-proxy-src URL")
    : bad(`sane fileid fallback broken: ${sane.slice(0, 300)}`);
}

// ── 5: direct absolute URL proxying (cryoSmartFetch normalization) ────
console.log("── 3. Direct absolute URL normalization (proxy-client) ──");
{
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response("{}", { status: 200 }); };
  try {
    const { cryoSmartFetch } = await import("../src/lib/cryosmart/proxy-client.ts");
    const session = { baseUrl: "http://192.168.4.3:8080", cookie: "s", auth: "Bearer t" };
    await cryoSmartFetch(session, "http://10.9.9.9:8080/api/log_image/abc123.png");
    const c = calls[0];
    /^\/api\/cryosmart\/api\/log_image\/abc123\.png\?/.test(c) && c.includes("base=http%3A%2F%2F10.9.9.9%3A8080")
      ? ok("direct URL → clean proxy path (origin in base, not the path)")
      : bad(`unexpected proxy URL: ${c}`);
    calls.length = 0;
    await cryoSmartFetch(session, "http://localhost:3000/api/cryosmart/import/session/s1-abc/image/f1");
    /^\/api\/cryosmart\/import\/session\/s1-abc\/image\/f1$/.test(calls[0])
      ? ok("absolute session-image URL → same-origin fetch (no proxy relay)")
      : bad(`unexpected session URL: ${calls[0]}`);
    calls.length = 0;
    await cryoSmartFetch(session, "api/log_image/rel.png");
    /^\/api\/cryosmart\/api\/log_image\/rel\.png\?base=/.test(calls[0])
      ? ok("relative path still routes through branch (1) unchanged")
      : bad(`unexpected relative URL: ${calls[0]}`);
  } finally {
    // CRITICAL: restore the real fetch so the server-hitting sections below work.
    globalThis.fetch = realFetch;
  }
}

// ── 6: null body import ──────────────────────────────────────────────
console.log("── 4. POST /import null body → 400 ──");
{
  const r = await fetch(`${BASE}/api/cryosmart/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "null",
  });
  r.status === 400 ? ok("null JSON body → 400 (was 500)") : bad(`status=${r.status}`);
  const cors = r.headers.get("access-control-allow-origin");
  cors === "*" ? ok("CORS header present on the error response too") : bad(`CORS=${cors}`);
}

// ── 8: staged-rescue ─────────────────────────────────────────────────
console.log("── 5. Staged-rescue: legacy import applies to the live session ──");
{
  const sess = await fetch(`${BASE}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "P314R", cryosmart_origin: "http://10.9.9.9:8080" }),
  }).then(j);
  const jobs = [{ uid: "J1", project_uid: "P314R", job_type: "import_movies", uid_num: 1 }];
  const r = await fetch(`${BASE}/api/cryosmart/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: sess.token, project_uid: "P314R", jobs,
      job_log_images: { J1: [{ fileid: "f1", name: "plot" }] },
      cryosmart_origin: "http://10.9.9.9:8080",
    }),
  }).then(j);
  r.ok && r.mode === "staged-rescue" && r.token === sess.token
    ? ok("rescue response: same token, mode=staged-rescue")
    : bad(`rescue response: ${JSON.stringify(r)}`);
  const data = await fetch(`${BASE}/api/cryosmart/import/session/${sess.token}/data`).then(j);
  data.status === "complete" ? ok("session completed") : bad(`status=${data.status}`);
  Array.isArray(data.data.jobs) && data.data.jobs.length === 1
    ? ok("jobs applied to the staged session")
    : bad("jobs not applied");
  data.data.job_log_images && data.data.job_log_images.J1?.length === 1
    ? ok("log refs merged into the session")
    : bad("log refs missing");
}

// ── 9: source contracts ──────────────────────────────────────────────
console.log("── 6. Source contracts (probe gating / SVG names / files[] dedupe) ──");
{
  const src = await Bun.file("../src/lib/cryosmart/bundle.ts").text();
  const gated = /includeFinalResults[\s\S]{0,600}ensureReachability\(\)/.test(src);
  gated ? ok("includeFinalResults gated on ensureReachability()") : bad("probe gate not found");
  const svg = await Bun.file("../src/lib/cryosmart/report-svg.ts").text();
  svg.includes('"templates_selected"') && !svg.includes('"selected_classes"')
    ? ok("SVG references templates_selected (matches bundle collector)")
    : bad("SVG select_2D name mismatch persists");
  const lin = await Bun.file("../src/lib/cryosmart/lineage.ts").text();
  /log\.files[\s\S]{0,80}claim\(/.test(lin)
    ? ok("dedupeLogImagesAcrossJobs claims the v3.11 files[] shape too")
    : bad("files[] dedupe missing");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
