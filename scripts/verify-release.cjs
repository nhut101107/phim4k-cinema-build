// Read-only archive validation; writes only generated release evidence/checksums.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const crc32 = require('buffer-crc32');
const plist = require('bplist-parser');
const root = path.resolve(__dirname, '..', 'builds', 'Phim4K-3.4.14');
function archive(file, inspect) {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error);
    let count = 0;
    zip.on('error', reject);
    zip.on('end', () => resolve(count));
    zip.on('entry', entry => {
      if (entry.fileName.endsWith('/')) return zip.readEntry();
      zip.openReadStream(entry, (error, stream) => {
        if (error) return reject(error);
        const chunks = [];
        stream.on('error', reject);
        stream.on('data', c => chunks.push(c));
        stream.on('end', () => {
          try {
            const bytes = Buffer.concat(chunks);
            if (crc32.unsigned(bytes) !== entry.crc32) throw new Error(`CRC mismatch: ${entry.fileName}`);
            inspect(entry.fileName, bytes);
            count++; zip.readEntry();
          } catch (error) { zip.close(); reject(error); }
        });
      });
    });
    zip.readEntry();
  }));
}
(async () => {
  const report = { version: '3.4.14', source: '2367ba126fde3b39a63fdd32527f0d4baba50663', checkedAt: new Date().toISOString(), files: [] };
  for (const name of ['Phim4K-iOS-3.4.14-unsigned.ipa', 'Phim4K-Android-TV-3.4.14.apk', 'Phim4K-Windows-3.4.14-x64.exe']) {
    const file = path.join(root, name);
    const data = fs.readFileSync(file);
    const item = { name, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
    if (!name.endsWith('.exe')) {
      let bridge = false;
      item.archiveEntriesVerified = await archive(file, (entry, bytes) => {
        if (entry.endsWith('/js/native-downloads.js')) bridge = bytes.toString().includes('Plugins?.ReleaseDownloads');
        if (entry === 'Payload/App.app/Info.plist') {
          const info = plist.parseBuffer(bytes)[0];
          if (info.CFBundleIdentifier !== 'com.phim4k.cinema' || info.CFBundleShortVersionString !== '3.4.14' || String(info.CFBundleVersion) !== '14') throw new Error('Incorrect IPA identity/version');
          item.bundleId = info.CFBundleIdentifier; item.build = info.CFBundleVersion;
        }
      });
      if (!bridge) throw new Error('Missing verified native downloader bridge');
      item.nativeBridgeFix = true;
    } else if (data.toString('ascii', 0, 2) !== 'MZ') throw new Error('Not a Windows executable');
    report.files.push(item);
  }
  fs.writeFileSync(path.join(root, 'SHA256SUMS.txt'), report.files.map(f => `${f.sha256}  ${f.name}`).join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
