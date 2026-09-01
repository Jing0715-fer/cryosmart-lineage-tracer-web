#!/usr/bin/env node
/**
 * v3.29 — Browser E2E prep: stages a LIVE lineage-scoped session whose
 * shape mirrors the user's exact report:
 *   - 593 jobs captured; traced lineage = J2..J6 (the "72 of 592" subset);
 *   - the script is mid-CALIBRATION: phase POSTs report "calibrating on
 *     J4 — action 'getJobDetail' arg shape 2/6…" while log_jobs_done
 *     stays 0 (the strip previously read "0/72 · 0% · fetching…" and
 *     looked frozen for 30–120s).
 * Modes:
 *   stage    → session + 593 jobs + 5-job trace request + a CALIBRATING
 *              phase POST (nothing scanned yet — the user's screenshot).
 *   scan     → a SCAN phase POST ("scanning 1/5 · J4 (relion_refine)")
 *              + the first /logs batch (1/5 done) — live mid-scan look.
 *   drain    → phase 'drain' + more batches → 5/5 done, bytes uploading.
 *   complete → {all:true} widening + the rest-pass batches + /complete.
 * Prints the token.
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
  const token = process.argv[3];

  if (mode === "stage") {
    const sess = await post("/api/cryosmart/import/session", {
      project_uid: "P329E2E",
      cryosmart_origin: "http://cryosmart.invalid",
      lineage_mode: true,
      source: "v329 browser e2e",
      end_job_uid: "J6",
    });
    const t = sess.token;
    // 593 jobs — the user's real project size (the trace covers 5 of them;
    // the "0/72"-style subset in miniature).
    const jobs = [];
    for (let i = 1; i <= 593; i++) {
      jobs.push({
        uid: i <= 6 ? `J${i}` : `K${i}`,
        job_type: i <= 6 ? "relion_refine" : "import_movies",
        status: "SUCCEEDED",
        project_uid: "P329E2E",
        ...(i >= 2 && i <= 6 ? { parents: [`J${i - 1}`] } : {}),
      });
    }
    await post(`/api/cryosmart/import/session/${t}/jobs`, { jobs });
    // the app's auto-trace publishes the 5-job lineage request
    await post(`/api/cryosmart/import/session/${t}/request-logs`, {
      jobs: ["J2", "J3", "J4", "J5", "J6"],
    });
    // THE USER'S SCREENSHOT STATE: script deep in loader calibration,
    // zero jobs scanned, a live phase POST explaining what is running.
    await post(`/api/cryosmart/import/session/${t}/phase`, {
      phase: "calibrating",
      detail: 'calibrating on J4 — action "getJobDetail" arg shape 2/6…',
    });
    console.log(t);
    return;
  }

  if (!token) { console.error("token required"); process.exit(1); }

  if (mode === "scan") {
    await post(`/api/cryosmart/import/session/${token}/phase`, {
      phase: "scan",
      detail: "scanning 1/5 · J4 (relion_refine)",
    });
    await post(`/api/cryosmart/import/session/${token}/logs`, {
      items: [
        { uid: "J2", images: [{ fileid: "IMG-A", name: "J2 volume png" }] },
        { uid: "J3", images: [] },
      ],
    });
    console.log("scan phase + 2/5 done");
  } else if (mode === "drain") {
    await post(`/api/cryosmart/import/session/${token}/phase`, {
      phase: "scan",
      detail: "scanning 4/5 · J6 (relion_refine) — logs are slow to arrive, waiting up to 20s…",
    });
    await post(`/api/cryosmart/import/session/${token}/logs`, {
      items: [
        { uid: "J4", images: [{ fileid: "IMG-B", name: "J4 fsc png" }] },
        { uid: "J5", images: [] },
      ],
    });
    await post(`/api/cryosmart/import/session/${token}/images`, {
      items: [{ fileid: "IMG-A", data: PNG_1PX }, { fileid: "IMG-B", data: PNG_1PX_B }],
    });
    await post(`/api/cryosmart/import/session/${token}/phase`, {
      phase: "drain",
      detail: "uploading image preview bytes — 2 ok · 0 in flight…",
    });
    console.log("drain phase + 4/5 done + bytes");
  } else if (mode === "complete") {
    await post(`/api/cryosmart/import/session/${token}/request-logs`, { all: true });
    await post(`/api/cryosmart/import/session/${token}/logs`, {
      items: [
        { uid: "J6", images: [{ fileid: "IMG-C", name: "J6 volume png" }] },
      ],
    });
    await post(`/api/cryosmart/import/session/${token}/images`, {
      items: [{ fileid: "IMG-C", data: PNG_1PX }],
    });
    await post(`/api/cryosmart/import/session/${token}/complete`, {});
    console.log("complete");
  }
};

main();
