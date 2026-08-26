/**
 * CryoSmart Capture - Content Script v3
 * Fixed: Search ALL __vue_app__ elements, not just #q-app
 */

const EXTENSION_ID = chrome.runtime.id;

const CONFIG = {
  MAX_WAIT_TIME: 15000,
  POLL_INTERVAL: 500,
  DEBUG_MODE: true
};

function log(...args) {
  if (CONFIG.DEBUG_MODE) {
    console.log('[CryoSmart Capture]', ...args);
  }
}

function logError(...args) {
  console.error('[CryoSmart Capture]', ...args);
}

let detectedStore = null;
let detectionComplete = false;

/**
 * Search ALL elements with __vue_app__ for Pinia stores
 */
function findAllPiniaStores() {
  log('Searching all elements for Pinia stores...');
  
  const elements = [...document.querySelectorAll('*')].filter(el => el.__vue_app__);
  log(`Found ${elements.length} elements with __vue_app__`);
  
  for (const el of elements) {
    try {
      const vueApp = el.__vue_app__;
      if (!vueApp) continue;
      
      // Vue 3: app.config.globalProperties.$pinia
      const pinia = vueApp.config?.globalProperties?.$pinia;
      if (pinia) {
        log('Found pinia at element:', el.tagName, el.className.substring(0, 50));
        
        if (pinia._s) {
          // Pinia 2.x style
          const storeNames = [...pinia._s.keys()];
          log('Pinia stores available:', storeNames);
          
          // Look for stores that have projectsInMap
          for (const name of storeNames) {
            try {
              const store = pinia._s.get(name);
              if (store && store.projectsInMap) {
                log('Found store with projectsInMap:', name);
                return { store, name };
              }
            } catch (e) {
              // Ignore errors getting individual stores
            }
          }
          
          // Return first store that might work
          if (storeNames.length > 0) {
            log('No projectsInMap found, returning first store:', storeNames[0]);
            return { store: pinia._s.get(storeNames[0]), name: storeNames[0] };
          }
        }
        
        if (pinia.state?.value?.projectsInMap) {
          log('Found projectsInMap in pinia.state.value');
          return { store: pinia.state.value, name: 'pinia-state' };
        }
      }
    } catch (e) {
      log('Error checking element:', e.message);
    }
  }
  
  // Try window globals
  log('Trying window globals...');
  if (window.__pinia__) {
    const pinia = window.__pinia__;
    if (pinia._s) {
      const storeNames = [...pinia._s.keys()];
      log('window.__pinia__ stores:', storeNames);
      
      for (const name of storeNames) {
        const store = pinia._s.get(name);
        if (store && store.projectsInMap) {
          log('Found projectsInMap in window.__pinia__ store:', name);
          return { store, name };
        }
      }
    }
  }
  
  if (window.pinia?._s) {
    const storeNames = [...window.pinia._s.keys()];
    log('window.pinia stores:', storeNames);
    
    for (const name of storeNames) {
      const store = window.pinia._s.get(name);
      if (store && store.projectsInMap) {
        log('Found projectsInMap in window.pinia store:', name);
        return { store, name };
      }
    }
  }
  
  // Try pinia state object directly
  if (window.__pinia__?.state?.value) {
    const state = window.__pinia__.state.value;
    for (const key of Object.keys(state)) {
      if (state[key]?.projectsInMap) {
        log('Found projectsInMap in pinia state:', key);
        return { store: state[key], name: key };
      }
    }
  }
  
  return null;
}

/**
 * Wait for projects to be loaded in store
 */
async function waitForProjects(maxWait = 15000) {
  const start = Date.now();
  let result = findAllPiniaStores();
  
  while (!result && (Date.now() - start) < maxWait) {
    await new Promise(r => setTimeout(r, CONFIG.POLL_INTERVAL));
    result = findAllPiniaStores();
  }
  
  return result;
}

/**
 * Extract project data
 */
function extractProjectData(projectId, store) {
  const projectMap = store.projectsInMap;
  if (!projectMap) {
    throw new Error('projectsInMap not found');
  }
  
  log('Available projects:', Object.keys(projectMap));
  
  let project = projectId ? projectMap[projectId] : null;
  
  if (!project) {
    const urlMatch = window.location.href.match(/\/projects\/([^/?#]+)/i);
    const hashId = urlMatch ? urlMatch[1] : null;
    
    if (hashId && projectMap[hashId]) {
      project = projectMap[hashId];
      projectId = hashId;
      log('Found project from URL:', projectId);
    }
  }
  
  if (!project) {
    const keys = Object.keys(projectMap);
    if (keys.length === 0) throw new Error('No projects found');
    project = projectMap[keys[0]];
    projectId = project.uid || keys[0];
    log('Using first project:', projectId);
  }
  
  const jobs = [];
  const experiments = project.experiments || [];
  
  for (const exp of experiments) {
    if (!exp.jobs) continue;
    log(`Exp ${exp.uid}: ${exp.jobs.length} jobs`);
    
    for (const job of exp.jobs) {
      jobs.push({
        uid: job.uid,
        job_type: job.job_type || 'unknown',
        status: job.status || 'unknown',
        project_uid: projectId,
        experiment_uid: exp.uid,
        workspace_uid: exp.uid,
        title: job.title || job.description || 'Untitled',
        created_at: job.created_at,
        completed_at: job.completed_at,
        failed_at: job.failed_at,
        killed_at: job.killed_at,
        started_at: job.started_at,
        parents: job.parents || [],
        children: job.children || [],
        input_slot_groups: job.input_slot_groups || [],
        output_result_groups: job.output_result_groups || [],
        params_spec: job.params_spec || {},
        created_by_user_id: job.created_by_user_id,
        deleted: job.deleted || false,
        priority: job.priority || 0,
        queued_to_lane: job.queued_to_lane,
        resources_allocated: job.resources_allocated || {}
      });
    }
  }
  
  if (jobs.length === 0) {
    throw new Error('No jobs found in project ' + projectId);
  }
  
  log('Extracted', jobs.length, 'jobs');
  
  return {
    projectUid: projectId,
    projectTitle: project.title || 'Untitled',
    experimentUid: experiments[0]?.uid,
    jobs,
    capturedAt: new Date().toISOString()
  };
}

/**
 * Capture CryoSmart session info (origin + WS token + browser cookie).
 * Content scripts share the page's DOM, so document.cookie is readable here
 * (non-HttpOnly cookies only). The cookie is what CryoSmart checks on
 * /api/log_image requests — the WS token alone is not enough.
 */
function captureSessionInfo() {
  const origin = window.location.origin;
  let auth = null;
  try {
    if (detectedStore?.socketManager?.token) {
      auth = 'Bearer ' + detectedStore.socketManager.token;
    }
  } catch (e) {
    // token access can throw if the store is a raw state object
  }
  let cookie = null;
  try { cookie = document.cookie || null; } catch (e) { cookie = null; }
  log('Session:', {
    origin,
    hasToken: !!auth,
    hasCookie: !!(cookie && cookie.length),
  });
  return { origin, auth, cookie };
}

/**
 * Upload to web app
 */
async function uploadToWebApp(data, webAppUrl) {
  log('Uploading to:', webAppUrl);

  const session = captureSessionInfo();

  const response = await fetch(webAppUrl + '/api/cryosmart/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_uid: data.projectUid,
      experiment_uid: data.experimentUid,
      jobs: data.jobs,
      source: 'CryoSmart Chrome Extension v3',
      captured_at: data.capturedAt,
      cryosmart_origin: session.origin,
      cryosmart_auth: session.auth,
      cryosmart_cookie: session.cookie
    })
  });
  
  if (!response.ok) {
    throw new Error('Upload failed: ' + response.status);
  }
  
  const result = await response.json();
  
  if (!result.ok) {
    throw new Error('Server error: ' + (result.error || 'unknown'));
  }
  
  log('Success! Token:', result.token, '| Session:', result.has_session ? 'Available (auth + cookie forwarded)' : 'Not available');
  
  return {
    success: true,
    token: result.token,
    count: result.count,
    projectUid: result.project_uid,
    webAppUrl: webAppUrl + '/?imported=' + result.token + '&pid=' + data.projectUid
  };
}

/**
 * Main capture
 */
async function capture(options = {}) {
  const { projectId = null, webAppUrl = null, autoOpen = true } = options;
  
  if (!webAppUrl) {
    const stored = await chrome.storage.sync.get(['webAppUrl']);
    webAppUrl = stored.webAppUrl || 'http://localhost:3006';
  }
  
  // Find store
  const result = await waitForProjects();
  
  if (!result) {
    throw new Error(
      'CryoSmart Vue store not found.\n\n' +
      'Make sure:\n' +
      '1. You are on a CryoSmart project page\n' +
      '2. The page has fully loaded\n' +
      '3. Projects are visible in the UI'
    );
  }
  
  log('Store found! Type:', result.name);
  
  const data = extractProjectData(projectId, result.store);
  const uploadResult = await uploadToWebApp(data, webAppUrl);
  
  if (autoOpen) {
    chrome.tabs.create({ url: uploadResult.webAppUrl, active: true });
  }
  
  return uploadResult;
}

/**
 * Get status
 */
async function getStatus() {
  if (!detectionComplete) {
    const result = await waitForProjects(3000);
    detectedStore = result?.store || null;
    detectionComplete = true;
  }
  
  const hasProjects = detectedStore?.projectsInMap && 
                      Object.keys(detectedStore.projectsInMap).length > 0;
  
  const urlMatch = window.location.href.match(/\/projects\/([^/?#]+)/i);
  const currentProjectId = urlMatch ? urlMatch[1] : null;
  
  let jobCount = 0;
  if (currentProjectId && detectedStore?.projectsInMap) {
    const project = detectedStore.projectsInMap[currentProjectId];
    if (project) {
      jobCount = (project.experiments || []).reduce(
        (sum, exp) => sum + (exp.jobs ? exp.jobs.length : 0), 0
      );
    }
  }
  
  return {
    success: true,
    connected: !!detectedStore,
    hasProjects,
    currentProjectId,
    currentProjectTitle: currentProjectId && detectedStore?.projectsInMap?.[currentProjectId]?.title,
    jobCount,
    message: detectedStore
      ? (hasProjects ? `Connected - ${jobCount} jobs in ${currentProjectId || 'project'}`
                     : 'CryoSmart loaded, no projects yet')
      : 'CryoSmart detected but store not found'
  };
}

/**
 * Get projects
 */
async function getProjects() {
  if (!detectedStore) {
    const result = await waitForProjects(3000);
    detectedStore = result?.store || null;
    detectionComplete = true;
  }
  
  if (!detectedStore?.projectsInMap) {
    throw new Error('Projects not available');
  }
  
  const projects = [];
  const projectMap = detectedStore.projectsInMap;
  
  for (const key of Object.keys(projectMap)) {
    const project = projectMap[key];
    if (project && typeof project === 'object') {
      const jobCount = (project.experiments || []).reduce(
        (sum, exp) => sum + (exp.jobs ? exp.jobs.length : 0), 0
      );
      projects.push({
        uid: project.uid || key,
        title: project.title || 'Untitled',
        jobCount,
        experimentCount: (project.experiments || []).length
      });
    }
  }
  
  return projects;
}

// ==================== MESSAGE HANDLER ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log('Message received:', message.action);
  
  if (message.action === 'capture') {
    capture(message.options || {})
      .then(result => sendResponse(result))
      .catch(err => {
        logError('Capture error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
  
  if (message.action === 'getStatus') {
    getStatus()
      .then(status => sendResponse(status))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (message.action === 'getProjects') {
    getProjects()
      .then(projects => sendResponse({ success: true, projects }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (message.action === 'debug') {
    const allStores = findAllPiniaStores();
    sendResponse({
      url: window.location.href,
      hasQApp: !!document.querySelector('#q-app'),
      vueAppElements: [...document.querySelectorAll('*')].filter(e => e.__vue_app__).length,
      storeFound: !!detectedStore,
      storeHasProjects: detectedStore?.projectsInMap ? Object.keys(detectedStore.projectsInMap).length : 0,
      allStoresFound: !!allStores,
      storeName: allStores?.name,
      availableStores: allStores ? [...(allStores.store._s?.keys?.() || [])] : [],
      projectKeys: detectedStore?.projectsInMap ? Object.keys(detectedStore.projectsInMap) : []
    });
    return true;
  }
});

// ==================== INIT ====================

log('[CryoSmart Capture v3] Loaded. Waiting for Vue...');

// Start detection
waitForProjects().then(result => {
  detectedStore = result?.store || null;
  detectionComplete = true;
  if (detectedStore) {
    log('Store detected! Name:', result.name);
    log('Projects:', Object.keys(detectedStore.projectsInMap || {}));
  }
});

window.addEventListener('load', () => {
  log('Page loaded, re-checking...');
  waitForProjects().then(result => {
    detectedStore = result?.store || null;
    detectionComplete = true;
  });
});
