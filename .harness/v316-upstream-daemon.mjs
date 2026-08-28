/**
 * v3.16 browser-E2E helper — fake CryoSmart upstream daemon (port 3999).
 * Logs every map request arrival/completion so concurrency can be
 * analyzed from the log after the browser-driven ZIP build.
 *
 * Run: bun .harness/v316-upstream-daemon.mjs > /tmp/v316-upstream.log 2>&1 &
 */
const MAP_DELAY_MS = 120;
let inFlight = 0, maxInFlight = 0, arrivals = 0;

Bun.serve({
  port: 3999,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/favicon.ico") {
      console.log(`[${Date.now()}] probe favicon`);
      return new Response("ok");
    }
    if (u.pathname.startsWith("/api/log_image/download_result_file/")) {
      const name = u.pathname.split("/").pop();
      const n = ++arrivals;
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      console.log(`[${Date.now()}] arrival ${n} ${name} inFlight=${inFlight} max=${maxInFlight}`);
      await new Promise((r) => setTimeout(r, MAP_DELAY_MS));
      inFlight--;
      console.log(`[${Date.now()}] done ${n} ${name}`);
      const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
      const bytes = new Uint8Array(64 * 1024);
      for (let k = 0; k < bytes.length; k++) bytes[k] = (k * 7 + seed) & 0xff;
      return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
    }
    return new Response(JSON.stringify({ detail: "Not Found" }), {
      status: 404, headers: { "content-type": "application/json" },
    });
  },
});
console.log(`[${Date.now()}] fake upstream on :3999`);
