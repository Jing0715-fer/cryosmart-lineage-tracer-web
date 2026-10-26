/**
 * v3.40 script-side unit test (node): slices the ACTUAL shipped helper
 * functions out of the extracted capture script and runs them against the
 * fake CryoSmart server on :9999 (which serves download_result_file/<pid>/
 * <uid>.volume.fsc.xml as XML and /api/log_image/<fileid> as PNG).
 *
 * Checks:
 *   1. resolveFscXml probes the result URL for the refine shape → xml text.
 *   2. resolveFscXml does NOT probe non-map jobs (zero requests).
 *   3. A log-entry XML ref wins over the probe (the ref's fileid is fetched).
 *   4. Non-markup bodies (PNG served for a ref fileid) are rejected.
 *   5. Once-per-run caching: a second call issues ZERO requests.
 *   6. isFscXmlFile: name-based, filetype-based, and negative cases.
 */
const fs = require("fs");
const src = fs.readFileSync('/tmp/capture-script-evaluated.js', 'utf8');

// Slice fileExtOf (defined before the image whitelist).
const extStart = src.indexOf('// Extension of a file name (lowercased, no dot)');
const extEnd = src.indexOf('// The image extensions a browser can actually render');
if (extStart < 0 || extEnd < 0) { console.error('fileExtOf slice not found'); process.exit(1); }
const fileExtOfSrc = src.slice(extStart, extEnd);

// Slice the v3.40 block: isFscXmlFile … resolveFscXml.
const vStart = src.indexOf('// True when a log file entry looks like the FSC curve XML.');
const vEnd = src.indexOf('// Iteration / round number buried in a title or file name:');
if (vStart < 0 || vEnd < 0) { console.error('v3.40 slice not found'); process.exit(1); }
const v40 = src.slice(vStart, vEnd);

// fetchT stub: plain timeout fetch (the pacer is irrelevant here). Node
// cannot fetch RELATIVE urls — resolve them against the fake CryoSmart
// origin exactly like the browser's page-origin resolution would.
const FAKE_ORIGIN = 'http://localhost:9999/';
function fetchT(url, opts, ms) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms || 15000);
  const o = Object.assign({}, opts || {}, { signal: ctrl.signal });
  return fetch(new URL(url, FAKE_ORIGIN).href, o).then(
    (r) => { clearTimeout(tid); return r; },
    (e) => { clearTimeout(tid); throw e; }
  );
}

const jobs = [
  { uid: 'J1', job_type: 'import_micrographs', output_result_groups: [{ name: 'movies', type: 'exposure', contains: [] }] },
  { uid: 'J2', job_type: 'nu_refine', output_result_groups: [{ name: 'volume', type: 'volume', contains: [{ type: 'volume.blob', name: 'map' }, { type: 'volume.blob', name: 'precision' }] }] },
  { uid: 'J3', job_type: 'class_3D', output_result_groups: [{ name: 'volume_class_0', type: 'volume', contains: [{ type: 'volume.blob', name: 'map' }] }] },
];
const projectId = 'PVF';

const factory = new Function('fetchT', 'jobs', 'projectId',
  fileExtOfSrc + '\n' + v40 + '\n' +
  'return { isFscXmlFile: isFscXmlFile, fscXmlRefFromLogs: fscXmlRefFromLogs,' +
  ' jobProducesVolumeMap: jobProducesVolumeMap, resolveFscXml: resolveFscXml };');
const api = factory(fetchT, jobs, projectId);

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('ok  : ' + label); } else { fail++; console.log('FAIL: ' + label); } };

(async () => {
  // 1. refine shape → probe succeeds with the XML text.
  const a = await api.resolveFscXml('J2', []);
  ok(!!a && !!a.xml && a.xml.includes('job="J2"'), 'refine job: volume.fsc.xml probe captured the XML text');
  ok(a.name === 'J2.volume.fsc.xml', 'refine job: probed payload name');

  // 2. non-map job → null, no request made (jobProducesVolumeMap false).
  ok(api.jobProducesVolumeMap('J1') === false, 'import job is not map-producing');
  const b = await api.resolveFscXml('J1', []);
  ok(b === null, 'non-map job resolves null');

  // class job (volume_class_0 group) must NOT probe the bare volume URL.
  ok(api.jobProducesVolumeMap('J3') === false, 'class_3D (volume_class_0) is not the refine shape → no probe');
  const c = await api.resolveFscXml('J3', []);
  ok(c === null, 'class job resolves null');

  // 3. log-entry ref wins (ref fileid fetched; body is PNG → rejected →
  //    falls back to the bare ref payload).
  const logs = [{ text: 'FSC Iteration 003', flags: ['fsc'], imgfiles: [
    { fileid: 'fsc_1_FSC.png', filename: 'FSC_Iteration_003.png', filetype: 'image/png' },
    { fileid: 'fsc_1_FSC.xml', filename: 'FSC_Iteration_003.xml', filetype: 'text/xml' },
  ]}];
  ok(!!api.fscXmlRefFromLogs(logs), 'fsc xml ref found in log entries');
  const d = await api.resolveFscXml('J9', logs);
  ok(!!d && d.fileid === 'fsc_1_FSC.xml' && !d.xml, 'PNG body rejected as non-markup → bare ref payload kept');

  // 4. ref whose fileid actually serves XML → text captured. Fake server
  //    serves XML only on the download_result_file route, so use a ref
  //    whose fileid path hits that route.
  const logs2 = [{ text: 'FSC', flags: [], imgfiles: [
    { fileid: 'download_result_file/PVF/J7.volume.fsc.xml', filename: 'J7.volume.fsc.xml', filetype: 'text/xml' },
  ]}];
  const e = await api.resolveFscXml('J7', logs2);
  ok(!!e && !!e.xml && e.xml.includes('job="J7"'), 'ref fileid serving XML → text captured');

  // 5. once-per-run caching: re-resolve J2 → same object, no fetch.
  const a2 = await api.resolveFscXml('J2', []);
  ok(a2 === a, 'second resolveFscXml returns the cached payload (no re-probe)');

  // 6. isFscXmlFile matrix.
  ok(api.isFscXmlFile({ filename: 'fsc.xml', filetype: 'text/xml' }, '') === true, 'name+type xml+fsc → true');
  ok(api.isFscXmlFile({ filename: 'other.xml', filetype: 'text/xml' }, 'FSC curve') === true, 'xml type + fsc evidence in entry → true');
  ok(api.isFscXmlFile({ filename: 'plot.png', filetype: 'image/png' }, 'FSC') === false, 'png → false');
  ok(api.isFscXmlFile({ filename: 'data.xml' }, 'noise') === false, 'xml without fsc evidence → false');
  ok(api.isFscXmlFile(null, 'FSC') === false, 'null → false');

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
