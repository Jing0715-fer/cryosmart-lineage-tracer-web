/**
 * CryoSmart Capture - Injection Script v8
 *
 * Run this in CryoSmart console (F12 > Console) to capture:
 * - Complete job metadata (input_slot_groups, params_spec, etc.)
 * - overview_assets scraped from each job's Overview tab (select_2D images, FSC resolution)
 * - ui_tile_images and output_group_images from Vue store
 * - Job log images: force-loads the LAZY jobLogs state via the store's own
 *   log-loading action (calibrated), falls back to HTTP log endpoints
 * - CryoSmart session (origin + auth token + browser cookie) for map/image downloads
 *
 * Ported DOM-scraping logic from CryoSmartLineageTracer_3.0 content.js.
 */

const WEB_APP_URL = 'https://preview-chat-0d40d05f-7154-4111-b4cc-6d6455063c5d.space-z.ai';
const AUTO_OPEN = true;
// How many completed jobs to scrape images for (0 = all). Cap to avoid long runs.
const MAX_JOB_SCRAPE = 20;

function log(...args) {
  console.log('%c[CryoSmart Capture v8]', 'color: #0d9488; font-weight: bold', ...args);
}

/* ------------------------------------------------------------------ */
/* DOM-scraping helpers (ported from CryoSmartLineageTracer_3.0)       */
/* ------------------------------------------------------------------ */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseRoute() {
  const m = location.href.match(/#\/projects\/([^/]+)(?:\/([^/]+))?(?:\/(J\d+))?/i);
  return {
    projectId: m ? m[1] : '',
    experimentId: m && m[2] ? m[2] : '',
    jobId: m && m[3] ? m[3].toUpperCase() : '',
  };
}

function findClickableByText(text) {
  const wanted = text.toLowerCase();
  const elements = Array.from(document.querySelectorAll('a, button, [role="button"], [tabindex], div, span'));
  const candidates = elements
    .filter(el => el.getBoundingClientRect().width > 0)
    .filter(el => (el.innerText || el.textContent || '').trim().toLowerCase().includes(wanted))
    .sort((a, b) => (a.innerText || a.textContent || '').length - (b.innerText || b.textContent || '').length);
  return candidates[0] ? (candidates[0].closest('a, button, [role="button"], [tabindex]') || candidates[0]) : null;
}

function findJobElement(uid) {
  const re = new RegExp(`\\b${uid}\\b`, 'i');
  const elements = Array.from(document.querySelectorAll('a, button, [role="button"], [tabindex], div, span'));
  return elements
    .filter(el => el.getBoundingClientRect().width > 0)
    .filter(el => re.test((el.innerText || el.textContent || '').trim()))
    .sort((a, b) => (a.innerText || a.textContent || '').length - (b.innerText || b.textContent || '').length)[0] || null;
}

async function waitForRoute(uid, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (parseRoute().jobId === uid) return true;
    await sleep(250);
  }
  return false;
}

function normalizeJob(value) {
  const text = String(value || '').trim();
  return /^J/i.test(text) ? text.toUpperCase() : `J${text}`;
}

async function openJob(uid, projectId, experimentId) {
  uid = normalizeJob(uid);
  if (parseRoute().jobId === uid) return true;
  if (experimentId) {
    location.hash = `#/projects/${projectId}/${experimentId}/${uid}`;
    if (await waitForRoute(uid, 10000)) { await sleep(900); return true; }
  }
  const viewAll = findClickableByText('View All');
  if (viewAll) { viewAll.click(); await sleep(700); }
  const jobEl = findJobElement(uid);
  if (!jobEl) return false;
  (jobEl.closest('a, button') || jobEl).click();
  if (await waitForRoute(uid, 15000)) { await sleep(1000); return true; }
  return false;
}

async function clickTab(name) {
  const tab = findClickableByText(name);
  if (!tab) return false;
  tab.click();
  await sleep(1000);
  return true;
}

function absoluteUrl(value) {
  try { return new URL(value, location.origin).href; } catch { return ''; }
}

function nearestText(el, regex) {
  let node = el;
  while (node && node !== document.body && node.parentElement) {
    const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    if (regex.test(text)) return text;
    node = node.parentElement;
  }
  return '';
}

function isPngLink(link) {
  const label = (link.innerText || link.textContent || link.getAttribute('aria-label') || '').trim().toLowerCase();
  const href = link.getAttribute('href') || '';
  if (label === 'pdf' || /\bpdf\b/i.test(label) || /\.pdf(?:$|\?)/i.test(href)) return false;
  return label === 'png' || /\[png\]|\bpng\b/i.test(label) || /(?:^|[._-])png(?:$|[._-])/i.test(href);
}

function parseResolutionFromText(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const patterns = [
    /(?:FSC|resolution|res)[^0-9]{0,60}([0-9]+(?:\.[0-9]+)?)\s*(?:Å|A\b|angstrom)/i,
    /([0-9]+(?:\.[0-9]+)?)\s*(?:Å|A\b|angstrom)[^.;]{0,60}(?:FSC|resolution|res)/i,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    const n = m && Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 20) return Math.round(n * 100) / 100;
  }
  return null;
}

function collectSelect2DImage() {
  const candidates = [];
  const seen = new Set();

  // Strategy 1: PNG links near "Selected N classes" text
  const pngLinks = Array.from(document.querySelectorAll('a[href*="/api/log_image/"]')).filter(isPngLink);
  for (const link of pngLinks) {
    const text = nearestText(link, /Selected\s+\d+\s+classes/i);
    const m = text.match(/Selected\s+(\d+)\s+classes/i);
    if (!m) continue;
    const url = absoluteUrl(link.getAttribute('href') || '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    candidates.push({ url, text, classes_selected: Number(m[1]), source: 'png_link' });
  }

  // Strategy 2: img tags near "Selected N classes" text
  const allImgs = Array.from(document.querySelectorAll('img[src*="/api/log_image/"]'));
  for (const img of allImgs) {
    const text = nearestText(img, /Selected\s+\d+\s+classes/i);
    const m = text.match(/Selected\s+(\d+)\s+classes/i);
    if (!m) continue;
    const url = absoluteUrl(img.getAttribute('src') || '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    candidates.push({ url, text, classes_selected: Number(m[1]), source: 'inline_image' });
  }

  // Score: png_link > inline_image; prefer "Selected N classes" text; prefer shorter text
  candidates.sort((a, b) => {
    const score = (c) => {
      let s = c.source === 'png_link' ? 0 : 1;
      if (!/Selected\s+\d+\s+classes/i.test(c.text)) s += 10;
      if (c.text.length > 900) s += 2;
      return s;
    };
    return score(a) - score(b) || a.text.length - b.text.length;
  });

  return candidates[0] || null;
}

function collectResolution() {
  const bodyText = document.body.innerText || '';
  return parseResolutionFromText(bodyText);
}

async function scrapeOverviewAssets(projectId, experimentId, uid) {
  const opened = await openJob(uid, projectId, experimentId);
  if (!opened) return null;
  await clickTab('Overview');

  // Wait for content to settle (up to 8 seconds)
  const started = Date.now();
  let lastLen = 0;
  let lastChanged = Date.now();
  while (Date.now() - started < 8000) {
    const text = document.body.innerText || '';
    if (text.length !== lastLen) { lastLen = text.length; lastChanged = Date.now(); }
    if (Date.now() - lastChanged > 600) break;
    await sleep(300);
  }

  if ((document.body.innerText || '').length < 50) return null;

  const selected = collectSelect2DImage();
  const resolution = collectResolution();

  const assets = {};
  if (selected) {
    assets.select_2d = {
      selected_classes_image: selected.url,
      selected_classes_src: selected.url,
      selected_classes_original_url: selected.url,
      classes_selected: selected.classes_selected,
      source: 'overview_log_selected_classes',
      log_text: selected.text,
    };
  }
  if (resolution !== null) {
    assets.resolution_A = resolution;
  }
  return Object.keys(assets).length > 0 ? assets : null;
}

/* ------------------------------------------------------------------ */
/* Store access helpers                                               */
/* ------------------------------------------------------------------ */

function findSocketStore() {
  const els = [...document.querySelectorAll('*')].filter(e => e.__vue_app__);
  for (const el of els) {
    const pinia = el.__vue_app__?.config?.globalProperties?.$pinia;
    if (pinia?._s) {
      const s = pinia._s.get('socketStore');
      if (s?.projectsInMap) return s;
    }
  }
  return null;
}

function getSessionInfo() {
  const origin = window.location.origin;
  const store = findSocketStore();
  let token = null;
  if (store?.socketManager?.token) { token = 'Bearer ' + store.socketManager.token; }
  // Capture the browser cookie too — CryoSmart authenticates /api/log_image
  // with the session cookie (the WS token alone is NOT enough). document.cookie
  // misses HttpOnly cookies, but it's the best a page script can do.
  let cookie = null;
  try { cookie = document.cookie || null; } catch (e) { cookie = null; }
  log('Session:', {
    origin,
    hasToken: !!token,
    hasCookie: !!(cookie && cookie.length),
    cookieLength: cookie ? cookie.length : 0,
  });
  return { origin, auth: token, cookie };
}

async function waitForData(maxMs = 20000) {
  const store = findSocketStore();
  if (!store) throw new Error('socketStore not found');
  const hasData = () => {
    const pm = store.projectsInMap;
    if (!pm) return false;
    const keys = Object.keys(pm);
    if (keys.length === 0) return false;
    const p = pm[keys[0]];
    return p?.experiments?.[0]?.jobs?.length > 0;
  };
  log('Waiting for data...');
  const start = Date.now();
  while (!hasData() && (Date.now() - start) < maxMs) {
    try { if (store.getProjects) store.getProjects(); } catch (e) {}
    await sleep(500);
  }
  if (!hasData()) {
    const pm = store.projectsInMap;
    log('Available:', Object.keys(pm || {}).map(k => k + ':' + (pm[k]?.experiments?.[0]?.jobs?.length || 0) + ' jobs'));
  }
  return store;
}

/* ------------------------------------------------------------------ */
/* Data extraction                                                    */
/* ------------------------------------------------------------------ */

function extractJobsFromStore(store, project) {
  const jobs = [];
  for (const exp of (project.experiments || [])) {
    if (!exp?.jobs) continue;
    for (const j of exp.jobs) {
      jobs.push({
        uid: j.uid,
        job_type: j.job_type || 'unknown',
        status: j.status || 'unknown',
        project_uid: project.uid,
        experiment_uid: exp.uid,
        workspace_uid: exp.uid,
        title: j.title || j.description || 'Untitled',
        created_at: j.created_at,
        completed_at: j.completed_at,
        failed_at: j.failed_at,
        killed_at: j.killed_at,
        started_at: j.started_at,
        parents: j.parents || [],
        children: j.children || [],
        input_slot_groups: j.input_slot_groups || [],
        output_result_groups: j.output_result_groups || [],
        params_spec: j.params_spec || {},
        // Image references from Vue store
        ui_tile_images: j.ui_tile_images || [],
        output_group_images: j.output_group_images || {},
        created_by_user_id: j.created_by_user_id,
        deleted: j.deleted || false,
        priority: j.priority || 0,
        queued_to_lane: j.queued_to_lane,
        resources_allocated: j.resources_allocated || {},
      });
    }
  }
  return jobs;
}

function extractData(store, projectId) {
  const pm = store.projectsInMap;
  let project = projectId ? pm[projectId] : null;
  if (!project) {
    const m = location.href.match(/\/projects\/([^/?#]+)/i);
    if (m?.[1] && pm[m[1]]) project = pm[m[1]];
  }
  if (!project) {
    const keys = Object.keys(pm);
    project = pm[keys[0]];
  }
  if (!project) throw new Error('No project found');
  const pid = project.uid || Object.keys(pm)[0];
  log('Project:', pid, project.title);
  const jobs = extractJobsFromStore(store, project);
  if (jobs.length === 0) throw new Error('No jobs in project');
  return {
    projectUid: pid,
    projectTitle: project.title || 'Untitled',
    experimentUid: project.experiments[0]?.uid,
    jobs,
    capturedAt: new Date().toISOString(),
  };
}

async function scrapeImagesForJobs(jobs, projectId, experimentId) {
  const completedJobs = jobs.filter(j =>
    (j.status === 'completed' || j.status === 'failed') && !j.deleted
  ).slice(0, MAX_JOB_SCRAPE > 0 ? MAX_JOB_SCRAPE : jobs.length);

  if (completedJobs.length === 0) {
    log('No completed jobs to scrape images for.');
    return;
  }

  log(`Scraping Overview images for ${completedJobs.length} jobs (this may take a while)...`);
  let done = 0;
  for (const job of completedJobs) {
    try {
      const assets = await scrapeOverviewAssets(projectId, experimentId, job.uid);
      if (assets) {
        job.overview_assets = assets;
        log(`  [${done + 1}/${completedJobs.length}] ${job.uid}: select_2d=${!!assets.select_2d} resolution=${assets.resolution_A || 'n/a'}`);
      } else {
        log(`  [${done + 1}/${completedJobs.length}] ${job.uid}: no images found`);
      }
    } catch (e) {
      log(`  [${done + 1}/${completedJobs.length}] ${job.uid}: ERROR ${e.message}`);
    }
    done++;
  }
  log(`Scraping done. ${done} jobs processed.`);
}

/* ------------------------------------------------------------------ */
/* Lazy jobLogs force-loading + log image extraction                  */
/* ------------------------------------------------------------------ */

/** Pull {fileid, name, text, flags} refs out of a job's log entries (log.imgfiles). */
function extractLogImages(logs) {
  const out = [];
  if (!Array.isArray(logs)) return out;
  for (const entry of logs) {
    if (!entry) continue;
    const files = entry.imgfiles || (entry.type === 'image' ? entry.files : null);
    if (!files || !files.length) continue;
    for (const file of files) {
      const fid = typeof file === 'string' ? file : (file && (file.fileid || file.file_id || file.id));
      if (!fid) continue;
      const name = (file && file.name) || entry.name || entry.title || ('log_image_' + out.length);
      // Carry the entry's text + flags so the web app can derive friendlier
      // names and categories (plots/fsc/slice) downstream.
      out.push({ fileid: fid, name, text: entry.text || null, flags: entry.flags || null });
    }
  }
  return out;
}

/** Find store functions that look like log loaders (name matches /log/i, then /detail/i). */
function findLogActions(store) {
  const found = [];
  const names = {};
  let obj = store;
  for (let depth = 0; depth < 4 && obj; depth++) {
    try {
      for (const n of Object.getOwnPropertyNames(obj)) names[n] = 1;
    } catch (e) { /* ignore */ }
    try { obj = Object.getPrototypeOf(obj); } catch (e) { break; }
  }
  for (const name of Object.keys(names)) {
    if (!/(log|detail)/i.test(name)) continue;
    try {
      if (typeof store[name] === 'function') found.push({ name, fn: store[name] });
    } catch (e) { /* ignore */ }
  }
  found.sort((a, b) => (/log/i.test(a.name) ? 0 : 1) - (/log/i.test(b.name) ? 0 : 1));
  return found;
}

/** Poll store.jobLogs[uid] until it appears (or timeout). */
function waitForLogs(store, uid, ms) {
  return new Promise(resolve => {
    const t0 = Date.now();
    (function check() {
      try {
        const logs = store.jobLogs && store.jobLogs[uid];
        if (logs && logs.length) return resolve(logs);
      } catch (e) { /* ignore */ }
      if (Date.now() - t0 >= ms) return resolve(null);
      setTimeout(check, 120);
    })();
  });
}

/** Fallback: probe common HTTP log endpoints (same-origin, cookies attached). */
async function httpLogProbe(uid) {
  const paths = [
    '/api/job/get_job_logs?job_uid=' + encodeURIComponent(uid),
    '/api/job/get_logs?job_uid=' + encodeURIComponent(uid),
    '/api/job/get_job_log?job_uid=' + encodeURIComponent(uid),
    '/api/log/get_logs?job_uid=' + encodeURIComponent(uid),
  ];
  for (const p of paths) {
    try {
      const r = await fetch(p, { credentials: 'include' });
      if (!r.ok) continue;
      const d = await r.json();
      const arr = d && (d.data || d.logs) || (Array.isArray(d) ? d : null);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) { /* try next */ }
  }
  return null;
}

/**
 * jobLogs is LAZY (only fetched when a job's detail view opens). We
 * calibrate the store's log-loading action on ONE job — trying arg shapes
 * uid / {job_uid} / {uid} / [uid] — then replay the winning call for every
 * remaining job. Best-effort: failure never aborts the capture.
 */
async function collectLogImages(store, jobs) {
  const result = {};
  let hasState = false;
  try { hasState = 'jobLogs' in store; } catch (e) { /* ignore */ }
  if (!hasState) {
    log('jobLogs state not found on this CryoSmart build — skipping log images.');
    return result;
  }

  // 1. Harvest logs already loaded.
  const pending = [];
  for (const job of jobs) {
    const uid = job && job.uid;
    if (!uid) continue;
    const existing = store.jobLogs && store.jobLogs[uid];
    if (existing && existing.length) {
      const imgs = extractLogImages(existing);
      if (imgs.length) result[uid] = imgs;
    } else {
      pending.push(uid);
    }
  }
  log(`Logs already loaded for ${jobs.length - pending.length} job(s); ${pending.length} to force-load.`);
  if (pending.length === 0) return result;

  // 2. Calibrate the loader call on the first pending job.
  const actions = findLogActions(store);
  log('Log loader candidates:', actions.map(a => a.name).join(', ') || 'none');

  const calibUid = pending[0];
  let winning = null; // { action, shapeIdx } or { http: true }
  const shapes = [calibUid, { job_uid: calibUid }, { uid: calibUid }, [calibUid]];

  outer:
  for (const action of actions) {
    for (let s = 0; s < shapes.length; s++) {
      try {
        const r = action.fn.call(store, shapes[s]);
        if (r && typeof r.then === 'function') r.catch(() => {});
      } catch (e) { /* ignore */ }
      const logs = await waitForLogs(store, calibUid, 800);
      if (logs) {
        winning = { action, shapeIdx: s };
        const cImgs = extractLogImages(logs);
        if (cImgs.length) result[calibUid] = cImgs;
        break outer;
      }
    }
  }

  if (!winning) {
    const probe = await httpLogProbe(calibUid);
    if (probe) {
      winning = { http: true };
      const pImgs = extractLogImages(probe);
      if (pImgs.length) result[calibUid] = pImgs;
    }
  }

  if (!winning) {
    log('Could not trigger lazy log loading — capturing without log images. ' +
        '(Tip: open one job detail view in CryoSmart, then re-run.)');
    return result;
  }
  log('Log loading works via ' + (winning.http ? 'HTTP endpoint' : `store action "${winning.action.name}"`) + ' — collecting...');

  // 3. Replay for every remaining job (time-boxed).
  const t0 = Date.now();
  const BUDGET_MS = 60000;
  for (let j = 1; j < pending.length; j++) {
    const uid = pending[j];
    if (result[uid]) continue;
    if (Date.now() - t0 > BUDGET_MS) {
      log(`Log collection time budget reached — stopping after ${j} job(s).`);
      break;
    }
    let logs = null;
    const cached = store.jobLogs && store.jobLogs[uid];
    if (cached && cached.length) {
      logs = cached;
    } else if (winning.http) {
      logs = await httpLogProbe(uid);
    } else {
      const arg = [uid, { job_uid: uid }, { uid }, [uid]][winning.shapeIdx];
      try {
        const r = winning.action.fn.call(store, arg);
        if (r && typeof r.then === 'function') r.catch(() => {});
      } catch (e) { /* ignore */ }
      logs = await waitForLogs(store, uid, 1200);
      if (!logs) logs = await httpLogProbe(uid); // per-job HTTP fallback
    }
    if (logs) {
      const imgs = extractLogImages(logs);
      if (imgs.length) result[uid] = imgs;
    }
    if ((j + 1) % 10 === 0) log(`Log loading progress: ${j + 1}/${pending.length} job(s)...`);
  }

  log(`Log images collected for ${Object.keys(result).length} of ${jobs.length} job(s)`);
  return result;
}

async function upload(data, session, logImages) {
  log('Uploading', data.jobs.length, 'jobs...');
  log('Session credentials:', {
    origin: session.origin,
    auth: session.auth ? 'Bearer [token]' : 'none',
    cookie: session.cookie && session.cookie.length ? session.cookie.length + ' chars' : 'none',
  });
  const payload = {
    project_uid: data.projectUid,
    experiment_uid: data.experimentUid,
    jobs: data.jobs,
    job_log_images: logImages || {},
    source: 'CryoSmart Console Capture v8 (+ DOM overview scraping + log images)',
    captured_at: data.capturedAt,
    cryosmart_origin: session.origin,
    cryosmart_auth: session.auth,
    cryosmart_cookie: session.cookie,
  };
  const r = await fetch(WEB_APP_URL + '/api/cryosmart/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const res = await r.json();
  if (!res.ok) throw new Error(res.error || 'Upload failed');
  const nLogs = Object.keys(logImages || {}).length;
  log(`Success! Token: ${res.token} | Session: ${res.has_session ? 'Available' : 'Not available'} | Log images: ${nLogs} job(s)`);
  return res;
}

async function capture(projectId) {
  log('CryoSmart Capture v8 -- starting');
  const session = getSessionInfo();
  const store = await waitForData();
  const data = extractData(store, projectId);

  // Force-load the LAZY jobLogs and extract log image fileids.
  let logImages = {};
  try {
    logImages = await collectLogImages(store, data.jobs);
  } catch (e) {
    log('Log image collection failed (non-fatal):', e.message);
  }

  // Scrape overview assets (select_2D images, FSC resolution) from DOM
  await scrapeImagesForJobs(data.jobs, data.projectUid, data.experimentUid);

  const result = await upload(data, session, logImages);
  if (AUTO_OPEN) {
    window.open(WEB_APP_URL + '/?imported=' + result.token + '&pid=' + data.projectUid, '_blank');
  }
  return result;
}

capture()
  .then(r => log('DONE!', r.count, 'jobs captured'))
  .catch(e => console.error('FAILED:', e.message));