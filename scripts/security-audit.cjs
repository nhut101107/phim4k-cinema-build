// Read-only source/artifact staging audit for high-confidence client leaks and
// unsafe release settings. This complements tests; a clean scan is not proof
// that a client cannot be reverse engineered.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const clientRoots = [
  'public',
  'desktop',
  'ios/App/App',
  'android/app/src/main',
].map((entry) => path.join(root, entry));
const repositoryRoots = [
  ...clientRoots,
  path.join(root, 'backend-worker'),
  path.join(root, 'relay'),
  path.join(root, 'scripts'),
  path.join(root, '.github'),
];
const textExtensions = new Set(['.html', '.js', '.cjs', '.mjs', '.json', '.xml', '.plist', '.swift', '.java', '.kt', '.gradle', '.sql', '.yml', '.yaml']);
const privateNames = new Set([
  'config.private.json',
  'current-origin.private.txt',
  'supervisor.private.lock',
]);
const secretRules = [
  ['private signing key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Google API key', /AIza[0-9A-Za-z_-]{30,}/],
  ['GitHub token', /gh[pousr]_[0-9A-Za-z_]{20,}/],
  ['Telegram bot token', /\b[0-9]{8,12}:[A-Za-z0-9_-]{30,}\b/],
];
const clientRules = [
  ['direct movie-provider origin', /phimapi\.com|ophim1\.com|phimimg\.com/i],
  ['raw media response contract', /link_(?:m3u8|embed)\s*[:=]/i],
  ['persisted raw license key', /localStorage\.setItem\(\s*['"]phim4k_key['"]/],
  ['Android backup enabled', /android:allowBackup\s*=\s*['"]true['"]/i],
  ['Android cleartext enabled', /android:usesCleartextTraffic\s*=\s*['"]true['"]/i],
  ['Android release debugging enabled', /android:debuggable\s*=\s*['"]true['"]/i],
  ['iOS arbitrary network loads', /<key>NSAllowsArbitraryLoads<\/key>\s*<true\s*\/>/i],
  ['Electron Node integration enabled', /nodeIntegration\s*:\s*true/],
  ['Electron context isolation disabled', /contextIsolation\s*:\s*false/],
  ['Electron sandbox disabled', /sandbox\s*:\s*false/],
];

function files(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    // Local runtime credentials are deliberately gitignored and must never be
    // opened, copied into audit output, or treated as source inputs.
    if (privateNames.has(entry.name) || entry.name === 'logs') return [];
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(target);
    return textExtensions.has(path.extname(entry.name).toLowerCase()) ? [target] : [];
  });
}

const findings = [];
const allFiles = [...new Set(repositoryRoots.flatMap(files))];
const clientFiles = [...new Set(clientRoots.flatMap(files))];
for (const file of allFiles) {
  const value = fs.readFileSync(file, 'utf8');
  for (const [label, rule] of secretRules) {
    if (rule.test(value)) findings.push(`${path.relative(root, file)}: ${label}`);
  }
}
for (const file of clientFiles) {
  const value = fs.readFileSync(file, 'utf8');
  for (const [label, rule] of clientRules) {
    if (rule.test(value)) findings.push(`${path.relative(root, file)}: ${label}`);
  }
}

if (findings.length) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Security audit passed for ${allFiles.length} repository files (${clientFiles.length} client files).`);
}
