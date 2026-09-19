const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('release web code is minified without source maps and desktop ships that hardened copy', () => {
  const source = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
  const hardened = fs.readFileSync(path.join(root, 'dist-ios/js/app.js'), 'utf8');
  const desktop = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder.json'), 'utf8'));
  const productionFiles = desktop.files.filter((entry) => entry && typeof entry === 'object');

  assert.ok(hardened.length < source.length * 0.75, 'the production bundle should be substantially minified');
  assert.doesNotMatch(hardened, /sourceMappingURL|\/\*|^\s*\/\//m);
  assert.ok(productionFiles.some((entry) => entry.from === 'dist-ios' && entry.to === 'public'));
  assert.equal(desktop.asar, true);
  assert.equal(desktop.electronFuses.enableEmbeddedAsarIntegrityValidation, true);
  assert.equal(desktop.electronFuses.onlyLoadAppFromAsar, true);
});
