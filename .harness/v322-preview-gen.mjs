/**
 * v3.22 preview generator — writes one standalone report HTML per template
 * (all 7 ids) into public/tmp-v322/ so agent-browser can screenshot each
 * skin at desktop + mobile widths without a live CryoSmart session.
 *
 * Images are inline data-URL PNGs, so the reports render fully offline.
 *
 * Run: bun .harness/v322-preview-gen.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildLineageHtmlV2 } from "../src/lib/cryosmart/report-html.ts";
import { REPORT_TEMPLATES } from "../src/lib/cryosmart/report-style.ts";
import { summary } from "./v322-fixture.mjs";

mkdirSync("public/tmp-v322", { recursive: true });
for (const t of REPORT_TEMPLATES) {
  const html = buildLineageHtmlV2(summary, {
    template: t.id,
    fontScale: "standard",
    widthMode: "full",
    imageMode: "embed",
    titleOverride: "",
    subtitle: "v3.22 模板视觉评审 · CryoSmart Lineage Tracer",
  });
  writeFileSync(`public/tmp-v322/${t.id}.html`, html);
  console.log(`wrote public/tmp-v322/${t.id}.html (${(html.length / 1024).toFixed(0)} KB)`);
}
