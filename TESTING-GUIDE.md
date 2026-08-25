 # CryoSmart 实时连接测试指南
 
 ## 测试前准备
 
 ### 1. 确认 CryoSmart 服务器信息
 
 请提供以下信息：
 
 - **CryoSmart URL**: CryoSmart 服务器的地址（如 `http://192.168.4.3:8080`）
 - **Project ID**: 要测试的项目 ID（如 `P52`）
 - **登录方式**: Cookie 或 Authorization Bearer Token
 
 ### 2. 获取 Session Cookie
 
 在 CryoSmart 页面打开浏览器开发者工具 (F12)：
 
 **方法 A - Application 面板**:
 1. 点击 Application 选项卡
 2. 展开 Cookies，选择 CryoSmart 域名
 3. 找到 `session` 或 `connect.sid` cookie
 4. 复制完整的 cookie 值（包括 `session=` 前缀）
 
 **方法 B - Network 面板**:
 1. 刷新 CryoSmart 页面
 2. 点击任意一个 `/api/` 请求
 3. 在 Request Headers 中找到 `Cookie` 字段
 4. 复制完整的值
 
 ---
 
 ## 运行测试
 
 ### 测试 1: 诊断连接 (diagnose.ts)
 
 这个脚本会探测 CryoSmart 服务器的各种端点：
 
 ```bash
 # 基本诊断
 npx ts-node src/tools/cryosmart-bridge/diagnose.ts --url http://192.168.4.3:8080
 ```
 
 它会测试：
 - HTTP 连接
 - WebSocket 路径探测
 - REST API 端点
 
 ### 测试 2: 获取完整 Metadata (fetch-full-metadata.ts)
 
 获取项目的所有 job 详情，包括 `input_slot_groups`（这是绘制 lineage graph 所必需的）：
 
 ```bash
 npx ts-node src/tools/cryosmart-bridge/fetch-full-metadata.ts \
   --url http://192.168.4.3:8080 \
   --project P52 \
   --cookie "session=your-session-here" \
   --output ./test-metadata.json
 ```
 
 ### 测试 3: 启动 WebSocket 桥接服务 (bridge.ts)
 
 如果诊断成功，启动桥接服务：
 
 ```bash
 npx ts-node src/tools/cryosmart-bridge/bridge.ts
 ```
 
 看到以下输出表示成功：
 ```
 [Bridge] Started: ws://localhost:3003
 [Bridge] Connecting to CryoSmart...
 [Bridge] Connected to CryoSmart
 ```
 
 ---
 
 ## 预期结果
 
 ### 成功标志
 
 | 组件 | 成功标志 |
 |------|----------|
 | HTTP 连接 | `✓ HTTP 200` |
 | REST API | `✓ 200 - Keys: uid, job_type, ...` |
 | WebSocket | `✓ Connection opened` |
 | Job 列表 | `Found N jobs` |
 | Job 详情 | `input_slot_groups` 数组存在且非空 |
 
 ### 常见问题
 
 #### 1. HTTP 连接失败
 - 检查 URL 是否正确
 - 检查 CryoSmart 是否运行
 - 检查防火墙设置
 
 #### 2. 401/403 认证错误
 - Cookie 可能已过期，需要重新登录 CryoSmart
 - 尝试获取新的 cookie
 
 #### 3. WebSocket 连接失败
 - CryoSmart 可能禁用了 WebSocket
 - 检查端口是否正确（默认 80/443）
 - 可能需要特定的 WebSocket 路径
 
 #### 4. 获取不到 input_slot_groups
 - 这是**关键问题**，没有这个数据就无法绘制 lineage graph
 - CryoSmart 的完整 job 详情可能只能通过 WebSocket RPC 获取
 - 需要进一步探测 CryoSmart 的 WebSocket 协议
 
 ---
 
 ## 测试记录模板
 
 请将测试结果记录在这里：
 
 ```
 测试日期: _______
 测试人员: _______
 
 CryoSmart URL: _______
 Project ID: _______
 
 === HTTP 连接测试 ===
 结果: _______
 响应状态: _______
 
 === REST API 测试 ===
 get_clear_job_list: _______
 get_current_jobs: _______
 获取到 jobs 数量: _______
 
 === WebSocket 测试 ===
 连接的路径: _______
 协议版本: _______
 
 === Job Metadata 测试 ===
 总 jobs 数量: _______
 有 input_slot_groups 的 jobs: _______
 
 === 问题记录 ===
 1. _______
 2. _______
 
 === 下一步 ===
 1. _______
 2. _______
 ```
 
 ---
 
 ## 联系支持
 
 如果测试过程中遇到问题，请提供：
 
 1. 完整的测试输出
 2. CryoSmart 版本（如果有）
 3. 浏览器控制台的错误信息（如果有）
 4. Network 面板中 CryoSmart 请求的截图
