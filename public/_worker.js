const LICENSE_ORIGIN = 'https://phim4k-license-api.phim4k-pwdbhdz.workers.dev';
const ENS_ORIGIN = 'https://enshihi.vercel.app';

const LICENSE_PREFIXES = [
  '/api/auth/',
  '/api/app/access-policy',
  '/api/app/maintenance',
];

function cloneUpstreamRequest(request, target, extraHeaders = {}) {
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;
  return new Request(target, init);
}

async function proxyTo(request, origin, extraHeaders = {}) {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, origin);
  const upstream = await fetch(cloneUpstreamRequest(request, target, extraHeaders));
  const headers = new Headers(upstream.headers);
  headers.delete('content-security-policy');
  headers.delete('content-security-policy-report-only');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/__ens/health') {
      return Response.json({
        ok: true,
        app: 'EnsMovie + Phim 4K VIP 4.0',
        licenseOrigin: LICENSE_ORIGIN,
        upstream: ENS_ORIGIN,
      }, {
        headers: { 'cache-control': 'no-store' },
      });
    }

    if (url.pathname === '/native-gate.html' || url.pathname.startsWith('/native-gate/')) {
      return env.ASSETS.fetch(request);
    }

    if (LICENSE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
      return proxyTo(request, LICENSE_ORIGIN, {
        'x-forwarded-host': url.host,
        'x-forwarded-proto': 'https',
        'x-app-runtime': 'ios',
      });
    }

    // Everything belonging to EnsMovie remains on EnsMovie's own gateway.
    // This preserves its player/source behavior exactly; the proxy only gives
    // us one stable host where we can later append our extra catalog adapters.
    return proxyTo(request, ENS_ORIGIN);
  },
};
