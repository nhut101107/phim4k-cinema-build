import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const relayDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(relayDir);
const relayServer = path.join(relayDir, 'relay-server.mjs');
const relayConfig = path.join(relayDir, 'config.private.json');
const cloudflared = path.join(projectDir, 'tools', 'cloudflared', 'cloudflared.exe');
const workerDir = path.join(projectDir, 'backend-worker');
const wranglerCli = path.join(projectDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const wranglerConfig = path.join(workerDir, 'wrangler.toml');
const wranglerAuthHome = 'C:\\Users\\Administrator\\AppData\\Roaming\\xdg.config';
const logDir = path.join(relayDir, 'logs');
const statePath = path.join(relayDir, 'current-origin.private.txt');
const lockPath = path.join(relayDir, 'supervisor.private.lock');
const supervisorLog = path.join(logDir, 'supervisor.log');
const tunnelPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g;
let stopping = false;
let relayChild = null;
let tunnelChild = null;

fs.mkdirSync(logDir, { recursive: true });
for (const required of [relayServer, relayConfig, cloudflared, wranglerCli, wranglerConfig]) {
  if (!fs.existsSync(required)) throw new Error(`Missing relay dependency: ${required}`);
}

function sanitize(value) {
  return String(value || '').replace(tunnelPattern, '[tunnel-origin]').replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function log(message) {
  fs.appendFileSync(supervisorLog, `${new Date().toISOString()} ${sanitize(message)}\n`, 'utf8');
}

function rotate(file) {
  try {
    if (fs.statSync(file).size > 5 * 1024 * 1024) fs.writeFileSync(file, '', 'utf8');
  } catch (_error) {}
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (_error) { return false; }
}

function acquireLock() {
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, String(process.pid), 'utf8');
    fs.closeSync(fd);
    return;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  let existing = 0;
  try { existing = Number(fs.readFileSync(lockPath, 'utf8')); } catch (_error) {}
  if (existing && processExists(existing)) process.exit(0);
  fs.rmSync(lockPath, { force: true });
  const fd = fs.openSync(lockPath, 'wx');
  fs.writeFileSync(fd, String(process.pid), 'utf8');
  fs.closeSync(fd);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function spawnLogged(executable, args, stdoutPath, stderrPath, parseOutput = null) {
  const child = spawn(executable, args, {
    cwd: projectDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = fs.createWriteStream(stdoutPath, { flags: 'a', encoding: 'utf8' });
  const stderr = fs.createWriteStream(stderrPath, { flags: 'a', encoding: 'utf8' });
  const forward = (stream, output) => stream.on('data', (chunk) => {
    const text = sanitize(chunk);
    output.write(`${text}\n`);
    if (parseOutput) parseOutput(String(chunk));
  });
  forward(child.stdout, stdout);
  forward(child.stderr, stderr);
  child.once('exit', () => { stdout.end(); stderr.end(); });
  return child;
}

async function waitForLocalHealth(child) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch('http://127.0.0.1:8788/healthz', { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) return true;
    } catch (_error) {}
    await sleep(500);
  }
  return false;
}

function waitForTunnelOrigin(child, registerListener) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tunnel origin timeout')), 120_000);
    const finish = (error, origin) => {
      clearTimeout(timeout);
      error ? reject(error) : resolve(origin);
    };
    registerListener((chunk) => {
      const match = String(chunk).match(tunnelPattern);
      if (match?.[0]) finish(null, match[0]);
    });
    child.once('exit', (code) => finish(new Error(`Tunnel exited before ready: ${code}`)));
  });
}

async function syncWorkerOrigin(origin) {
  let previous = '';
  try { previous = fs.readFileSync(statePath, 'utf8').trim(); } catch (_error) {}
  if (previous === origin) return;
  log('syncing new tunnel origin to Worker secret');
  const child = spawn(process.execPath, [
    wranglerCli, 'secret', 'put', 'VPS_RELAY_ORIGIN', '--config', wranglerConfig,
  ], {
    cwd: workerDir,
    windowsHide: true,
    env: { ...process.env, XDG_CONFIG_HOME: wranglerAuthHome },
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let errorOutput = '';
  child.stderr.on('data', (chunk) => { errorOutput += String(chunk).slice(0, 2000); });
  child.stdin.end(`${origin}\n`);
  const code = await new Promise((resolve) => child.once('exit', resolve));
  if (code !== 0) {
    log(`Worker secret update failed with exit code ${code}: ${sanitize(errorOutput)}`);
    throw new Error(`Worker secret update failed: ${code}`);
  }
  fs.writeFileSync(statePath, origin, 'utf8');
  log('Worker relay origin synchronized');
}

async function runPair() {
  for (const file of ['supervisor.log', 'relay.out.log', 'relay.err.log', 'tunnel.out.log', 'tunnel.err.log']) rotate(path.join(logDir, file));
  relayChild = spawnLogged(process.execPath, [relayServer], path.join(logDir, 'relay.out.log'), path.join(logDir, 'relay.err.log'));
  if (!await waitForLocalHealth(relayChild)) throw new Error('Relay failed local health check');

  let outputListener = () => {};
  tunnelChild = spawnLogged(cloudflared, [
    'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:8788',
  ], path.join(logDir, 'tunnel.out.log'), path.join(logDir, 'tunnel.err.log'), (chunk) => outputListener(chunk));
  const origin = await waitForTunnelOrigin(tunnelChild, (listener) => { outputListener = listener; });
  log('tunnel origin allocated');
  await syncWorkerOrigin(origin);
  log('relay and tunnel healthy');
  await Promise.race([
    new Promise((resolve) => relayChild.once('exit', resolve)),
    new Promise((resolve) => tunnelChild.once('exit', resolve)),
  ]);
}

function stopChild(child) {
  if (child && child.exitCode === null) child.kill('SIGTERM');
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`supervisor stopping on ${signal}`);
  stopChild(tunnelChild);
  stopChild(relayChild);
}

acquireLock();
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
log('supervisor started');

try {
  while (!stopping) {
    try {
      await runPair();
      if (!stopping) log('relay or tunnel exited; restarting pair');
    } catch (error) {
      log(`pair startup failed: ${sanitize(error?.message || error)}`);
    } finally {
      stopChild(tunnelChild);
      stopChild(relayChild);
      tunnelChild = null;
      relayChild = null;
    }
    if (!stopping) await sleep(5000);
  }
} finally {
  try { fs.rmSync(lockPath, { force: true }); } catch (_error) {}
}
