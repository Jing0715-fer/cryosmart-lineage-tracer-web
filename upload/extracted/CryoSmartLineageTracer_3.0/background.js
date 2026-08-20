function downloadFile(item) {
  return new Promise((resolve, reject) => {
    if (!item || !item.url || !item.filename) {
      resolve(null);
      return;
    }

    chrome.downloads.download({
      url: item.url,
      filename: item.filename,
      saveAs: false,
      conflictAction: "overwrite"
    }, (downloadId) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(downloadId);
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== "downloadCryoSmartFiles") return false;

  (async () => {
    const downloads = Array.isArray(message.downloads) ? message.downloads : [];
    let count = 0;
    for (const item of downloads) {
      const id = await downloadFile(item);
      if (id !== null) count += 1;
    }
    sendResponse({ ok: true, count });
  })().catch((err) => {
    sendResponse({ ok: false, error: err.message });
  });

  return true;
});
