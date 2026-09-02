// Extracts the captureScript template literal from smart-capture-panel.tsx
// (substituting ${webAppUrl}) into /tmp/capture-script-evaluated.js so it
// can be syntax-checked and behavior-tested with plain node.
const fs = require('fs');
const tsx = fs.readFileSync('/home/z/my-project/src/app/components/cryosmart/smart-capture-panel.tsx', 'utf8');
const startMarker = 'const captureScript = `';
const i = tsx.indexOf(startMarker);
if (i < 0) { console.error('captureScript start marker not found'); process.exit(1); }
const bodyStart = i + startMarker.length;
const endMarker = '\n`.trim();';
const j = tsx.indexOf(endMarker, bodyStart);
if (j < 0) { console.error('captureScript end marker not found'); process.exit(1); }
let body = tsx.slice(bodyStart, j);
// The TSX template literal doubles every backslash (\\ → \) — collapse the
// pairs so the extracted file matches what Next.js actually serves.
body = body.replace(/\\\\/g, '\\');
body = body.replace(/\$\{webAppUrl\}/g, 'http://192.168.202.99:3000');
fs.writeFileSync('/tmp/capture-script-evaluated.js', body);
console.log('extracted', body.length, 'bytes to /tmp/capture-script-evaluated.js');
