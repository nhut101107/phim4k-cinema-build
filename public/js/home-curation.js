(function (root) {
  'use strict';
  const POLICY = 'new-cinema-v1';
  const number = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  function unique(items) {
    const map = new Map();
    for (const m of items || []) {
      if (!m || typeof m.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,159}$/.test(m.slug)) continue;
      map.set(m.slug, { ...map.get(m.slug), ...m });
    }
    return [...map.values()];
  }
  function modified(m, now) {
    const time = Date.parse(m.modified?.time || '');
    return Number.isFinite(time) && time <= now ? time : 0;
  }
  function interest(m) {
    // Votes are an interest proxy, NOT live viewing figures or a global trending chart.
    const candidates = [m.tmdb, m.imdb].filter(v => number(v?.vote_count) >= 10);
    return Math.max(0, ...candidates.map(v => Math.log10(1 + Math.min(number(v.vote_count), 1e7)) * 4
      + Math.min(number(v.vote_average), 10) * 0.4));
  }
  function tags(movie, field) {
    const value = movie?.[field];
    return (Array.isArray(value) ? value : value ? [value] : [])
      .map(item => typeof item === 'string' ? item : item?.name)
      .filter(Boolean)
      .map(value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim());
  }
  function personalize(items, history, { limit = 30 } = {}) {
    const catalog = unique(items);
    const watchedSlugs = new Set((history || []).map(item => String(item?.slug || '').toLowerCase()).filter(Boolean));
    const watched = (history || []).map((item, index) => ({
      movie: catalog.find(movie => movie.slug === item?.slug),
      weight: 1 / (1 + index * 0.35),
    })).filter(item => item.movie);
    if (!watched.length) return null;

    const affinities = { category: new Map(), country: new Map(), type: new Map() };
    const add = (field, value, weight) => affinities[field].set(value, (affinities[field].get(value) || 0) + weight);
    watched.forEach(({ movie, weight }) => {
      tags(movie, 'category').forEach(value => add('category', value, weight * 4));
      tags(movie, 'country').forEach(value => add('country', value, weight * 2));
      if (movie.type) add('type', String(movie.type).toLowerCase(), weight * 1.25);
    });
    const score = movie => {
      let affinity = 0;
      tags(movie, 'category').forEach(value => { affinity += affinities.category.get(value) || 0; });
      tags(movie, 'country').forEach(value => { affinity += affinities.country.get(value) || 0; });
      affinity += affinities.type.get(String(movie.type || '').toLowerCase()) || 0;
      return { affinity, total: affinity + interest(movie) * 0.08 };
    };
    const ranked = catalog
      .filter(movie => !watchedSlugs.has(movie.slug))
      .map(movie => ({ movie, ...score(movie) }))
      .filter(item => item.affinity > 0)
      .sort((a, b) => b.total - a.total || modified(b.movie, Date.now()) - modified(a.movie, Date.now()) || a.movie.slug.localeCompare(b.movie.slug))
      .slice(0, Math.max(1, limit))
      .map(item => item.movie);
    if (!ranked.length) return null;
    return { id: 'for-you', title: 'Dành riêng cho bạn', items: ranked, personalized: true };
  }
  function build(items, { now = Date.now(), updatedAt = new Date(now).toISOString(), offline = false } = {}) {
    const year = new Date(now).getUTCFullYear();
    const catalog = unique(items);
    const eligible = catalog.filter(m => {
      const y = number(m.year), premiere = Date.parse(m.release_date || '');
      return y >= year - 1 && y <= year && (!Number.isFinite(premiere) || premiere <= now);
    });
    // Previous year is only a fallback when this year's data is unavailable.
    const current = eligible.filter(m => number(m.year) === year);
    const recent = current.length ? current : eligible;
    const newest = (a, b) => number(b.year) - number(a.year) || modified(b, now) - modified(a, now) || a.slug.localeCompare(b.slug);
    const score = m => interest(m) + Math.max(0, 1 - (now - modified(m, now)) / (90 * 864e5)) * 14;
    const ranked = (a, b) => score(b) - score(a) || newest(a, b);
    const cinema = recent.filter(m => m.chieurap === true).sort(ranked);
    const hot = recent.filter(m => interest(m) > 0).sort(ranked);
    const releases = [...recent].sort(newest);
    // Hero is intentionally strict: only current cinema releases or current
    // titles with a real TMDB/IMDb interest signal. Generic/old catalogue
    // entries remain available in rails but never take the premium banner.
    const promoted = unique([...cinema, ...hot]);
    const hero = unique(promoted.length ? promoted : releases).slice(0, 10);
    const recentYear = recent[0]?.year || year;
    return { policy: POLICY, updatedAt, offline, rankingBasis: 'release-year + recent-catalog-update + TMDB/IMDb vote-count proxy',
      hero,
      sections: [
        { id: 'cinema-new', title: `Chiếu rạp ${recentYear} · Nổi bật`, items: cinema.slice(0, 30) },
        { id: 'new-releases', title: `Phim mới ${recentYear}`, items: releases.slice(0, 48) },
        { id: 'recent-interest', title: 'Phim mới được quan tâm', items: hot.slice(0, 36) },
        { id: 'series-new', title: `Phim bộ ${recentYear}`, items: releases.filter(m => m.type === 'series').slice(0, 36) },
        { id: 'latest', title: offline ? 'Kho phim đã lưu · Đang chờ kết nối' : 'Vừa cập nhật trong kho · Có cả phim năm cũ', items: [...catalog].sort((a,b) => modified(b,now)-modified(a,now) || a.slug.localeCompare(b.slug)).slice(0, 240) }
      ].filter(section => section.items.length) };
  }
  // Upstream route construction is deliberately server-only. This browser
  // module contains presentation/ranking logic but no provider API contract.
  const api = Object.freeze({ POLICY, build, interest, personalize });
  root.Phim4KHome = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
