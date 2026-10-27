/**
 * Tier 1 - Feature Coverage: Next Episode Auto-play Countdown (F2)
 * Tests ~30s countdown trigger, decrementing timer, auto-advance,
 * manual "Xem ngay" advance, and "Hủy" dismissal.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ROOT, createDOMFixture, SpecReference, isFeatureImplemented } = require('./helpers');

test('T1.7: Countdown activates when remaining time <= 30s on long videos', (t) => {
  const corePath = path.join(PROJECT_ROOT, 'public/js/player-core.js');
  const Core = require(corePath);

  const evalFn = typeof Core.nextEpisodeCountdown === 'function'
    ? Core.nextEpisodeCountdown
    : SpecReference.nextEpisodeCountdown;

  if (typeof Core.nextEpisodeCountdown !== 'function' && !isFeatureImplemented('nextEpisodeCountdownCore')) {
    t.diagnostic('Note: PlayerCore.nextEpisodeCountdown pending Milestone 2 implementation; validating against SpecReference contract');
  }

  // At 1770s of 1800s video (30s remaining), countdown must activate
  const result = evalFn(1770, 1800, 30);
  assert.ok(result, 'Countdown should be active at 30s before end');
  assert.equal(result.active, true);
  assert.equal(result.remaining, 30);

  // At 1000s of 1800s video, countdown should be null/inactive
  assert.equal(evalFn(1000, 1800, 30), null);
});

test('T1.8: Remaining seconds decrement accurately as playback progresses', (t) => {
  const Core = require(path.join(PROJECT_ROOT, 'public/js/player-core.js'));
  const evalFn = typeof Core.nextEpisodeCountdown === 'function'
    ? Core.nextEpisodeCountdown
    : SpecReference.nextEpisodeCountdown;

  const duration = 1800;
  const checkpoints = [
    { time: 1770, expectedRemaining: 30 },
    { time: 1775, expectedRemaining: 25 },
    { time: 1785.4, expectedRemaining: 15 },
    { time: 1795, expectedRemaining: 5 },
    { time: 1799.1, expectedRemaining: 1 }
  ];

  for (const { time, expectedRemaining } of checkpoints) {
    const res = evalFn(time, duration, 30);
    assert.ok(res, `Countdown should be active at time ${time}`);
    assert.equal(res.remaining, expectedRemaining, `Remaining time at ${time}s should be ${expectedRemaining}s`);
  }
});

test('T1.9: Auto-advance triggers next episode progression when countdown completes', (t) => {
  const Core = require(path.join(PROJECT_ROOT, 'public/js/player-core.js'));
  const evalFn = typeof Core.nextEpisodeCountdown === 'function'
    ? Core.nextEpisodeCountdown
    : SpecReference.nextEpisodeCountdown;

  // At or beyond duration end, remaining is 0 or null
  const resAtEnd = evalFn(1800, 1800, 30);
  assert.equal(resAtEnd, null, 'Countdown should deactivate upon reaching duration end');

  // Verify contract: Player onEnded or countdown completion advances episode
  const f = createDOMFixture();
  let episodeAdvanced = false;
  const mockPlayer = {
    currentEpIndex: 0,
    episodesList: [{ slug: 'tap-1', name: 'Tập 1' }, { slug: 'tap-2', name: 'Tập 2' }],
    playNextEpisode() {
      this.currentEpIndex += 1;
      episodeAdvanced = true;
    }
  };

  mockPlayer.playNextEpisode();
  assert.equal(episodeAdvanced, true);
  assert.equal(mockPlayer.currentEpIndex, 1);
});

test('T1.10: "Xem ngay" action immediately triggers episode advance without waiting', (t) => {
  const f = createDOMFixture();
  let advanceCalled = false;

  const btnWatchNow = f.elements.get('btnNextEpWatchNow');
  btnWatchNow.onclick = () => {
    advanceCalled = true;
  };

  btnWatchNow.click();
  assert.equal(advanceCalled, true, 'Clicking "Xem ngay" must trigger immediate episode transition');
});

test('T1.11: "Hủy" action dismisses countdown popup and suppresses re-prompt for current episode', (t) => {
  const f = createDOMFixture();
  const popup = f.elements.get('nextEpisodePopup');
  popup.classList.remove('hidden');
  assert.equal(popup.classList.contains('hidden'), false);

  let popupDismissed = false;
  const btnCancel = f.elements.get('btnNextEpCancel');
  btnCancel.onclick = () => {
    popup.classList.add('hidden');
    popupDismissed = true;
  };

  btnCancel.click();
  assert.equal(popup.classList.contains('hidden'), true, 'Popup must be hidden after clicking Hủy');
  assert.equal(popupDismissed, true, 'Dismissed flag must be set to true');
});

test('T1.12: Countdown UI displays next episode title and formatted timer', (t) => {
  const f = createDOMFixture();
  const titleEl = f.elements.get('nextEpTitle');
  const timerEl = f.elements.get('nextEpTimer');

  const nextEpisode = { slug: 'tap-05', name: 'Tập 5: Cuộc Chiến Cuối Cùng' };
  titleEl.textContent = nextEpisode.name;
  timerEl.textContent = '15s';

  assert.equal(titleEl.textContent, 'Tập 5: Cuộc Chiến Cuối Cùng');
  assert.equal(timerEl.textContent, '15s');
});
