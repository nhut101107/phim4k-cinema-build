(() => {
  const VoiceSearch = {
    active: false,
    recognition: null,
    status(message = '', error = false) {
      const box = document.getElementById('tvVoiceStatus');
      const button = document.getElementById('tvVoiceSearchBtn');
      if (box) {
        box.textContent = message;
        box.classList.toggle('hidden', !message);
        box.classList.toggle('error', error);
      }
      button?.classList.toggle('listening', this.active);
      button?.setAttribute('aria-pressed', String(this.active));
      if (message && !this.active) window.setTimeout(() => box?.classList.add('hidden'), 3500);
    },
    submit(transcript) {
      const query = String(transcript || '').trim().slice(0, 120);
      if (!query) throw new Error('Không nghe rõ tên phim. Hãy thử lại.');
      const input = document.getElementById('searchInput');
      if (input) {
        input.value = query;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      this.status(`Đang tìm “${query}”…`);
      window.App?.hideSearchDropdown?.();
      void window.App?.loadFullSearch?.(query, 1);
      window.API?.trackUsage?.('search', { query, entry: 'TV voice' });
    },
    async nativeListen() {
      const plugin = window.Capacitor?.Plugins?.VoiceSearch;
      if (!plugin?.listen) return false;
      const result = await plugin.listen({ locale: 'vi-VN', prompt: 'Nói tên phim cần tìm' });
      this.submit(result?.text);
      return true;
    },
    webListen() {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) throw new Error('TV này chưa có dịch vụ nhận dạng giọng nói.');
      return new Promise((resolve, reject) => {
        const recognition = new Recognition();
        this.recognition = recognition;
        recognition.lang = 'vi-VN';
        recognition.interimResults = false;
        recognition.maxAlternatives = 3;
        recognition.onresult = event => {
          try { this.submit(event.results?.[0]?.[0]?.transcript); resolve(true); }
          catch (error) { reject(error); }
        };
        recognition.onerror = event => reject(new Error(event.error === 'not-allowed' ? 'TV chưa cấp quyền micro.' : 'Không nghe rõ tên phim. Hãy thử lại.'));
        recognition.onend = () => { this.recognition = null; };
        recognition.start();
      });
    },
    async start() {
      if (this.active) {
        this.recognition?.stop?.();
        return;
      }
      this.active = true;
      this.status('Đang nghe… nói tên phim vào remote.');
      try {
        if (!await this.nativeListen()) await this.webListen();
      } catch (error) {
        this.status(error?.message || 'Không thể mở tìm kiếm giọng nói.', true);
      } finally {
        this.active = false;
        this.status(document.getElementById('tvVoiceStatus')?.textContent || '');
      }
    }
  };
  window.Phim4KVoiceSearch = Object.freeze({ start: () => VoiceSearch.start() });
  const selector = 'button, a[href], input, select, textarea, [role="button"], [onclick]:not(.modal-dialog):not(.modal-overlay):not(.download-dialog)';
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.hidden, [inert]');
  function scope() {
    const overlays = [...document.querySelectorAll('.modal-overlay, #playerModal, #activationGate')].filter(visible);
    return overlays.reverse().sort((a, b) => (Number(getComputedStyle(b).zIndex) || 0) - (Number(getComputedStyle(a).zIndex) || 0))[0] || document;
  }
  function candidates() {
    return [...scope().querySelectorAll(selector)].filter(el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
  }
  const inBottomTabs = el => Boolean(el?.closest?.('#bottomTabBar, .bottom-tab-bar'));
  const movieCard = el => el?.closest?.('.movie-card');
  let lastMovieFocus = null;
  function rememberMovie(el) {
    const card = movieCard(el);
    if (!card) return;
    lastMovieFocus = {
      section: card.closest('.movie-section')?.dataset.sectionId || '',
      index: card.dataset.railIndex || '',
      label: card.getAttribute('aria-label') || ''
    };
  }
  function focus(el, vertical = false) {
    if (!el) return;
    if (el.tabIndex < 0) el.tabIndex = 0;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: vertical && movieCard(el) ? 'center' : 'nearest', inline: 'nearest' });
    rememberMovie(el);
  }
  function restoreMovieFocus() {
    if (!lastMovieFocus) return null;
    const sections = [...scope().querySelectorAll('.movie-section')];
    const section = sections.find(item => item.dataset.sectionId === lastMovieFocus.section);
    if (!section) return null;
    return [...section.querySelectorAll('.movie-card')].find(card =>
      card.dataset.railIndex === lastMovieFocus.index || card.getAttribute('aria-label') === lastMovieFocus.label
    ) || section.querySelector('.movie-card');
  }
  function back() {
    const area = scope();
    const closer = [...area.querySelectorAll?.('.modal-close-btn, .modal-close, .detail-close-btn, .admin-close-btn, [onclick*="closePlayer"], [onclick*="hideAdmin"], [onclick*="closeDetail"]') || []].find(visible);
    if (closer) { closer.click(); return true; }
    if (typeof Player !== 'undefined' && Player.modal && visible(Player.modal)) { Player.close(); return true; }
    if (area !== document && area.id !== 'activationGate') return true;
    return false;
  }
  // Android phone and Android TV share one predictable system-Back contract:
  // close the topmost app layer first and exit only when the home screen is bare.
  window.Phim4KNavigation = Object.freeze({ back });

  if (Phim4KPlatform.detect(navigator.userAgent, window.PHIM4K_PLATFORM) !== 'android_tv') return;
  document.documentElement.classList.add('tv-mode');
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key === 'BrowserBack') { if (back()) { event.preventDefault(); event.stopImmediatePropagation(); } return; }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) return;
    const all = candidates();
    const current = document.activeElement;
    if (event.key === 'Enter') {
      if (!all.includes(current)) focus(all[0]);
      else if (!current.matches('button, a, input, textarea, select')) { current.click(); event.preventDefault(); }
      return;
    }
    if (current?.matches('select, textarea') || (current?.matches('input:not([type=range])') && ['ArrowLeft', 'ArrowRight'].includes(event.key))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!all.includes(current)) { focus(all[0]); return; }
    const rect = current.getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const sign = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const currentCard = movieCard(current);
    let pool = all.filter(el => el !== current);
    if (!inBottomTabs(current)) pool = pool.filter(el => !inBottomTabs(el));
    if (currentCard && horizontal) {
      const currentRow = currentCard.closest('.cinema-rail, .movie-grid');
      const rowCards = pool.filter(el => movieCard(el)?.closest('.cinema-rail, .movie-grid') === currentRow);
      if (rowCards.length) pool = rowCards;
    } else if (currentCard && !horizontal) {
      const cards = pool.filter(el => movieCard(el));
      if (cards.length) pool = cards;
    }
    const rank = pool => pool.map(el => {
      const r = el.getBoundingClientRect(), dx = r.x + r.width / 2 - x, dy = r.y + r.height / 2 - y;
      const primary = (horizontal ? dx : dy) * sign, secondary = Math.abs(horizontal ? dy : dx);
      return { el, primary, score: primary + secondary * (horizontal ? 2 : 0.7) };
    }).filter(item => item.primary > 4).sort((a, b) => a.score - b.score);
    let options = rank(pool);
    // The fixed tab bar is only a final destination after the last content row.
    if (!options.length && !inBottomTabs(current)) options = rank(all.filter(el => inBottomTabs(el)));
    focus(options[0]?.el, !horizontal);
  }, true);
  window.Phim4KTV = Object.freeze({ back });
  // Focus is repaired after a modal opens or a catalogue replaces its cards.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!candidates().includes(document.activeElement)) focus(restoreMovieFocus() || candidates().find(el => !inBottomTabs(el)) || candidates()[0]);
    });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('focusin', event => rememberMovie(event.target), true);
  focus(candidates().find(el => !inBottomTabs(el)) || candidates()[0]);
})();
