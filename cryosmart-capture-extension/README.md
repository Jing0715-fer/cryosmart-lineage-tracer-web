# CryoSmart Capture Extension

A Chrome extension that automatically captures complete CryoSmart job metadata and syncs to the CryoSmart Lineage Tracer web app.

## Features

- **Auto-capture**: Automatically extracts full job metadata when you open a CryoSmart project
- **Complete metadata**: Captures `input_slot_groups`, `output_result_groups`, `params_spec`, `parents`, `children` - data not available via REST API
- **One-click sync**: Manual capture with one click from the extension popup
- **Multiple project support**: Select which project to capture
- **Configurable**: Set your web app URL and enable/disable auto-capture

## Installation

### Step 1: Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right corner)
3. Click **Load unpacked**
4. Select the `cryosmart-capture-extension` folder

### Step 2: Configure the extension

1. Click the extension icon in Chrome toolbar
2. Set your Lineage Tracer web app URL (default: `http://localhost:3006`)
3. Optionally enable **Auto-capture on project load**
4. Navigate to CryoSmart and open a project

## Usage

### Automatic Capture

Enable "Auto-capture on project load" in the extension popup. When you navigate to any CryoSmart project page, the extension will:

1. Detect the project load
2. Extract complete job metadata from CryoSmart internal store
3. Upload to your Lineage Tracer web app
4. Open the web app with your data loaded

### Manual Capture

1. Navigate to CryoSmart and open your project
2. Click the CryoSmart Capture extension icon
3. Select your project from the list
4. Click **Capture & Sync**
5. The web app will open with your complete lineage data

## How It Works

CryoSmart stores complete job metadata (including lineage connections) in its Vue.js/Pinia frontend store. The REST API and WebSocket only expose basic job info.

This extension:

1. Runs as a content script inside CryoSmart pages
2. Accesses CryoSmart`'s Pinia store via `document.querySelector(`'#q-app'`).__vue_app__.$pinia`
3. Extracts complete job objects with all metadata
4. POSTs the data to the Lineage Tracer web app`'s `/api/cryosmart/import` endpoint
5. Opens the web app with the captured data

## Project Structure

```
cryosmart-capture-extension/
├── manifest.json           # Extension manifest (v3)
├── content-script.js       # Extracts data from CryoSmart store
├── background/
│   └── service-worker.js  # Handles auto-capture triggers
├── popup/
│   ├── popup.html         # Popup UI
│   └── popup.js           # Popup logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Troubleshooting

### Extension shows "Open CryoSmart to capture"

Make sure CryoSmart is open at `http://192.168.202.11:8080` with a project loaded.

### Upload fails

Check that:
- The Lineage Tracer web app is running (default: `http://localhost:3006`)
- The web app URL in extension settings is correct
- CORS is allowed (the API route has `Access-Control-Allow-Origin: *`)

### Auto-capture not working

Check that:
- "Auto-capture on project load" is checked in extension popup
- You have navigated to a CryoSmart project page (URL contains `/projects/`)

## Customization

### Change Web App URL

If your Lineage Tracer runs on a different port or URL:

1. Click the extension icon
2. Update the "Web App URL" field
3. Settings are saved automatically

### Change CryoSmart Server

To target a different CryoSmart server:

1. Open `manifest.json`
2. Update the `host_permissions` URLs
3. Update the `content_scripts` matches
4. Reload the extension

## License

MIT
