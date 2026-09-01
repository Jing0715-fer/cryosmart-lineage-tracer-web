import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const templates = ["paper","minimal","slate","blueprint","editorial","focus","classic"];
const out = {};
for (const t of templates) {
  const f = `/home/z/my-project/.harness/v323-${t}-lightbox.png`;
  const prompt = `这是报告模板 ${t} 点击图片后的放大查看器截图。放大的是一张模拟冷冻电镜显微照片（深色噪声图，图片内容本身正常，忽略图片内容）。评价查看器设计：遮罩/画框/按钮/字幕栏/风格一致性。只输出 JSON：{"score":0,"issues":["最多3个，每个≤20字"],"strengths":["最多2个"]}`;
  let score = null, issues = [];
  try {
    execSync(`z-ai vision -p ${JSON.stringify(prompt)} -i "${f}" -o /tmp/vlm-f3.json`, { stdio: "pipe", timeout: 150000 });
    const j = JSON.parse(readFileSync("/tmp/vlm-f3.json", "utf8"));
    const txt = String(j?.choices?.[0]?.message?.content ?? "").replace(/```(?:json)?/g, "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { const p = JSON.parse(m[0]); if (typeof p.score === "number") { score = p.score; issues = p.issues || []; } } catch (e) {} }
  } catch (e) {}
  out[t] = { score, issues };
  console.log(`${t}: ${score}${score === null ? " FAILED" : ""} ${issues[0] || ""}`);
  execSync("sleep 12");
}
writeFileSync(".harness/v323-vlm-final3.json", JSON.stringify(out, null, 2));
