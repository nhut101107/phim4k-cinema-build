const apiOrigin = 'https://phim4k-license-api.phim4k-pwdbhdz.workers.dev';
const key = String(process.env.PHIM4K_TEST_KEY || '');
const deviceId = String(process.env.PHIM4K_TEST_DEVICE || '');
const expectedSlug = String(process.env.PHIM4K_EXPECTED_SLUG || '').trim();
const expectedImageSha256 = String(process.env.PHIM4K_EXPECTED_IMAGE_SHA256 || '').trim().toLowerCase();
if (!key || !deviceId) throw new Error('Missing temporary live-test identity');

const response = await fetch(`${apiOrigin}/api/watch-progress`, {
  headers: {
    'x-license-key': key,
    'x-device-id': deviceId,
    'x-app-version': 'watch-image-smoke',
  },
});
if (!response.ok) throw new Error(`Watch progress returned HTTP ${response.status}`);
const payload = await response.json();
if (!Array.isArray(payload.items) || !payload.items.length) throw new Error('Temporary watch history is empty');

const secondResponse = await fetch(`${apiOrigin}/api/watch-progress`, {
  headers: {
    'x-license-key': key,
    'x-device-id': deviceId,
    'x-app-version': 'watch-image-smoke',
  },
});
if (!secondResponse.ok) throw new Error(`Second watch progress request returned HTTP ${secondResponse.status}`);
const secondPayload = await secondResponse.json();
const firstState = payload.items.map(({ slug, episodeId, thumb, updatedAt }) => ({ slug, episodeId, thumb, updatedAt }));
const secondState = (secondPayload.items || []).map(({ slug, episodeId, thumb, updatedAt }) => ({ slug, episodeId, thumb, updatedAt }));
if (JSON.stringify(secondState) !== JSON.stringify(firstState)) {
  throw new Error('Protected poster migration was repeated instead of remaining stable');
}

const results = [];
for (const item of payload.items) {
  const imageUrl = new URL(item.thumb);
  if (imageUrl.origin !== apiOrigin || imageUrl.pathname !== '/api/media/image' || !imageUrl.searchParams.has('t')) {
    throw new Error(`Watch poster for ${item.slug} is not protected`);
  }
  const image = await fetch(imageUrl, { redirect: 'manual' });
  const contentType = String(image.headers.get('content-type') || '').toLowerCase();
  if (!image.ok || !contentType.startsWith('image/')) {
    throw new Error(`Watch poster for ${item.slug} returned HTTP ${image.status} (${contentType || 'unknown'})`);
  }
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (!bytes.byteLength) throw new Error(`Watch poster for ${item.slug} is empty`);
  let expectedContentMatched = null;
  if (expectedSlug && item.slug === expectedSlug && expectedImageSha256) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const actual = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
    expectedContentMatched = actual === expectedImageSha256;
    if (!expectedContentMatched) throw new Error(`Watch poster for ${item.slug} does not match its catalogue image`);
  }
  results.push({ slug: item.slug, status: image.status, type: contentType.split(';')[0], expectedContentMatched });
}

console.log(JSON.stringify({ watchProgress: response.status, stableSecondRead: true, posters: results }, null, 2));
