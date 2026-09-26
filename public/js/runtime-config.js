/* Global request adapter for the bundled Capacitor shell.
 * It preserves browser-relative requests while allowing the native app to call
 * one configured HTTPS API origin. Only /api paths are rewritten when running inside native apps.
 */
(() => {
  // Only native platforms (Capacitor on iOS / Android) running on capacitor:// or file://
  // need a full https:// origin prefix. Web browsers on pages.dev MUST call relative /api/.
  const isNativeApp = window.location.protocol === 'capacitor:' || window.location.protocol === 'file:' || Boolean(window.Capacitor?.isNativePlatform?.());
  const configured = isNativeApp ? (window.PHIM4K_MOBILE_CONFIG?.apiBaseUrl || "") : "";
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

  window.Phim4KRuntime = Object.freeze({ apiBaseUrl });
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const decorated = window.SessionVault ? await window.SessionVault.decorate(input, init) : init;
    if (typeof input === "string" && input.startsWith("/api/") && apiBaseUrl) {
      return nativeFetch(`${apiBaseUrl}${input}`, decorated);
    }
    return nativeFetch(input, decorated);
  };
})();
