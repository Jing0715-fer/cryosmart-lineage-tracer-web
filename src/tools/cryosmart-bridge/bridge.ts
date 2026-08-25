 /**
  * CryoSmart WebSocket Bridge
  *
  * 本地桥接服务：将 CryoSmart 服务器的 WebSocket 连接到你的 web 应用。
  *
  * 使用方法：
  * 1. 安装依赖: npm install ws
  * 2. 运行: npx ts-node src/tools/cryosmart-bridge/bridge.ts
  * 3. 或编译后: node dist/tools/cryosmart-bridge/bridge.js
  *
  * 然后在 web 应用的 Live Connect 中，连接到 ws://localhost:3003
  */
 
 import { WebSocketServer, WebSocket } from 'ws';
 import { createServer } from 'http';
 
 interface CryoSmartMessage {
   id?: string;
   method?: string;
   result?: unknown;
   error?: unknown;
   event?: string;
   data?: unknown;
   params?: unknown;
 }
 
 interface BridgeConfig {
   cryosmartUrl: string;
   bridgePort: number;
   webAppPort: number;
   projectId?: string;
 }
 
 const CRYOSMART_WS_PATH = '/api/subscribe';
 
 class CryoSmartBridge {
   private cryosmartWs: WebSocket | null = null;
   private clientSockets: Set<WebSocket> = new Set();
   private server: WebSocketServer | null = null;
   private httpServer: ReturnType<typeof createServer> | null = null;
   private reconnectTimer: NodeJS.Timeout | null = null;
   private pingTimer: NodeJS.Timeout | null = null;
   private config: BridgeConfig;
   private isConnected = false;
   private messageId = 0;
 
   constructor(config: BridgeConfig) {
     this.config = config;
   }
 
   async start(): Promise<void> {
     this.httpServer = createServer((req, res) => {
       if (req.url === '/health') {
         res.writeHead(200, { 'Content-Type': 'application/json' });
         res.end(JSON.stringify({
           status: 'ok',
           cryosmartConnected: this.isConnected,
           clients: this.clientSockets.size,
           timestamp: new Date().toISOString()
         }));
         return;
       }
       if (req.url === '/events') {
         res.writeHead(200, {
           'Content-Type': 'text/event-stream',
           'Cache-Control': 'no-cache',
           'Connection': 'keep-alive'
         });
         res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
         return;
       }
       res.writeHead(404);
       res.end();
     });
 
     this.server = new WebSocketServer({ server: this.httpServer });
 
     this.server.on('connection', (ws: WebSocket, req) => {
       console.log(`[Bridge] Client connected from ${req.socket.remoteAddress}`);
       this.clientSockets.add(ws);
 
       ws.send(JSON.stringify({
         type: 'bridge_status',
         connected: this.isConnected,
         cryosmartUrl: this.config.cryosmartUrl
       }));
 
       ws.on('message', (data: Buffer) => {
         try {
           const msg = JSON.parse(data.toString());
           this.handleClientMessage(ws, msg);
         } catch (e) {
           console.error('[Bridge] Client message parse error:', e);
         }
       });
 
       ws.on('close', () => {
         this.clientSockets.delete(ws);
       });
 
       ws.on('error', (err) => {
         console.error('[Bridge] Client WS error:', err.message);
         this.clientSockets.delete(ws);
       });
     });
 
     return new Promise((resolve) => {
       this.httpServer!.listen(this.config.bridgePort, () => {
         console.log(`[Bridge] Started: ws://localhost:${this.config.bridgePort}`);
         console.log(`[Bridge] Health check: http://localhost:${this.config.bridgePort}/health`);
         this.connectToCryoSmart();
         resolve();
       });
     });
   }
 
   private connectToCryoSmart(): void {
     const wsUrl = this.config.cryosmartUrl
       .replace('http://', 'ws://')
       .replace('https://', 'wss://') + CRYOSMART_WS_PATH;
     console.log(`[Bridge] Connecting to CryoSmart: ${wsUrl}`);
 
     this.cryosmartWs = new WebSocket(wsUrl, {
       headers: { 'Origin': this.config.cryosmartUrl }
     });
 
     this.cryosmartWs.on('open', () => {
       console.log('[Bridge] Connected to CryoSmart');
       this.isConnected = true;
       this.broadcastToClients({ type: 'cryosmart_connected', url: this.config.cryosmartUrl });
       this.startPing();
     });
 
     this.cryosmartWs.on('message', (data: Buffer) => {
       try {
         const message = JSON.parse(data.toString());
         this.handleCryoSmartMessage(message);
       } catch (e) {
         console.error('[Bridge] CryoSmart message parse error:', e);
       }
     });
 
     this.cryosmartWs.on('close', (code, reason) => {
       console.log(`[Bridge] CryoSmart disconnected: ${code}`);
       this.isConnected = false;
       this.stopPing();
       this.broadcastToClients({ type: 'cryosmart_disconnected', code });
       this.scheduleReconnect();
     });
 
     this.cryosmartWs.on('error', (err) => {
       console.error('[Bridge] CryoSmart WS error:', err.message);
     });
   }
 
   private handleCryoSmartMessage(message: CryoSmartMessage): void {
     console.log('[Bridge] CryoSmart msg:', JSON.stringify(message).substring(0, 150));
     this.broadcastToClients({ type: 'cryosmart_message', ...message });
   }
 
   private handleClientMessage(ws: WebSocket, message: { type: string; [key: string]: unknown }): void {
     switch (message.type) {
       case 'rpc':
         this.sendToCryoSmart({ id: String(++this.messageId), ...message.payload as object });
         break;
       case 'subscribe':
         if (message.projectId) {
           this.sendToCryoSmart({
             id: String(++this.messageId),
             method: 'subscribe_project',
             params: { project_id: message.projectId }
           });
         }
         break;
       case 'get_jobs':
         this.sendToCryoSmart({
           id: String(++this.messageId),
           method: 'get_jobs',
           params: message.params || {}
         });
         break;
       case 'get_job_detail':
         this.sendToCryoSmart({
           id: String(++this.messageId),
           method: 'get_job_detail',
           params: { uid: message.uid }
         });
         break;
       case 'ping':
         ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
         break;
     }
   }
 
   private sendToCryoSmart(message: object): void {
     if (this.cryosmartWs && this.cryosmartWs.readyState === WebSocket.OPEN) {
       this.cryosmartWs.send(JSON.stringify(message));
     }
   }
 
   private broadcastToClients(message: object): void {
     const data = JSON.stringify(message);
     for (const client of this.clientSockets) {
       if (client.readyState === WebSocket.OPEN) {
         client.send(data);
       }
     }
   }
 
   private startPing(): void {
     this.pingTimer = setInterval(() => {
       if (this.cryosmartWs && this.cryosmartWs.readyState === WebSocket.OPEN) {
         this.cryosmartWs.send(JSON.stringify({ method: 'ping', id: String(++this.messageId) }));
       }
     }, 30000);
   }
 
   private stopPing(): void {
     if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
   }
 
   private scheduleReconnect(): void {
     if (this.reconnectTimer) return;
     console.log('[Bridge] Reconnecting in 5s...');
     this.reconnectTimer = setTimeout(() => {
       this.reconnectTimer = null;
       if (!this.isConnected) this.connectToCryoSmart();
     }, 5000);
   }
 
   stop(): void {
     console.log('[Bridge] Stopping...');
     this.stopPing();
     if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
     for (const client of this.clientSockets) client.close();
     this.clientSockets.clear();
     if (this.cryosmartWs) { this.cryosmartWs.close(); this.cryosmartWs = null; }
     if (this.server) this.server.close();
     if (this.httpServer) this.httpServer.close();
     this.isConnected = false;
   }
 }
 
 // Main
 const config: BridgeConfig = {
   cryosmartUrl: process.env.CRYOSMART_URL || 'http://192.168.4.3:8080',
   bridgePort: parseInt(process.env.BRIDGE_PORT || '3003', 10),
   webAppPort: parseInt(process.env.WEBAPP_PORT || '3000', 10),
   projectId: process.env.PROJECT_ID,
 };
 
 console.log('╔═══════════════════════════════════════════════════════════╗');
 console.log('║        CryoSmart WebSocket Bridge v1.0                  ║');
 console.log('╠═══════════════════════════════════════════════════════════╣');
 console.log(`║  CryoSmart: ${config.cryosmartUrl.padEnd(38)}║`);
 console.log(`║  Bridge:    ws://localhost:${config.bridgePort}`.padEnd(52) + '║');
 console.log('╚═══════════════════════════════════════════════════════════╝');
 
 const bridge = new CryoSmartBridge(config);
 bridge.start();
 
 process.on('SIGINT', () => { bridge.stop(); process.exit(0); });
 process.on('SIGTERM', () => { bridge.stop(); process.exit(0); });
 const CRYOSMART_WS_PATH = '/ws';
