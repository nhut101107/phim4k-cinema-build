const API_ORIGIN = 'https://phim4k-license-api.phim4k-pwdbhdz.workers.dev';

function apiTarget(request) {
  const incoming = new URL(request.url);
  return new URL(incoming.pathname + incoming.search, API_ORIGIN);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/__web/health') {
      return Response.json({
        ok: true,
        app: 'Phim 4K VIP 4.0',
        apiOrigin: API_ORIGIN,
      }, {
        headers: { 'cache-control': 'no-store' },
      });
    }

    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.set('x-forwarded-host', url.host);
      headers.set('x-forwarded-proto', 'https');

      const upstream = await fetch(apiTarget(request), new Request(request, { headers }));
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('cache-control', upstream.headers.get('cache-control') || 'no-store');
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }

    let response = await env.ASSETS.fetch(request);
    if (
      response.status === 404 &&
      request.method === 'GET' &&
      (request.headers.get('accept') || '').includes('text/html')
    ) {
      const indexRequest = new Request(new URL('/', request.url), request);
      response = await env.ASSETS.fetch(indexRequest);
    }
    return response;
  },
};
