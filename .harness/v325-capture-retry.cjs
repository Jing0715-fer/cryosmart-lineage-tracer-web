// Functional smoke test for the v3.25 capture-script image pipeline:
//   1. fetchImageData retries transient failures (502 → 200 succeeds)
//   2. 404 fails fast (exactly ONE fetch, no retry)
//   3. persistent network errors give up after 3 attempts → null
//   4. blobToDataUrl rewrites the mime with the SNIFFED type
//      (octet-stream blob carrying PNG magic → data:image/png;base64,…)
//   5. flushImageBatch retries a lost /images POST and keeps the bytes
const fs = require("fs");

const gen = fs.readFileSync("/tmp/capture-script-check.js", "utf8");

function extractFn(name, src) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  throw new Error(`${name}: unbalanced`);
}

const fetchImageDataSrc = extractFn("fetchImageData", gen);
const blobToDataUrlSrc = extractFn("blobToDataUrl", gen);
const flushImageBatchSrc = extractFn("flushImageBatch", gen);

// ---- mocks ----------------------------------------------------------------
let calls = 0;
let responses = []; // {status, blob} or {reject: err}
function mockFetch() {
  calls++;
  const r = responses.shift();
  if (!r) return Promise.resolve({ ok: false, status: 404, blob: () => Promise.resolve(null) });
  if (r.reject) return Promise.reject(r.reject);
  return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, blob: () => Promise.resolve(r.blob) });
}
function fetchT(url, opts, ms) { return mockFetch(); }
function sleepMs(ms) { return new Promise((r) => setTimeout(r, Math.min(ms, 5))); } // fast-forward

// the real sniffImageMime from the generated script
const sniffImageMimeSrc = extractFn("sniffImageMime", gen);
function refMimeHint() { return null; }

const IMG_MAX_BYTES = 4 * 1024 * 1024;
const IMG_FETCH_TRIES = 3;

// PNG magic bytes
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const pngBlob = {
  size: pngBytes.length,
  type: "application/octet-stream", // the typeless-server case
  arrayBuffer: () => Promise.resolve(pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength)),
};

// image-store state for flushImageBatch
const state = { imgBatch: [], imgPosted: 0, imgUploaded: 0, imgFailed: 0 };
let postCalls = 0;
let postResponses = [];
function post(path, body) {
  postCalls++;
  const r = postResponses.shift();
  if (r && r.reject) return Promise.reject(r.reject);
  return Promise.resolve(r || { ok: true, stored: body.items.length });
}

const sleepFast = sleepMs;
// eslint-disable-next-line no-unused-vars
const ctx = `
  "use strict";
  return {
    fetchImageData: ${fetchImageDataSrc},
    blobToDataUrl: ${blobToDataUrlSrc},
    flushImageBatch: ${flushImageBatchSrc}
  };
`;
// flushImageBatch references outer state vars directly; wrap it with a shim
const factory = new Function(
  "fetchT", "sleepMs", "sniffImageMime", "refMimeHint", "IMG_MAX_BYTES", "IMG_FETCH_TRIES",
  "imgBatch", "imgPosted", "imgUploaded", "imgFailed", "post", "console",
  `
  ${sniffImageMimeSrc}
  ${blobToDataUrlSrc}
  ${fetchImageDataSrc}
  var imgQueue = [];
  var flushImageBatchShim = ${flushImageBatchSrc.replace(/imgBatch/g, "shimBatch").replace(/imgPosted/g, "shimPosted").replace(/imgUploaded/g, "shimUploaded").replace(/imgFailed/g, "shimFailed").replace(/var items = shimBatch; shimBatch = \[\];/, "var items = shimBatch; shimBatch = [];")};
  var shimBatch = [];
  var shimPosted = 0, shimUploaded = 0, shimFailed = 0;
  return {
    sniffImageMime: sniffImageMime,
    blobToDataUrl: blobToDataUrl,
    fetchImageData: fetchImageData,
    flushImageBatch: function() {
      // feed the outer shim state through arguments-by-reference closures
      return flushImageBatchInner();
    },
    setBatch: function(items) { shimBatch = items; },
    counts: function() { return { posted: shimPosted, uploaded: shimUploaded, failed: shimFailed }; }
  };
  function flushImageBatchInner() { return flushImageBatchShim(); }
  `
);

// simpler approach: build a fresh module per test with its own state
function buildModule(fetchImpl, postImpl) {
  const mod = new Function(
    "fetchT", "sleepMs", "sniffImageMime", "refMimeHint", "IMG_MAX_BYTES", "IMG_FETCH_TRIES", "post", "console",
    `
    ${sniffImageMimeSrc}
    ${blobToDataUrlSrc}
    ${fetchImageDataSrc}
    var IMG_WORKERS = 8, imgQueue = [], imgBatch = [], imgWorkers = 0, imgPosted = 0, imgUploaded = 0, imgFailed = 0;
    ${flushImageBatchSrc}
    return {
      fetchImageData: fetchImageData,
      blobToDataUrl: blobToDataUrl,
      flushImageBatch: flushImageBatch,
      setBatch: function(items) { imgBatch = items; },
      counts: function() { return { posted: imgPosted, uploaded: imgUploaded, failed: imgFailed }; }
    };
    `
  )(fetchImpl, sleepMs, eval(`(${sniffImageMimeSrc.replace("function sniffImageMime", "function")})`), () => null, IMG_MAX_BYTES, IMG_FETCH_TRIES, postImpl, console);
  return mod;
}

(async () => {
  let pass = 0, fail = 0;
  const check = (name, cond) => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name); } };

  // ── 1. retry then success ──
  calls = 0;
  responses = [
    { status: 502, blob: null },
    { status: 200, blob: pngBlob },
  ];
  {
    const m = buildModule(fetchT, post);
    const url = await m.fetchImageData({ fileid: "abc", name: "x.png" });
    check("502→200 retries and succeeds", url != null && url.startsWith("data:image/png;base64,"));
    check("exactly 2 fetch attempts", calls === 2);
    check("mime rewritten from octet-stream to image/png", url.startsWith("data:image/png;base64,iVBOR"));
  }

  // ── 2. 404 fails fast ──
  calls = 0;
  responses = [{ status: 404, blob: null }];
  {
    const m = buildModule(fetchT, post);
    const url = await m.fetchImageData({ fileid: "gone" });
    check("404 → null", url == null);
    check("404 → single fetch (no retry)", calls === 1);
  }

  // ── 3. persistent network failure ──
  calls = 0;
  responses = [{ reject: new Error("ECONNRESET") }, { reject: new Error("ECONNRESET") }, { reject: new Error("ECONNRESET") }];
  {
    const m = buildModule(fetchT, post);
    const url = await m.fetchImageData({ fileid: "flaky" });
    check("3× network error → null", url == null);
    check("exactly 3 attempts", calls === 3);
  }

  // ── 4. non-image bytes (no sniffable magic, no hint) → null ──
  calls = 0;
  const textBlob = {
    size: 16,
    type: "",
    arrayBuffer: () => Promise.resolve(new Uint8Array([104, 101, 108, 108, 111, 32, 119, 111, 114, 108, 100, 33, 33, 33, 33, 33]).buffer),
  };
  responses = [{ status: 200, blob: textBlob }];
  {
    const m = buildModule(fetchT, post);
    const url = await m.fetchImageData({ fileid: "txt" });
    check("non-image bytes → null", url == null);
  }

  // ── 5. flushImageBatch retries a lost POST ──
  postCalls = 0;
  postResponses = [{ reject: new Error("network blip") }, { ok: true, stored: 2 }];
  {
    const m = buildModule(fetchT, post);
    m.setBatch([
      { fileid: "a", data: "data:image/png;base64,iVBORw0KGgo=", name: "a.png" },
      { fileid: "b", data: "data:image/png;base64,iVBORw0KGgo=", name: "b.png" },
    ]);
    await m.flushImageBatch();
    await new Promise((r) => setTimeout(r, 60));
    const c = m.counts();
    check("lost /images POST retried once → stored", postCalls === 2 && c.uploaded === 2 && c.failed === 0);
    check("imgPosted back to 0", c.posted === 0);
  }

  // ── 6. flushImageBatch gives up after 3 ──
  postCalls = 0;
  postResponses = [{ reject: new Error("x") }, { reject: new Error("x") }, { reject: new Error("x") }];
  {
    const m = buildModule(fetchT, post);
    m.setBatch([{ fileid: "a", data: "data:image/png;base64,iVBORw0KGgo=" }]);
    await m.flushImageBatch();
    await new Promise((r) => setTimeout(r, 60));
    const c = m.counts();
    check("3 failed POSTs → counted as failed", postCalls === 3 && c.failed === 1 && c.uploaded === 0);
    check("imgPosted back to 0 after final failure", c.posted === 0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
