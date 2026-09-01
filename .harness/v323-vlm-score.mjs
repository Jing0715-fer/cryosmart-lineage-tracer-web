/** v3.23 VLM design scoring — scores content + lightbox screenshots per template. */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const templates = ["paper","minimal","slate","blueprint","editorial","focus","classic"];
const views = ["content","lightbox"];
const out = {};
for (const t of templates) {
  out[t] = {};
  for (const v of views) {
    const f = `/home/z/my-project/.harness/v323-${t}-${v}.png`;
    const prompt = v === "content"
      ? `这是冷冻电镜数据谱系报告（模板 ${t}）的网页截图。图中图片为测试占位图（小尺寸渐变色块），请忽略图片内容本身、只评价版式设计。请从专业 UI/UX 设计角度严格评分（1-10，可给小数）：视觉层次/排版体系/留白节奏/配色协调/细节打磨/整体专业度。只输出 JSON（不要其他文字）：{"score":0,"issues":["最多3个最影响观感的问题，每个≤20字"],"strengths":["最多2个优点"]}`
      : `这是报告模板 ${t} 中点击图片后弹出的放大查看器（lightbox）截图。图片为占位图，忽略图片内容。请评价查看器设计：遮罩/按钮/字幕排版/加载指示/与模板风格一致性。只输出 JSON（不要其他文字）：{"score":0,"issues":["最多3个问题，每个≤20字"],"strengths":["最多2个优点"]}`;
    try {
      execSync(`z-ai vision -p ${JSON.stringify(prompt)} -i "${f}" -o /tmp/vlm-v323.json`, { stdio: "pipe", timeout: 120000 });
      const raw = readFileSync("/tmp/vlm-v323.json", "utf8");
      const j = JSON.parse(raw);
      const content = j?.choices?.[0]?.message?.content ?? j?.content ?? raw;
      // r4: robust extraction — VLM sometimes wraps JSON in prose/fences.
      // Try fenced json, then first {...last...}, then a bare score regex.
      const txt = String(content).replace(/```(?:json)?/g, "").trim();
      let parsed = null;
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch (e) {} }
      if (!parsed || typeof parsed.score !== "number") {
        const sm = txt.match(/"score"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
        if (sm) {
          parsed = { score: parseFloat(sm[1]) };
          const im = txt.match(/"issues"\s*:\s*\[([\s\S]*?)\]/);
          if (im) { try { parsed.issues = JSON.parse("[" + im[1] + "]"); } catch (e) {} }
        }
      }
      out[t][v] = parsed || { score: null, raw: txt.slice(0, 300) };
    } catch (e) {
      out[t][v] = { score: null, error: String(e.message).slice(0, 200) };
    }
    console.log(`${t}/${v}: ${JSON.stringify(out[t][v]).slice(0, 220)}`);
  }
}
writeFileSync("/home/z/my-project/.harness/v323-vlm-scores.json", JSON.stringify(out, null, 2));
console.log("\n== scores ==");
for (const t of templates) console.log(t, "content:", out[t].content?.score, "lightbox:", out[t].lightbox?.score);
