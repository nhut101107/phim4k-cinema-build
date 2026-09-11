const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "public");
const output = path.join(root, "dist-ios");
fs.mkdirSync(path.join(source, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/hls.js/dist/hls.min.js'), path.join(source, 'vendor/hls.min.js'));

if (!fs.statSync(source).isDirectory()) {
  throw new Error("Missing public web assets");
}

// This is a generated build directory only. Exclude development-only media and
// the legacy standalone page so the native integrity manifest matches the
// exact production bundle shipped to users.
const productionExcludes = new Set([
  'standalone.html',
  'media/qa-original.mp4',
  'media/qa-seek.mp4',
]);
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(source, output, {
  recursive: true,
  filter: (entry) => {
    const relative = path.relative(source, entry).split(path.sep).join('/');
    return !productionExcludes.has(relative);
  }
});

const outputIndex = path.join(output, "index.html");
if (!fs.existsSync(outputIndex)) {
  throw new Error("iOS web bundle did not contain index.html");
}

// Native builds read the public GitHub release manifest directly so the
// in-app download screen always sees the exact APK/IPA/EXE assets that were
// just published. Keep the rest of the CSP unchanged.
let indexHtml = fs.readFileSync(outputIndex, "utf8");
indexHtml = indexHtml.replace(/connect-src\s+([^;\"]+);/i, (full, sources) => {
  if (sources.includes("https://api.github.com")) return full;
  return `connect-src ${sources.trim()} https://api.github.com;`;
});
fs.writeFileSync(outputIndex, indexHtml);

console.log("Prepared reviewed iOS web bundle");
