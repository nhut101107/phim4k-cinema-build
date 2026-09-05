(function(root) {
  let graph;
  function safeSource(src, base) {
    try {
      const url = new URL(src), local = new URL(base);
      if (url.protocol === 'blob:') return url.origin === local.origin;
      return url.protocol === local.protocol && url.host === local.host && url.pathname.startsWith('/media/');
    } catch (_) { return false; }
  }
  async function toggle(video) {
    if (graph?.video === video) {
      graph.enabled = !graph.enabled;
      graph.source.disconnect();
      graph.source.connect(graph.enabled ? graph.eq : graph.context.destination);
      await graph.context.resume();
      return graph.enabled;
    }
    const src = video.currentSrc || video.src;
    if (!safeSource(src, root.location.href)) throw new Error('Nguồn này giữ âm gốc để tránh mất tiếng do giới hạn xử lý âm thanh.');
    const Context = root.AudioContext || root.webkitAudioContext;
    if (!Context) throw new Error('Thiết bị này chưa hỗ trợ chế độ Rõ thoại.');
    const context = new Context();
    try {
      await context.resume();
      if (!video.isConnected || (video.currentSrc || video.src) !== src) throw new Error('Luồng đã thay đổi. Hãy thử lại.');
      const eq = context.createBiquadFilter(); eq.type = 'peaking'; eq.frequency.value = 2200; eq.Q.value = 0.7; eq.gain.value = 2;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -20; compressor.knee.value = 24; compressor.ratio.value = 3; compressor.attack.value = 0.005; compressor.release.value = 0.18;
      const gain = context.createGain(); gain.gain.value = 0.75;
      eq.connect(compressor); compressor.connect(gain); gain.connect(context.destination);
      const source = context.createMediaElementSource(video);
      source.connect(eq);
      graph = {video,context,source,eq,enabled:true};
      return true;
    } catch (error) { void context.close().catch(() => {}); throw error; }
  }
  function release(video) {
    if (graph?.video !== video) return false;
    graph.source.disconnect(); void graph.context.close().catch(() => {}); graph = null;
    return true; // Caller replaces the captured element before loading any new source.
  }
  root.Phim4KAudio = { toggle, release };
  if (typeof module === 'object' && module.exports) module.exports = { safeSource };
})(typeof window === 'object' ? window : globalThis);
