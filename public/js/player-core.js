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

  function findEquivalentEpisode(episodes, currentEpisode, fallbackIndex) {
    const list = Array.isArray(episodes) ? episodes : [];
    if (!list.length) return { episode: null, index: -1 };

    const currentKeys = new Set(episodeKeys(currentEpisode));
    if (currentKeys.size) {
      const matchedIndex = list.findIndex((episode) => episodeKeys(episode).some((key) => currentKeys.has(key)));
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

  return {
    findEquivalentEpisode,
    uniqueQualityOptions,
    clampResumeTime,
    qualityOption,
    doubleTapSeek,
    autoAdSkipTarget
  };
});
