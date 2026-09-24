const API_ORIGIN = 'https://phim4k-license-api.phim4k-pwdbhdz.workers.dev';

async function proxyApi(request) {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, API_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', 'https');
  headers.set('x-app-runtime', 'web');

  const init = { method: request.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;
  const upstream = await fetch(target, init);
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set('cache-control', upstream.headers.get('cache-control') || 'no-store');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/__web/health') {
      return Response.json({
        ok: true,
        app: 'Phim 4K VIP 4.0 Web Preview',
        player: 'browser-preview',
        nativeTarget: 'EnsMovie iOS player',
      }, { headers: { 'cache-control': 'no-store' } });
    }

    if (url.pathname.startsWith('/api/')) return proxyApi(request);

    const wantsHtml = request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html');
    if (url.pathname === '/' || wantsHtml) {
      const previewUrl = new URL('/web-index.html', request.url);
      const preview = await env.ASSETS.fetch(new Request(previewUrl, request));
      if (preview.ok) return preview;
    }

    return env.ASSETS.fetch(request);
  },
};
