#!/usr/bin/env node
/**
 * v3.26 — Browser E2E prep: stages a LIVE lineage-scoped session the app can
 * attach to via /?imported=<token>:
 *   - 6 jobs (2 traced: J4/J5 with log-image refs+bytes; 4 untraced)
 *   - log_request = [J4, J5] (partial → the "Fetch all 6 jobs" button shows)
 *   - 3 refs stored, 2 with bytes (1 missing → the explanatory summary's
 *     "no preview bytes" clause fires), 1 of the 2 traced jobs with images
 * Prints the token + a follow-up script call (fetch-all + complete) for the
 * E2E to invoke BETWEEN snapshots.
 */
const BASE = "http://localhost:3000";
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
      project_uid: "P326E2E",
      cryosmart_origin: "http://cryosmart.invalid",
      lineage_mode: true,
      source: "v326 browser e2e",
      end_job_uid: "J5",
    });
    const token = sess.token;
    const jobs = [1, 2, 3, 4, 5, 6].map((i) => ({
      uid: `J${i}`,
      job_type: i >= 4 ? "relion_refine" : "import_movies",
      status: "SUCCEEDED",
      project_uid: "P326E2E",
      start_time: 1700000000 + i * 60,
      end_time: 1700000000 + i * 60 + 30,
    }));
    await post(`/api/cryosmart/import/session/${token}/jobs`, { jobs });
    // partial request: the traced lineage is J4 + J5
    await post(`/api/cryosmart/import/session/${token}/request-logs`, {
      jobs: ["J4", "J5"],
    });
    // log batches: J4 gets 2 refs, J5 gets 1 ref (withLogs = 2 jobs)
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
    // bytes for 2 of the 3 (IMG-B stays ref-only → "1 image without preview bytes")
    await post(`/api/cryosmart/import/session/${token}/images`, {
      items: [
        { fileid: "IMG-A", data: PNG_1PX },
        { fileid: "IMG-C", data: PNG_1PX },
      ],
    });
    console.log(token);
  } else if (mode === "complete") {
    // fetch-all first, then complete — the E2E clicks the button in between
    // but for the deterministic tail we drive both via API.
    const token = process.argv[3];
    await post(`/api/cryosmart/import/session/${token}/request-logs`, { all: true });
    await post(`/api/cryosmart/import/session/${token}/complete`, {});
    console.log("completed", token);
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
