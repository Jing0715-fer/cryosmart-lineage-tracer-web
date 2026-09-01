/**
 * CryoSmart Capture - Popup Script v4 (fixed)
 */

let selectedProject = null;
let currentStatus = null;

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const webAppUrlInput = document.getElementById('webAppUrl');
const autoCaptureCheckbox = document.getElementById('autoCapture');
const projectList = document.getElementById('projectList');
const captureBtn = document.getElementById('captureBtn');
const openBtn = document.getElementById('openBtn');
const resultDiv = document.getElementById('result');

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.sync.get(['webAppUrl', 'autoCapture']);
  webAppUrlInput.value = settings.webAppUrl || 'http://localhost:3006';
  autoCaptureCheckbox.checked = settings.autoCapture !== false;
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab.url || !tab.url.includes('192.168.202.11:8080')) {
    projectList.innerHTML = '<div style="padding: 12px; color: #6b7280; font-size: 13px;">Open CryoSmart first to capture projects</div>';
    captureBtn.disabled = true;
    statusDot.className = 'status-dot error';
    statusText.textContent = 'Not on CryoSmart page';
    return;
  }
  
  checkStatus(tab);
  loadProjects(tab);
  setupListeners(tab);
});

async function checkStatus(tab) {
  statusText.textContent = 'Connecting...';
  statusDot.className = 'status-dot waiting';
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
      currentStatus = response;
      
      if (response.success && response.connected) {
        statusDot.className = 'status-dot ' + (response.hasProjects ? 'connected' : 'waiting');
        statusText.textContent = response.message || 'Connected to CryoSmart';
        captureBtn.disabled = !response.hasProjects;
        return;
      } else {
        statusDot.className = 'status-dot error';
        statusText.textContent = response.message || 'Not connected';
        captureBtn.disabled = true;
        return;
      }
    } catch (err) {
      if (attempt < 3) {
        statusText.textContent = `Retry ${attempt}/3...`;
        await new Promise(r => setTimeout(r, 1000));
      } else {
        statusDot.className = 'status-dot error';
        statusText.textContent = 'Extension not loaded - reload CryoSmart page';
        captureBtn.disabled = true;
        showReloadHint();
      }
    }
  }
}

async function loadProjects(tab) {
  await new Promise(r => setTimeout(r, 500));
  
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProjects' });
    
    if (response.success && response.projects && response.projects.length > 0) {
      renderProjectList(response.projects);
    } else {
      projectList.innerHTML = '<div style="padding: 12px; color: #6b7280; font-size: 13px;">No projects found</div>';
    }
  } catch (err) {
    projectList.innerHTML = '<div style="padding: 12px; color: #ef4444; font-size: 13px;">Failed to load: ' + err.message + '</div>';
  }
}

function renderProjectList(projects) {
  selectedProject = currentStatus?.currentProjectId 
    ? projects.find(p => p.uid === currentStatus.currentProjectId) || projects[0]
    : projects[0];
  
  projectList.innerHTML = projects.map(p => `
    <div class="project-item ${selectedProject?.uid === p.uid ? 'selected' : ''}" data-uid="${p.uid}">
      <div class="project-item-title">${p.title || p.uid}</div>
      <div class="project-item-meta">${p.uid} - ${p.jobCount} jobs, ${p.experimentCount} experiments</div>
    </div>
  `).join('');
  
  projectList.querySelectorAll('.project-item').forEach(item => {
    item.addEventListener('click', () => {
      projectList.querySelectorAll('.project-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      selectedProject = projects.find(p => p.uid === item.dataset.uid);
    });
  });
}

function setupListeners(tab) {
  webAppUrlInput.addEventListener('change', async () => {
    await chrome.storage.sync.set({ webAppUrl: webAppUrlInput.value });
  });
  
  autoCaptureCheckbox.addEventListener('change', async () => {
    await chrome.storage.sync.set({ autoCapture: autoCaptureCheckbox.checked });
  });
  
  captureBtn.addEventListener('click', async () => {
    if (!selectedProject) {
      showResult('error', 'Please select a project first');
      return;
    }
    
    await chrome.storage.sync.set({
      webAppUrl: webAppUrlInput.value,
      autoCapture: autoCaptureCheckbox.checked
    });
    
    captureBtn.disabled = true;
    captureBtn.innerHTML = '<span class="spinner"></span> Capturing...';
    resultDiv.innerHTML = '';
    
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'capture',
          options: {
            projectId: selectedProject.uid,
            webAppUrl: webAppUrlInput.value,
            autoOpen: true
          }
        });
        
        if (response.success) {
          showResult('success', 
            `Captured ${response.count} jobs!<br>` +
            `Token: ${response.token}<br>` +
            `<a href="${response.webAppUrl}" target="_blank">Open Lineage Tracer</a>`
          );
          return;
        } else {
          showResult('error', response.error || 'Capture failed');
          if (response.error?.includes('not found')) {
            showDebugButton(tab);
          }
          return;
        }
      } catch (err) {
        lastError = err;
        if (attempt < 3) {
          captureBtn.innerHTML = `<span class="spinner"></span> Retry ${attempt}/3...`;
          await new Promise(r => setTimeout(r, 1500));
          captureBtn.innerHTML = '<span class="spinner"></span> Capturing...';
        }
      }
    }
    
    showResult('error', 'Capture failed: ' + (lastError?.message || 'unknown error'));
    showReloadHint();
    captureBtn.disabled = false;
    captureBtn.innerHTML = '<span>Capture & Sync</span>';
  });
  
  openBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://192.168.202.11:8080', active: true });
  });
}

function showReloadHint() {
  resultDiv.innerHTML = `
    <div class="result error">
      <strong>Extension not loaded!</strong><br><br>
      After updating the extension, you must <strong>reload CryoSmart</strong>.<br><br>
      1. Go to CryoSmart tab<br>
      2. Press <kbd style="background:#e5e7eb;padding:2px 6px;border-radius:4px">Ctrl+R</kbd> to reload<br>
      3. Wait for jobs to load<br>
      4. Come back here
    </div>
  `;
}

function showDebugButton(tab) {
  if (document.getElementById('debugBtn')) return;
  
  const debugSection = document.createElement('div');
  debugSection.style.cssText = 'margin-top: 12px; padding: 12px; background: #fef3c7; border-radius: 8px;';
  debugSection.innerHTML = `
    <div style="font-size: 12px; color: #92400e; margin-bottom: 8px;">
      <strong>Debug:</strong> CryoSmart detection failed.
    </div>
    <button id="debugBtn" style="width:100%;padding:8px;background:#f59e0b;color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer">Show Debug Info</button>
    <div id="debugOutput" style="margin-top:8px;font-family:monospace;font-size:11px;display:none;white-space:pre-wrap;background:#1f2937;color:#10b981;padding:8px;border-radius:4px;max-height:200px;overflow-y:auto;"></div>
  `;
  
  resultDiv.parentElement.insertBefore(debugSection, resultDiv);
  
  document.getElementById('debugBtn').addEventListener('click', async () => {
    const output = document.getElementById('debugOutput');
    output.style.display = 'block';
    output.textContent = 'Loading...';
    
    try {
      const info = await chrome.tabs.sendMessage(tab.id, { action: 'debug' });
      output.textContent = JSON.stringify(info, null, 2);
    } catch (err) {
      output.textContent = 'Error: ' + err.message + '\n\nContent script not running.';
    }
  });
}

function showResult(type, message) {
  resultDiv.innerHTML = `<div class="result ${type}">${message}</div>`;
}
