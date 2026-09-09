const path = require('node:path');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const desktopConfig = require(path.join(root, 'electron-builder.json'));
const archive = path.join(root, desktopConfig.directories.output, 'win-unpacked', 'resources', 'app.asar');
const entries = asar.listPackage(archive);
const required = [
  'desktop/main.cjs',
  'desktop/preload.cjs',
  'public/js/api.js',
  'public/js/auth.js',
  'public/js/session-vault.js',
];

function packagedPath(relative) {
  return `\\${relative.replaceAll('/', '\\')}`;
}

for (const relative of required) {
  if (!entries.includes(packagedPath(relative))) {
    throw new Error(`Windows ASAR is missing ${relative}`);
  }
}

const sources = required
  .map((relative) => asar.extractFile(archive, relative.replaceAll('/', '\\')).toString('utf8'))
  .join('\n');
const auth = asar.extractFile(archive, 'public\\js\\auth.js').toString('utf8');
const forbidden = [
  ['direct phimapi provider', /phimapi\.com/i],
  ['direct ophim provider', /ophim1\.com/i],
  ['persisted raw license', /localStorage\.setItem\(\s*['"]phim4k_key/i],
  ['Electron Node integration', /nodeIntegration\s*:\s*true/i],
  ['Electron context isolation disabled', /contextIsolation\s*:\s*false/i],
].filter(([, rule]) => rule.test(sources));

if (!auth.includes('initializingPromise')) {
  throw new Error('Windows ASAR does not contain the startup/activation race fix');
}
if (forbidden.length) {
  throw new Error(`Unsafe Windows ASAR content: ${forbidden.map(([label]) => label).join(', ')}`);
}

console.log(`Windows artifact verified: ${entries.length} ASAR entries, ${required.length} protected inputs, 0 forbidden matches.`);
