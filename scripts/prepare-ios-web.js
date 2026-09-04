const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "public");
const output = path.join(root, "dist-ios");

if (!fs.statSync(source).isDirectory()) {
  throw new Error("Missing public web assets");
}

// This is a generated build directory only. Exclude the legacy standalone page
// so an iOS package has one reviewed activation path.
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(source, output, {
  recursive: true,
  filter: (entry) => path.basename(entry) !== "standalone.html"
});

if (!fs.existsSync(path.join(output, "index.html"))) {
  throw new Error("iOS web bundle did not contain index.html");
}
console.log("Prepared reviewed iOS web bundle");
