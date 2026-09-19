const fs = require('node:fs');
const path = require('node:path');
const { minify } = require('terser');

const root = path.resolve(__dirname, '..');
const bundleRoot = path.join(root, 'dist-ios');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

async function main() {
  if (!fs.existsSync(bundleRoot)) throw new Error('Missing generated production web bundle.');
  const scripts = walk(bundleRoot).filter((file) => file.endsWith('.js') && !file.endsWith('.min.js'));
  for (const file of scripts) {
    const source = fs.readFileSync(file, 'utf8');
    const result = await minify(source, {
      ecma: 2020,
      compress: { passes: 2, drop_console: true },
      mangle: true,
      format: { comments: false, ascii_only: true },
      sourceMap: false,
    });
    if (!result.code) throw new Error(`Terser produced an empty bundle for ${path.relative(root, file)}`);
    fs.writeFileSync(file, `${result.code}\n`, 'utf8');
  }
  console.log(`Hardened ${scripts.length} production JavaScript files (no source maps).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
