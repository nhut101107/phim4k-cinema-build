(function (root) {
  'use strict';
  const labels = { ios: 'iPhone / iPad', android: 'Android', android_tv: 'Android TV', windows: 'Windows 64-bit' };
  function detect(ua = '', native = root.PHIM4K_PLATFORM || root.Capacitor?.getPlatform?.() || '') {
    if (native === 'android_tv' || /Phim4KTV|Android TV|GoogleTV|SmartTV|AFT\w/i.test(ua)) return 'android_tv';
    if (native === 'windows' || /Windows/i.test(ua)) return 'windows';
    if (/iPhone|iPad|iPod/i.test(ua) || native === 'ios') return 'ios';
    if (/Android/i.test(ua) || native === 'android') return 'android';
    return 'web';
  }
  function safeUrl(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password ? u.href : '';
    } catch (_) { return ''; }
  }
  function release(data, platform) {
    const entry = data?.[platform] || { url: data?.[platform + 'Url'], version: data?.[platform + 'Version'] };
    const sha256 = String(entry.sha256 || '').trim().toLowerCase();
    const sizeBytes = Number(entry.sizeBytes || 0);
    return {
      url: safeUrl(entry.url),
      version: String(entry.version || '').slice(0, 64),
      sha256: /^[a-f0-9]{64}$/.test(sha256) ? sha256 : '',
      sizeBytes: Number.isSafeInteger(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
      signer: String(entry.signer || '').slice(0, 200)
    };
  }
  function releaseState(entry, current) {
    if (!entry.url || !entry.sha256) return 'unavailable';
    if (!/^\d+(\.\d+){0,3}$/.test(entry.version) || !/^\d+(\.\d+){0,3}$/.test(current)) return 'unknown';
    const a = entry.version.split('.').map(Number), b = current.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) ? 'newer' : 'older';
    }
    return 'current';
  }
  const current = detect(root.navigator?.userAgent || '', root.PHIM4K_PLATFORM || root.Capacitor?.getPlatform?.() || '');
  if (root.document?.documentElement) {
    root.document.documentElement.dataset.platform = current;
    root.document.documentElement.classList.add(`platform-${current.replace('_', '-')}`);
  }
  root.Phim4KPlatform = Object.freeze({ labels, detect, safeUrl, release, releaseState });
  if (typeof module !== 'undefined') module.exports = root.Phim4KPlatform;
})(typeof window !== 'undefined' ? window : globalThis);
