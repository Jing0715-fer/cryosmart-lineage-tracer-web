/**
 * CryoSmart Capture - Background Service Worker
 * 
 * Manages extension state, handles auto-capture triggers,
 * and coordinates with content scripts.
 */

// Track capture state
let captureState = {
  lastCapture: null,
  isCapturing: false,
  currentProject: null
};

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'projectsLoaded') {
    handleProjectsLoaded(message.url, sender.tab);
  }
  
  if (message.action === 'captureComplete') {
    handleCaptureComplete(message.data);
  }
  
  if (message.action === 'getState') {
    sendResponse(captureState);
  }
  
  return true;
});

/**
 * Handle when projects are loaded in CryoSmart
 */
async function handleProjectsLoaded(url, tab) {
  // Extract project ID from URL
  const match = url.match(/\/projects\/([^/?#]+)/i);
  const projectId = match ? match[1] : null;
  
  // Update badge to show connected
  chrome.action.setBadgeText({ text: '!', tabId: tab.id });
  chrome.action.setBadgeBackgroundColor({ color: '#10b981', tabId: tab.id });
  
  // Get auto-capture settings
  const settings = await chrome.storage.sync.get(['autoCapture', 'webAppUrl']);
  
  if (settings.autoCapture && projectId) {
    // Trigger capture automatically
    console.log('[CryoSmart Capture] Auto-capturing project:', projectId);
    
    try {
      const result = await chrome.tabs.sendMessage(tab.id, {
        action: 'capture',
        options: {
          projectId,
          webAppUrl: settings.webAppUrl || 'http://localhost:3006',
          autoOpen: true
        }
      });
      
      if (result.success) {
        captureState.lastCapture = {
          timestamp: Date.now(),
          projectId,
          jobCount: result.count,
          token: result.token
        };
      }
    } catch (err) {
      console.error('[CryoSmart Capture] Auto-capture failed:', err);
    }
  }
  
  captureState.currentProject = projectId;
}

/**
 * Handle capture completion
 */
function handleCaptureComplete(data) {
  captureState.lastCapture = {
    timestamp: Date.now(),
    projectId: data.projectUid,
    jobCount: data.count,
    token: data.token
  };
  captureState.isCapturing = false;
  
  // Update badge
  chrome.action.setBadgeText({ text: String(data.count) });
  chrome.action.setBadgeBackgroundColor({ color: '#059669' });
}

// Listen for tab updates to re-check badge
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('192.168.202.11:8080')) {
    // Check if we can connect
    chrome.tabs.sendMessage(tabId, { action: 'getStatus' })
      .then(status => {
        if (status.success) {
          chrome.action.setBadgeText({ text: status.hasProjects ? '!' : '?', tabId });
          chrome.action.setBadgeBackgroundColor({ 
            color: status.hasProjects ? '#10b981' : '#f59e0b', 
            tabId 
          });
        }
      })
      .catch(() => {
        chrome.action.setBadgeText({ text: '?', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#6b7280', tabId });
      });
  }
});

console.log('[CryoSmart Capture] Background service worker loaded');
