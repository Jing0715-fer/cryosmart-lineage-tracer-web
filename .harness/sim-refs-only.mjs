/** Refs-only capture sim: log-image refs with NO byte uploads, then complete. */
const APP = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const createResp = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "PRF",
      cryosmart_origin: "http://localhost:9999",
      source: "sim",
      end_job_uid: "J3",
      lineage_mode: true,
    }),
  });
  const { token } = await createResp.json();
  console.log("TOKEN=" + token);

  const jobs = [];
  for (let i = 1; i <= 3; i++) {
    jobs.push({
      uid: `J${i}`,
      job_type: i === 1 ? "import_micrographs" : "nu_refine",
      status: "completed", project_uid: "PRF",
      title: `job ${i}`, created_at: "2026-08-20T10:00:00Z", completed_at: "2026-08-21T12:00:00Z",
      parents: i === 1 ? [] : [`J${i - 1}`], children: i === 3 ? [] : [`J${i + 1}`],
      input_slot_groups: i === 1 ? [] : [{ name: "particles", type: "particle", title: "particles", connections: [{ job_uid: `J${i - 1}`, group_name: "movies" }] }],
      output_result_groups: [{ name: "volume", type: "volume", title: "volume", contains: [{ type: "volume.blob", name: "map" }] }],
      params_spec: {}, output_group_images: {}, ui_tile_images: [],
    });
  }
  await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "PRF", jobs }),
  });
  console.log("jobs posted");

  // refs ONLY — no bytes uploaded (the user's refs-only capture shape)
  await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [1, 2, 3].map((i) => ({
      uid: `J${i}`, images: [0, 1, 2].map((k) => ({
        fileid: `J${i}_ref_${k}`, name: `img_${k}.png`, text: `log ${k}`, flags: null,
      })),
    })) }),
  });
  console.log("refs-only logs posted (no bytes)");
  await sleep(2000);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  console.log("complete");
}
main().catch((e) => { console.error(e); process.exit(1); });
