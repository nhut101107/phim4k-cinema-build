// Read-only release validation. It verifies archive CRCs, application identity,
// shared web contracts and high-confidence secret/provider signatures.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const crc32 = require('buffer-crc32');
const plist = require('bplist-parser');

const version = process.env.RELEASE_VERSION || '3.4.39';
const build = version.split('.').at(-1);
const root = path.resolve(__dirname, '..', 'builds', `4K-Cinema-${version}`);
const files = [
  `4K-Cinema-iOS-${version}-unsigned.ipa`,
  `4K-Cinema-Android-${version}.apk`,
  `4K-Cinema-Android-TV-${version}.apk`,
  `4K-Cinema-Windows-${version}-x64.exe`,
];
const forbidden = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Google API key', /AIza[0-9A-Za-z_-]{30,}/],
  ['GitHub token', /gh[pousr]_[0-9A-Za-z_]{20,}/],
  ['Telegram bot token', /\b[0-9]{8,12}:[A-Za-z0-9_-]{30,}\b/],
  ['movie provider origin', /phimapi\.com|ophim1\.com|phimimg\.com/i],
  ['raw media contract', /link_(?:m3u8|embed)\s*[:=]/i],
];

function inspectText(name, bytes) {
  if (!/\.(?:html|js|css|json|xml|plist|txt|mjs|cjs|yml|yaml)$/i.test(name)) return;
  const value = bytes.toString('utf8');
  for (const [label, rule] of forbidden) {
    if (rule.test(value)) throw new Error(`${name}: exposed ${label}`);
  }
}

function archive(file, inspect) {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error);
    let count = 0;
    zip.on('error', reject);
    zip.on('end', () => resolve(count));
    zip.on('entry', entry => {
      if (entry.fileName.endsWith('/')) return zip.readEntry();
      if (entry.fileName.split('/').includes('..')) return reject(new Error(`Unsafe archive path: ${entry.fileName}`));
      zip.openReadStream(entry, (streamError, stream) => {
        if (streamError) return reject(streamError);
        const chunks = [];
        stream.on('error', reject);
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
          try {
            const bytes = Buffer.concat(chunks);
            if (crc32.unsigned(bytes) !== entry.crc32) throw new Error(`CRC mismatch: ${entry.fileName}`);
            inspectText(entry.fileName, bytes);
            inspect(entry.fileName, bytes);
            count += 1;
            zip.readEntry();
          } catch (inspectError) {
            zip.close();
            reject(inspectError);
          }
        });
      });
    });
    zip.readEntry();
  }));
}

(async () => {
  const report = {
    version,
    source: process.env.RELEASE_SOURCE || require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    checkedAt: new Date().toISOString(),
    files: [],
  };
  for (const name of files) {
    const file = path.join(root, name);
    const data = fs.readFileSync(file);
    const item = { name, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
    if (name.endsWith('.exe')) {
      if (data.toString('ascii', 0, 2) !== 'MZ') throw new Error(`${name}: not a Windows executable`);
    } else {
      let indexVerified = false;
      let apiVerified = false;
      item.archiveEntriesVerified = await archive(file, (entry, bytes) => {
        if (/(?:^|\/)public\/index\.html$/.test(entry)) {
          const html = bytes.toString('utf8');
          indexVerified = html.includes('<title>4K Cinema</title>') && html.includes('Content-Security-Policy');
        }
        if (/(?:^|\/)public\/js\/api\.js$/.test(entry)) apiVerified = bytes.toString('utf8').includes(`return '${version}'`);
        if (entry === 'Payload/App.app/Info.plist') {
          const info = plist.parseBuffer(bytes)[0];
          if (info.CFBundleIdentifier !== 'com.phim4k.cinema' || info.CFBundleDisplayName !== '4K Cinema' || info.CFBundleShortVersionString !== version || String(info.CFBundleVersion) !== build) {
            throw new Error(`${name}: incorrect iOS identity, name or version`);
          }
          item.bundleId = info.CFBundleIdentifier;
          item.displayName = info.CFBundleDisplayName;
          item.build = info.CFBundleVersion;
        }
      });
      if (!indexVerified || !apiVerified) throw new Error(`${name}: missing 4K Cinema web identity/version/security policy`);
      item.webContract = true;
    }
    report.files.push(item);
  }
  const evidence = path.resolve(__dirname, '..', 'data', 'qa', `release-${version}`);
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'SHA256SUMS.txt'), report.files.map(file => `${file.sha256}  ${file.name}`).join('\n') + '\n');
  fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
