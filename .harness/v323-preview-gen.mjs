/**
 * v3.23 preview generator — one standalone report HTML per template (7 ids)
 * into public/tmp-v323/ for agent-browser screenshots + VLM design scoring.
 * Run: bun .harness/v323-preview-gen.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildLineageHtmlV2 } from "../src/lib/cryosmart/report-html.ts";
import { REPORT_TEMPLATES } from "../src/lib/cryosmart/report-style.ts";
import { summary } from "./v322-fixture.mjs";

mkdirSync("public/tmp-v323", { recursive: true });
for (const t of REPORT_TEMPLATES) {
  const html = buildLineageHtmlV2(summary, {
    template: t.id,
    fontScale: "standard",
    widthMode: "full",
    imageMode: "embed",
    titleOverride: "",
    subtitle: "v3.23 · 点击任意图片可放大查看（lightbox）",
  });
  writeFileSync(`public/tmp-v323/${t.id}.html`, html);
  console.log(`wrote public/tmp-v323/${t.id}.html (${(html.length / 1024).toFixed(0)} KB)`);
}
