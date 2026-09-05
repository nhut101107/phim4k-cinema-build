(() => {
  const start = performance.now();
  const heartbeat = () => {
    if (document.hidden) return;
    const video = document.querySelector('video');
    const context = { ...API.getOperationalContext(), visibility: 'visible', uptime: Math.round((performance.now() - start) / 1000) };
    if (video && !video.paused) {
      context.seconds = Math.round(video.currentTime || 0);
      context.readyState = video.readyState;
      context.buffered = video.buffered.length ? Math.max(0, Math.round(video.buffered.end(video.buffered.length - 1) - video.currentTime)) : 0;
    }
    API.trackUsage('heartbeat', context);
  };
  setInterval(heartbeat, 60000);
  document.addEventListener('visibilitychange', () => API.trackUsage('app_visibility', { visibility: document.hidden ? 'hidden' : 'visible' }));
  for (const event of ['online', 'offline']) window.addEventListener(event, () => API.trackUsage('network_change', { network: event }));
  // Never ship raw error messages, stack traces, URLs or user-entered text.
  let lastError = 0;
  const report = kind => { if (Date.now() - lastError > 10000) { lastError = Date.now(); API.trackUsage('client_error', { error: kind }); } };
  window.addEventListener('error', () => report('javascript_error'));
  window.addEventListener('unhandledrejection', () => report('unhandled_promise'));
})();
