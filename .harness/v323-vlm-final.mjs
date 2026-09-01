/** v3.23 FINAL VLM scoring — 3 samples per view, median, stable table. */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const templates = ["paper","minimal","slate","blueprint","editorial","focus","classic"];
const views = ["content","lightbox"];
const median = (a) => { const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };
const out = {};
for (const t of templates) {
  out[t] = {};
  for (const v of views) {
    const f = `/home/z/my-project/.harness/v323-${t}-${v}.png`;
    const prompt = v === "content"
      ? `这是冷冻电镜数据谱系报告（模板 ${t}）的网页截图。图中图片为模拟显微照片占位图，忽略图片内容本身、只评价版式设计。从专业 UI/UX 设计角度严格评分（1-10，可小数）：视觉层次/排版/留白/配色/细节/专业度。只输出 JSON：{"score":0,"issues":["最多3个，每个≤20字"],"strengths":["最多2个"]}`
      : `这是报告模板 ${t} 点击图片后的放大查看器（lightbox）截图。图片为占位图。评价查看器设计：遮罩/按钮/字幕/与模板风格一致性/交互可见性。只输出 JSON：{"score":0,"issues":["最多3个，每个≤20字"],"strengths":["最多2个"]}`;
    const scores = []; let best = null;
    for (let i = 0; i < 3; i++) {
      try {
        execSync(`z-ai vision -p ${JSON.stringify(prompt)} -i "${f}" -o /tmp/vlm-v323.json`, { stdio: "pipe", timeout: 120000 });
        const j = JSON.parse(readFileSync("/tmp/vlm-v323.json", "utf8"));
        const txt = String(j?.choices?.[0]?.message?.content ?? j?.content ?? "").replace(/```(?:json)?/g, "").trim();
        let parsed = null;
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch (e) {} }
        if (!parsed || typeof parsed.score !== "number") {
          const sm = txt.match(/"score"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
          if (sm) parsed = { score: parseFloat(sm[1]) };
        }
        if (parsed && typeof parsed.score === "number") { scores.push(parsed.score); if (!best || parsed.score === median(scores)) best = parsed; }
      } catch (e) { /* sample failed */ }
    }
    out[t][v] = { median: scores.length ? median(scores) : null, samples: scores, detail: best };
    console.log(`${t}/${v}: median=${out[t][v].median} samples=[${scores}]`);
  }
}
writeFileSync(".harness/v323-vlm-final.json", JSON.stringify(out, null, 2));
const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
const cs = [], ls = [];
console.log("\n=== final VLM table (median of 3) ===");
for (const t of templates) {
  if (out[t].content.median != null) cs.push(out[t].content.median);
  if (out[t].lightbox.median != null) ls.push(out[t].lightbox.median);
  console.log(`${t.padEnd(10)} content ${String(out[t].content.median).padStart(4)}  lightbox ${String(out[t].lightbox.median).padStart(4)}`);
}
console.log(`content avg ${avg(cs)} · lightbox avg ${avg(ls)}`);
