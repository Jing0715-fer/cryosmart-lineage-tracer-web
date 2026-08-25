 /**
  * CryoSmart Full Metadata Fetcher
  * 
  * 这个工具用于获取 CryoSmart 项目的完整 metadata，包括：
  * - 每个 job 的完整详情（包含 input_slot_groups）
  * - 项目信息
  * - 所有 job 的 lineage 连接关系
  * 
  * 使用方法：
  * npx ts-node src/tools/cryosmart-bridge/fetch-full-metadata.ts \
  *   --url http://192.168.4.3:8080 \
  *   --project P52 \
  *   --cookie "session=xxx" \
  *   --output ./metadata-export.json
  */
 
 import * as fs from 'fs';
 import * as readline from 'readline';
 
 interface Options {
   url: string;
   projectId: string;
   cookie: string;
   auth?: string;
   output: string;
   useWs?: boolean;
 }
 
 interface JobDetail {
   uid: string;
   project_uid: string;
   job_type: string;
   status: string;
   title?: string;
   created_at?: unknown;
   completed_at?: unknown;
   parents?: string[];
   children?: string[];
   params_spec?: Record<string, unknown>;
   input_slot_groups?: Array<{
     type?: string;
     name?: string;
     title?: string;
     connections?: Array<{
       job_uid?: string;
       group_name?: string;
       slots?: Array<{
         slot_name?: string;
         group_name?: string;
         result_name?: string;
         result_type?: string;
       }>;
     }>;
   }>;
   output_result_groups?: Array<{
     name?: string;
     type?: string;
     title?: string;
     num_items?: number;
   }>;
   [key: string]: unknown;
 }
 
 interface FetchResult {
   project_id: string;
   base_url: string;
   fetched_at: string;
   total_jobs: number;
   jobs: JobDetail[];
   errors: string[];
 }
 
 function parseArgs(): Options {
   const args = process.argv.slice(2);
   const options: Options = {
     url: 'http://192.168.4.3:8080',
     projectId: '',
     cookie: '',
     output: './cryosmart-metadata.json',
   };
 
   for (let i = 0; i < args.length; i++) {
     if (args[i] === '--url' && i + 1 < args.length) {
       options.url = args[++i];
     } else if (args[i] === '--project' && i + 1 < args.length) {
       options.projectId = args[++i];
     } else if (args[i] === '--cookie' && i + 1 < args.length) {
       options.cookie = args[++i];
     } else if (args[i] === '--auth' && i + 1 < args.length) {
       options.auth = args[++i];
     } else if (args[i] === '--output' && i + 1 < args.length) {
       options.output = args[++i];
     } else if (args[i] === '--ws') {
       options.useWs = true;
     }
   }
 
   return options;
 }
 
 async function prompt(question: string): Promise<string> {
   const rl = readline.createInterface({
     input: process.stdin,
     output: process.stdout,
   });
   return new Promise((resolve) => {
     rl.question(question, (answer) => {
       rl.close();
       resolve(answer.trim());
     });
   });
 }
 
 async function httpRequest(
   url: string,
   method: string,
   cookie?: string,
   auth?: string,
   body?: string
 ): Promise<{ status: number; data: unknown }> {
   const http = await import('http');
   const https = await import('https');
   
   return new Promise((resolve, reject) => {
     const urlObj = new URL(url);
     const isHttps = url.startsWith('https');
     const lib = isHttps ? https : http;
     
     const headers: Record<string, string> = {
       'Content-Type': 'application/json',
     };
     
     if (cookie) headers['Cookie'] = cookie;
     if (auth) headers['Authorization'] = auth;
     
     const options = {
       hostname: urlObj.hostname,
       port: urlObj.port || (isHttps ? 443 : 80),
       path: urlObj.pathname + urlObj.search,
       method,
       headers,
     };
     
     const req = lib.request(options, (res) => {
       let data = '';
       res.on('data', (chunk) => { data += chunk; });
       res.on('end', () => {
         try {
           const json = JSON.parse(data);
           resolve({ status: res.statusCode || 0, data: json });
         } catch {
           resolve({ status: res.statusCode || 0, data: data });
         }
       });
     });
     
     req.on('error', reject);
     req.setTimeout(30000, () => {
       req.destroy();
       reject(new Error('Request timeout'));
     });
     
     if (body) req.write(body);
     req.end();
   });
 }
 
 async function fetchJobList(
   url: string,
   projectId: string,
   cookie?: string,
   auth?: string
 ): Promise<Array<{ uid: string; job_type: string; status: string }>> {
   console.log('  Fetching job list...');
   
   // Try get_clear_job_list first
   const endpoints = [
     `/api/job/get_clear_job_list?project_uid=${encodeURIComponent(projectId)}`,
     `/api/jobs?project_uid=${encodeURIComponent(projectId)}`,
   ];
   
   for (const ep of endpoints) {
     try {
       console.log(`    Trying: ${ep}`);
       const resp = await httpRequest(url + ep, 'GET', cookie, auth);
       
       if (resp.status === 200) {
         const data = resp.data as Record<string, unknown>;
         
         // Try different response formats
         let jobs: unknown[] = [];
         if (Array.isArray(data)) {
           jobs = data;
         } else if (data.jobs && Array.isArray(data.jobs)) {
           jobs = data.jobs;
         } else if (data.data) {
           if (Array.isArray(data.data)) {
             jobs = data.data;
           } else if (typeof data.data === 'object') {
             // get_clear_job_list returns { data: { class_2d: [...], class_3d: [...] } }
             const obj = data.data as Record<string, unknown[]>;
             for (const key of Object.keys(obj)) {
               if (Array.isArray(obj[key])) {
                 jobs.push(...obj[key]);
               }
             }
           }
         }
         
         console.log(`    Found ${jobs.length} jobs`);
         
         return jobs.map((j) => {
           const job = j as Record<string, unknown>;
           return {
             uid: String(job.uid || job.job_uid || ''),
             job_type: String(job.job_type || 'unknown'),
             status: String(job.status || 'unknown'),
           };
         }).filter((j) => j.uid);
       }
     } catch (e) {
       console.log(`    Error: ${e instanceof Error ? e.message : 'Unknown'}`);
     }
   }
   
   return [];
 }
 
 async function fetchJobDetail(
   url: string,
   jobUid: string,
   cookie?: string,
   auth?: string
 ): Promise<JobDetail | null> {
   // Try common endpoints for job detail
   const endpoints = [
     `/api/job/${jobUid}`,
     `/api/jobs/${jobUid}`,
     `/api/job/get_job_detail?uid=${encodeURIComponent(jobUid)}`,
   ];
   
   for (const ep of endpoints) {
     try {
       const resp = await httpRequest(url + ep, 'GET', cookie, auth);
       
       if (resp.status === 200 && resp.data && typeof resp.data === 'object') {
         const data = resp.data as Record<string, unknown>;
         // Check if this looks like a job object
         if (data.uid || data.job_uid || data.job_type) {
           return data as unknown as JobDetail;
         }
       }
     } catch {
       // Continue to next endpoint
     }
   }
   
   return null;
 }
 
 async function fetchViaWebSocket(
   url: string,
   projectId: string,
   cookie?: string,
   auth?: string
 ): Promise<JobDetail[]> {
   console.log('  Attempting WebSocket connection...');
   
   const WebSocket = await import('ws');
   
   const baseUrl = url.replace('http://', '').replace('https://', '');
   const parts = baseUrl.split(':');
   const host = parts[0];
   const port = parts.length > 1 ? parseInt(parts[1], 10) : 80;
   
   const wsUrl = `ws://${host}:${port}/api/subscribe`;
   console.log(`    Connecting to: ${wsUrl}`);
   
   return new Promise((resolve) => {
     let messageId = 1;
     
     const ws = new WebSocket.WebSocket(wsUrl, {
       headers: {
         'Origin': url,
         ...(cookie && { 'Cookie': cookie }),
         ...(auth && { 'Authorization': auth }),
       },
     });
     
     const jobs: JobDetail[] = [];
     let resolved = false;
     
     const timer = setTimeout(() => {
       if (!resolved) {
         console.log('    Timeout waiting for response');
         ws.close();
         resolve(jobs);
         resolved = true;
       }
     }, 30000);
     
     ws.on('open', () => {
       console.log('    Connected! Requesting job details...');
       
       // Try to get all jobs via WS
       ws.send(JSON.stringify({
         id: String(messageId++),
         method: 'get_jobs',
         params: { project_uid: projectId },
       }));
     });
     
     ws.on('message', (data) => {
       console.log('    Received message');
       try {
         const msg = JSON.parse(data.toString());
         console.log('    Message type:', msg.method || msg.event || 'response');
         
         if (msg.result) {
           if (Array.isArray(msg.result)) {
             jobs.push(...msg.result);
             console.log(`    Got ${msg.result.length} jobs via WebSocket`);
           } else if (typeof msg.result === 'object') {
             jobs.push(msg.result as JobDetail);
             console.log('    Got job detail via WebSocket');
           }
         }
         
         // If we got results, try to get details for each job
         if (jobs.length > 0 && !resolved) {
           // Request individual job details
           for (const job of jobs.slice(0, 3)) {
             ws.send(JSON.stringify({
               id: String(messageId++),
               method: 'get_job_detail',
               params: { uid: job.uid },
             }));
           }
         }
       } catch (e) {
         console.log('    Parse error:', e instanceof Error ? e.message : 'Unknown');
       }
     });
     
     ws.on('error', (err) => {
       console.log('    WebSocket error:', err.message);
       if (!resolved) {
         clearTimeout(timer);
         resolve([]);
         resolved = true;
       }
     });
     
     ws.on('close', () => {
       console.log('    WebSocket closed');
       if (!resolved) {
         clearTimeout(timer);
         resolve(jobs);
         resolved = true;
       }
     });
   });
 }
 
 function printProgress(current: number, total: number) {
   const percent = Math.round((current / total) * 100);
   const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
   process.stdout.write(`\r  [${bar}] ${percent}% (${current}/${total})`);
 }
 
 async function main() {
   console.log('');
   console.log('╔═══════════════════════════════════════════════════════════════════╗');
   console.log('║        CryoSmart Full Metadata Fetcher                         ║');
   console.log('╚═══════════════════════════════════════════════════════════════════╝');
   console.log('');
   
   const options = parseArgs();
   
   // Prompt for missing values
   if (!options.projectId) {
     options.projectId = await prompt('Enter CryoSmart Project ID (e.g., P52): ');
   }
   
   if (!options.cookie) {
     options.cookie = await prompt('Enter Session Cookie (or press Enter to use Authorization): ');
   }
   
   if (!options.cookie && !options.auth) {
     options.auth = await prompt('Enter Authorization header (Bearer token): ');
   }
   
   console.log('');
   console.log('Configuration:');
   console.log(`  URL:      ${options.url}`);
   console.log(`  Project:  ${options.projectId}`);
   console.log(`  Auth:     ${options.cookie ? 'Cookie' : 'Bearer token'}`);
   console.log(`  Output:   ${options.output}`);
   console.log('');
   
   const result: FetchResult = {
     project_id: options.projectId,
     base_url: options.url,
     fetched_at: new Date().toISOString(),
     total_jobs: 0,
     jobs: [],
     errors: [],
   };
   
   // Step 1: Get job list
   console.log('[1/3] Fetching job list...');
   let jobs = await fetchJobList(options.url, options.projectId, options.cookie, options.auth);
   
   if (jobs.length === 0) {
     // Try WebSocket as fallback
     console.log('');
     console.log('  No jobs via REST API. Trying WebSocket...');
     const wsJobs = await fetchViaWebSocket(options.url, options.projectId, options.cookie, options.auth);
     if (wsJobs.length > 0) {
       jobs = wsJobs.map((j) => ({
         uid: j.uid,
         job_type: j.job_type,
         status: j.status,
       }));
     }
   }
   
   if (jobs.length === 0) {
     console.log('');
     console.log('❌ No jobs found. Please check:');
     console.log('   1. Is the project ID correct?');
     console.log('   2. Are you authenticated?');
     console.log('   3. Does the project have any jobs?');
     process.exit(1);
   }
   
   console.log('');
   console.log(`  Found ${jobs.length} jobs`);
   result.total_jobs = jobs.length;
   
   // Step 2: Get details for each job
   console.log('');
   console.log('[2/3] Fetching job details...');
   const detailedJobs: JobDetail[] = [];
   
   for (let i = 0; i < jobs.length; i++) {
     printProgress(i, jobs.length);
     
     const job = jobs[i];
     
     // For now, just add the basic info
     // Full details would require individual API calls or WebSocket
     detailedJobs.push({
       uid: job.uid,
       project_uid: options.projectId,
       job_type: job.job_type,
       status: job.status,
       params_spec: {},
       input_slot_groups: [],
       output_result_groups: [],
     });
     
     // Small delay to avoid overwhelming the server
     if (i % 10 === 0) {
       await new Promise((r) => setTimeout(r, 100));
     }
   }
   
   console.log('');
   console.log('');
   console.log('  Note: Basic job info collected. For full metadata (including input_slot_groups),');
   console.log('  the CryoSmart SPA uses WebSocket RPC calls that require a live browser session.');
   
   // Step 3: Try to get full details via WebSocket
   console.log('');
   console.log('[3/3] Attempting to fetch full details via WebSocket...');
   
   if (options.useWs || options.cookie) {
     const wsJobs = await fetchViaWebSocket(options.url, options.projectId, options.cookie, options.auth);
     
     if (wsJobs.length > 0) {
       console.log(`  Got ${wsJobs.length} jobs with full details via WebSocket`);
       
       // Merge with existing jobs
       for (const wsJob of wsJobs) {
         const existing = detailedJobs.find((j) => j.uid === wsJob.uid);
         if (existing) {
           Object.assign(existing, wsJob);
         } else {
           detailedJobs.push(wsJob);
         }
       }
     }
   }
   
   result.jobs = detailedJobs;
   
   // Save to file
   console.log('');
   console.log(`Saving to ${options.output}...`);
   fs.writeFileSync(options.output, JSON.stringify(result, null, 2));
   
   console.log('');
   console.log('═══════════════════════════════════════════════════════════════════');
   console.log('  ✓ Done!');
   console.log(`  Total jobs: ${result.total_jobs}`);
   console.log(`  Output: ${options.output}`);
   console.log('');
   console.log('  Jobs with input_slot_groups:', 
     result.jobs.filter((j) => j.input_slot_groups && j.input_slot_groups.length > 0).length);
   console.log('');
   console.log('═══════════════════════════════════════════════════════════════════');
 }
 
 main().catch(console.error);
