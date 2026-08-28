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
│   │   │   └── proxy-image/[fileid]  # 直链图片代理（防盗链回退）
│   │   ├── components/cryosmart/     # 业务 UI（smart-capture-panel / lineage-graph / …）
│   │   └── page.tsx                  # 主页面
│   ├── components/ui/                # shadcn/ui 生成的基础组件
│   ├── lib/cryosmart/                # 业务核心
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
├── .harness/                         # 端到端 harness 脚本（v3.x 历史快照）
├── Caddyfile                         # 反向代理（HTTPS 终止 → 3000）
├── TESTING-GUIDE.md                  # 端到端 / harness 测试说明
└── worklog.md                        # 项目演进 worklog（v1 → v3.13）
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

### 3. Report HTML（`report-html.ts`）

- 单文件 HTML，含 base64 内嵌图、懒加载、Referrer-Policy、`onerror` 远程回退
- log images 按 job 严格分组、只取最后一轮
- 直接邮件 / IM 分享，**不需要后端托管**

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

- **Secure context**：局域网 IP 访问时 Clipboard API 不可用，已加 `execCommand` fallback（见 `smart-capture-panel.tsx` 的 `copyToClipboard` helper）
- **Next.js 16 allowedDevOrigins**：从非 localhost 访问会看到 `Cross origin request detected from …` 警告，配置 `next.config.ts` 的 `allowedDevOrigins` 可消除
- **后台标签页节流**：捕获期间本应用的预览标签页若被切到后台，浏览器会节流轮询 —— 已用 `visibilitychange` 唤醒 + localStorage token 恢复兜底，切回来即刷新
- **多 round job**：捕获脚本只保留**最后一轮**的 log images（之前的已被清理）
- **CryoSmart 后端**：第三方管理；本应用不依赖其 WebSocket，全部数据经 Smart Capture 脚本一次性带出

---

## 许可证

本仓库内代码：MIT。
CryoSmart 是 [cryosmart.bio](https://cryosmart.bio) 的产品，本项目是非官方辅助工具。
