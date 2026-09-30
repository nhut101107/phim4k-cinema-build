/* Global request adapter for the bundled Capacitor shell.
 * It preserves browser-relative requests while allowing the native app to call
 * one configured HTTPS API origin. Only /api paths are rewritten when running inside native apps.
 */
(() => {
  // Only native platforms (Capacitor on iOS / Android) running on capacitor:// or file://
  // need a full https:// origin prefix. Web browsers on pages.dev MUST call relative /api/.
  const isNativeApp = window.location.protocol === 'capacitor:' || window.location.protocol === 'file:' || Boolean(window.Capacitor?.isNativePlatform?.());
  const configured = isNativeApp ? (window.PHIM4K_MOBILE_CONFIG?.apiBaseUrl || "") : "";
  const licenseConfigured = window.PHIM4K_MOBILE_CONFIG?.licenseApiBaseUrl || "";
  let apiBaseUrl = "";
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "https:") {
        apiBaseUrl = parsed.origin;
      }
    } catch (_error) {
      // Keep empty
    }
  }

  let licenseApiBaseUrl = "";
  try {
    const parsed = new URL(licenseConfigured);
    if (parsed.protocol === "https:") licenseApiBaseUrl = parsed.origin;
  } catch (_error) {}

  const authoritativePath = (pathname) => pathname.startsWith('/api/auth/')
    || pathname.startsWith('/api/admin/')
    || ['/api/app/access-policy', '/api/app/downloads', '/api/app/check-update', '/api/app/version', '/api/app/announcement', '/api/telemetry', '/api/feedback', '/api/watch-progress', '/api/movies/report-issue'].includes(pathname);

  window.Phim4KRuntime = Object.freeze({ apiBaseUrl, licenseApiBaseUrl });
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const decorated = window.SessionVault ? await window.SessionVault.decorate(input, init) : init;
    if (typeof input === "string" && input.startsWith("/api/")) {
      const [pathname] = input.split('?');
      if (licenseApiBaseUrl && authoritativePath(pathname)) return nativeFetch(`${licenseApiBaseUrl}${input}`, decorated);
      if (apiBaseUrl) return nativeFetch(`${apiBaseUrl}${input}`, decorated);
    }
    return nativeFetch(input, decorated);
  };
})();
