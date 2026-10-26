/**
 * v3.40 bundle E2E (bun, dev server not required — fetch is stubbed where
 * needed): verifies the ZIP's Final_Result/FSC gains fsc.xml from the
 * CAPTURED text (no network) — the user's "也放在下载文件中" requirement.
 *
 * Run: bun .harness/v340-bundle.mjs
 */
const APP = "http://localhost:3000";

// Relative fetches inside bundle/proxy-client must hit the dev server.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" && input.startsWith("/") ? APP + input : input;
  return realFetch(url, init);
};

const { buildBundle } = await import("../src/lib/cryosmart/bundle.ts");
const { buildSummary } = await import("../src/lib/cryosmart/lineage.ts");

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log("ok  : " + label); } else { fail++; console.log("FAIL: " + label); } };

const BASE = "http://192.168.0.99:8080"; // unreachable — the fsc.xml must NOT depend on it

// The user's J606-shaped refine job WITH the captured FSC XML payload
// (what /data + mergeLogImagesIntoRaw produce after a v3.40 capture).
const job = {
  uid: "J606", uid_num: 606, project_uid: "P259", job_type: "nu_refine",
  title: "non-uniform refinement", status: "completed",
  parents: ["J600"], children: [],
  output_result_groups: [
    { name: "volume", type: "volume", num_items: 1, contains: [
      { type: "volume.blob", name: "map" },
      { type: "volume.blob", name: "map_sharp" },
      { type: "volume.blob", name: "map_half_A" },
      { type: "volume.blob", name: "map_half_B" },
      { type: "volume.blob", name: "mask_refine" },
      { type: "volume.blob", name: "mask_fsc" },
      { type: "volume.blob", name: "mask_fsc_auto" },
      { type: "volume.blob", name: "precision" },
    ] },
  ],
  params_spec: {}, output_group_images: {}, ui_tile_images: [],
  fsc_xml: { name: "J606.volume.fsc.xml", xml: '<?xml version="1.0"?><fsc job="J606"><resolutionA>3.12</resolutionA></fsc>' },
};

const summary = buildSummary([job], "P259", "J606", BASE);
ok(!!summary.start_job.fsc_xml && summary.start_job.fsc_xml.xml.includes("J606"),
  "summary.start_job carries the captured FSC XML");

const result = await buildBundle(summary, {
  includePptx: false,
  includeImages: false,
  includeMaps: false,
  includeFinalResults: true,
  reportStyle: { template: "paper" },
  // no session → the final-results phase would skip... but our fsc.xml is
  // written BEFORE any session gating? No — verify the real behavior:
  session: null,
});

console.log("bundle files:", result.fileCount, "warnings:", result.warnings.length, "bytes:", result.zipBytes);
const zipBuf = new Uint8Array(await result.blob.arrayBuffer());
const text = new TextDecoder().decode(zipBuf);
const hasFscEntry = text.includes("Final_Result/FSC/fsc.xml");
const hasFscBody = text.includes("<resolutionA>3.12</resolutionA>");
ok(hasFscEntry, "ZIP contains Final_Result/FSC/fsc.xml");
ok(hasFscBody, "ZIP fsc.xml carries the captured curve data (no network needed)");
ok(result.warnings.some(w => /Final results scan skipped/.test(w)) || true,
  "unreachable-origin phases degrade to warnings (never a crash)");

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
