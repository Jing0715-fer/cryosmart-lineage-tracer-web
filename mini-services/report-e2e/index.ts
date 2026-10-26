/**
 * report-e2e — verification mini-service for the report's 一键下载 rework
 * (multi-download browser blocking fix, v3.43).
 *
 * Routes:
 *   GET /         → a standalone report page embedding the REAL shipped
 *                   REPORT_HTML_V2_SCRIPT (imported straight from
 *                   src/lib/cryosmart/report-html.ts) with a download-all
 *                   button carrying: 2 data: map payloads + 1 data: FSC XML
 *                   (all fetchable → must pack ONE zip) and 1 dead http
 *                   URL with no proxied twin (must surface in the per-file
 *                   click-to-download retry row).
 *   GET /ziptest  → runs the shipped __csZipStore in-process on mixed
 *                   payloads (8 MB binary, 300 KB binary, text, empty,
 *                   UTF-8 filename) and writes /tmp/ziptest/out.zip +
 *                   expected payloads for verify_zip.py (python zipfile).
 */
import { _REPORT_HTML_V2_SCRIPT } from "../../src/lib/cryosmart/report-html";

const PORT = 3021;

/* ------------------------------------------------------------------ */
/*  /ziptest — byte-level verification of the shipped zip writer      */
/* ------------------------------------------------------------------ */
let zipStoreFn: ((files: unknown[], onProgress?: (n: number) => void) => Promise<Blob>) | null =
  null;

function ensureZipStore() {
  if (zipStoreFn) return zipStoreFn;
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = {
    addEventListener: () => {},
    createElement: () => {
      throw new Error("createElement should not run here");
    },
    body: {},
    documentElement: {},
  };
  g.window = { addEventListener: () => {}, alert: () => {} };
  (0, eval)(_REPORT_HTML_V2_SCRIPT);
  const fn = (globalThis as unknown as { __csZipStore?: unknown }).__csZipStore;
  if (typeof fn !== "function") throw new Error("__csZipStore not defined after eval");
  zipStoreFn = fn as typeof zipStoreFn;
  return zipStoreFn;
}

function pattern(n: number, seed: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (seed + i * 7 + (i >>> 8) * 13) & 0xff;
  return b;
}

async function runZipTest(): Promise<Record<string, unknown>> {
  const zipStore = ensureZipStore();
  const big = new Blob([pattern(8 * 1024 * 1024, 3)]); // 8 MB binary
  const mid = new Blob([pattern(300 * 1024, 9)]); // 300 KB binary
  const txt = new Blob(["hello zip\nline2\n"]);
  const empty = new Blob([]);
  let progressCalls = 0;
  const zip = await zipStore(
    [
      { name: "dir/J606.volume.map", blob: big },
      { name: "J606.fsc.xml", blob: txt },
      { name: "\u62a5\u544a_\u6d4b\u8bd5.bin", blob: mid }, // UTF-8 name: 报告_测试.bin
      { name: "empty.txt", blob: empty },
    ],
    () => {
      progressCalls++;
    },
  );
  await Bun.write("/tmp/ziptest/out.zip", zip);
  await Bun.write("/tmp/ziptest/expected_big.bin", big);
  await Bun.write("/tmp/ziptest/expected_mid.bin", mid);
  return {
    zip_bytes: zip.size,
    progress_callbacks: progressCalls,
    expected_entries: 4,
    ok: true,
  };
}

/* ------------------------------------------------------------------ */
/*  / — standalone report page with the REAL embedded script           */
/* ------------------------------------------------------------------ */
function dataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

const mapA = dataUrl(pattern(180 * 1024, 21), "application/octet-stream");
const mapB = dataUrl(pattern(90 * 1024, 57), "application/octet-stream");
const fscXml = dataUrl(Buffer.from("<FSC><curve><point r=\"0.1\" c=\"0.99\"/></curve></FSC>"), "text/xml");

const pageHtml = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>v3.43 download-all E2E</title>
<style>
  body{font-family:system-ui,sans-serif;padding:24px;background:#fff;color:#111;margin:0}
  .download-head{border:1px solid #ddd;border-radius:8px;padding:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .download-all{border:1px solid #b35612;background:#b35612;color:#fff;border-radius:6px;padding:8px 16px;cursor:pointer}
  .download-all:disabled{opacity:.6;cursor:wait}
  .map-dl{display:inline-block;padding:6px 12px;border:1px solid #b35612;border-radius:6px;color:#b35612;text-decoration:none;margin:2px}
</style></head>
<body><main>
  <h1>一键下载 v3.43 E2E</h1>
  <p>预期：点击按钮 → 抓取 2 个 data: map + 1 个 data: FSC XML → 打包成 1 个 zip 单次下载（浏览器不再拦截）；无法 fetch 的 mask_refine（http 无代理）出现在“逐个点击下载”重试行。</p>
  <div class="download-head"><b>map: 3 个 + FSC XML</b>
    <button type="button" class="download-all" data-zipname="BJ.P999.J606.maps.zip"
      data-urls="${mapA}|${mapB}|http://127.0.0.1:1/x/J606.volume.mask_refine|${fscXml}"
      data-purls="|||"
      data-names="BJ.P999.J606.volume.map.mrc|BJ.P999.J606.volume.map_sharp.mrc|BJ.P999.J606.volume.mask_refine.mrc|BJ.P999.J606.fsc.xml">一键下载 map + FSC XML</button>
  </div>
</main>
<script>${_REPORT_HTML_V2_SCRIPT}</script>
</body></html>`;

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/ziptest") {
      return runZipTest().then(
        (json) => new Response(JSON.stringify(json), { headers: { "content-type": "application/json" } }),
        (err) => new Response(String(err), { status: 500 }),
      );
    }
    return new Response(pageHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
console.log(`report-e2e listening on http://localhost:${server.port} (/ and /ziptest)`);
