/* Shared, dependency-free player rules. Kept separate so server, quality and
 * resume behaviour can be tested without a browser or a live movie stream. */
(function attachPlayerCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PlayerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, () => {
  function normalise(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function episodeKeys(episode) {
    return [episode?.slug, episode?.filename, episode?.name]
      .map(normalise)
      .filter(Boolean);
  }

  function episodeOrdinal(episode) {
    for (const value of [episode?.slug, episode?.filename, episode?.name]) {
      const text = normalise(value);
      if (!text) continue;
      const prefixed = text.match(/(?:^|\s)(?:tap|episode|ep|e)\s*0*(\d{1,4})(?:\s|$)/);
      if (prefixed) return Number(prefixed[1]);
      const standalone = text.match(/^0*(\d{1,4})$/);
      if (standalone) return Number(standalone[1]);
    }
    return null;
  }

  function findEquivalentEpisode(episodes, currentEpisode, fallbackIndex) {
    const list = Array.isArray(episodes) ? episodes : [];
    if (!list.length) return { episode: null, index: -1 };

    const currentKeys = new Set(episodeKeys(currentEpisode));
    if (currentKeys.size) {
      const matchedIndex = list.findIndex((episode) => episodeKeys(episode).some((key) => currentKeys.has(key)));
      if (matchedIndex >= 0) return { episode: list[matchedIndex], index: matchedIndex };
    }

    // Different providers often call the same episode "Tap 03", "Episode 3",
    // "EP03", etc. Match the real episode number before trusting list order.
    const ordinal = episodeOrdinal(currentEpisode);
    if (ordinal !== null) {
      const matchedIndex = list.findIndex((episode) => episodeOrdinal(episode) === ordinal);
      if (matchedIndex >= 0) return { episode: list[matchedIndex], index: matchedIndex };
    }

    const safeIndex = Number.isInteger(fallbackIndex) && fallbackIndex >= 0 && fallbackIndex < list.length
      ? fallbackIndex
      : 0;
    return { episode: list[safeIndex], index: safeIndex };
  }

  function qualityOption(level, levelIndex) {
    const height = Number(level?.height) || 0;
    const width = Number(level?.width) || 0;
    const bitrate = Number(level?.bitrate) || 0;
    return {
      levelIndex,
      height,
      width,
      bitrate,
      label: height ? `${height}p` : (width ? `${width}px` : `Mức ${levelIndex + 1}`)
    };
  }

  function uniqueQualityOptions(levels) {
    const seen = new Set();
    return (Array.isArray(levels) ? levels : [])
      .map(qualityOption)
      .filter((option) => {
        const key = `${option.height}|${option.width}|${option.bitrate}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (b.height - a.height) || (b.width - a.width) || (b.bitrate - a.bitrate));
  }

  function clampResumeTime(value, duration) {
    const time = Number(value);
    const total = Number(duration);
    if (!Number.isFinite(time) || time <= 0) return 0;
    if (!Number.isFinite(total) || total <= 1) return time;
    return Math.max(0, Math.min(time, Math.max(0, total - 0.5)));
  }

  function doubleTapSeek(first, next) {
    // Mobile WebViews may synthesize the second click 400-500 ms after the
    // first physical tap. Keep this aligned with Player.surfaceTapTimer.
    if (!first || !next || next.time - first.time < 0 || next.time - first.time > 520) return 0;
    const zone = x => x < 0.4 ? -1 : x > 0.6 ? 1 : 0;
    const direction = zone(next.x);
    return direction && direction === zone(first.x) && Math.abs(next.x - first.x) < 0.2 ? direction * 10 : 0;
  }

  function autoAdSkipTarget(currentTime, duration, skippedMarkers = [], intervalSeconds = 900, adSeconds = 35) {
    const current = Number(currentTime);
    const total = Number(duration);
    const interval = Number(intervalSeconds);
    const length = Number(adSeconds);
    if (![current, total, interval, length].every(Number.isFinite)
      || current < 0 || total <= 1 || interval <= 0 || length <= 0) return null;

    const marker = Math.floor(current / interval) * interval;
    if (marker < interval || marker >= total - 1 || current >= marker + length) return null;
    if (new Set(skippedMarkers).has(marker)) return null;

    const target = clampResumeTime(marker + length, total);
    return target > current ? { marker, target } : null;
  }

  function hlsAbsolute(uri, base) {
    try { return new URL(String(uri || '').trim(), base).href; } catch (_error) { return ''; }
  }

  function hlsSegmentSignature(absoluteUrl) {
    try {
      const parsed = new URL(absoluteUrl);
      const slash = parsed.pathname.lastIndexOf('/');
      const directory = parsed.pathname.slice(0, slash + 1);
      const file = parsed.pathname.slice(slash + 1);
      const dot = file.lastIndexOf('.');
      const stem = dot > 0 ? file.slice(0, dot) : file;
      const ext = dot > 0 ? file.slice(dot).toLowerCase() : '';
      return `${parsed.host}${directory}|${stem.replace(/[A-Za-z0-9]/g, 'x')}${ext}`;
    } catch (_error) {
      return 'invalid';
    }
  }

  function hlsRewriteUriAttribute(line, base, cleanUrlFor = null) {
    return line.replace(/URI\s*=\s*["']([^"']*)["']/i, (_match, uri) => {
      const abs = hlsAbsolute(uri, base) || uri;
      return `URI="${cleanUrlFor ? cleanUrlFor(abs) : abs}"`;
    });
  }

  function stripHlsAds(text, baseUrl, { cleanUrlFor = null } = {}) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    if (!lines[0] || !lines[0].trim().startsWith('#EXTM3U')) throw new Error('NOT_HLS_PLAYLIST');

    if (lines.some((line) => line.startsWith('#EXT-X-STREAM-INF'))) {
      const out = [];
      const variants = [];
      let expectVariant = false;
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('#')) {
          if (line.startsWith('#EXT-X-STREAM-INF')) {
            expectVariant = true;
            out.push(line);
          } else if (line.startsWith('#EXT-X-MEDIA') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF')) {
            out.push(hlsRewriteUriAttribute(line, baseUrl, cleanUrlFor));
          } else {
            out.push(line);
          }
          continue;
        }
        const absolute = hlsAbsolute(line, baseUrl) || line;
        if (expectVariant) variants.push(absolute);
        out.push(expectVariant && cleanUrlFor ? cleanUrlFor(absolute) : absolute);
        expectVariant = false;
      }
      return { playlist: `${out.join('\n')}\n`, removedSegments: 0, removedSeconds: 0, isMaster: true, variants };
    }

    const header = [];
    const segments = [];
    const trailer = [];
    let pending = [];
    let currentKey = null;
    let currentMap = null;
    let group = 0;
    let discontinuityBefore = false;
    let seenSegment = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXT-X-ENDLIST')) { trailer.push(line); continue; }
      if (line.startsWith('#EXT-X-DISCONTINUITY') && !line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE')) {
        if (seenSegment) group += 1;
        discontinuityBefore = true;
        continue;
      }
      if (line.startsWith('#EXT-X-KEY')) { currentKey = hlsRewriteUriAttribute(line, baseUrl); continue; }
      if (line.startsWith('#EXT-X-MAP')) { currentMap = hlsRewriteUriAttribute(line, baseUrl); continue; }
      if (line.startsWith('#')) {
        if (!seenSegment && !line.startsWith('#EXTINF') && !line.startsWith('#EXT-X-BYTERANGE')
          && !line.startsWith('#EXT-X-PROGRAM-DATE-TIME')) header.push(line);
        else pending.push(line);
        continue;
      }
      const extinf = pending.find((tag) => tag.startsWith('#EXTINF'));
      const duration = Math.max(0, Number.parseFloat(String(extinf || '').slice(8)) || 0);
      const url = hlsAbsolute(line, baseUrl) || line;
      segments.push({ tags: pending, url, duration, key: currentKey, map: currentMap, group, discontinuityBefore,
        signature: hlsSegmentSignature(url) });
      pending = [];
      discontinuityBefore = false;
      seenSegment = true;
    }

    const bySignature = new Map();
    let totalSeconds = 0;
    for (const segment of segments) {
      totalSeconds += segment.duration;
      bySignature.set(segment.signature, (bySignature.get(segment.signature) || 0) + segment.duration);
    }
    const dominant = [...bySignature.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    const groups = new Map();
    for (const segment of segments) {
      const entry = groups.get(segment.group) || { seconds: 0, foreign: true };
      entry.seconds += segment.duration;
      if (segment.signature === dominant) entry.foreign = false;
      groups.set(segment.group, entry);
    }
    const multipleGroups = groups.size > 1;
    const adGroups = new Set();
    let adSeconds = 0;
    for (const [id, entry] of groups) {
      if (multipleGroups && entry.foreign && entry.seconds <= 180) {
        adGroups.add(id);
        adSeconds += entry.seconds;
      }
    }
    if (!totalSeconds || adSeconds > totalSeconds * 0.25) adGroups.clear();

    const out = [...header];
    let emittedKey = null;
    let emittedMap = null;
    let pendingDiscontinuity = false;
    let removedSegments = 0;
    let removedSeconds = 0;
    let emittedAny = false;
    let lastKeptSignature = '';
    let removedSinceKept = false;
    for (const segment of segments) {
      if (segment.discontinuityBefore) pendingDiscontinuity = true;
      if (adGroups.has(segment.group)) {
        removedSegments += 1;
        removedSeconds += segment.duration;
        removedSinceKept = true;
        continue;
      }
      const spliceOnly = removedSinceKept && segment.signature === lastKeptSignature;
      if (pendingDiscontinuity && emittedAny && !spliceOnly) out.push('#EXT-X-DISCONTINUITY');
      pendingDiscontinuity = false;
      removedSinceKept = false;
      lastKeptSignature = segment.signature;
      if (segment.key !== emittedKey) {
        out.push(segment.key || '#EXT-X-KEY:METHOD=NONE');
        emittedKey = segment.key;
      }
      if (segment.map && segment.map !== emittedMap) {
        out.push(segment.map);
        emittedMap = segment.map;
      }
      out.push(...segment.tags, segment.url);
      emittedAny = true;
    }
    out.push(...trailer);
    return { playlist: `${out.join('\n')}\n`, removedSegments, removedSeconds, isMaster: false, variants: [] };
  }

  function nextEpisodeCountdown(currentTime, duration, threshold = 30) {
    const cur = Number(currentTime);
    const dur = Number(duration);
    if (!Number.isFinite(cur) || !Number.isFinite(dur) || dur <= 60) return null;
    const remaining = Math.max(0, Math.ceil(dur - cur));
    if (remaining <= threshold && remaining > 0) {
      return { active: true, remaining };
    }
    return null;
  }

  function isIntroInterval(currentTime, duration, introSeconds = 85) {
    const cur = Number(currentTime);
    const dur = Number(duration);
    if (!Number.isFinite(cur) || !Number.isFinite(dur) || dur <= 120) return false;
    return cur >= 0 && cur < introSeconds;
  }

  function skipIntroTarget(currentTime, duration, introSeconds = 85) {
    const dur = Number(duration);
    if (!Number.isFinite(dur) || dur <= 1) return introSeconds;
    return Math.max(0, Math.min(introSeconds, dur - 1));
  }

  return {
    findEquivalentEpisode,
    episodeOrdinal,
    uniqueQualityOptions,
    clampResumeTime,
    qualityOption,
    doubleTapSeek,
    autoAdSkipTarget,
    stripHlsAds,
    nextEpisodeCountdown,
    isIntroInterval,
    skipIntroTarget
  };
});
