/**
 * Browser-side client for fetching CryoSmart images and converting to base64.
 * Used by the bundle builder to pre-fetch images for embedding in HTML reports.
 */

/**
 * Fetch a CryoSmart path via the proxy and return as base64 data URL.
 * Returns null on failure.
 */
export async function imageToBase64(
  session: import("./proxy-client").CryoSmartSession,
  cryosmartPath: string
): Promise<string | null> {
  try {
    const resp = await fetch(
      `/api/cryosmart/${cryosmartPath.replace(/^\/+/, "")}?base=${encodeURIComponent(session.baseUrl)}${
        session.auth ? `&auth=${encodeURIComponent(session.auth)}` : ""
      }${
        session.cookie ? `&cookie=${encodeURIComponent(session.cookie)}` : ""
      }`,
      { credentials: "same-origin" }
    );
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    const mime = resp.headers.get("content-type") || "image/png";
    const base64 = btoa(
      new Uint8Array(buf).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}

/**
 * Pre-fetch all images referenced in the summary and return a map of
 * { remoteUrl → base64DataUrl } for embedding in the HTML report.
 */
export async function prefetchImagesForReport(
  session: import("./proxy-client").CryoSmartSession,
  summary: import("./types").LineageSummary,
  onProgress?: (msg: string) => void
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const urls = new Set<string>();

  // Collect all image URLs from the summary
  for (const node of summary.nodes || []) {
    const uid = node.uid || "J0";

    // From node.images
    for (const img of node.images || []) {
      if (img.url) urls.add(img.url);
    }

    // From representative_micrograph_images
    for (const img of node.representative_micrograph_images || []) {
      if (img.url) urls.add(img.url);
    }

    // From select_2d
    if (node.select_2d) {
      const s = node.select_2d;
      if (s.selected_classes_image) urls.add(s.selected_classes_image);
      if (s.selected_classes_src) urls.add(s.selected_classes_src);
      if (s.selected_particles_image) urls.add(s.selected_particles_image);
      if (s.excluded_classes_image) urls.add(s.excluded_classes_image);
    }

    // From class splits (mrc preview)
    for (const cls of node.classes || []) {
      if (cls.mrc_preview_url) urls.add(cls.mrc_preview_url);
      if (cls.mrc_preview_src) urls.add(cls.mrc_preview_src);
    }

    // From maps (preview URLs)
    for (const m of node.maps || []) {
      if (m.preview_url) urls.add(m.preview_url);
      if (m.preview_src) urls.add(m.preview_src);
    }
  }

  // Also collect from the start job
  const sj = summary.start_job;
  if (sj) {
    for (const img of sj.images || []) {
      if (img.url) urls.add(img.url);
    }
    if (sj.select_2d) {
      const s = sj.select_2d;
      if (s.selected_classes_image) urls.add(s.selected_classes_image);
      if (s.selected_classes_src) urls.add(s.selected_classes_src);
    }
  }

  const urlList = Array.from(urls).filter(Boolean);
  let done = 0;
  for (const url of urlList) {
    onProgress?.(`Embedding image ${done + 1}/${urlList.length}...`);
    const dataUrl = await imageToBase64(session, url);
    if (dataUrl) {
      out[url] = dataUrl;
    }
    done++;
  }

  return out;
}