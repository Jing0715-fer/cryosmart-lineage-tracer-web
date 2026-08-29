/**
 * v3.17 browser-E2E helper — fake CryoSmart upstream daemon (port 3999).
 * Serves each map as a CHUNKED stream (8 × 32KB, 150ms apart ≈ 1.2s/map)
 * so the browser-driven build (a) visibly shows the new
 * "N in flight · M MB received" liveness line mid-download and (b) lasts
 * long enough in the maps phase to click the new Stop button.
 *
 * Run: bun .harness/v317-browser-daemon.mjs > /tmp/v317-upstream.log 2>&1 &
 */
let arrivals = 0;

Bun.serve({
  port: 3999,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/favicon.ico") return new Response("ok");
    if (u.pathname.startsWith("/api/log_image/download_result_file/")) {
      const name = u.pathname.split("/").pop();
      const n = ++arrivals;
      console.log(`[${Date.now()}] arrival ${n} ${name}`);
      const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
      const body = new Uint8Array(256 * 1024);
      for (let k = 0; k < body.length; k++) body[k] = (k * 7 + seed) & 0xff;
      return new Response(
        new ReadableStream({
          async start(ctrl) {
            const CH = 32 * 1024;
            for (let off = 0; off < body.length; off += CH) {
              ctrl.enqueue(body.subarray(off, off + CH));
              await new Promise((r) => setTimeout(r, 150));
            }
            ctrl.close();
            console.log(`[${Date.now()}] done ${n} ${name}`);
          },
        }),
        { headers: { "content-type": "application/octet-stream" } }
      );
    }
    return new Response(JSON.stringify({ detail: "Not Found" }), {
      status: 404, headers: { "content-type": "application/json" },
    });
  },
});
console.log(`[${Date.now()}] v317 chunked fake upstream on :3999`);
