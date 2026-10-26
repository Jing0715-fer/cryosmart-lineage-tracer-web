/**
 * v3.40 unit tests (bun): the 5-map set + FSC-curve XML.
 *
 *  1. normalMapAssets — mask_refine IN, precision OUT, mask_fsc/auto OUT.
 *  2. fscXmlAsset — captured text → data: URL; bare fileid → log_image URL;
 *     raw image_logs ref → log_image URL; constructed fallback for
 *     map-producing jobs; null for non-map jobs.
 *  3. jobNode carries fsc_xml; reportMapDownloads renders 5 maps + the XML
 *     in the one-click set (data-urls / data-names / zipname / label).
 *  4. The inline download script's single-file fallback uses the SUCCEEDED
 *     file's own url (files[0].url), not urls[0].
 */
import { normalMapAssets, fscXmlAsset, jobNode } from "../src/lib/cryosmart/lineage";
import { reportMapDownloads, _REPORT_HTML_V2_SCRIPT } from "../src/lib/cryosmart/report-html";
import type { JobMetadata, LineageSummary, MapAsset } from "../src/lib/cryosmart/types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log("ok  : " + label); }
  else { fail++; console.log("FAIL: " + label); }
}

const BASE = "http://cryo.test:8080";
const PID = "P259";

/** The user's J606-shaped refine job (8 volume results + mask group). */
function refineJob(overrides: Partial<JobMetadata> = {}): JobMetadata {
  return {
    uid: "J606",
    uid_num: 606,
    project_uid: PID,
    job_type: "nu_refine",
    title: "non-uniform refinement",
    status: "completed",
    parents: ["J600"],
    children: [],
    output_result_groups: [
      {
        name: "volume",
        type: "volume",
        title: "volume",
        num_items: 1,
        contains: [
          { type: "volume.blob", name: "map" },
          { type: "volume.blob", name: "map_sharp" },
          { type: "volume.blob", name: "map_half_A" },
          { type: "volume.blob", name: "map_half_B" },
          { type: "volume.blob", name: "mask_refine" },
          { type: "volume.blob", name: "mask_fsc" },
          { type: "volume.blob", name: "mask_fsc_auto" },
          { type: "volume.blob", name: "precision" },
        ],
      },
      {
        name: "mask",
        type: "mask",
        title: "mask",
        num_items: 1,
        contains: [{ type: "mask.blob", name: "mask_refine" }],
      },
    ],
    ...overrides,
  } as JobMetadata;
}

function mapOf(group: string, result: string, groupType: string): MapAsset {
  return {
    group,
    group_title: group,
    group_type: groupType,
    result_name: result,
    download_url: `http://cryo.test:8080/api/log_image/download_result_file/${PID}/J606.${group}.${result}`,
    preview_url: "http://cryo.test:8080/api/log_image/pvol1",
    preview_src: "http://cryo.test:8080/api/log_image/pvol1",
    preview_original_url: "http://cryo.test:8080/api/log_image/pvol1",
  };
}

// ── 1. normalMapAssets ────────────────────────────────────────────────
{
  const node = {
    maps: [
      mapOf("volume", "map", "volume"),
      mapOf("volume", "map_sharp", "volume"),
      mapOf("volume", "map_half_A", "volume"),
      mapOf("volume", "map_half_B", "volume"),
      mapOf("volume", "mask_refine", "volume"),
      mapOf("volume", "mask_fsc", "volume"),
      mapOf("volume", "mask_fsc_auto", "volume"),
      mapOf("volume", "precision", "volume"),
      mapOf("mask", "mask_refine", "mask"),
    ],
  };
  const got = normalMapAssets(node).map((m) => `${m.group}.${m.result_name}`);
  ok(
    got.join(",") ===
      "volume.map,volume.map_sharp,volume.map_half_A,volume.map_half_B,volume.mask_refine,mask.mask_refine",
    `normalMapAssets = the 5-map set (+ mask-group twin): ${got.join(",")}`
  );
  ok(!got.some((g) => /precision/.test(g)), "precision EXCLUDED from the report set");
  ok(!got.some((g) => /mask_fsc($|_auto)/.test(g)), "mask_fsc / mask_fsc_auto stay excluded");
}

// ── 2. fscXmlAsset priority chain ─────────────────────────────────────
{
  // (a) captured TEXT → data: URL + raw xml carried for the ZIP.
  const a = fscXmlAsset(refineJob({ fsc_xml: { xml: "<?xml version=\"1.0\"?><fsc><r>3.1</r></fsc>" } }), BASE, PID);
  ok(!!a && a.source === "captured", "captured xml → source 'captured'");
  ok(!!a && a.url.startsWith("data:text/xml;charset=utf-8,"), "captured xml → data: URL");
  ok(!!a && a.xml === "<?xml version=\"1.0\"?><fsc><r>3.1</r></fsc>", "captured xml text carried for the ZIP");
  ok(!!a && a.name === "BJ.P259.J606.volume.fsc.xml", `download name convention: ${a?.name}`);

  // (b) captured bare fileid → direct log_image URL.
  const b = fscXmlAsset(refineJob({ fsc_xml: { fileid: "fsc_1_FSC.xml", name: "fsc.xml" } }), BASE, PID);
  ok(!!b && b.url === `${BASE}/api/log_image/fsc_1_FSC.xml`, `bare fileid → log_image URL: ${b?.url}`);
  ok(!!b && !b.xml, "bare fileid → no embedded text");

  // (c) raw image_logs FSC XML ref (JSON-upload mode).
  const c = fscXmlAsset(
    refineJob({
      image_logs: [
        {
          _id: "l1",
          type: "image",
          text: "FSC Iteration 003",
          flags: ["fsc"],
          imgfiles: [
            { fileid: "fsc_1_FSC.png", filename: "FSC_Iteration_003.png", filetype: "image/png" },
            { fileid: "fsc_1_FSC.xml", filename: "FSC_Iteration_003.xml", filetype: "text/xml" },
          ],
        } as never,
      ],
    }),
    BASE,
    PID
  );
  ok(!!c && c.source === "log_ref" && c.url === `${BASE}/api/log_image/fsc_1_FSC.xml`, "raw image_logs xml ref → log_ref URL");

  // (d) constructed fallback for map-producing jobs (old captures).
  const d = fscXmlAsset(refineJob(), BASE, PID);
  ok(
    !!d && d.source === "constructed" &&
      d.url === `${BASE}/api/log_image/download_result_file/${PID}/J606.volume.fsc.xml`,
    `constructed fallback: ${d?.url}`
  );

  // (e) non-map job → null.
  const e = fscXmlAsset(
    {
      uid: "J1",
      project_uid: PID,
      job_type: "import_micrographs",
      output_result_groups: [{ name: "movies", type: "exposure", contains: [] }],
    } as JobMetadata,
    BASE,
    PID
  );
  ok(e === null, "non-map job → no FSC XML entry");
}

// ── 3. jobNode + reportMapDownloads ───────────────────────────────────
{
  const node = jobNode(refineJob({ fsc_xml: { xml: "<fsc/>" } }), BASE, PID);
  ok(!!node.fsc_xml && node.fsc_xml.url.startsWith("data:text/xml"), "jobNode builds fsc_xml from the captured payload");

  const summary = {
    project_uid: PID,
    start_uid: "J606",
    base_url: BASE,
  } as unknown as LineageSummary;

  const html = reportMapDownloads(node, summary);
  const urls = (html.match(/data-urls="([^"]*)"/) || [])[1] || "";
  const names = (html.match(/data-names="([^"]*)"/) || [])[1] || "";
  const urlList = urls.split("|");
  const nameList = names.split("|");
  ok(urlList.length === 6, `one-click set has 6 entries (5 maps + 1 xml): ${urlList.length}`);
  ok(nameList.filter((n) => /\.mrc$/.test(n)).length === 5, "5 .mrc names in the set");
  ok(
    nameList.includes("BJ.P259.J606.volume.mask_refine.mrc"),
    "mask_refine is in the one-click set"
  );
  ok(
    !nameList.some((n) => /precision/.test(n)),
    "precision is NOT in the one-click set"
  );
  ok(
    nameList.includes("BJ.P259.J606.volume.fsc.xml"),
    "the FSC XML is the 6th entry"
  );
  ok(urlList[5].startsWith("data:text/xml"), "the XML entry is a self-contained data: URL");
  ok(/一键下载 map \+ FSC XML/.test(html), "button label names the XML");
  ok(/mask_refine/.test(html), "map count line mentions mask_refine");
  ok(/maps\.zip/.test(html), "the button has its own zip name");
  ok(/FSC XML/.test(html) && /map-dl/.test(html), "standalone FSC XML chip present");

  // no fsc captured → 5 maps only, old label.
  const node2 = jobNode(refineJob(), BASE, PID);
  node2.fsc_xml = { name: "x", url: `${BASE}/api/log_image/download_result_file/${PID}/J606.volume.fsc.xml`, source: "constructed" };
  const html2 = reportMapDownloads(node2, summary);
  const urls2 = ((html2.match(/data-urls="([^"]*)"/) || [])[1] || "").split("|");
  ok(urls2.length === 6 && /volume\.fsc\.xml/.test(urls2[5]), "constructed URL still rides the button for old captures");
}

// ── 4. inline script single-file fallback ─────────────────────────────
{
  ok(
    /triggerSingle\(files\[0\]\.url,files\[0\]\.name\)/.test(_REPORT_HTML_V2_SCRIPT),
    "single-file fallback downloads the SUCCEEDED file (files[0].url), not urls[0]"
  );
  ok(
    /return \{name:nameOf\(url,i\),data:blob,url:url\}/.test(_REPORT_HTML_V2_SCRIPT),
    "zip parts carry their own url"
  );
}

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
