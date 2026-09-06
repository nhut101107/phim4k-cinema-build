import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(process.env.PHIM4K_RELAY_CONFIG || path.join(here, 'config.private.json'));
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const secret = String(process.env.PHIM4K_RELAY_SECRET || config.secret || '');
const bindHost = String(config.bindHost || '127.0.0.1');
const port = Number(config.port || 8788);
const maxConcurrent = Math.min(190, Math.max(8, Number(config.maxConcurrent || 160)));
const signatureContext = 'phim4k-vps-relay-v1';
const maxBodyBytes = 8192;
const maxClockSkewSeconds = 60;
const replayWindowMs = 2 * 60 * 1000;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const replayedNonces = new Map();
let activeRequests = 0;

if (secret.length < 32) throw new Error('Relay secret is not configured');
if (bindHost !== '127.0.0.1') throw new Error('Relay must bind to 127.0.0.1');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Relay port is invalid');

function writeLog(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`);
}

function securityHeaders(extra = {}) {
  return {
    'cache-control': 'private, no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...extra,
  };
}

function sendText(response, status, message, extra = {}) {
  if (response.headersSent) return response.destroy();
  response.writeHead(status, securityHeaders({ 'content-type': 'text/plain; charset=utf-8', ...extra }));
  response.end(message);
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family !== 6) return true;
  const value = address.toLowerCase();
  if (value.startsWith('::ffff:')) return isPrivateIpv4(value.slice(7));
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') ||
    value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') ||
    value.startsWith('ff');
}

async function resolvePublicTarget(value) {
  if (!value || String(value).length > 4096) throw new Error('INVALID_TARGET');
  const target = new URL(String(value));
  const hostname = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (target.protocol !== 'https:' || target.username || target.password || target.port || !hostname) throw new Error('INVALID_TARGET');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new Error('BLOCKED_TARGET');
  if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.startsWith('.') || hostname.endsWith('.')) throw new Error('INVALID_TARGET');
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('BLOCKED_TARGET');
  target.hash = '';
  return { target, addresses };
}

function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    const all = Boolean(options && typeof options === 'object' && options.all);
    if (all) return callback(null, addresses.map(({ address, family }) => ({ address, family })));
    const selected = addresses[crypto.randomInt(addresses.length)];
    return callback(null, selected.address, selected.family);
  };
}

function requestUpstream(target, addresses, headers) {
  return new Promise((resolve, reject) => {
    const upstreamRequest = https.request({
      protocol: 'https:',
      hostname: target.hostname,
      port: 443,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      servername: target.hostname,
      lookup: pinnedLookup(addresses),
      headers,
    }, (upstreamResponse) => resolve({ request: upstreamRequest, response: upstreamResponse }));
    upstreamRequest.setTimeout(20_000, () => upstreamRequest.destroy(new Error('UPSTREAM_TIMEOUT')));
    upstreamRequest.once('error', reject);
    upstreamRequest.end();
  });
}

async function openUpstream(initialUrl, requestHeaders, redirectsLeft = 4) {
  const { target, addresses } = await resolvePublicTarget(initialUrl);
  const { request, response } = await requestUpstream(target, addresses, requestHeaders);
  if (redirectStatuses.has(response.statusCode) && redirectsLeft > 0) {
    const location = response.headers.location;
    response.resume();
    request.destroy();
    if (!location) throw new Error('INVALID_REDIRECT');
    return openUpstream(new URL(location, target).href, requestHeaders, redirectsLeft - 1);
  }
  if (redirectStatuses.has(response.statusCode)) {
    response.resume();
    request.destroy();
    throw new Error('REDIRECT_LIMIT');
  }
  return { target, request, response };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error('BODY_TOO_LARGE'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.once('error', reject);
  });
}

function verifySignedBody(request, rawBody) {
  const timestamp = String(request.headers['x-phim4k-relay-timestamp'] || '');
  const nonce = String(request.headers['x-phim4k-relay-nonce'] || '');
  const supplied = String(request.headers['x-phim4k-relay-signature'] || '');
  if (!/^\d{10}$/.test(timestamp) || !/^[A-Za-z0-9_-]{20,64}$/.test(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > maxClockSkewSeconds) return false;
  if (replayedNonces.has(nonce)) return false;
  const signed = `${signatureContext}\n${timestamp}\n${nonce}\n${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest();
  let suppliedBytes;
  try {
    suppliedBytes = Buffer.from(supplied, 'base64url');
  } catch (_error) {
    return false;
  }
  if (suppliedBytes.length !== expected.length || suppliedBytes.toString('base64url') !== supplied || !crypto.timingSafeEqual(expected, suppliedBytes)) return false;
  replayedNonces.set(nonce, Date.now());
  return true;
}

function cleanReferer(value, target) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port) return `${parsed.origin}/`;
  } catch (_error) {}
  return `${target.origin}/`;
}

function upstreamHeaders(payload, target) {
  const referer = cleanReferer(payload.referer, target);
  const headers = {
    accept: '*/*',
    'accept-language': 'vi,en-US;q=0.8,en;q=0.6',
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    referer,
    origin: new URL(referer).origin,
  };
  if (payload.format !== 'hls' && payload.range) headers.range = payload.range;
  return headers;
}

async function handleMedia(request, response) {
  const requestId = crypto.randomBytes(8).toString('hex');
  if (request.method !== 'POST' || request.url !== '/v1/media') return sendText(response, 404, 'Not found');
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return sendText(response, 415, 'Unsupported media type');
  if (activeRequests >= maxConcurrent) return sendText(response, 503, 'Relay busy', { 'retry-after': '2' });

  let rawBody;
  try {
    rawBody = await readBody(request);
  } catch (_error) {
    return sendText(response, 413, 'Request too large');
  }
  if (!verifySignedBody(request, rawBody)) {
    writeLog('auth_denied', { requestId });
    return sendText(response, 401, 'Unauthorized');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (_error) {
    return sendText(response, 400, 'Invalid request');
  }
  if (payload?.v !== 1 || typeof payload.url !== 'string' || !['hls', 'media'].includes(payload.format) || (payload.range && !/^bytes=\d*-\d*$/.test(payload.range))) {
    return sendText(response, 400, 'Invalid request');
  }
  if (payload.format === 'hls') payload.range = '';

  activeRequests += 1;
  let finalized = false;
  const finish = () => {
    if (finalized) return;
    finalized = true;
    activeRequests = Math.max(0, activeRequests - 1);
  };
  response.once('finish', finish);
  response.once('close', finish);

  try {
    const first = await resolvePublicTarget(payload.url);
    const opened = await openUpstream(first.target.href, upstreamHeaders(payload, first.target));
    const status = Number(opened.response.statusCode || 502);
    if (status < 200 || status >= 300) {
      opened.response.resume();
      opened.request.destroy();
      writeLog('upstream_denied', { requestId, status });
      return sendText(response, 502, 'Upstream unavailable');
    }
    const sourceHeaders = opened.response.headers;
    const outputHeaders = securityHeaders({
      'content-type': String(sourceHeaders['content-type'] || 'application/octet-stream'),
      'x-phim4k-relay-final': Buffer.from(opened.target.href, 'utf8').toString('base64url'),
    });
    for (const name of ['accept-ranges', 'content-range', 'etag', 'last-modified']) {
      if (sourceHeaders[name]) outputHeaders[name] = String(sourceHeaders[name]);
    }
    if (sourceHeaders['content-length'] && !sourceHeaders['content-encoding']) outputHeaders['content-length'] = String(sourceHeaders['content-length']);
    response.writeHead(status, outputHeaders);
    request.once('aborted', () => opened.request.destroy());
    response.once('close', () => {
      if (!opened.response.complete) opened.request.destroy();
    });
    opened.response.once('error', () => response.destroy());
    opened.response.pipe(response);
    writeLog('stream_open', {
      requestId,
      status,
      format: payload.format,
      ranged: Boolean(payload.range),
      contentType: String(sourceHeaders['content-type'] || '').split(';')[0].slice(0, 80),
      active: activeRequests,
    });
  } catch (error) {
    writeLog('relay_error', { requestId, code: String(error?.message || 'RELAY_ERROR').slice(0, 80) });
    sendText(response, 502, 'Relay unavailable');
  }
}

setInterval(() => {
  const cutoff = Date.now() - replayWindowMs;
  for (const [nonce, seenAt] of replayedNonces) if (seenAt < cutoff) replayedNonces.delete(nonce);
  while (replayedNonces.size > 20_000) replayedNonces.delete(replayedNonces.keys().next().value);
}, 30_000).unref();

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    return sendText(response, 200, 'ok');
  }
  handleMedia(request, response).catch(() => sendText(response, 500, 'Relay error'));
});
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 500;
server.listen(port, bindHost, () => writeLog('relay_ready', { bindHost, port, maxConcurrent }));

function shutdown(signal) {
  writeLog('relay_shutdown', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
