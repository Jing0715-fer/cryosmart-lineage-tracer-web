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
      ? `这是冷冻电镜数据谱系报告（模板 ${t}）的网页截图。图中图片为模拟显微照片占位图，忽略图片内容本身、只评价版式设计。从专业 UI/UX 设计角度严格评分（1-10，可小数）。只输出 JSON：{"score":0,"issues":["最多3个，每个≤20字"],"strengths":["最多2个"]}`
      : `这是报告模板 ${t} 点击图片后的放大查看器截图。图片为占位图。评价查看器设计：遮罩/按钮/字幕/风格一致性/交互可见性。只输出 JSON：{"score":0,"issues":["最多3个，每个≤20字"],"strengths":["最多2个"]}`;
    let score = null, issues = [];
    try {
      execSync(`z-ai vision -p ${JSON.stringify(prompt)} -i "${f}" -o /tmp/vlm-f.json`, { stdio: "pipe", timeout: 150000 });
      const j = JSON.parse(readFileSync("/tmp/vlm-f.json", "utf8"));
      const txt = String(j?.choices?.[0]?.message?.content ?? "").replace(/```(?:json)?/g, "").trim();
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) { try { const p = JSON.parse(m[0]); if (typeof p.score === "number") { score = p.score; issues = p.issues || []; } } catch (e) {} }
      if (score === null) { const sm = txt.match(/"score"\s*:\s*([0-9]+(?:\.[0-9]+)?)/); if (sm) score = parseFloat(sm[1]); }
    } catch (e) { /* rate limit etc */ }
    out[t][v] = { score, issues };
    console.log(`${t}/${v}: ${score}${score === null ? " (failed)" : ""}${issues.length ? " " + issues[0] : ""}`);
    execSync("sleep 12");
  }
}
writeFileSync(".harness/v323-vlm-final2.json", JSON.stringify(out, null, 2));
