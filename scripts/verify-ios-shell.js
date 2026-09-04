const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const required = [
  "capacitor.config.json",
  "public/index.html",
  "public/js/mobile-config.js",
  "public/js/runtime-config.js",
  "public/js/api.js",
  "scripts/prepare-ios-web.js"
];
for (const relative of required) {
  if (!fs.statSync(path.join(root, relative)).isFile()) {
    throw new Error(`Missing iOS shell input: ${relative}`);
  }
}
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
for (const script of ["/js/mobile-config.js", "/js/runtime-config.js", "/js/api.js"]) {
  if (!html.includes(script)) {
    throw new Error(`index.html does not load ${script}`);
  }
}
const config = JSON.parse(fs.readFileSync(path.join(root, "capacitor.config.json"), "utf8"));
if (config.appId !== "com.phim4k.cinema" || config.webDir !== "dist-ios") {
  throw new Error("Unexpected Capacitor app identity or web directory");
}
const iosIndex = path.join(root, config.webDir, "index.html");
if (fs.existsSync(iosIndex) && fs.existsSync(path.join(root, config.webDir, "standalone.html"))) {
  throw new Error("The iOS web bundle must not include standalone.html");
}
console.log("iOS shell inputs verified");
