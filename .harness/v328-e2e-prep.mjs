#!/usr/bin/env node
/**
 * v3.28 — Browser E2E prep: stages a LIVE lineage-scoped session whose
 * shape mirrors the user's "missing log images" report:
 *   - 6 jobs; traced lineage J4/J5 (log-image refs + bytes)
 *   - J1/J2/J3: NO log refs ever streamed (the "31 of 72 never ran"
 *     shape) but their ui_tile_images / output_group_images bytes ride
 *     the capture pipeline (queueJobAssets) → the report's v3.28
 *     OUTPUT-GROUP FALLBACK must render their previews.
 *   - J6: nothing at all (renders no media, no fallback).
 * Prints the token; "complete" mode widens the request ({all:true}) and
 * completes, so the final summary fires with the fallback wording.
 */
const BASE = "http://localhost:3000";
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_1PX_B =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const post = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return r.json();
};

const main = async () => {
  const mode = process.argv[2] || "stage";
  if (mode === "stage") {
    const sess = await post("/api/cryosmart/import/session", {
      project_uid: "P328E2E",
      cryosmart_origin: "http://cryosmart.invalid",
      lineage_mode: true,
      source: "v328 browser e2e",
      end_job_uid: "J5",
    });
    const token = sess.token;
    const jobs = [1, 2, 3, 4, 5, 6].map((i) => ({
      uid: `J${i}`,
      job_type: i >= 4 ? "relion_refine" : i === 1 ? "motion_correction" : i === 2 ? "ctf_refine" : "import_movies",
      status: "SUCCEEDED",
      project_uid: "P328E2E",
      start_time: 1700000000 + i * 60,
      end_time: 1700000000 + i * 60 + 30,
      // upstream chain J1→J2→J3→J4→J5 (J6 unconnected — rest-pass only):
      // the auto-trace from J5 then covers every fallback fixture job.
      ...(i >= 2 && i <= 5 ? { parents: [`J${i - 1}`] } : {}),
      // v3.12 shape: tiles + map previews ride the JOBS payload as fileids;
      // the capture script uploads their bytes through the SAME pipeline.
      ...(i >= 1 && i <= 3
        ? {
            ui_tile_images: [{ name: `J${i}_tile`, fileid: `TILE-${i}` }],
            output_group_images: { volume_main: `OG-${i}` },
          }
        : {}),
    }));
    await post(`/api/cryosmart/import/session/${token}/jobs`, { jobs });
    await post(`/api/cryosmart/import/session/${token}/request-logs`, {
      jobs: ["J4", "J5"],
    });
    await post(`/api/cryosmart/import/session/${token}/logs`, {
      items: [
        { uid: "J4", images: [
          { fileid: "IMG-A", name: "J4 volume png" },
          { fileid: "IMG-B", name: "J4 fsc png" },
        ] },
        { uid: "J5", images: [{ fileid: "IMG-C", name: "J5 volume png" }] },
        { uid: "J6", images: [] },
      ],
    });
    // bytes: log images for J4/J5 + the fallback previews for J1/J2/J3
    await post(`/api/cryosmart/import/session/${token}/images`, {
      items: [
        { fileid: "IMG-A", data: PNG_1PX },
        { fileid: "IMG-B", data: PNG_1PX_B },
        { fileid: "IMG-C", data: PNG_1PX },
        { fileid: "TILE-1", data: PNG_1PX, name: "J1_tile" },
        { fileid: "TILE-2", data: PNG_1PX_B, name: "J2_tile" },
        { fileid: "TILE-3", data: PNG_1PX, name: "J3_tile" },
        { fileid: "OG-1", data: PNG_1PX_B, name: "volume_main" },
        { fileid: "OG-2", data: PNG_1PX, name: "volume_main" },
        { fileid: "OG-3", data: PNG_1PX_B, name: "volume_main" },
      ],
    });
    console.log(token);
  } else if (mode === "complete") {
    const token = process.argv[3];
    await post(`/api/cryosmart/import/session/${token}/request-logs`, { all: true });
    await post(`/api/cryosmart/import/session/${token}/complete`, {});
    console.log("completed", token);
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
