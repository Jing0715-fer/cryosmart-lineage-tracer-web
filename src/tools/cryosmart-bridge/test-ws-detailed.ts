 /**
  * CryoSmart WebSocket 详细测试
  * 
  * CryoSmart 的 WebSocket 消息格式：
  * {
  *   send_type: "...",
  *   data: { code: 200, msg: "ok", data: <actual data> },
  *   request_id: "..."
  * }
  */
 
 // 在浏览器 Console 中运行这个脚本
 
 const wsUrl = 'ws://192.168.202.11:8080/ws/J5mg_jmUduorTdt2TrG91NCHQyYrzCE5BXOFBEJDl9Y';
 console.log('Connecting to:', wsUrl);
 
 const ws = new WebSocket(wsUrl);
 
 ws.onopen = () => {
   console.log('✓ Connected!');
   
   // 1. Ping
   setTimeout(() => {
     console.log('\n[1] Ping...');
     ws.send(JSON.stringify({ 
       send_type: 'command', 
       data: { method: 'ping', params: {} },
       request_id: '1'
     }));
   }, 200);
   
   // 2. 获取 job 列表
   setTimeout(() => {
     console.log('\n[2] get_clear_job_list...');
     ws.send(JSON.stringify({ 
       send_type: 'command', 
       data: { method: 'get_clear_job_list', params: { project_uid: 'P259' } },
       request_id: '2'
     }));
   }, 400);
   
   // 3. 获取单个 job 详情（关键测试）
   setTimeout(() => {
     console.log('\n[3] get_job for J13...');
     ws.send(JSON.stringify({ 
       send_type: 'command', 
       data: { method: 'get_job', params: { uid: 'J13' } },
       request_id: '3'
     }));
   }, 600);
   
   // 4. 尝试获取带参数的 job
   setTimeout(() => {
     console.log('\n[4] get_job with full params for J13...');
     ws.send(JSON.stringify({ 
       send_type: 'command', 
       data: { method: 'get_job', params: { uid: 'J13', include_params: true } },
       request_id: '4'
     }));
   }, 800);
   
   // 5. 尝试获取带连接的 job
   setTimeout(() => {
     console.log('\n[5] get_job with connections for J13...');
     ws.send(JSON.stringify({ 
       send_type: 'command', 
       data: { method: 'get_job', params: { uid: 'J13', include_connections: true } },
       request_id: '5'
     }));
   }, 1000);
 };
 
 ws.onmessage = (event) => {
   const msg = JSON.parse(event.data);
   const requestId = msg.request_id || 'N/A';
   
   // 只显示 request_id 1-5 的响应
   if (!['1','2','3','4','5'].includes(String(requestId))) return;
   
   console.log(`\n=== Response for request_id: ${requestId} ===`);
   console.log('send_type:', msg.send_type);
   console.log('code:', msg.data?.code);
   console.log('msg:', msg.data?.msg);
   
   if (msg.data?.data !== undefined) {
     const actualData = msg.data.data;
     console.log('\n--- Actual Data ---');
     console.log('Type:', Array.isArray(actualData) ? 'Array' : typeof actualData);
     
     if (Array.isArray(actualData)) {
       console.log('Length:', actualData.length);
       if (actualData.length > 0) {
         const first = actualData[0];
         console.log('First item keys:', Object.keys(first));
         console.log('Has input_slot_groups:', 'input_slot_groups' in first);
         console.log('Sample:', JSON.stringify(first).slice(0, 1000));
       }
     } else if (typeof actualData === 'object' && actualData !== null) {
       console.log('Keys:', Object.keys(actualData));
       console.log('Has input_slot_groups:', 'input_slot_groups' in actualData);
       console.log('Has params_spec:', 'params_spec' in actualData);
       console.log('Has input_slot_groups:', 'input_slot_groups' in actualData);
       console.log('Sample:', JSON.stringify(actualData).slice(0, 1000));
       
       // 如果有 input_slot_groups，完整打印
       if ('input_slot_groups' in actualData && actualData.input_slot_groups) {
         console.log('\n*** FOUND input_slot_groups! ***');
         console.log(JSON.stringify(actualData.input_slot_groups, null, 2));
       }
       
       // 如果有 params_spec，显示部分
       if ('params_spec' in actualData && actualData.params_spec) {
         console.log('\nparams_spec keys:', Object.keys(actualData.params_spec).slice(0, 10));
       }
     } else {
       console.log('Value:', String(actualData).slice(0, 200));
     }
   }
 };
 
 ws.onerror = (e) => console.log('Error:', e);
 ws.onclose = (e) => console.log('Closed:', e.code);
 
 // 15秒后关闭
 setTimeout(() => { 
   console.log('\n=== Done ===');
   ws.close(); 
 }, 15000);
