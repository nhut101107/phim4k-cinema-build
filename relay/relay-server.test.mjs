import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, 'relay-server.mjs');

async function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('relay test startup timed out')), 10_000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('relay_ready')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`relay exited before startup: ${code}`));
    });
  });
}

test('local relay requires HMAC, rejects replay, and blocks private targets', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'phim4k-relay-test-'));
  const port = 18788;
  const secret = 'unit-test-relay-secret-that-is-longer-than-thirty-two-characters';
  const configPath = path.join(temp, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({ bindHost: '127.0.0.1', port, maxConcurrent: 8, secret }));
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PHIM4K_RELAY_CONFIG: configPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForReady(child);
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);

    const body = JSON.stringify({ v: 1, url: 'https://127.0.0.1/private', range: '', format: 'media', referer: '' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(18).toString('base64url');
    const signature = crypto.createHmac('sha256', secret)
      .update(`phim4k-vps-relay-v1\n${timestamp}\n${nonce}\n${body}`)
      .digest('base64url');
    const headers = {
      'content-type': 'application/json',
      'x-phim4k-relay-timestamp': timestamp,
      'x-phim4k-relay-nonce': nonce,
      'x-phim4k-relay-signature': signature,
    };

    const unsigned = await fetch(`http://127.0.0.1:${port}/v1/media`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(unsigned.status, 401);
    const blocked = await fetch(`http://127.0.0.1:${port}/v1/media`, { method: 'POST', headers, body });
    assert.equal(blocked.status, 502);
    const replay = await fetch(`http://127.0.0.1:${port}/v1/media`, { method: 'POST', headers, body });
    assert.equal(replay.status, 401);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
