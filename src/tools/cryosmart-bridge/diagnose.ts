 /**
  * CryoSmart 连接诊断工具
  * 
  * 这个脚本用于诊断 CryoSmart 连接问题，探测 WebSocket 协议。
  * 
  * 使用方法：
  * npx ts-node src/tools/cryosmart-bridge/diagnose.ts --url http://192.168.4.3:8080
  */
 
 import { WebSocket } from 'ws';
 import * as readline from 'readline';
 
 interface Options {
   url: string;
   method?: string;
   timeout?: number;
 }
 
 function parseArgs(): Options {
   const args = process.argv.slice(2);
   const options: Options = {
     url: 'http://192.168.4.3:8080',
     timeout: 10000,
   };
 
   for (let i = 0; i < args.length; i++) {
     if (args[i] === '--url' && i + 1 < args.length) {
       options.url = args[++i];
     } else if (args[i] === '--method' && i + 1 < args.length) {
       options.method = args[++i];
     } else if (args[i] === '--timeout' && i + 1 < args.length) {
       options.timeout = parseInt(args[++i], 10);
     }
   }
 
   return options;
 }
 
 function printBanner() {
   console.log('');
   console.log('╔═══════════════════════════════════════════════════════════════════╗');
   console.log('║           CryoSmart Connection Diagnostic Tool                  ║');
   console.log('╚═══════════════════════════════════════════════════════════════════╝');
   console.log('');
 }
 
 async function testHttpConnection(url: string): Promise<boolean> {
   console.log('[1/5] Testing HTTP connection...');
   try {
     const http = await import('http');
     return new Promise((resolve) => {
       const req = http.get(url, (res) => {
         console.log(`  ✓ HTTP ${res.statusCode} - ${url}`);
         console.log(`    Headers: ${Object.keys(res.headers).slice(0, 5).join(', ')}...`);
         resolve(true);
       });
       req.on('error', (e) => {
         console.log(`  ✗ HTTP Error: ${e.message}`);
         resolve(false);
       });
       req.setTimeout(5000, () => {
         console.log('  ✗ HTTP Timeout');
         req.destroy();
         resolve(false);
       });
     });
   } catch (e: unknown) {
     const msg = e instanceof Error ? e.message : String(e);
     console.log(`  ✗ Error: ${msg}`);
     return false;
   }
 }
 
 async function probeWebSocketPaths(url: string): Promise<string[]> {
   console.log('');
   console.log('[2/5] Probing WebSocket paths...');
   
   const baseUrl = url.replace('http://', '').replace('https://', '');
   const host = baseUrl.split(':')[0];
   const port = baseUrl.includes(':') ? parseInt(baseUrl.split(':')[1], 10) : (url.startsWith('https') ? 443 : 80);
   
   const wsPaths = [
     '/api/subscribe',
     '/api/ws',
     '/ws',
     '/socket',
     '/api/v1/ws',
     '/ws/subscribe',
     '/api/stream',
   ];
   
   const foundPaths: string[] = [];
   
   for (const path of wsPaths) {
     try {
       const wsUrl = `ws://${host}:${port}${path}`;
       console.log(`  Testing: ${wsUrl}`);
       
       const ws = new WebSocket(wsUrl, {
         headers: { 'Origin': url },
       });
       
       const result = await new Promise<'success' | 'auth' | 'reject' | 'timeout'>((resolve) => {
         const timer = setTimeout(() => {
           ws.close();
           resolve('timeout');
         }, 3000);
         
         ws.on('open', () => {
           clearTimeout(timer);
           console.log(`    ✓ Connection opened (path: ${path})`);
           ws.close();
           resolve('success');
         });
         
         ws.on('error', (err) => {
           clearTimeout(timer);
           const msg = err.message || '';
           if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')) {
             resolve('auth');
           } else if (msg.includes('ECONNREFUSED')) {
             console.log(`    ✗ Connection refused`);
             resolve('reject');
           } else {
             console.log(`    Error: ${msg.substring(0, 50)}`);
             resolve('reject');
           }
         });
       });
       
       if (result === 'success') {
         foundPaths.push(path);
         console.log(`    ✓ Working WebSocket path: ${path}`);
       } else if (result === 'auth') {
         console.log(`    ~ Needs authentication: ${path}`);
         foundPaths.push(path + ' (auth required)');
       }
     } catch (e: unknown) {
       const msg = e instanceof Error ? e.message : String(e);
       console.log(`    ✗ ${msg.substring(0, 50)}`);
     }
   }
   
   return foundPaths;
 }
 
 async function testAuthenticatedWs(url: string): Promise<void> {
   console.log('');
   console.log('[3/5] Testing authenticated WebSocket connection...');
   console.log('  Please provide your session cookie to test authenticated access');
   console.log('  Format: session=xxx; csrftoken=yyy');
   console.log('');
   
   const rl = readline.createInterface({
     input: process.stdin,
     output: process.stdout,
   });
   
   const cookie = await new Promise<string>((resolve) => {
     rl.question('  Paste your session cookie (or press Enter to skip): ', (answer) => {
       resolve(answer.trim());
     });
   });
   
   rl.close();
   
   if (!cookie) {
     console.log('  Skipped');
     return;
   }
   
   // Test with cookie
   const baseUrl = url.replace('http://', '').replace('https://', '');
   const host = baseUrl.split(':')[0];
   const port = baseUrl.includes(':') ? parseInt(baseUrl.split(':')[1], 10) : 80;
   
   const wsUrl = `ws://${host}:${port}/api/subscribe`;
   console.log(`  Connecting to: ${wsUrl}`);
   
   return new Promise((resolve) => {
     const ws = new WebSocket(wsUrl, {
       headers: {
         'Origin': url,
         'Cookie': cookie,
       },
     });
     
     const timer = setTimeout(() => {
       console.log('  Timeout - no response');
       ws.close();
       resolve();
     }, 10000);
     
     ws.on('open', () => {
       console.log('  ✓ Connected!');
       console.log('  Sending ping...');
       ws.send(JSON.stringify({ method: 'ping', id: '1' }));
     });
     
     ws.on('message', (data) => {
       console.log('  Received:', data.toString().substring(0, 200));
       clearTimeout(timer);
       ws.close();
       resolve();
     });
     
     ws.on('error', (err) => {
       console.log('  ✗ Error:', err.message);
       clearTimeout(timer);
       resolve();
     });
   });
 }
 
 async function probeRestEndpoints(url: string): Promise<void> {
   console.log('');
   console.log('[4/5] Probing REST API endpoints...');
   
   const http = await import('http');
   
   const endpoints = [
     '/api/projects',
     '/api/job/get_clear_job_list',
     '/api/job/get_current_jobs',
   ];
   
   for (const ep of endpoints) {
     try {
       const fullUrl = `${url}${ep}`;
       console.log(`  Testing: ${fullUrl}`);
       
       const result = await new Promise<{ status: number; keys?: string[] }>((resolve) => {
         const req = http.get(fullUrl, (res) => {
           let data = '';
           res.on('data', (chunk) => { data += chunk; });
           res.on('end', () => {
             try {
               const json = JSON.parse(data);
               const keys = Object.keys(json).slice(0, 5);
               resolve({ status: res.statusCode || 0, keys });
             } catch {
               resolve({ status: res.statusCode || 0 });
             }
           });
         });
         req.on('error', () => resolve({ status: 0 }));
         req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0 }); });
       });
       
       if (result.status >= 200 && result.status < 300) {
         console.log(`    ✓ ${result.status} - Keys: ${result.keys?.join(', ') || 'N/A'}`);
       } else if (result.status === 401 || result.status === 403) {
         console.log(`    ~ ${result.status} - Authentication required`);
       } else {
         console.log(`    ✗ ${result.status || 'Error'}`);
       }
     } catch (e: unknown) {
       console.log(`    ✗ ${e instanceof Error ? e.message : 'Error'}`);
     }
   }
 }
 
 function printSummary(url: string, wsPaths: string[]) {
   console.log('');
   console.log('[5/5] Summary');
   console.log('═══════════════════════════════════════════════════════════════════');
   console.log(`  Target: ${url}`);
   console.log('');
   console.log('  WebSocket paths tested:');
   if (wsPaths.length > 0) {
     wsPaths.forEach((p) => console.log(`    • ${p}`));
   } else {
     console.log('    (none found)');
   }
   console.log('');
   console.log('  Next steps:');
   console.log('    1. If WebSocket paths found, update bridge.ts with the correct path');
   console.log('    2. Run: npx ts-node src/tools/cryosmart-bridge/bridge.ts');
   console.log('    3. Connect web app to ws://localhost:3003');
   console.log('');
   console.log('═══════════════════════════════════════════════════════════════════');
 }
 
 async function main() {
   const options = parseArgs();
   printBanner();
   
   console.log(`Target: ${options.url}`);
   console.log('');
   
   // Test 1: HTTP
   const httpOk = await testHttpConnection(options.url);
   if (!httpOk) {
     console.log('');
     console.log('❌ Cannot reach CryoSmart server. Please check:');
     console.log('   1. Is the server running?');
     console.log('   2. Is the IP address correct?');
     console.log('   3. Is there a firewall blocking the connection?');
     process.exit(1);
   }
   
   // Test 2: WebSocket paths
   const wsPaths = await probeWebSocketPaths(options.url);
   
   // Test 3: Authenticated WS (optional)
   await testAuthenticatedWs(options.url);
   
   // Test 4: REST endpoints
   await probeRestEndpoints(options.url);
   
   // Summary
   printSummary(options.url, wsPaths);
 }
 
 main().catch(console.error);
