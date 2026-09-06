const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'ios', 'App', 'App', 'public');
const manifestPath = path.join(root, 'ios', 'App', 'App', 'RuntimeIntegrityManifest.generated.swift');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    if (!entry.isFile() || entry.name === '.DS_Store' || entry.name.endsWith('.map')) return [];
    return [absolute];
  });
}

test('generated iOS manifest seals every packaged web asset with its current SHA-256', () => {
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const protectedFiles = new Map(
    [...manifest.matchAll(/^\s+"(public\/[^"]+)": "([a-f0-9]{64})",$/gm)]
      .map((match) => [match[1], match[2]])
  );
  const actualFiles = walk(publicRoot).map((absolute) => [
    `public/${path.relative(publicRoot, absolute).split(path.sep).join('/')}`,
    crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),
  ]);

  assert.ok(protectedFiles.size >= 25, 'manifest unexpectedly small');
  assert.equal(protectedFiles.size, actualFiles.length, 'manifest file set is stale');
  for (const [relative, digest] of actualFiles) {
    assert.equal(protectedFiles.get(relative), digest, `${relative} is not sealed by the native manifest`);
  }
});
