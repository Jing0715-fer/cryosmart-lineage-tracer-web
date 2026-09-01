# CryoSmart Lineage Tracer Web

> 把 CryoSmart 冷冻电镜的 job lineage（数据血缘）从它的前端 Pinia store 抽出来，渲染成可交互的 SVG 图、生成可分享的报告，并接 ChimeraX 自动化对齐导出 PPTX。

[![Next.js](https://img.shields.io/badge/Next.js-16.1-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
[![Bun](https://img.shields.io/badge/Bun-1.3-f9f1e1?logo=bun)](https://bun.sh/)

---

## 这是什么

CryoSmart 是一个冷冻电镜数据处理平台（[cryosmart.bio](https://cryosmart.bio)），但它的 **REST API 和 WebSocket 只暴露基础 job 信息**；完整的 lineage（上下游关系、输入/输出 slot、参数、log images）只有前端 Vue/Pinia store 里才有。

这个项目是一站式解决方案：

1. **把数据从 CryoSmart 拉出来** —— 唯一方式：**Smart Capture**（复制一段控制台脚本到 CryoSmart 页面的 DevTools 里执行，自动捕获、上传、自动追踪）
2. **渲染可交互的 lineage 图**（BFS 距离分层 + 族系颜色边 + hover 高亮上下游路径 + PNG/SVG 导出）
3. **生成可分享的 HTML 报告**（含懒加载图片、点击 fallback、Referrer-Policy 防防盗链）
4. **对接 ChimeraX 自动化**（4 个 helper 脚本，3D 地图对齐 + 优化 + PPTX 导出 + 重打包）

> 早期的 Bookmarklet 控制台脚本 / JSON 上传 / WebSocket 实时桥接 / 内置示例 4 种方式已全部移除，只保留 Smart Capture 一条通路。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | **Next.js 16.1**（App Router + Turbopack） |
| UI | **React 19** + **Tailwind CSS v4** + **shadcn/ui** + Radix + Framer Motion |
| 状态 | **Zustand** + **TanStack Query** |
| 表单 | **react-hook-form** + **Zod** |
| 国际化 | **next-intl** |
| 数据库 | **Prisma 6**（可选，导入 session 持久化） |
| 包管理 | **Bun 1.3** |
| 辅助 | `sharp`（图片处理）、`qrcode`（分享） |

---

## 快速开始

```bash
# 1. 安装依赖（推荐 bun；也可用 npm/pnpm）
bun install

# 2. 启动 dev server（Turbopack，端口 3000）
bun run dev

# 3. 浏览器打开
#    http://localhost:3000
```

### Smart Capture（唯一的数据获取方式）

1. 在页面 **Smart Capture** 卡片里点 **Open CryoSmart**，登录并进入你的项目（或直接进入最终 job 的页面，推荐）
2. 按 `F12` 打开 DevTools → **Console** 标签
3. 点 Smart Capture 卡片里的 **Copy Capture Script**，粘贴到 Console，回车
4. 之后全自动：job 元数据即时导入 → lineage 自动追踪 → 只对 lineage 内的 job 抓取 log images → 新标签页自动打开本应用并渲染

> ⚠️ **Secure context 注意**：`navigator.clipboard` 只在 `https://` 或 `http://localhost` 下可用。如果你从局域网 IP（`http://192.168.x.x:3000`）访问，Smart Capture 的 Copy 按钮会走 `execCommand` fallback，DevTools console 也能兜底拿脚本。

### Capture History（采集历史：记录、恢复、导出、迁移）

每次 capture 完成时会**自动归档**到磁盘（`capture-history/<id>/`，LRU 保留最近 40 份，不入库不入 git），无需重复采集：

- **恢复（Restore）**：点击历史条目上的 Restore，数据（jobs + log images + 图片字节）完整回到当前页面 —— 自动回填 Start Job、自动 Trace、Graph / Report / ZIP 下载全部照常工作，即使原 session 已过期或服务器已重启
- **保存（Save current capture）**：capture 进行中或刚完成时也可手动归档（应对脚本中断、session 即将过期等场景）
- **导出（Export）**：三种便携 JSON（`cryosmart-capture/v1` 格式）：
  - *Links only* —— 体积小，每张 image / 每个 map 都带**绝对 URL**（`http://<内网>/api/log_image/...` 及 `download_result_file/...`）
  - *With embedded images* —— 图片字节内嵌 base64，完全自包含
  - *Embedded + credentials* —— 再附带捕获的登录凭据（供需要鉴权的内网服务器重新下载）
- **导入（Import capture JSON）**：把导出的 JSON 导入到任何一台部署了本应用的实例，恢复 Graph + Report（也可导入旧版 `{ jobs: [...] }` 项目元数据）。图片按优先级解析：内嵌字节 → **源条目字节复用**（同实例导入 links-only 导出时自动拷贝原图）→ **按需远程拉取**（links-only 导入后，图片 URL 索引持久化，`/api/cryosmart/history/<id>/image/<fileid>` 端点在磁盘未命中时代理拉取远程 URL 并转发凭据）——只要应用服务器能访问内网 CryoSmart，links-only 导入的图片照常显示

> **只靠 JSON 能否通过网络下载全部 image / map？** image 和 map 的绝对 URL 都在文件里 —— 只要读取方所在机器能访问你的 CryoSmart 内网服务器（需要登录时随文件带上 credentials），就能仅凭 JSON 重新下载全部 image 和 map；带内嵌字节的导出让 image 完全离线自包含。map 是大体积二进制，永不内嵌，只能通过 URL 从 CryoSmart 服务器下载。

### Class 分组展示（v3.15）

ab-initio / hetero-refine 这类多 class 作业的 log image 会按 class 自动分组：标题/文件名中的 `class N` 标记、纯数字标题、class 画廊文件（如 `J4_final_000.png`）都能被识别。**Graph 详情弹窗**渲染紧凑的 class 标签页（Class 0 / Class 1 / … / General），**Report** 每类一个紧密的 auto-fill 网格分区（每类上限 12 张，计数随加载失败自动修正）。无法提取 class 的作业保持原有平铺展示。

### Map 下载防卡死与手动停止（v3.17）

打包时的 map / .mrc 下载不会再"永远停在 0%"：每个下载自带**双向超时**（代理上游侧 + 浏览器侧绝对上限）与**无数据看门狗**（默认 45 秒没有任何字节到达即判定 stalled，慢速但持续有数据的下载不会误伤）；累计 3 次 stall 自动跳过剩余队列并写入 `maps/DOWNLOAD_LINKS.txt`。下载过程中进度行实时显示 `Map 0/12 · 4 in flight · 0.4 MB received`（字节级心跳），慢 ≠ 卡死一眼可辨。Download 卡片新增 **Stop build** 按钮：随时中断打包，进行中的下载立即中止，不会误报 "Previous build did not finish"。另外修复了全站 toast 从不显示的问题（layout 挂错 Toaster：radix → sonner）。

### ZIP 增量（流式）写入 — 大包不再爆内存（v3.18）

修复"66 个 map 打包到一半页面崩溃、重载后提示 Previous build did not finish"：旧流程把所有文件字节累积在内存里再一次性拼 ZIP（内部还有两轮全量拷贝，峰值 ≈ 3× 包体积），66 个 .mrc（10+ GB）直接把浏览器页签撑爆。现在 ZIP 通过 **StreamingZipWriter** 逐条写入（字节布局与旧版完全一致，可与历史产物逐字节比对）：

- **浏览器安全上下文（https / localhost）**：逐条流式写入 **OPFS**（浏览器私有磁盘文件），峰值内存只剩 4 个并发下载的缓冲；打包结束后由浏览器把磁盘上的文件以普通下载方式流出。构建时进度框显示 "Streaming ZIP to browser disk storage"。
- **兜底（纯 http 部署 / 非浏览器环境）**：内存 sink + **1 GB 预算守卫** —— 超预算的 map / Final_Result 大文件自动降级为 `maps/DOWNLOAD_LINKS.txt` 手动链接（构建照常完成，绝不 OOM），并以明确警告提示改用 HTTPS 部署以启用磁盘流式。
- 并发下载完成顺序不定：writer 内部以 promise 链串行化写入，杜绝条目交错损坏；Stop build / 任何异常路径都会中止并丢弃半截输出（不留脏的 OPFS 暂存文件）。
- 完成 toast 现在带真实体积（`Downloaded … .zip (66 files · 8.2 GB · streamed to disk)`），Re-download 对 OPFS 磁盘文件同样有效。

---

## 项目结构

```
cryosmart-lineage-tracer-web/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── api/
│   │   │   ├── cryosmart/[...path]   # 通用 CryoSmart 后端代理（cookie 透传）
│   │   │   ├── cryosmart/import/     # 直传导入（脚本 POST 元数据）
│   │   │   ├── cryosmart/pending/    # 直传导入的单次领取端点
│   │   │   ├── cryosmart/import/session/[token]/
│   │   │   │                         #   staged 导入 session API
│   │   │   │   ├── data/             #     - 元数据
│   │   │   │   ├── image/[fileid]/   #     - 单张 log image 代理（魔数 sniff）
│   │   │   │   ├── images/           #     - 批量 image 字节上传
│   │   │   │   ├── request-logs/     #     - 上报 lineage log（应用层去重）
│   │   │   │   └── jobs|logs|complete
│   │   │   ├── cryosmart/history/    # Capture History（磁盘归档）
│   │   │   │   ├── [id]/             #   - 恢复数据 / 删除 / 图片字节服务
│   │   │   │   │   └── export/       #   - 便携 JSON 导出（可内嵌图片/凭据）
│   │   │   │   └── import/           #   - 从导出 JSON（或旧版 jobs JSON）导入
│   │   │   └── proxy-image/[fileid]  # 直链图片代理（防盗链回退）
│   │   ├── components/cryosmart/     # 业务 UI（smart-capture-panel / lineage-graph / …）
│   │   └── page.tsx                  # 主页面
│   ├── components/ui/                # shadcn/ui 生成的基础组件
│   ├── lib/cryosmart/                # 业务核心
│   │   ├── capture-history.ts        # 采集历史磁盘存储（归档/恢复/导出/导入）
│   │   ├── image-embed.ts            # 字节 → data URL（sniff magic number）
│   │   ├── import-session-store.ts   # staged 导入 session 内存存储
│   │   ├── lineage.ts                # BFS / ancestors / downstream helpers
│   │   ├── report-html.ts            # 报告 HTML 模板 + 懒加载
│   │   ├── proxy-client.ts           # CryoSmart 代理 fetch（map 下载等）
│   │   └── types.ts                  # LineageSummary / Edge / Node 等类型
│   └── hooks/                        # 自定义 React hooks
├── public/
│   └── helpers/                      # 4 个 ChimeraX helper 脚本
│       ├── CryoSmart_auto_align_export_ppt.py   # 一键：align + 优化 + 导出 + PPTX
│       ├── CryoSmart_align_maps_check_view.py   # 仅对齐 + 优化
│       ├── CryoSmart_export_current_view_ppt.py # 仅导出 + PPTX
│       └── rebuild_picture_flow_pptx.mjs        # 独立 Node PPTX 重打包
├── prisma/                           # Prisma schema（可选）
├── db/                               # SQL 初始化脚本
├── tests/                            # 运行时构建脚本
├── capture-history/                  # Capture History 归档（gitignored，可到数百 MB）
├── .harness/                         # 端到端 harness 脚本（v3.x 历史快照）
├── Caddyfile                         # 反向代理（HTTPS 终止 → 3000）
├── TESTING-GUIDE.md                  # 端到端 / harness 测试说明
└── worklog.md                        # 项目演进 worklog（v1 → v3.14）
```

---

## 核心模块一览

### 1. Lineage Graph（`lineage-graph.tsx`）

完全重做过的 SVG 交互血缘图。

- **布局**：以 START job 为基准做 BFS 计算上游距离，列坐标 = `maxDistance - distance`，最上游在最左、START 在最右
- **节点**：168×70 圆角卡片，左侧 4px 族系色条，mono UID + 截断 job_type + 关键指标（particles / mics / maps / resolution Å）
- **边**：平滑水平 bezier，4 种族系颜色（cyan = micrograph/exposure，amber = particle，teal = volume/mask/model，slate = parent/other），hover 高亮上下游路径
- **交互**：hover → 高亮从该节点到 START 的完整路径；click → 钉选；拖拽平移；滚轮缩放（0.2–3.0）；底部弹出详情 popover
- **导出**：PNG（2× retina，深浅色自适应背景）+ SVG（含背景 rect）
- **无障碍**：role/aria-label，键盘 Enter/Space 选中

### 2. Smart Capture（`smart-capture-panel.tsx`）

捕获脚本的源头（当前 v3.12）。每次版本变化都更新这里的 staged copy（v3.6 多 round 去重 → v3.7 20min 等待 → v3.8 渐进式渲染 → v3.9 cache-hit loader → v3.11 最后一轮 + 图片白名单 → v3.12 magic-number sniff）。

执行流程（staged，两阶段）：

```
打开 about:blank (防弹窗拦截)
  └─► POST /api/cryosmart/import/session      ← 拿 token
       └─► 跳转已开 tab 到 /?imported=<token>
            └─► POST .../jobs    ← 阶段 1：全部 job 元数据，UI 立即渲染图
                 └─► Trace Lineage（app 自动）
                      └─► POST .../logs     ← 阶段 2：只对 lineage 内 job 抓 log images
                           └─► POST .../images  ← log image 字节流（sniff magic number）
                                └─► POST .../complete  ← 收尾
```

关键设计：

- **阶段式采集**：先快速抓全部 jobs（跳过 log 扫描），lineage 追踪确定子集后，才逐 job 抓 log images —— 不在 lineage 里的 job 不浪费一次 API 调用
- **最后一轮**：多轮/多 iteration 的 job 只保留最后一轮（最大 iteration 号）的 log images
- **图片白名单**：只采集真实图片（PNG/JPEG/GIF/WebP/BMP 等，按魔数判断），PDF/XML/TXT 一律过滤
- **Content-Type 无关上传**：CryoSmart 服务端对 `/api/log_image/` 不回 Content-Type，脚本自己从魔数嗅探 MIME 再构造 data URL 上传
- **防登出**：脚本黑名单机制绝不触碰 auth/logout 类请求

### 3. Report HTML（`report-html.ts` + `report-style.ts`）

- 单文件 HTML，含 base64 内嵌图、懒加载、Referrer-Policy、`onerror` 远程回退
- log images 按 job 严格分组、只取最后一轮
- 直接邮件 / IM 分享，**不需要后端托管**
- **v3.19 模板系统**：报告不再内嵌于页面（旧的内嵌 iframe 已移除），在 **Lineage Preview → Report** 标签页选择样式与配置后，仅提供「新标签页打开」和「下载 HTML」两种出口。八套模板共享完全相同的正文标记（内容不缩水，仅换肤换骨架）：
  - **Paper 学术**（默认）：衬线字体、纯白纸面、双线题头、hairline 边框、booktabs 表格、打印友好（`@page` + `@media print`），无渐变/荧光/阴影
  - **Minimal 极简**：系统无衬线、灰底白卡三级层次、青绿题头刻线、盒装媒体区块，kind 色仅作标记
  - **Slate 暗色**：三级明度深色面板、青绿渐隐题头线、悬停辉光，暗室演示友好
  - **Classic 旧版**：v3.16 原样式（渐变、荧光、自动深浅色）完整保留
  - **Blueprint 工程记录簿**（v3.22）：0px 直角面板 + 硬偏移阴影 + 点阵坐标纸底、石墨题头块 + 铁锈红刻度带、`SEC 01` 等宽编号分节、卡片四角角标
  - **Editorial 画报/年报**（v3.22）：墨色报头 band + 大号衬线展示字体、章节大数字 `01/02…`、job 卡顶部色带与序号徽章、奶油纸面
  - **Focus 沉浸阅读**（v3.22）：单栏文档流（顶部横向章节导轨 + 章节板式图片流，与双栏工作台结构性不同的第三种版式原型）、暖纸色衬线正文、大行距
  - **Industrial 工业控制台**（v3.24）：枪灰钢板暗色面板（中性暖炭灰三级钢板）、**45° 安全橙警示条纹**题头下缘、job 卡顶部**铆钉铭牌**（nameplate strip + 左右铆钉）、LED 状态灯分节标记与题头指示灯、拉丝金属页面纹理、方角机加工倒角（inset 高光 + 硬投影）、安全橙机器按钮；lightbox 查看器同样随皮肤着色（石墨速罩 + 橙色顶轨 + 等宽大写字幕）
- **自定义配置**（localStorage 持久化，`cryosmart_report_style_v1`）：模板、**页面宽度（全宽 / 宽 1680 / 适中 1280）**、字号（紧凑/标准/舒适）、图片模式（嵌入 data-URL / 引用原链接 / 不含图片）、自定义报告标题与附注。**Build & download ZIP** 的 HTML 报告自动沿用同一配置（打包时读取）
- **v3.20 全宽与层次**：三种新模板默认**全宽利用屏幕**（无 1240px 封顶，左侧谱系栏按比例 `min(24vw, 540px)`、主链占满剩余宽度）；图片/地图网格改为 auto-fill 自适应列（map 240px、紧凑图 176px、class 砖 180px 起，宽屏自动多列），媒体框整体放大（map 预览井 130px、micrograph 网格 210px 起）；minimal/slate 的媒体/数据区块渲染为盒装内嵌面板（三层视觉深度）、slim sticky 题头 + 题头刻线；统一了 focus-visible 焦点环与细滚动条
- **v3.20 修复（blob 报告图片回归）**：v3.19 移除内嵌 iframe 后，**从 Capture History 恢复**的报告在新标签页（blob: URL）里所有 UI title / log 图片全部静默消失 —— history 图片 URL 是相对路径，blob: 上下文无法解析。现在 `/api/cryosmart/history/<id>/image/` 与 session 图片一样会被**绝对化**（含「打开」链接与 map/class 预览链接），且无活动会话时也照常预取 history 图片做嵌入（嵌入模式恢复自包含导出）
- **v3.21 版式修正（列宽一致性 + 左栏双列）**：① 主链 job 卡片的「输出到」侧栏改为**固定轨道** `clamp(180px, 22%, 280px)` —— 旧版 `auto` 轨道按各卡内容自适应（218px vs 76px），导致每张卡的主内容列宽各不相同；现在所有卡片侧栏同宽对齐、主列等宽。② 左侧 Lineage Outline 改为**每行 2 个 job 砖**：phase 标签移到网格上方（释放 92px 侧栏），stage-grid 以 140px auto-fill 铺列（390px 手机 → 143px 砖、1920px 全宽 → ~198px 砖），mini-node 重排为紧凑竖向砖（uid/类型/指标堆叠、引用药丸折行到下方）。终节点的「最终节点」占位渲染为安静药丸，固定宽侧栏不再显得空。四种模板同步生效（classic 以追加覆盖方式获得同样的版式，外观不变）
- **v3.23 图片点击放大（lightbox，所有模板）**：报告里**任何一张图**（UI title 图、log 图、class 网格、map 预览、select-2D、最终结果图）点击后全屏放大查看 —— 深色磨砂遮罩 + 定尺寸画框（`object-fit:contain`，小图自动放大填满）、**点击缩放（以点击点为中心，1–8×）+ 滚轮缩放 + 拖拽平移 + 触摸滑动翻页**、‹/› 与 ←/→ 键翻图、ESC 关闭、底部字幕栏（job 名 · 图名 · 位置计数 · 实时缩放百分比）与「点击缩放 · ESC 关闭」提示。八套模板的查看器各自随皮肤着色（Paper 白卡纸画框 + 衬线斜体字幕、Blueprint/Industrial 等宽大写字幕 + 直角按钮、Editorial/Focus 衬线斜体字幕等），打印时自动隐藏。实现为自包含内联脚本，blob 新标签页 / 下载的 HTML 文件 / ZIP 内报告全部可用；图片优先加载原图链接、失败自动回退到页面已渲染的源
- **v3.24 代码审查修复（ZIP64 + 流式收尾 + 安全加固）**：① **ZIP64**（`zip.ts`）—— v3.18 流式 ZIP 去掉了内存上限，但所有 size/offset 仍是 32 位字段，>4 GiB 的档案「构建成功却解压即坏」（central directory 偏移被截断取模）。现在按 APPNOTE 4.5 发出 ZIP64 扩展字段（本地头双 size）、中央目录溢出字段、ZIP64 EOCD 记录 + locator；小档案字节级不变（与 makeZip 完全一致），并由 CPython `zipfile` 独立读回验证。② **Final_Result 阶段流式收尾**（`bundle.ts`）—— 旧代码把 6 个 .mrc 终图 + 5 个图全部缓冲在内存里才写盘（峰值 = 全部之和，正是 66-map OOM 的同类）；改为有序生产者/消费者（并发下载不变，写入按路径排序逐个落盘，写完即释放）。③ **SSRF 凭证外发防护**（`capture-history.ts`）—— 导入的 capture JSON 里的 `remote_image_urls` 原先会把存储的 Authorization/Cookie 转发给**任意** http(s) URL；现在仅允许与该 capture 自身 `cryosmart_origin` 同源的链接携带凭证，且重定向手动逐跳校验同源、8 MB 上限改为流式截断（谎报 Content-Length 也逃不掉）。④ **分享链接解压炸弹**（`share-url.ts`）—— `#s=` 载荷解压时实时计数，超过 20 MB 立即中止（原来先整块解压再校验，~2 MB 哈希即可 OOM 接收方标签页）。⑤ **可中止的图片预取**（`image-embed.ts` / `bundle.ts`）—— Stop 按钮现在会传入 AbortSignal，取消后不再有 N/8 × 10s 的僵尸请求打进已闲置的进度卡。⑥ **Stop 后立即重建**（`download-card.tsx`）—— 新构建会先（最长 3s）等待被取消构建的 OPFS 锁释放，不再因为 `createWritable()` 报 InvalidStateError 而静默降级到 1 GB 内存 sink。⑦ blob URL 统一延迟 30s 释放（报告下载 / 谱系图 PNG 导出在 Safari 系引擎下同步 revoke 可能取消下载；导出失败路径原先永不释放）
- **v3.25 数据载入可见化 + 采集脚本重试提速**：① **`/data` 流式响应**（`import/session/[token]/data/route.ts`）—— 快照 JSON 改为 ReadableStream 分块（256 KiB）输出并携带精确 `Content-Length` 与 `Content-Encoding: identity`（禁止中间层透明压缩导致字节数与长度失配），前端用 `getReader()` 逐块读取，**真正显示「256 KB / 13.2 MB · 2% · 874 KB/s」**。② **applying 状态**（`use-imported-metadata.ts`）—— 大捕获（590 jobs ≈ 7–13 MB）的 下载→JSON.parse→merge→LineageGraph 重渲 全程原本不可见（弹窗页「看着像死页，得刷新」）；现在 hook 发布 `ApplyProgress`（字节数/阶段/起始时刻），按 ~4 Hz 节流更新，**DataSourceCard 显示「Receiving 590 jobs (13.2 MB) · 0.3s…」+ 下载进度条与速率**，**进度条 Strip 增加第二行 applying 指示**（弹窗自动滚动到 #preview，数据卡可能在屏外），首次应用完成弹出 **toast「Loaded 590 jobs in 0.9s」**；badge 保留到重渲真正绘制完成后才消失（rAF + setTimeout；隐藏标签页有 3s 墙钟兜底）。③ **Stop 与轮询的过期覆盖竞态**—— stopImport 与轮询的 /data 应用共用 `fetchSessionData`（applySeq 单调序号），停止时在飞的旧轮询应用不再反向覆盖最新快照。④ **LineageGraph memo 化**—— applying 的 5 Hz 计时重渲不再连带重跑数百节点的 SVG 渲染（props 引用稳定时直接跳过）。⑤ **采集脚本：图片字节抓取重试**（`smart-capture-panel.tsx`）—— 原先单次尝试，一次瞬时故障（连接重置 / 502 / 代理抖动）就永久丢掉该图预览；现在**最多 3 次**（0.8s/2s 退避），仅对可重试失败（网络错误、408/429/5xx）重试，404/403 仍然快速失败；单次超时 45s→30s。⑥ **采集脚本：批量 POST 重试**—— `/images` 与 `/logs` 批次各自 3 次尝试（服务端按 fileid/uid 幂等去重，重发安全）；丢失一批日志 refs 原本会让这些 job 的图片「字节在但引用没了」。⑦ **采集脚本：原生 base64**—— 逐字符 btoa 循环（每张多 MB 图 100–200ms 主线程）改为 `FileReader.readAsDataURL`（原生 ~10–20ms/MB）+ 嗅探 mime 前缀重写（typeless 服务器场景），旧手动编码保留为兜底；并发 6→8 workers。回归：v313-unit 13/13、v313-bundle 16/16、v314 24/24、v315 35/35、v317 16/16、v318 22/22、v319 241/241、v324-zip64 19/19、v324-security 14/14、新增 v325-capture-retry 12/12；浏览器 E2E 实测 13.2 MB 快照的完整时间线（waiting → downloading（字节/速率/%）→ parsing → toast → 恢复采集进度）、Stop 保留数据、Trace 后图谱渲染均通过
- **v3.26 Fetch all jobs 按钮 + 采集结果自解释**：用户的典型困惑「Captured 592 jobs + 393 log images from 41 jobs (traced lineage — 72 of 592 jobs scanned) —— 为何有些 job 没抓到？和上次卡住中断时一样多」根因有两层：**① 血统范围裁剪是设计行为**（>15 jobs 的项目，log 图片只为「Trace Lineage 的谱系」抓取 —— 520 个谱系外 job 从不扫描，控制台 `__csCaptureAll()` 是唯一逃生口）；**② 之前那次「卡住中断」其实已经抓完了**（393 refs / 390 bytes 与本次完整跑完逐项一致 = 确定性结果；当时停在脚本收尾的静默等待期：慢日志救援 90s + re-trace 宽限 3 min + 字节排空最长 7 min，期间无任何输出，看起来像卡死）。本次改进：① **进度条 Strip 新增「Fetch all 592 jobs」按钮**（`lineage-preview-card.tsx`）—— 血统范围捕获进行中（含等待 Trace 阶段）可见，点击即向会话 `request-logs` POST `{all:true}`，把**全部已捕获 job**并入 log request（服务端拿 session 自己的 uid 列表，浏览器无需知道；`setLogRequest` 幂等并集 + revision 递增，`log_jobs_total` 随之扩大，进度条分母自然延长）；按钮点击后翻转为「Requested ✓」并在请求覆盖全部 job 后消失。② **采集脚本收尾（字节排空期）也监听 log request**（`smart-capture-panel.tsx` 的 `drainImageUploads`）—— 原先 3 分钟 re-trace 宽限窗口一过、进入最长 7 分钟字节排空后就不再看 request，晚点的 Fetch all 点击会被静默丢弃；现在排空循环每 3s 带心跳轮询一次 request，发现未扫描 job 就地 `scanLogs()` 并重置排空期限，且**只在「队列空闲 + 最近一次轮询确认无新增」时才 resolve**（两轮轮询之间落地的点击不再漏掉）。③ **完成摘要自解释**（`use-imported-metadata.ts`）—— 「Captured 6 jobs + 3 log images from 2 of the 6 traced jobs — 4 of the traced jobs have no readable log images (import/ctf jobs usually have none — the CryoSmart console lists them); 1 image(s) have no preview bytes (missing or too large on the CryoSmart server) (2 with previews).」—— 三个数字（谱系内无日志 job 数 / 谱系外跳过数 / 无字节图片数）直接在最终消息里说明原因，不再需要翻控制台。④ 扫描收尾消息从「finalizing…」改为「the script finishes after a short re-trace grace window…」，点名那段看似卡死的静默等待。回归：v325-capture-retry 12/12、v313-bundle 16/16、v314 24/24、v318 22/22、v324-zip64 19/19、v319 241/241、v324-security 14/14、新增 v326-fetchall 13/13；浏览器 E2E（staged 血统会话）实测按钮可见 → 点击 → toast + request-logs 落地 → 分母 2→6 → /complete 后新格式摘要逐字呈现，390px 无横向溢出

### 4. Share（`share-url.ts`）

- 把 lineage summary 压缩成 URL-safe base64url 塞进 `#s=...`
- 同事打开链接即渲染同样的图和统计，无需任何数据源
- 附二维码，手机扫码直接打开

---

## ChimeraX helper 脚本

4 个脚本都随下载 bundle 一起打包，也可在页面 Help 卡片单独下载（需本地安装 ChimeraX）：

- **`CryoSmart_auto_align_export_ppt.py`**（推荐一键流）：打开 lineage 全部 maps，测试 5 种对齐假设（原始 + 3 轴翻转 + z-flip），按相关性选优，优化 90° 视角，导出 PNG，白平衡 + 统一裁剪，按 `name="CryoSmartImage:<key>"` 标记替换进 PPTX
- **`CryoSmart_align_maps_check_view.py`**：手动流程第 1 步（仅对齐 + 优化，可检查中间状态）
- **`CryoSmart_export_current_view_ppt.py`**：手动流程第 2 步（手动调相机后仅导出）
- **`rebuild_picture_flow_pptx.mjs`**：独立 Node 脚本，从 lineage JSON 重建 Picture Flow PPTX

---

## 开发命令

```bash
bun run dev          # Next dev（Turbopack），端口 3000
bun run build        # 生产构建（输出 standalone）
bun run start        # 跑生产构建
bun run lint         # ESLint
bun run db:push      # Prisma 同步 schema 到数据库
bun run db:generate  # Prisma 生成 client
bun run db:migrate   # Prisma migration
bun run db:reset     # 重置数据库
```

---

## 部署

推荐用项目根目录的 **`Caddyfile`**：

- Caddy 自动申请 Let's Encrypt 证书（HTTPS）
- 反代到 localhost:3000
- 解决局域网 IP 访问时 `navigator.clipboard` 不可用 + `/_next/*` 跨源问题

```bash
caddy run --config Caddyfile
```

---

## 文档导航

| 文档 | 用途 |
| --- | --- |
| [`TESTING-GUIDE.md`](./TESTING-GUIDE.md) | 端到端 / harness 测试说明 |
| [`worklog.md`](./worklog.md) | 项目演进 worklog（v1 → v3.13，捕获脚本每次迭代的 root cause + fix） |

---

## 已知行为与限制

- **Secure context**：局域网 IP 访问时 Clipboard API 不可用，已加 `execCommand` fallback（统一封装在 `src/lib/cryosmart/clipboard.ts`，Smart Capture / Share / Mermaid Copy 三处共用）
- **Next.js 16 allowedDevOrigins**：从非 localhost 访问会看到 `Cross origin request detected from …` 警告，配置 `next.config.ts` 的 `allowedDevOrigins` 可消除
- **后台标签页节流**：捕获期间本应用的预览标签页若被切到后台，浏览器会节流轮询 —— 已用 `visibilitychange` 唤醒 + localStorage token 恢复兜底，切回来即刷新
- **多 round job**：捕获脚本只保留**最后一轮**的 log images（之前的已被清理）
- **CryoSmart 后端**：第三方管理；本应用不依赖其 WebSocket，全部数据经 Smart Capture 脚本一次性带出

### 安全姿态（内网单用户工具的设计决策）

- **`/api/cryosmart/[...path]` 与 `/api/proxy-image/*` 是开放代理**：`base` 参数完全由调用方控制，服务端会对任意 http(s) URL 发起请求并回传响应体。这是内网单用户工具的有意设计（浏览器无法直连 CryoSmart 的 CORS/HttpOnly cookie 限制所致）；**请勿将本应用暴露到公网**，否则会成为一个 SSRF 中继。
- **上传字节只接受光栅图片**：两处存储（session store / capture history）都按魔数嗅探字节，PNG/JPEG/GIF/BMP/WebP/TIFF/ICO 之外一律拒绝（`image/svg+xml` 携带脚本的存储型 XSS 由此封死），图片响应另附 `Content-Security-Policy: default-src 'none'; sandbox` + `nosniff` 纵深防御。
- **会话 token 使用 crypto 随机数**（`randomBytes`，128-bit 熵 + 序号前缀）。`/data` 等端点会返回捕获到的 CryoSmart 凭据（应用需要它们做代理下载）——持有 token 即持有凭据，因此 token 不可猜测是硬要求。
- **凭据明文落盘**：capture history 的 `capture.json` 内含捕获时的 cookie/auth（导出时凭据默认剔除、需显式勾选）——历史目录（`capture-history/`）请当作敏感数据对待。

---

## 许可证

本仓库内代码：MIT。
CryoSmart 是 [cryosmart.bio](https://cryosmart.bio) 的产品，本项目是非官方辅助工具。
