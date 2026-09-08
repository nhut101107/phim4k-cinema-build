const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const player = fs.readFileSync(path.join(root, 'public/js/player.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/player.css'), 'utf8');

test('player exposes only subtitle-safe contain and explicit fullscreen fill modes', () => {
  assert.match(player, /removeItem\('phim4k-player-fit'\)/);
  assert.match(player, /removeItem\('phim4k-player-fit-v2'\)/);
  assert.match(player, /getItem\('phim4k-player-aspect-v3'\)/);
  assert.match(index, /id="btnAspectContain"/);
  assert.match(index, /id="btnAspectCover"/);
  assert.match(css, /\.cinema-player-wrapper\.aspect-cover \.video-element\s*\{[\s\S]*?object-fit:\s*cover/);
  assert.match(css, /\.cinema-player-wrapper\.aspect-contain \.video-element\s*\{[\s\S]*?object-fit:\s*contain/);
});

test('fullscreen follows the live visual viewport after native rotation', () => {
  assert.match(player, /window\.visualViewport\?\.addEventListener\('resize'/);
  assert.match(player, /syncFullscreenViewport\(\)/);
  assert.match(css, /width: var\(--player-viewport-width, 100%\)/);
  assert.match(css, /height: var\(--player-viewport-height, 100%\)/);
});

test('admin owns a block scroll layout so horizontal tabs cannot flex-shrink away', () => {
  const modal=fs.readFileSync(path.join(root,'public/css/modal.css'),'utf8');
  assert.match(modal,/\.admin-dialog\s*\{[^}]*display:\s*block/);
  assert.match(modal,/\.admin-tabs-nav\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(modal,/\.admin-tab-btn\s*\{[^}]*min-height:\s*44px/);
});

test('playback clock stays below seek bar and is not hidden on mobile', () => {
  assert.ok(index.indexOf('id="progressContainer"') < index.indexOf('id="currentTime"'));
  assert.ok(index.indexOf('id="currentTime"') < index.indexOf('class="controls-row"'));
  assert.doesNotMatch(css, /\.time-display\s*\{[^}]*display:\s*none/);
  assert.equal((index.match(/id="currentTime"/g) || []).length, 1);
});

test('explicit pause cancels pending surface gestures', () => {
  assert.match(player, /togglePlayPause\(\)\s*\{[\s\S]*?this\.clearSurfaceTap\(\);\s*this\.resetInactivityTimer\(\)/);
  assert.match(css, /\.player-center-toggle svg\s*\{[^}]*pointer-events:\s*none/);
});

test('uses one native fullscreen path and never rotates the web player with CSS', () => {
  assert.match(player, /ScreenOrientation/);
  assert.match(player, /StatusBar/);
  assert.match(player, /orientation:\s*'landscape'/);
  assert.doesNotMatch(player, /webkitEnterFullscreen|landscape-forced|toggleLandscapeFullscreen/);
});

test('loads player rules before the shared player and exposes a single fullscreen control', () => {
  assert.ok(index.indexOf('/js/player-core.js') < index.indexOf('/js/player.js'));
  assert.match(index, /id="btnCinemaFullscreen"/);
  assert.doesNotMatch(index, /btnLandscapeFullscreen/);
});

test('prefers native HLS before hls.js inside the iPhone WebView', () => {
  const nativeIndex = player.indexOf("if (isHls && this.nativePlatform() === 'ios')");
  const hlsJsIndex = player.indexOf('const HlsEngine = window.Hls');
  assert.ok(nativeIndex >= 0);
  assert.ok(hlsJsIndex > nativeIndex);
  assert.match(player, /this\.usingNativeHls = true/);
});

test('Android WebView keeps adaptive hls.js playback with a native fallback', () => {
  assert.match(player, /nativePlatform\(\)/);
  assert.match(player, /this\.nativePlatform\(\) === 'ios'/);
  assert.match(player, /const HlsEngine = window\.Hls/);
  assert.match(player, /this\.usingNativeHls = isHls;[\s\S]*?this\.video\.src = streamUrl/);
});

test('keeps adaptive quality selected when HLS changes rendition', () => {
  assert.match(player, /qualityMode: 'auto'/);
  assert.match(player, /hls\.currentLevel = -1/);
  assert.match(player, /if \(this\.qualityMode === 'auto'\)/);
  assert.match(player, /setQualityButtonLabel\('Tự động'\)/);
  assert.match(index, /id="btnQuality"[^>]*>Tự động</);
  assert.match(index, /id="btnQuality"[^>]*disabled/);
  assert.doesNotMatch(index, /id="qualityMenu"/);
  assert.doesNotMatch(index, /id="btnAudioMode"/);
  assert.doesNotMatch(index, /id="btnAspectFit"/);
});

test('uses black bars without poster ambience and reserves subtitle space in contain mode', () => {
  assert.doesNotMatch(index, /id="playerAmbientBackdrop"/);
  assert.doesNotMatch(player, /setAmbientBackdrop|layoutVideoSurface/);
  assert.doesNotMatch(css, /player-ambient-backdrop/);
  assert.match(css, /\.video-element\s*\{[\s\S]*?background:\s*#000/);
  assert.match(css, /aspect-contain:not\(\.inactive\) \.video-element\s*\{[\s\S]*?subtitle-safe-area/);
});

test('uses a compact portrait video stage instead of centering video in the full viewport', () => {
  assert.match(css, /@media \(orientation: portrait\)/);
  assert.match(css, /top: max\(62px, calc\(env\(safe-area-inset-top\) \+ 54px\)\)/);
  assert.match(css, /height: min\(56\.25vw, calc\(100dvh - 224px\)\)/);
  assert.match(css, /badge-real-res\.res-auto/);
});

test('native playback and HLS.js expose automatic quality only', () => {
  assert.match(player, /populateNativeHlsMenu\(\)[\s\S]*?this\.qualityMode = 'auto'/);
  assert.match(player, /if \(this\.hls\) this\.hls\.currentLevel = -1/);
  assert.doesNotMatch(index, /onclick="setQuality\((?!-1)/);
});
