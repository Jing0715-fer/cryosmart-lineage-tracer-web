 /**
  * CryoSmart Live Client - WebSocket Bridge 连接器
  *
  * 这个模块允许 web 应用通过本地桥接服务连接到 CryoSmart 的 WebSocket。
  * 使用方式：
  *
  * 1. 先启动桥接服务：
  *    npx ts-node src/tools/cryosmart-bridge/bridge.ts
  *
  * 2. 在 web 应用中使用：
  *    import { createCryoSmartLiveClient } from '@/lib/cryosmart/live-client';
  *    const client = createCryoSmartLiveClient('ws://localhost:3003');
  *    client.connect();
  *    client.on('job_update', (job) => { ... });
  */
 
 import { EventEmitter } from 'events';
 
 export interface LiveClientConfig {
   /** 桥接服务地址，如 ws://localhost:3003 */
   bridgeUrl: string;
   /** 重连间隔（毫秒），默认 5000 */
   reconnectInterval?: number;
   /** 最大重连次数，默认 10 */
   maxReconnectAttempts?: number;
 }
 
 export interface CryoSmartJob {
   uid: string;
   project_uid: string;
   job_type: string;
   status: string;
   title?: string;
   created_at?: unknown;
   completed_at?: unknown;
   [key: string]: unknown;
 }
 
 export type LiveEventType =
   | 'connected'
   | 'disconnected'
   | 'job_update'
   | 'job_created'
   | 'job_completed'
   | 'jobs_list'
   | 'error';
 
 export interface LiveEvent {
   type: LiveEventType;
   data?: unknown;
   job?: CryoSmartJob;
   jobs?: CryoSmartJob[];
   error?: string;
 }
 
 class CryoSmartLiveClient extends EventEmitter {
   private ws: WebSocket | null = null;
   private config: LiveClientConfig;
   private reconnectAttempts = 0;
   private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
   private shouldReconnect = true;
   private isManualDisconnect = false;
 
   constructor(config: LiveClientConfig) {
     super();
     this.config = {
       reconnectInterval: 5000,
       maxReconnectAttempts: 10,
       ...config,
     };
   }
 
   /** 连接到桥接服务 */
   connect(): void {
     if (this.ws && this.ws.readyState === WebSocket.OPEN) {
       console.log('[LiveClient] Already connected');
       return;
     }
 
     this.isManualDisconnect = false;
     console.log(`[LiveClient] Connecting to ${this.config.bridgeUrl}...`);
 
     try {
       this.ws = new WebSocket(this.config.bridgeUrl);
       this.setupEventHandlers();
     } catch (err) {
       console.error('[LiveClient] Connection error:', err);
       this.scheduleReconnect();
     }
   }
 
   /** 断开连接 */
   disconnect(): void {
     this.shouldReconnect = false;
     this.isManualDisconnect = true;
     if (this.reconnectTimer) {
       clearTimeout(this.reconnectTimer);
       this.reconnectTimer = null;
     }
     if (this.ws) {
       this.ws.close();
       this.ws = null;
     }
     this.emit('disconnected', { reason: 'manual' });
   }
 
   /** 订阅项目更新 */
   subscribe(projectId: string): void {
     this.send({ type: 'subscribe', projectId });
   }
 
   /** 获取 jobs 列表 */
   getJobs(params?: { project_uid?: string; status?: string }): void {
     this.send({ type: 'get_jobs', params });
   }
 
   /** 获取单个 job 详情 */
   getJobDetail(uid: string): void {
     this.send({ type: 'get_job_detail', uid });
   }
 
   /** 发送 RPC 请求 */
   rpc(method: string, params?: unknown): void {
     this.send({ type: 'rpc', payload: { method, params } });
   }
 
   /** 检查连接状态 */
   isConnected(): boolean {
     return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
   }
 
   private setupEventHandlers(): void {
     if (!this.ws) return;
 
     this.ws.onopen = () => {
       console.log('[LiveClient] Connected to bridge');
       this.reconnectAttempts = 0;
       this.emit('connected', {});
     };
 
     this.ws.onmessage = (event) => {
       try {
         const message = JSON.parse(event.data);
         this.handleMessage(message);
       } catch (e) {
         console.error('[LiveClient] Message parse error:', e);
       }
     };
 
     this.ws.onclose = (event) => {
       console.log(`[LiveClient] Disconnected: ${event.code} ${event.reason}`);
       this.emit('disconnected', { code: event.code, reason: event.reason });
       
       if (this.shouldReconnect && !this.isManualDisconnect) {
         this.scheduleReconnect();
       }
     };
 
     this.ws.onerror = (error) => {
       console.error('[LiveClient] WebSocket error:', error);
       this.emit('error', { message: 'WebSocket connection error' });
     };
   }
 
   private handleMessage(message: Record<string, unknown>): void {
     console.log('[LiveClient] Message:', message.type);
 
     switch (message.type) {
       case 'bridge_status':
         console.log('[LiveClient] Bridge status:', message.connected ? 'CryoSmart connected' : 'CryoSmart not connected');
         break;
 
       case 'cryosmart_connected':
         console.log('[LiveClient] CryoSmart is connected');
         this.emit('connected', { cryosmart: true, url: message.url });
         break;
 
       case 'cryosmart_disconnected':
         console.log('[LiveClient] CryoSmart disconnected');
         this.emit('disconnected', { cryosmart: true, code: message.code });
         break;
 
       case 'cryosmart_message':
         // 处理 CryoSmart 的消息
         this.handleCryoSmartMessage(message);
         break;
 
       case 'pong':
         // 心跳响应，忽略
         break;
 
       default:
         console.log('[LiveClient] Unknown message type:', message.type);
     }
   }
 
   private handleCryoSmartMessage(message: Record<string, unknown>): void {
     // 根据 CryoSmart 的事件类型转发
     const event = message.event as string | undefined;
     const result = message.result as Record<string, unknown> | undefined;
 
     if (event) {
       switch (event) {
         case 'job_updated':
         case 'job_status_changed':
           if (result) {
             const job = this.normalizeJob(result);
             this.emit('job_update', job);
           }
           break;
 
         case 'job_created':
           if (result) {
             const job = this.normalizeJob(result);
             this.emit('job_created', job);
           }
           break;
 
         case 'job_completed':
           if (result) {
             const job = this.normalizeJob(result);
             this.emit('job_completed', job);
           }
           break;
 
         default:
           this.emit('message', message);
       }
     }
 
     // 如果是 RPC 响应
     if (result) {
       // 检查是否是 jobs 列表响应
       if (Array.isArray(result)) {
         const jobs = result.map(j => this.normalizeJob(j as Record<string, unknown>));
         this.emit('jobs_list', jobs);
       }
     }
 
     // 触发通用消息事件
     this.emit('message', message);
   }
 
   private normalizeJob(data: Record<string, unknown>): CryoSmartJob {
     return {
       uid: (data.uid || data.job_uid || '') as string,
       project_uid: (data.project_uid || '') as string,
       job_type: (data.job_type || 'unknown') as string,
       status: (data.status || 'unknown') as string,
       title: data.title as string | undefined,
       created_at: data.created_at,
       completed_at: data.completed_at,
       ...data,
     };
   }
 
   private send(message: object): void {
     if (this.ws && this.ws.readyState === WebSocket.OPEN) {
       this.ws.send(JSON.stringify(message));
     } else {
       console.warn('[LiveClient] Not connected, cannot send:', message);
     }
   }
 
   private scheduleReconnect(): void {
     if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 10)) {
       console.error('[LiveClient] Max reconnect attempts reached');
       this.emit('error', { message: 'Max reconnect attempts reached' });
       return;
     }
 
     this.reconnectAttempts++;
     const delay = this.config.reconnectInterval || 5000;
     
     console.log(`[LiveClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
     
     this.reconnectTimer = setTimeout(() => {
       this.connect();
     }, delay);
   }
 }
 
 /** 创建 CryoSmart Live 客户端实例 */
 export function createCryoSmartLiveClient(config: LiveClientConfig): CryoSmartLiveClient {
   return new CryoSmartLiveClient(config);
 }
 
 /**
  * 简化版本：轮询 + Bridge SSE
  * 
  * 如果 WebSocket 连接不可用，可以使用 Server-Sent Events 作为备用方案
  */
 export async function createSSEClient(bridgeUrl: string): Promise<EventSource> {
   const sseUrl = bridgeUrl.replace('ws://', 'http://').replace('wss://', 'https://') + '/events';
   return new EventSource(sseUrl);
 }
