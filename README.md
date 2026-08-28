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

1. **把数据从 CryoSmart 拉出来**（4 种方式：Bookmarklet 控制台脚本 / JSON 上传 / WebSocket 实时桥接 / 内置示例）
2. **渲染可交互的 lineage 图**（BFS 距离分层 + 族系颜色边 + hover 高亮上下游路径 + PNG/SVG 导出）
3. **生成可分享的 HTML 报告**（含懒加载图片、点击 fallback、Referrer-Policy 防防盗链）
4. **对接 ChimeraX 自动化**（4 个 helper 脚本，3D 地图对齐 + 优化 + PPTX 导出 + 重打包）

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
| 辅助 | `sharp`（图片处理）、`qrcode`（分享）、`ws`（WS 桥接）、`puppeteer`-free 导出 |

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

打开后看到 4 个数据源标签页：

- **Smart Capture** — 推荐：从 CryoSmart 页面复制粘贴一段 console 脚本到 DevTools 执行，自动捕获并 POST 进来
- **Upload JSON** — 把之前导出的 CryoSmart job JSON 拖进来
- **Live Connect** — 填 CryoSmart Base URL + 登录 cookie + Project ID，实时同步 jobs
- **Try Sample** — 用内置示例数据先看效果

> ⚠️ **Secure context 注意**：`navigator.clipboard` 只在 `https://` 或 `http://localhost` 下可用。如果你从局域网 IP（`http://192.168.x.x:3000`）访问 Smart Capture 的 Copy 按钮会用 `execCommand` fallback，DevTools console 也能兜底拿脚本。

---

## 项目结构

```
cryosmart-lineage-tracer-web/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── api/
│   │   │   ├── cryosmart/[...path]   # 通用 CryoSmart 后端代理（cookie 透传）
│   │   │   ├── cryosmart/import/session/[token]/   # staged 导入 session API
│   │   │   │   ├── data/             #   - 元数据
│   │   │   │   ├── image/[fileid]/   #   - 单张 log image 代理（魔数 sniff）
│   │   │   │   ├── images/           #   - 批量 image 字节上传
│   │   │   │   ├── request-logs/     #   - 上报 lineage log（应用层去重）
│   │   │   │   └── jobs|logs|complete
│   │   │   └── proxy-image/[fileid]  # 直链图片代理（防盗链回退）
│   │   ├── components/cryosmart/     # 业务 UI（lineage-graph / smart-capture-panel / …）
│   │   └── page.tsx                  # 主页面（4 个标签的根）
│   ├── components/ui/                # shadcn/ui 生成的基础组件
│   ├── lib/cryosmart/                # 业务核心
│   │   ├── bookmarklet.ts            # 老式 bookmarklet 脚本源
│   │   ├── image-embed.ts            # 字节 → data URL（sniff magic number）
│   │   ├── import-session-store.ts   # staged 导入 session 内存存储
│   │   ├── lineage.ts                # BFS / ancestors / downstream helpers
│   │   ├── report-html.ts            # 报告 HTML 模板 + 懒加载
│   │   └── types.ts                  # LineageSummary / Edge / Node 等类型
│   ├── hooks/                        # 自定义 React hooks
│   ├── tools/cryosmart-bridge/       # WebSocket 桥接服务（实时模式）
│   └── ...
├── public/
│   ├── helpers/                      # 4 个 ChimeraX helper 脚本
│   │   ├── CryoSmart_auto_align_export_ppt.py   # 一键：align + 优化 + 导出 + PPTX
│   │   ├── CryoSmart_align_maps_check_view.py   # 仅对齐 + 优化
│   │   ├── CryoSmart_export_current_view_ppt.py # 仅导出 + PPTX
│   │   └── rebuild_picture_flow_pptx.mjs        # 独立 Node PPTX 重打包
│   └── demo/                         # 内置示例数据 / 截图
├── cryosmart-capture-extension/      # 子项目：Chrome 扩展（自动捕获）
├── download/                         # 旧版下载工具
├── examples/websocket/               # WS 桥接示例
├── mini-services/                    # 本地辅助服务（WS 桥接等）
├── prisma/                           # Prisma schema（可选）
├── db/                               # SQL 初始化脚本
├── scripts/                          # 维护脚本
├── tests/                            # 端到端 / harness 测试
├── upload/                           # 浏览器粘贴的临时上传
├── .harness/                         # 端到端 harness 脚本（v3.x 历史快照）
├── Caddyfile                         # 反向代理（HTTPS 终止 → 3000）
├── LIVE-CONNECT-GUIDE.md             # 实时连接（轮询 vs WS 桥接）详细配置
├── TESTING-GUIDE.md                  # 端到端 / harness 测试说明
└── worklog.md                        # 项目演进 worklog（v1 → v3.12）
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

捕获脚本的源头。每次版本变化都更新这里的 staged copy（v3.6 多 round 去重 → v3.7 20min 等待 → v3.8 渐进式渲染 → v3.9 cache-hit loader → v3.12 magic-number sniff）。

执行流程（v3.12）：

```
打开 about:blank (防弹窗拦截)
  └─► POST /api/cryosmart/import/session       ← 拿 token
       └─► 跳转已开 tab 到 /?imported=<token>
            └─► POST .../jobs    ← UI 立即渲染图
                 └─► POST .../request-logs  ← app 自动追踪 lineage
                      └─► POST .../images   ← log image 字节流（sniff magic number）
                           └─► POST .../complete  ← 收尾
```

### 3. Report HTML（`report-html.ts`）

- 单文件 HTML，含 base64 内嵌图、懒加载、Referrer-Policy、`onerror` 远程回退
- 直接邮件 / IM 分享，**不需要后端托管**

### 4. Live Connect（`LIVE-CONNECT-GUIDE.md`）

两种模式：

- **轮询模式**：默认 30s HTTP 刷新 job 列表
- **WS 桥接模式**（推荐）：本地 `mini-services/cryosmart-bridge` 订阅 CryoSmart WebSocket，再推给前端，毫秒级延迟

---

## 子项目

### `cryosmart-capture-extension/`

Chrome 扩展，访问 `chrome://extensions/` → 加载已解压的扩展程序 → 选这个目录。可在 CryoSmart 项目页加载时**自动捕获 + 同步**到本应用。详见 [`cryosmart-capture-extension/README.md`](./cryosmart-capture-extension/README.md)。

### `download/`

旧版手动下载工具（保留以兼容旧流程）。新流程请用 Smart Capture。

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
| [`LIVE-CONNECT-GUIDE.md`](./LIVE-CONNECT-GUIDE.md) | 实时连接：轮询 vs WebSocket 桥接 详细配置 |
| [`TESTING-GUIDE.md`](./TESTING-GUIDE.md) | 端到端 / harness 测试说明 |
| [`worklog.md`](./worklog.md) | 项目演进 worklog（v1 → v3.12，捕获脚本每次迭代的 root cause + fix） |
| [`cryosmart-capture-extension/README.md`](./cryosmart-capture-extension/README.md) | Chrome 扩展安装 / 配置 / 故障排查 |

---

## 已知行为与限制

- **Secure context**：局域网 IP 访问时 Clipboard API 不可用，已加 `execCommand` fallback（见 `smart-capture-panel.tsx` 的 `copyToClipboard` helper）
- **Next.js 16 allowedDevOrigins**：从非 localhost 访问会看到 `Cross origin request detected from …` 警告，配置 `next.config.ts` 的 `allowedDevOrigins` 可消除
- **CryoSmart 后端**：第三方管理，WebSocket 路径不能改，所以本项目用 WS 桥接做实时同步
- **多 round job**：捕获脚本只保留**最后一轮**的 log images（之前的已被清理）

---

## 许可证

本仓库内代码：MIT。  
CryoSmart 是 [cryosmart.bio](https://cryosmart.bio) 的产品，本项目是非官方辅助工具。
