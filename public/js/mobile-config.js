/*
 * Set only a public HTTPS origin here before building a release IPA.
 * No key, password, cookie, or administrator credential belongs in this file.
 * Empty uses the current origin for the normal web deployment.
 */
window.PHIM4K_MOBILE_CONFIG = Object.freeze({
  apiBaseUrl: ""
});
