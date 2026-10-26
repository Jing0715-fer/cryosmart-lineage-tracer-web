/** v3.40 E2E sim: staged capture WITH the FSC-XML payload (as the v3.40
 *  capture script streams it), then verification of the /data shape. */
const APP = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const createResp = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "PVF",
      cryosmart_origin: "http://localhost:9999",
      source: "sim",
      end_job_uid: "J3",
      lineage_mode: true,
    }),
  });
  const { token } = await createResp.json();
  console.log("TOKEN=" + token);

  const volumeContains = [
    { type: "volume.blob", name: "map" },
    { type: "volume.blob", name: "map_sharp" },
    { type: "volume.blob", name: "map_half_A" },
    { type: "volume.blob", name: "map_half_B" },
    { type: "volume.blob", name: "mask_refine" },
    { type: "volume.blob", name: "mask_fsc" },
    { type: "volume.blob", name: "mask_fsc_auto" },
    { type: "volume.blob", name: "precision" },
  ];
  const jobs = [];
  for (let i = 1; i <= 3; i++) {
    jobs.push({
      uid: `J${i}`,
      job_type: i === 1 ? "import_micrographs" : "nu_refine",
      status: "completed", project_uid: "PVF",
      title: `job ${i}`, created_at: "2026-08-20T10:00:00Z", completed_at: "2026-08-21T12:00:00Z",
      parents: i === 1 ? [] : [`J${i - 1}`], children: i === 3 ? [] : [`J${i + 1}`],
      input_slot_groups: i === 1 ? [] : [{ name: "particles", type: "particle", title: "particles", connections: [{ job_uid: `J${i - 1}`, group_name: "movies" }] }],
      output_result_groups: i === 1
        ? [{ name: "movies", type: "exposure", title: "movies", contains: [] }]
        : [
            { name: "volume", type: "volume", title: "volume", num_items: 1, contains: volumeContains },
            { name: "mask", type: "mask", title: "mask", num_items: 1, contains: [{ type: "mask.blob", name: "mask_refine" }] },
          ],
      params_spec: {}, output_group_images: i === 1 ? {} : { volume: `J${i}_vol.png` }, ui_tile_images: [],
    });
  }
  await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "PVF", jobs }),
  });
  console.log("jobs posted (J2/J3 = user's J606 shape)");

  // /logs with image refs AND the FSC-XML payload (what the v3.40 script
  // sends after probing download_result_file/<pid>/<uid>.volume.fsc.xml).
  await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [1, 2, 3].map((i) => ({
      uid: `J${i}`,
      images: i === 1 ? [] : [0, 1].map((k) => ({
        fileid: `J${i}_ref_${k}`, name: `img_${k}.png`, text: `log ${k}`, flags: null,
      })),
      fsc_xml: i === 1 ? undefined : {
        name: `J${i}.volume.fsc.xml`,
        xml: `<?xml version="1.0"?><fsc job="J${i}"><resolution>3.1</resolution></fsc>`,
      },
    })) }),
  });
  console.log("logs posted with fsc_xml payloads");

  await sleep(800);

  // /data must carry job_fsc_xml.
  const dataResp = await fetch(`${APP}/api/cryosmart/import/session/${token}/data`);
  const data = await dataResp.json();
  const fsc = data.data.job_fsc_xml || {};
  const okShape =
    fsc.J2 && typeof fsc.J2.xml === "string" && fsc.J2.xml.includes("J2") &&
    fsc.J3 && fsc.J3.xml.includes("J3") && !fsc.J1;
  console.log("data job_fsc_xml shape:", okShape ? "OK" : JSON.stringify(fsc));

  await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  console.log("complete");
  console.log("SIM-DONE token=" + token);
}
main().catch((e) => { console.error(e); process.exit(1); });
