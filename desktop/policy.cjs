const path = require('node:path');
function resolveAsset(root, raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'phim4k:' || url.hostname !== 'app') return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) return null;
    const asset = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!asset.startsWith(path.resolve(root) + path.sep)) return null;
    if (!['.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.woff2', '.json'].includes(path.extname(asset))) return null;
    return asset;
  } catch (_) { return null; }
}
function allowedExternal(raw) {
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password; }
  catch (_) { return false; }
}
module.exports = { resolveAsset, allowedExternal };
