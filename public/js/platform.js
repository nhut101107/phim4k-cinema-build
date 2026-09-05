(function (root) {
  'use strict';
  const labels = { ios: 'iPhone / iPad', android: 'Android', android_tv: 'Android TV', windows: 'Windows 64-bit' };
  function detect(ua = '', native = '') {
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
    return { url: safeUrl(entry.url), version: String(entry.version || '').slice(0, 64) };
  }
  root.Phim4KPlatform = Object.freeze({ labels, detect, safeUrl, release });
  if (typeof module !== 'undefined') module.exports = root.Phim4KPlatform;
})(typeof window !== 'undefined' ? window : globalThis);
