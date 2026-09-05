import test from "node:test";
import assert from "node:assert/strict";
import worker, { auditTypeForAction, compareAppVersions, createRateLimiter, json, normalizeAnnouncementSetting, normalizeTelemetryEvents } from "../src/worker.mjs";

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

test("movie metadata relay works without D1 and never accepts an arbitrary upstream", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const target = String(input);
    requests.push(target);
    return new Response(JSON.stringify({ items: [{ name: "Fixture", slug: "fixture" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const home = await worker.fetch(new Request("https://example.workers.dev/api/movies/home"), {});
    assert.equal(home.status, 200);
    const payload = await home.json();
    assert.equal(payload.hero[0].slug, "fixture");
    assert.equal(payload.sections.length, 4);
    assert.equal(home.headers.get("access-control-allow-origin"), "*");
    assert.equal(requests.length, 1);
    assert.ok(requests.every((target) => target.startsWith("https://phimapi.com/")));

    const filtered = await worker.fetch(new Request("https://example.workers.dev/api/movies/filter?genre=hanh-dong&country=trung-quoc&page=2"), {});
    assert.equal(filtered.status, 200);
    assert.equal(requests.at(-1), "https://phimapi.com/v1/api/the-loai/hanh-dong?page=2&limit=24&country=trung-quoc");

    const invalidFilter = await worker.fetch(new Request("https://example.workers.dev/api/movies/filter?genre=../../secret"), {});
    assert.equal(invalidFilter.status, 400);

    const invalid = await worker.fetch(new Request("https://example.workers.dev/api/movies/category/not-allowed"), {});
    assert.equal(invalid.status, 400);
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("app update checks compare version components rather than strings", () => {
  assert.equal(compareAppVersions("3.10.0", "3.2.0"), 1);
  assert.equal(compareAppVersions("3.1.9", "3.2.0"), -1);
  assert.equal(compareAppVersions("3.2", "3.2.0"), 0);
});

test("image relay accepts only the reviewed movie image host and image responses", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ target: String(input), redirect: options?.redirect });
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "4", etag: '"fixture"' },
    });
  };
  try {
    const source = encodeURIComponent("https://phimimg.com/uploads/movies/fixture.jpg");
    const allowed = await worker.fetch(new Request(`https://example.workers.dev/api/media/image?url=${source}`), {});
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("content-type"), "image/jpeg");
    assert.equal(allowed.headers.get("access-control-allow-origin"), "*");
    assert.match(allowed.headers.get("cache-control"), /max-age=86400/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].target, "https://phimimg.com/uploads/movies/fixture.jpg");
    assert.equal(requests[0].redirect, "manual");

    const denied = await worker.fetch(new Request("https://example.workers.dev/api/media/image?url=https%3A%2F%2F127.0.0.1%2Fsecret"), {});
    assert.equal(denied.status, 400);
    assert.equal((await denied.json()).code, "IMAGE_HOST_NOT_ALLOWED");
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("device-only access stays pending until the verified admin approves that exact device", async () => {
  const state = {
    requestStatus: null,
    deviceId: null,
    license: {
      license_key: "P4K-DEVICE-TEST",
      plan: "VIP",
      expires_at: null,
      active: 1,
      assigned_telegram_id: null,
      activated_telegram_id: null,
      device_id: null,
    },
  };
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("FROM app_settings")) return null;
              if (sql.includes("FROM license_keys WHERE license_key")) return state.license;
              if (sql.includes("SELECT status FROM device_access_requests")) return state.requestStatus ? { status: state.requestStatus } : null;
              return null;
            },
            async run() {
              if (sql.startsWith("INSERT INTO device_access_requests")) state.requestStatus ||= "pending";
              if (sql.startsWith("UPDATE license_keys SET device_id")) {
                state.deviceId = values[0];
                state.license.device_id = values[0];
              }
              if (sql.startsWith("UPDATE device_access_requests SET status")) state.requestStatus = values[0];
              return { success: true };
            },
            async all() { return { results: [] }; },
          };
        },
        async run() { return { success: true }; },
      };
    },
  };
  const env = { DB: db, ADMIN_LICENSE_KEY: "MASTER-DEVICE-KEY", ADMIN_TELEGRAM_ID: "5992662564" };
  const request = await worker.fetch(new Request("https://example.workers.dev/api/auth/request-device-access", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.31" },
    body: JSON.stringify({ key: "P4K-DEVICE-TEST", deviceId: "device-no-telegram" }),
  }), env);
  assert.equal(request.status, 200);
  assert.equal((await request.json()).status, "pending");

  const pending = await worker.fetch(new Request("https://example.workers.dev/api/auth/device-status?key=P4K-DEVICE-TEST&deviceId=device-no-telegram", {
    headers: { "cf-connecting-ip": "203.0.113.32" },
  }), env);
  assert.equal((await pending.json()).active, false);

  const approved = await worker.fetch(new Request("https://example.workers.dev/api/admin/device-access-decision", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-license-key": "MASTER-DEVICE-KEY",
      "x-telegram-id": "5992662564",
      "cf-connecting-ip": "203.0.113.33",
    },
    body: JSON.stringify({ key: "P4K-DEVICE-TEST", deviceId: "device-no-telegram", decision: "approve" }),
  }), env);
  assert.equal(approved.status, 200);
  assert.equal(state.deviceId, "device-no-telegram");

  const active = await worker.fetch(new Request("https://example.workers.dev/api/auth/device-status?key=P4K-DEVICE-TEST&deviceId=device-no-telegram", {
    headers: { "cf-connecting-ip": "203.0.113.34", "x-app-version": "3.4.8" },
  }), env);
  const activeBody = await active.json();
  assert.equal(activeBody.active, true);
  assert.equal(activeBody.deviceOnly, true);
});

test("auth activation is rate limited with a retry window", () => {
  const limiter = createRateLimiter();
  const request = new Request("https://example.workers.dev/api/auth/activate", {
    headers: { "cf-connecting-ip": "203.0.113.9" },
  });
  for (let index = 0; index < 20; index += 1) assert.equal(limiter(request, "/api/auth/activate", 1000), null);
  assert.equal(limiter(request, "/api/auth/activate", 1000), 60);
  assert.equal(limiter(request, "/api/auth/activate", 61000), null);
});

test("edge rate-limit denial returns 429 before the backend is used", async () => {
  let limiterCalls = 0;
  const response = await worker.fetch(
    new Request("https://example.workers.dev/api/health", {
      headers: { "cf-connecting-ip": "203.0.113.14" },
    }),
    {
      PUBLIC_RATE_LIMITER: {
        async limit({ key }) {
          limiterCalls += 1;
          assert.equal(key, "/api/health:203.0.113.14");
          return { success: false };
        },
      },
    },
  );
  assert.equal(limiterCalls, 1);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal((await response.json()).code, "RATE_LIMITED");
});

test("viewer telemetry accepts only allowlisted fields and never stores stream URLs or secrets", async () => {
  const events = normalizeTelemetryEvents([
    { action: "movie_open", context: { movie: "Phim mẫu", token: "secret", source: "https://media.example/video.m3u8" } },
    { action: "playback_error", context: { error: "Không phát được", episode: "Tập 2" } },
    { action: "not_allowed", context: { movie: "Bỏ qua" } },
  ]);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { action: "usage_movie_open", context: { movie: "Phim mẫu" } });
  assert.equal(auditTypeForAction(events[0].action), "USER");
  assert.equal(auditTypeForAction("license_activated"), "AUTH");

  const inserted = [];
  const license = {
    license_key: "P4K-USER-TEST", active: 1, expires_at: null,
    activated_telegram_id: "123456789", assigned_telegram_id: null, device_id: "device-user-1",
  };
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("FROM app_settings")) return null;
              if (sql.includes("FROM license_keys")) return license;
              if (sql.includes("FROM bans")) return null;
              return null;
            },
            async run() {
              if (sql.startsWith("INSERT INTO audit_logs")) inserted.push(values);
              return { success: true };
            },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
  const response = await worker.fetch(new Request("https://example.workers.dev/api/telemetry", {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-license-key": "P4K-USER-TEST",
      "x-telegram-id": "123456789", "x-device-id": "device-user-1", "x-app-version": "3.4.11",
      "cf-connecting-ip": "203.0.113.88",
    },
    body: JSON.stringify({ events: [
      { action: "movie_open", context: { movie: "Phim mẫu", token: "secret", source: "https://media.example/video.m3u8" } },
      { action: "playback_error", context: { error: "Không phát được", episode: "Tập 2" } },
    ] }),
  }), { DB: db });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).accepted, 2);
  assert.equal(inserted.length, 2);
  assert.equal(inserted[0][1], "usage_movie_open");
  assert.equal(inserted[0][2], "123456789");
  assert.doesNotMatch(inserted[0][5], /https?:|m3u8|secret|P4K-USER-TEST/i);
});

test("viewer telemetry keeps privacy-safe session and playback diagnostics", () => {
  const [event] = normalizeTelemetryEvents([{
    action: "playback_stop",
    context: {
      movie: "Phim kiểm thử", watched: 125.36, session: "s-fixture", runtime: "iOS app",
      screen: "390x844", language: "vi-VN", network: "4g", authorization: "Bearer secret",
    },
  }]);
  assert.deepEqual(event, {
    action: "usage_playback_stop",
    context: {
      movie: "Phim kiểm thử", watched: 125.4, session: "s-fixture", runtime: "iOS app",
      screen: "390x844", language: "vi-VN", network: "4g",
    },
  });
});

test("admin content status checks catalog and exposes only authorized provider readiness", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/System/Info/Public")) {
      return new Response(JSON.stringify({ ServerName: "Licensed Library", Version: "10.11.11" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ items: [{ name: "Fixture", slug: "fixture" }] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  const db = {
    prepare() {
      return {
        bind() {
          return {
            async first() { return null; },
            async run() { return { success: true }; },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
  try {
    const response = await worker.fetch(new Request("https://example.workers.dev/api/admin/content-status", {
      headers: { "x-license-key": "MASTER-CONTENT-KEY", "x-telegram-id": "5992662564" },
    }), {
      DB: db, ADMIN_LICENSE_KEY: "MASTER-CONTENT-KEY", ADMIN_TELEGRAM_ID: "5992662564",
      JELLYFIN_BASE_URL: "https://media.example.com",
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, "READY");
    assert.equal(payload.providers[1].status, "READY");
    assert.equal(payload.providers[1].serverName, "Licensed Library");
    assert.equal(payload.ads.sdkEmbedded, false);
    assert.doesNotMatch(JSON.stringify(payload), /KEY|secret|token/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("announcement normalization hides disabled and expired messages", () => {
  const timestamp = Date.parse("2026-09-06T00:00:00.000Z");
  assert.deepEqual(normalizeAnnouncementSetting({ enabled: false }, timestamp), { active: false });
  assert.deepEqual(normalizeAnnouncementSetting({
    enabled: true, message: "Đã hết hạn", expiresAt: "2026-09-05T23:59:00.000Z",
  }, timestamp), { active: false });
  assert.equal(normalizeAnnouncementSetting({
    enabled: true, id: "notice-1", title: "Bảo trì", message: "Hệ thống sắp bảo trì.",
    publishedAt: "2026-09-05T23:00:00.000Z", expiresAt: "2026-09-06T01:00:00.000Z",
  }, timestamp).active, true);
});

test("verified admin can publish and clear a timed global announcement", async () => {
  const state = { announcement: null, auditActions: [] };
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("FROM app_settings") && values[0] === "global_announcement_v1") {
                return state.announcement ? { setting_value: state.announcement } : null;
              }
              return null;
            },
            async run() {
              if (sql.startsWith("INSERT INTO app_settings") && values[0] === "global_announcement_v1") state.announcement = values[1];
              if (sql.startsWith("INSERT INTO audit_logs")) state.auditActions.push(values[1]);
              return { success: true };
            },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
  const env = { DB: db, ADMIN_LICENSE_KEY: "MASTER-NOTICE-KEY", ADMIN_TELEGRAM_ID: "5992662564" };
  const headers = {
    "content-type": "application/json", "x-license-key": "MASTER-NOTICE-KEY", "x-telegram-id": "5992662564",
  };
  const publish = await worker.fetch(new Request("https://example.workers.dev/api/admin/announcement", {
    method: "POST", headers, body: JSON.stringify({ title: "Tin mới", message: "Phim mới đã cập nhật.", durationMinutes: 90 }),
  }), env);
  assert.equal(publish.status, 200);
  const published = await publish.json();
  assert.equal(published.announcement.active, true);
  assert.equal(published.announcement.message, "Phim mới đã cập nhật.");
  assert.ok(Date.parse(published.announcement.expiresAt) > Date.now());

  const visible = await worker.fetch(new Request("https://example.workers.dev/api/app/announcement"), env);
  assert.equal((await visible.json()).active, true);
  assert.ok(state.auditActions.includes("admin_announcement_published"));

  const clear = await worker.fetch(new Request("https://example.workers.dev/api/admin/announcement", {
    method: "POST", headers, body: JSON.stringify({ action: "clear" }),
  }), env);
  assert.equal(clear.status, 200);
  assert.equal((await clear.json()).active, false);
  assert.equal((await (await worker.fetch(new Request("https://example.workers.dev/api/app/announcement"), env)).json()).active, false);
  assert.ok(state.auditActions.includes("admin_announcement_cleared"));
});
