/* Copy only authenticated, SHA-verified release URLs displayed by auth.js. */
(() => {
  'use strict';
  const platforms = [
    ['Apk', 'Android'], ['Ipa', 'iOS'], ['Exe', 'Windows'], ['Tv', 'Android TV']
  ];
  const label = '🔗 Sao chép link tải';

  function safeReleaseUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch (_error) {
      return '';
    }
  }

  async function copyText(value) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_error) { /* Embedded iOS WebViews may deny Clipboard API. */ }
    const field = document.createElement('textarea');
    field.value = value;
    field.readOnly = true;
    field.setAttribute('aria-hidden', 'true');
    field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(field);
    field.focus();
    field.select();
    let copied = false;
    try { copied = Boolean(document.execCommand('copy')); } catch (_error) {}
    field.remove();
    return copied;
  }

  function attach(anchor, platformName) {
    if (!anchor || anchor.dataset.releaseCopyBound) return;
    anchor.dataset.releaseCopyBound = '1';
    const row = document.createElement('div');
    row.className = 'download-action-row';
    anchor.parentNode.insertBefore(row, anchor);
    row.appendChild(anchor);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-copy-release';
    button.textContent = label;
    button.setAttribute('aria-label', `Sao chép link tải ${platformName}`);
    row.appendChild(button);

    // The Android native installer removes href while downloading. Retain only
    // the previously verified URL; discard it whenever the release is revoked.
    let lastVerifiedUrl = '';
    const sync = () => {
      if (anchor.getAttribute('aria-disabled') !== 'false') {
        lastVerifiedUrl = '';
      } else {
        lastVerifiedUrl = safeReleaseUrl(anchor.getAttribute('href')) || lastVerifiedUrl;
      }
      button.disabled = !lastVerifiedUrl;
      button.title = lastVerifiedUrl ? `Sao chép link tải ${platformName}` : 'Chưa có link tải được xác minh';
    };
    new MutationObserver(sync).observe(anchor, { attributes: true, attributeFilter: ['href', 'aria-disabled'] });
    button.addEventListener('click', async () => {
      sync();
      if (!lastVerifiedUrl) return;
      const copied = await copyText(lastVerifiedUrl);
      if (!copied) {
        // Explicitly display the URL so a user can select/copy it manually.
        window.prompt('Sao chép link tải:', lastVerifiedUrl);
        return;
      }
      button.textContent = '✓ Đã sao chép';
      window.setTimeout(() => { button.textContent = label; }, 1800);
    });
    sync();
  }

  function init() {
    for (const [suffix, name] of platforms) {
      attach(document.getElementById(`btnDownload${suffix}`), name);
      attach(document.getElementById(`forceBtn${suffix}`), name);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
