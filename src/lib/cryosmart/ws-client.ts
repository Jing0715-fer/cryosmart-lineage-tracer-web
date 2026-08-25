 /**
  * CryoSmart WebSocket Client
  * 
  * CryoSmart 使用 WebSocket 进行实时通信，认证通过 URL 中的 token：
  * ws://<host>:<port>/ws/<token>
  * 
  * 发现的 WebSocket 端点：
  * ws://192.168.202.11:8080/ws/J5mg_jmUduorTdt2TrG91NCHQyYrzCE5BXOFBEJDl9Y
  * 
  * REST API 响应格式：
  * { data: [...], msg: "..." } 或 { data: {...}, pagination: {...} }
  */
 
 export interface WsConfig {
   /** CryoSmart 服务器地址，如 http://192.168.202.11:8080 */
   baseUrl: string;
   /** WebSocket token（从登录 URL 中获取，如 /ws/<token>） */
   token: string;
 }
 
 export interface WsMessage {
   id?: string;
   method?: string;
   result?: unknown;
   error?: unknown;
   event?: string;
   data?: unknown;
   params?: unknown;
   [key: string]: unknown;
 }
 
 export type WsEventHandler = (message: WsMessage) => void;
 
 export class CryoSmartWsClient {
   private ws: WebSocket | null = null;
   private config: WsConfig;
   private eventHandlers: Map<string, Set<WsEventHandler>> = new Map();
   private reconnectAttempts = 0;
   private maxReconnectAttempts = 10;
   private reconnectDelay = 5000;
   private shouldReconnect = true;
   private isConnected = false;
 
   constructor(config: WsConfig) {
     this.config = config;
   }
 
   /** 连接到 CryoSmart WebSocket */
   connect(): Promise<void> {
     return new Promise((resolve, reject) => {
       const wsUrl = this.config.baseUrl
         .replace('http://', 'ws://')
         .replace('https://', 'wss://') + `/ws/${this.config.token}`;
       
       console.log('[CryoSmartWs] Connecting to:', wsUrl);
       
       try {
         this.ws = new WebSocket(wsUrl);
       } catch (err) {
         reject(err);
         return;
       }
 
       const timeout = setTimeout(() => {
         reject(new Error('Connection timeout'));
       }, 30000);
 
       this.ws.onopen = () => {
         clearTimeout(timeout);
         console.log('[CryoSmartWs] Connected!');
         this.isConnected = true;
         this.reconnectAttempts = 0;
         this.emit('connected', {});
         resolve();
       };
 
       this.ws.onmessage = (event) => {
         try {
           const message = JSON.parse(event.data) as WsMessage;
           console.log('[CryoSmartWs] Received:', JSON.stringify(message).slice(0, 200));
           this.handleMessage(message);
         } catch (e) {
           console.error('[CryoSmartWs] Parse error:', e);
         }
       };
 
       this.ws.onclose = (event) => {
         console.log('[CryoSmartWs] Disconnected:', event.code, event.reason);
         this.isConnected = false;
         this.emit('disconnected', { code: event.code, reason: event.reason });
         
         if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
           this.scheduleReconnect();
         }
       };
 
       this.ws.onerror = (error) => {
         console.error('[CryoSmartWs] Error:', error);
         clearTimeout(timeout);
         reject(error);
       };
     });
   }
 
   /** 断开连接 */
   disconnect(): void {
     this.shouldReconnect = false;
     if (this.ws) {
       this.ws.close();
       this.ws = null;
     }
   }
 
   /** 发送 RPC 请求 */
   send(method: string, params?: unknown): Promise<unknown> {
     return new Promise((resolve, reject) => {
       if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
         reject(new Error('Not connected'));
         return;
       }
 
       const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
       const message: WsMessage = { id, method, params };
       
       const handler = (response: WsMessage) => {
         if (response.id === id || response.result !== undefined) {
           this.off('message', handler);
           if (response.error) {
             reject(response.error);
           } else {
             resolve(response.result);
           }
         }
       };
 
       this.on('message', handler);
       this.ws.send(JSON.stringify(message));
       
       // Timeout after 30 seconds
       setTimeout(() => {
         this.off('message', handler);
         reject(new Error(`Request ${method} timed out`));
       }, 30000);
     });
   }
 
   /** 订阅事件 */
   subscribe(event: string, handler: WsEventHandler): void {
     if (!this.eventHandlers.has(event)) {
       this.eventHandlers.set(event, new Set());
     }
     this.eventHandlers.get(event)!.add(handler);
   }
 
   /** 取消订阅 */
   unsubscribe(event: string, handler: WsEventHandler): void {
     this.eventHandlers.get(event)?.delete(handler);
   }
 
   /** 监听消息 */
   on(event: string, handler: WsEventHandler): void {
     this.subscribe(event, handler);
   }
 
   /** 移除监听 */
   off(event: string, handler: WsEventHandler): void {
     this.unsubscribe(event, handler);
   }
 
   /** 检查连接状态 */
   get connected(): boolean {
     return this.isConnected;
   }
 
   private handleMessage(message: WsMessage): void {
     // Emit to specific event handlers
     if (message.event) {
       this.emit(message.event, message);
     }
     
     // Always emit as generic message
     this.emit('message', message);
   }
 
   private emit(event: string, data: unknown): void {
     const handlers = this.eventHandlers.get(event);
     if (handlers) {
       handlers.forEach((handler) => handler(data as WsMessage));
     }
   }
 
   private scheduleReconnect(): void {
     this.reconnectAttempts++;
     const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
     
     console.log(`[CryoSmartWs] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
     
     setTimeout(() => {
       if (this.shouldReconnect && !this.isConnected) {
         this.connect().catch(console.error);
       }
     }, delay);
   }
 }
 
 /**
  * 从 CryoSmart URL 中提取 WebSocket token
  * CryoSmart 的 WebSocket token 在 URL 路径中，如 /ws/<token>
  */
 export function extractWsToken(url: string): string | null {
   // Match /ws/<token> pattern
   const match = url.match(/\/ws\/([A-Za-z0-9_-]+)/);
   return match ? match[1] : null;
 }
 
 /**
  * 获取 CryoSmart WebSocket URL
  */
 export function buildWsUrl(baseUrl: string, token: string): string {
   return baseUrl
     .replace('http://', 'ws://')
     .replace('https://', 'wss://') + `/ws/${token}`;
 }
