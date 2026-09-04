import test from "node:test";
import assert from "node:assert/strict";
import worker, { createRateLimiter, json } from "../src/worker.mjs";

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
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("admin master key is normalized but restricted to its configured Telegram ID", async () => {
  const db = {
    prepare() {
      return { bind() { return { first: async () => null }; } };
    },
  };
  const env = { DB: db, ADMIN_LICENSE_KEY: "mnhut", ADMIN_TELEGRAM_ID: "5992662564" };
  const makeRequest = (telegramId) => new Request("https://example.workers.dev/api/auth/activate", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": telegramId },
    body: JSON.stringify({ key: "MNHUT", telegramId, deviceId: "device-1" }),
  });

  const allowed = await worker.fetch(makeRequest("5992662564"), env);
  assert.equal(allowed.status, 200);
  const allowedBody = await allowed.json();
  assert.equal(allowedBody.isAdmin, true);
  assert.equal(allowedBody.telegramId, "5992662564");

  const denied = await worker.fetch(makeRequest("5992662565"), env);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "ADMIN_TELEGRAM_REQUIRED");
});

test("auth activation is rate limited with a retry window", () => {
  const limiter = createRateLimiter();
  const request = new Request("https://example.workers.dev/api/auth/activate", {
    headers: { "cf-connecting-ip": "203.0.113.9" },
  });
  for (let index = 0; index < 10; index += 1) assert.equal(limiter(request, "/api/auth/activate", 1000), null);
  assert.equal(limiter(request, "/api/auth/activate", 1000), 60);
  assert.equal(limiter(request, "/api/auth/activate", 61000), null);
});
