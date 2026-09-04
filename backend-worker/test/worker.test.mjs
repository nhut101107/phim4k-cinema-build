import test from "node:test";
import assert from "node:assert/strict";
import worker, { json } from "../src/worker.mjs";

test("health reports an unconfigured database without exposing settings", async () => {
  const response = await worker.fetch(new Request("https://example.workers.dev/api/health"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ready: false, service: "phim4k-license-api" });
});

test("auth fails closed when the D1 binding is absent", async () => {
  const response = await worker.fetch(new Request("https://example.workers.dev/api/auth/status?key=P4K-TEST&telegramId=1&deviceId=2"), {});
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "DATABASE_NOT_CONFIGURED");
  assert.equal(body.active, false);
});

test("JSON responses include CORS and no-store headers", async () => {
  const response = json({ ok: true });
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

