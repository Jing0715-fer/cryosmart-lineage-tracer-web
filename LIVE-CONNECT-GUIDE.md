 # CryoSmart 实时连接配置指南
 
 ## 概述
 
 由于 CryoSmart 服务器由第三方管理且无法修改其 WebSocket 配置，本项目提供了两种实时连接方案：
 
 1. **轮询模式** - 通过定时 HTTP 请求获取更新（简单但不实时）
 2. **WebSocket 桥接模式** - 通过本地桥接服务实现真正的实时连接（推荐）
 
 ---
 
 ## 方案一：轮询模式（无需额外配置）
 
 这是最简单的方式，但数据不是真正实时的。
 
 ### 工作原理
 - 每隔一定时间（默认 30 秒）自动刷新 job 列表
 - 当你在 CryoSmart 中启动新任务时，下次刷新时会看到更新
 - 不需要额外的服务或安装
 
 ### 使用方法
 
 1. 在 Live Connect 面板中填写：
    - CryoSmart Base URL: `http://192.168.4.3:8080`
    - Session Cookie: 你的登录 cookie
    - Project ID: 如 `P52`
 
 2. 点击 "Load jobs" 加载初始数据
 
 3. **开启自动刷新**：勾选 "Auto-refresh" 选项
    - 刷新间隔可在 15s / 30s / 60s / 120s 中选择
 
 4. 每次需要最新数据时，点击 "Refresh" 按钮
 
 ---
 
 ## 方案二：WebSocket 桥接模式（推荐，需要本地服务）
 
 这是真正的实时连接，job 状态变更会在几毫秒内反映到 web 应用中。
 
 ### 工作原理
 
 ```
 ┌──────────────┐         ┌──────────────────┐         ┌────────────────┐
 │ CryoSmart    │◄────────│ 本地桥接服务      │────────►│ Web 应用       │
 │ 服务器       │  WS     │ (bridge.ts)     │  WS     │ (实时更新)     │
 │ 192.168.4.3  │         │ localhost:3003   │         │ localhost:3000 │
 └──────────────┘         └──────────────────┘         └────────────────┘
 ```
 
 ### 安装和配置步骤
 
 #### 第一步：安装 WebSocket 依赖
 
 在项目目录中运行：
 
 ```bash
 npm install ws
 ```
 
 #### 第二步：启动桥接服务
 
 打开终端，运行：
 
 ```bash
 npx ts-node src/tools/cryosmart-bridge/bridge.ts
 ```
 
 或（如果 TypeScript 编译正常）：
 
 ```bash
 npx tsx src/tools/cryosmart-bridge/bridge.ts
 ```
 
 应该看到类似输出：
 
 ```
 ╔═══════════════════════════════════════════════════════════╗
 ║        CryoSmart WebSocket Bridge v1.0                  ║
 ╠═══════════════════════════════════════════════════════════╣
 ║  CryoSmart: http://192.168.4.3:8080                      ║
 ║  Bridge:    ws://localhost:3003                          ║
 ╚═══════════════════════════════════════════════════════════╝
 [Bridge] Started: ws://localhost:3003
 [Bridge] Health check: http://localhost:3003/health
 ```
 
 如果 CryoSmart 服务器可访问，会显示：
 
 ```
 [Bridge] Connecting to CryoSmart: ws://192.168.4.3:8080/api/subscribe
 [Bridge] Connected to CryoSmart
 ```
 
 #### 第三步：配置 Web 应用
 
 1. 在浏览器中打开 cryosmart-lineage-tracer-web (http://localhost:3000)
 
 2. 进入 Live Connect 面板
 
 3. 勾选 **"Use WebSocket Bridge"** 选项
 
 4. 填写：
    - Bridge URL: `ws://localhost:3003`
    - Project ID: `P52`
 
 5. 点击 "Connect" 按钮
 
 #### 第四步：验证连接
 
 查看状态指示：
 
 - 🟢 **绿色** - 已连接，CryoSmart 已连接，实时更新可用
 - 🟡 **黄色** - 已连接到桥接，但 CryoSmart 未连接
 - 🔴 **红色** - 连接失败
 
 你也可以访问 http://localhost:3003/health 查看详细状态：
 
 ```json
 {
   "status": "ok",
   "cryosmartConnected": true,
   "clients": 1,
   "timestamp": "2024-01-15T10:30:00.000Z"
 }
 ```
 
 ### 环境变量
 
 启动桥接服务时可以配置以下环境变量：
 
 | 变量 | 默认值 | 说明 |
 |------|--------|------|
 | `CRYOSMART_URL` | `http://192.168.4.3:8080` | CryoSmart 服务器地址 |
 | `BRIDGE_PORT` | `3003` | 桥接服务端口 |
 | `WEBAPP_PORT` | `3000` | Web 应用端口 |
 | `PROJECT_ID` | 无 | 自动订阅的项目 ID |
 
 示例：
 
 ```bash
 CRYOSMART_URL=http://192.168.4.3:8080 BRIDGE_PORT=3003 npx ts-node src/tools/cryosmart-bridge/bridge.ts
 ```
 
 ### 故障排除
 
 #### 问题：桥接服务无法连接到 CryoSmart
 
 **检查**：
 1. CryoSmart 服务器是否运行？
 2. IP 地址是否正确？（192.168.4.3）
 3. 防火墙是否阻止了 WebSocket 连接？
 
 **解决方案**：
 - 确认网络可达：`ping 192.168.4.3`
 - 检查端口：`curl -I http://192.168.4.3:8080`
 - 如果在同一台机器上运行，尝试 `http://localhost:8080`
 
 #### 问题：Web 应用无法连接到桥接服务
 
 **检查**：
 1. 桥接服务是否正在运行？
 2. 端口 3003 是否被占用？
 
 **解决方案**：
 - 换一个端口：`BRIDGE_PORT=3004 npx ts-node src/tools/cryosmart-bridge/bridge.ts`
 - 更新 Web 应用中的 Bridge URL
 
 #### 问题：连接断开后不自动重连
 
 **检查**：
 1. 是否是手动断开？（关闭终端会断开连接）
 
 **解决方案**：
 - 桥接服务会自动尝试重连（最多 10 次）
 - 如果需要长期运行，考虑使用 PM2 或 systemd 管理服务
 
 ### 长期运行（可选）
 
 如果需要 24/7 运行桥接服务，建议使用 PM2：
 
 ```bash
 # 安装 PM2
 npm install -g pm2
 
 # 启动服务
 pm2 start npx --name cryosmart-bridge -- ts-node src/tools/cryosmart-bridge/bridge.ts
 
 # 保存进程列表
 pm2 save
 
 # 设置开机自启
 pm2 startup
 ```
 
 PM2 命令：
 - `pm2 status` - 查看状态
 - `pm2 logs cryosmart-bridge` - 查看日志
 - `pm2 restart cryosmart-bridge` - 重启
 - `pm2 stop cryosmart-bridge` - 停止
 
 ---
 
 ## 方案对比
 
 | 特性 | 轮询模式 | WebSocket 桥接模式 |
 |------|----------|-------------------|
 | 实时性 | 30秒+ 延迟 | <1秒 |
 | 设置难度 | ⭐ 简单 | ⭐⭐ 中等 |
 | 额外依赖 | 无 | Node.js + ws |
 | 服务器资源 | 较高（频繁请求） | 很低 |
 | 断线重连 | 需要刷新页面 | 自动 |
 | 推荐场景 | 偶尔使用 | 频繁监控 |
 
 ---
 
 ## 已知限制
 
 1. **CryoSmart WebSocket 协议**
    - 不同版本的 CryoSmart 可能有不同的 WebSocket 消息格式
    - 桥接服务会打印所有接收到的消息，方便调试
 
 2. **认证**
    - 桥接服务目前不支持自动认证
    - 如果 CryoSmart 需要认证，可能需要手动在桥接服务中添加 cookie
 
 3. **网络隔离**
    - 如果 CryoSmart 服务器在不同的网络段，可能无法直接连接
    - 需要确保网络可达性
 
 ---
 
 ## 技术支持
 
 如果遇到问题：
 
 1. 查看桥接服务的终端输出
 2. 检查浏览器控制台 (F12)
 3. 访问 http://localhost:3003/health 检查服务状态
 4. 查看项目 Issues
