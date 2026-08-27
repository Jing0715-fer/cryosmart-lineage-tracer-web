 /**
  * CryoSmart WebSocket 测试脚本
  * 
  * 测试通过 WebSocket RPC 获取完整 job metadata（包括 input_slot_groups）
  * 
  * 运行方式（在浏览器 Console 中）：
  * 1. 先登录 CryoSmart
  * 2. F12 打开 Console
  * 3. 粘贴并运行
  */
 
 // CryoSmart 配置
 const CRYOSMART_BASE = 'http://192.168.202.11:8080';
 const PROJECT_ID = 'P259';
 
 async function testWebSocketRPC() {
   console.log('=== CryoSmart WebSocket RPC Test ===');
   
   // 1. 获取 WebSocket URL（从当前页面）
   // CryoSmart SPA 会自动建立 WebSocket 连接
   // 我们需要找到它
   
   // 方法：检查 CryoSmart 是如何建立 WebSocket 的
   // 通常是 /ws/<session_token>
   
   // 尝试从 localStorage/sessionStorage 获取 token
   let wsToken = null;
   try {
     const storageKeys = Object.keys(localStorage).filter(k => 
       k.includes('token') || k.includes('session') || k.includes('auth') || k.includes('ws')
     );
     console.log('Storage keys with auth:', storageKeys);
     
     for (const key of storageKeys) {
       const value = localStorage.getItem(key);
       console.log(`  ${key}: ${String(value).slice(0, 50)}...`);
     }
   } catch (e) {
     console.log('Cannot access localStorage:', (e as Error).message);
   }
   
   // 2. 尝试 WebSocket 连接
   // CryoSmart 使用 FastAPI/WebSockets
   // 认证 token 通常在登录响应中返回
   
   console.log('\n尝试建立 WebSocket 连接...');
   
   // 如果有 token，尝试连接
   const token = prompt('请输入 WebSocket token（或从 Network 面板的 WS 连接中复制）:');
   if (!token) {
     console.log('需要 WebSocket token 才能继续');
     return;
   }
   
   const wsUrl = `ws://192.168.202.11:8080/ws/${token}`;
   console.log('Connecting to:', wsUrl);
   
   return new Promise<void>((resolve) => {
     const ws = new WebSocket(wsUrl);
     
     ws.onopen = () => {
       console.log('✓ WebSocket 连接成功！');
       
       // 3. 发送 RPC 请求获取 job 详情
       // CryoSmart 使用 JSON-RPC 风格的消息
       
       // 首先获取项目信息
       const pingMsg = {
         method: 'ping',
         params: {}
       };
       console.log('\nSending ping...');
       ws.send(JSON.stringify(pingMsg));
       
       // 获取 jobs 列表
       setTimeout(() => {
         const getJobsMsg = {
           method: 'get_clear_job_list',
           params: { project_uid: PROJECT_ID }
         };
         console.log('Sending get_clear_job_list...');
         ws.send(JSON.stringify(getJobsMsg));
       }, 500);
       
       // 尝试获取单个 job 的完整详情
       setTimeout(() => {
         const getJobDetailMsg = {
           method: 'get_job_detail',
           params: { uid: 'J13' }
         };
         console.log('Sending get_job_detail for J13...');
         ws.send(JSON.stringify(getJobDetailMsg));
       }, 1000);
     };
     
     ws.onmessage = (event) => {
       try {
         const msg = JSON.parse(event.data);
         console.log('\n--- Received Message ---');
         console.log('Keys:', Object.keys(msg));
         
         // 检查是否有 input_slot_groups
         if (msg.result) {
           const result = msg.result;
           console.log('Result type:', typeof result);
           
           if (Array.isArray(result)) {
             console.log('Result is array, length:', result.length);
             if (result.length > 0) {
               console.log('First item keys:', Object.keys(result[0]));
               console.log('Has input_slot_groups:', 'input_slot_groups' in result[0]);
             }
           } else if (typeof result === 'object') {
             console.log('Result keys:', Object.keys(result));
             console.log('Has input_slot_groups:', 'input_slot_groups' in result);
             
             // 如果有 input_slot_groups，显示它
             if ('input_slot_groups' in result) {
               console.log('\n*** FOUND input_slot_groups! ***');
               console.log(JSON.stringify(result.input_slot_groups, null, 2));
             }
           }
           
           console.log('Sample:', JSON.stringify(result).slice(0, 500));
         }
         
         if (msg.event) {
           console.log('Event:', msg.event);
           console.log('Event data:', JSON.stringify(msg.data).slice(0, 300));
         }
       } catch (e) {
         console.log('Raw message:', event.data);
       }
     };
     
     ws.onerror = (error) => {
       console.log('WebSocket error:', error);
     };
     
     ws.onclose = (event) => {
       console.log('\nWebSocket closed:', event.code, event.reason);
       resolve();
     };
     
     // 30 秒后自动关闭
     setTimeout(() => {
       console.log('\nTimeout - closing...');
       ws.close();
       resolve();
     }, 30000);
   });
 }
 
 // 运行测试
 testWebSocketRPC();
