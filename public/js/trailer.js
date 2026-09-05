(function(root) {
  function resolveTrailer(raw, base = 'https://localhost/') {
    try {
      const u = new URL(String(raw || ''), base), origin = new URL(base);
      if (!raw || u.username || u.password) return null;
      if (u.protocol === origin.protocol && u.host === origin.host && /\.mp4$/i.test(u.pathname)) return { kind: 'video', url: u.href };
      if (u.protocol !== 'https:') return null;
      let id;
      if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
      else if (['youtube.com','www.youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(u.hostname)) {
        id = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(?:embed|shorts)\/([^/]+)$/.exec(u.pathname)?.[1];
      }
      if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) return null;
      return { kind: 'youtube', url: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0`, external: `https://www.youtube.com/watch?v=${id}` };
    } catch (_) { return null; }
  }
  function stop() {
    const host = root.document?.getElementById('detailTrailerMedia');
    host?.querySelectorAll('video').forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); });
    host?.replaceChildren();
  }
  function mount(movie) {
    stop();
    const host = root.document.getElementById('detailTrailerMedia');
    const label = root.document.getElementById('detailTrailerStatus');
    const section = root.document.getElementById('detailTrailer');
    if (!host || !label || !section) return;
    section.classList.remove('hidden');
    const trailer = resolveTrailer(movie?.trailer_url, root.location.href);
    label.textContent = trailer ? 'Trailer đúng phim · bắt đầu tắt tiếng, bật tiếng trong trình phát' : 'Nguồn chưa cung cấp trailer phù hợp cho phim này.';
    root.document.getElementById('detailTrailerSkip').classList.toggle('hidden', !trailer);
    if (!trailer) return;
    if (trailer.kind === 'video') {
      const video = root.document.createElement('video');
      video.controls = true; video.muted = true; video.autoplay = true; video.playsInline = true;
      video.src = trailer.url;
      video.addEventListener('error', () => { label.textContent = 'Trailer không phát được. Bạn vẫn có thể chọn tập phim bên dưới.'; stop(); });
      host.append(video);
      video.play().catch(() => { label.textContent = 'Bấm phát để xem trailer.'; });
    } else {
      const frame = root.document.createElement('iframe');
      frame.title = `Trailer: ${String(movie.name || '').slice(0,160)}`;
      frame.src = trailer.url;
      frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      host.append(frame);
      const link = root.document.createElement('a');
      link.href = trailer.external; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = 'Không phát được? Mở trailer trên YouTube';
      host.append(link);
    }
  }
  root.Phim4KTrailer = { resolveTrailer, mount, stop };
  if (typeof module === 'object' && module.exports) module.exports = { resolveTrailer };
  root.document?.addEventListener('visibilitychange', () => { if (root.document.hidden) stop(); });
})(typeof window === 'object' ? window : globalThis);
