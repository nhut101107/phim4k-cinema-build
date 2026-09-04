/* Global request adapter for the bundled Capacitor shell.
 * It preserves browser-relative requests while allowing the native app to call
 * one configured HTTPS API origin. Only /api paths are rewritten.
 */
(() => {
  const configured = window.PHIM4K_MOBILE_CONFIG?.apiBaseUrl || "";
  let apiBaseUrl = "";
  try {
    const parsed = new URL(configured);
    if (parsed.protocol === "https:") {
      apiBaseUrl = parsed.origin;
    }
  } catch (_error) {
    // An empty or malformed value deliberately leaves browser-relative API
    // calls untouched. Authentication then fails closed in api.js.
  }

  window.Phim4KRuntime = Object.freeze({ apiBaseUrl });
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string" && input.startsWith("/api/") && apiBaseUrl) {
      return nativeFetch(`${apiBaseUrl}${input}`, init);
    }
    return nativeFetch(input, init);
  };
})();
