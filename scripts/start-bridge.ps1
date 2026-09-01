 # CryoSmart WebSocket Bridge 启动脚本
 # 
 # 使用方法：
 # 1. 右键点击此文件 -> "使用 PowerShell 运行"
 # 2. 或在终端中运行: .\scripts\start-bridge.ps1
 
 $ErrorActionPreference = "Stop"
 
 Write-Host ""
 Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
 Write-Host "║        CryoSmart WebSocket Bridge 启动器               ║" -ForegroundColor Cyan
 Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
 Write-Host ""
 
 # 检测是否安装了 ws 模块
 Write-Host "[1/4] 检查依赖..." -ForegroundColor Yellow
 try {
     $wsCheck = npm list ws --depth=0 2>$null
     if ($wsCheck -notmatch "ws@") {
         Write-Host "  [安装] 需要安装 ws 模块..." -ForegroundColor Yellow
         npm install ws --save-dev
     } else {
         Write-Host "  [OK] ws 模块已安装" -ForegroundColor Green
     }
 } catch {
     Write-Host "  [安装] 需要安装 ws 模块..." -ForegroundColor Yellow
     npm install ws --save-dev
 }
 
 # 配置
 $cryosmartUrl = "http://192.168.4.3:8080"
 $bridgePort = 3003
 
 Write-Host ""
 Write-Host "[2/4] 配置参数" -ForegroundColor Yellow
 Write-Host "  CryoSmart: $cryosmartUrl" -ForegroundColor White
 Write-Host "  Bridge端口: $bridgePort" -ForegroundColor White
 
 # 检查端口是否被占用
 Write-Host ""
 Write-Host "[3/4] 检查端口占用..." -ForegroundColor Yellow
 $portInUse = Get-NetTCPConnection -LocalPort $bridgePort -ErrorAction SilentlyContinue
 if ($portInUse) {
     Write-Host "  [警告] 端口 $bridgePort 已被占用" -ForegroundColor Red
     Write-Host "  PID: $($portInUse.OwningProcess)" -ForegroundColor Yellow
     
     $choice = Read-Host "是否尝试终止占用端口的进程? (y/N)"
     if ($choice -eq 'y' -or $choice -eq 'Y') {
         Stop-Process -Id $portInUse.OwningProcess -Force
         Start-Sleep -Seconds 1
         Write-Host "  [OK] 进程已终止" -ForegroundColor Green
     } else {
         $bridgePort = $bridgePort + 1
         Write-Host "  [INFO] 将使用端口 $bridgePort" -ForegroundColor Yellow
     }
 }
 
 # 启动服务
 Write-Host ""
 Write-Host "[4/4] 启动桥接服务..." -ForegroundColor Yellow
 Write-Host ""
 
 $env:CRYOSMART_URL = $cryosmartUrl
 $env:BRIDGE_PORT = $bridgePort.ToString()
 
 Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
 Write-Host "  CryoSmart: $cryosmartUrl" -ForegroundColor White
 Write-Host "  Bridge:    ws://localhost:$bridgePort" -ForegroundColor White
 Write-Host "  Health:    http://localhost:$bridgePort/health" -ForegroundColor White
 Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
 Write-Host ""
 Write-Host "按 Ctrl+C 停止服务" -ForegroundColor Gray
 Write-Host ""
 
 # 运行桥接服务
 try {
     npx ts-node -T src/tools/cryosmart-bridge/bridge.ts
 } catch {
     Write-Host ""
     Write-Host "[错误] 启动失败。请检查：" -ForegroundColor Red
     Write-Host "  1. TypeScript 是否正确配置" -ForegroundColor Yellow
     Write-Host "  2. 桥接脚本是否存在" -ForegroundColor Yellow
     Write-Host "  3. CryoSmart 服务器是否可达" -ForegroundColor Yellow
     Write-Host ""
     Write-Host "备用方案 - 使用 Node.js 直接运行：" -ForegroundColor Cyan
     Write-Host "  1. 先编译: npx tsc src/tools/cryosmart-bridge/bridge.ts" -ForegroundColor Gray
     Write-Host "  2. 然后运行: node dist/tools/cryosmart-bridge/bridge.js" -ForegroundColor Gray
 }
