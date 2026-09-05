/*
 * Set only a public HTTPS origin here before building a release IPA.
 * No key, password, cookie, or administrator credential belongs in this file.
 * Empty uses the current origin for the normal web deployment.
 */
window.PHIM4K_MOBILE_CONFIG = Object.freeze({
  // Capacitor loads the bundled UI from capacitor://localhost.  A relative
  // /api request would therefore never reach the public Worker on an iPhone.
  apiBaseUrl: "https://phim4k-license-api.phim4k-pwdbhdz.workers.dev"
});
