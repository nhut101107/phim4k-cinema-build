const fs = require("fs");
const path = require("path");

const requestedUrl = (process.env.PHIM4K_API_BASE_URL || process.argv[2] || "").trim();
if (!requestedUrl) {
  throw new Error("PHIM4K_API_BASE_URL is required for a native IPA build");
}

let origin;
try {
  const parsed = new URL(requestedUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS API origins are allowed");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("Use an HTTPS origin only, without a path, query, or credentials");
  }
  origin = parsed.origin;
} catch (error) {
  throw new Error(`Invalid PHIM4K_API_BASE_URL: ${error.message}`);
}

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "dist-ios", "js", "mobile-config.js");
if (!fs.existsSync(configPath)) {
  throw new Error("Prepare the iOS web bundle before setting its API origin");
}

const source = fs.readFileSync(configPath, "utf8");
// The source bundle may contain either an empty development placeholder or the
// reviewed public production origin.  The workflow still overwrites that one
// public setting with its explicit, HTTPS-only input; it never appends or
// exposes credentials.
const configValuePattern = /apiBaseUrl:\s*"(?:[^"\\]|\\.)*"/;
if (!configValuePattern.test(source)) {
  throw new Error("The generated mobile configuration did not contain an API URL setting");
}

const updated = source.replace(configValuePattern, `apiBaseUrl: ${JSON.stringify(origin)}`);
fs.writeFileSync(configPath, updated, "utf8");
console.log(`Configured native API origin for host: ${new URL(origin).host}`);
