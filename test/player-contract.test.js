const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const player = fs.readFileSync(path.join(root, 'public/js/player.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const coverflow = fs.readFileSync(path.join(root, 'public/js/coverflow.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/player.css'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'backend-worker/src/worker.mjs'), 'utf8');
const pagesWorker = fs.readFileSync(path.join(root, 'public/_worker.js'), 'utf8');

test('tapping any movie opens its description before playback', () => {
  assert.match(app, /async openMovieDetail\(slug\)/);
  assert.doesNotMatch(app, /openMovieDetail\(slug, autoPlay/);
  assert.doesNotMatch(coverflow, /openMovieDetail\([^)]*,\s*true\)/);
  assert.match(index, /id="movieModal"/);
  assert.match(index, /class="btn-play-large"[^>]*onclick="playCurrentFirstEpisode\(\)"/);
});

test('catalog episodes retain the EnsMovie playback identity contract', () => {
  assert.match(app, /withPlaybackReference\(episode, server, serverIndex, episodeIndex\)/);
  for (const field of ['sourceMovieSlug', 'serverName', 'episodeSlug', 'episodeName', 'episodeFilename']) {
    assert.match(app, new RegExp(`${field}:`));
  }
  assert.match(player, /episode\?\.link_embed \|\| ''/);
});

test('all clients keep the previously working provider player path', () => {
  assert.match(app, /return \{\s*\.\.\.episode,[\s\S]*?stream_ref:/);
  assert.match(player, /episode\?\.link_embed \|\| ''/);
  const loadEpisode = player.match(/async loadEpisode\(episode,[\s\S]*?\n  \},\n\n  playEmbedStream/)?.[0] || '';
  assert.doesNotMatch(loadEpisode, /getPlaybackTicket|link_m3u8|loadStream/);
  assert.doesNotMatch(player, /publicWebPlayback/);
});

test('desktop and mobile playback use only the stable EnsMovie embed', () => {
  const embed = player.indexOf('this.playEmbedStream(providerEmbedUrl)');
  assert.ok(embed >= 0);
  const loadEpisode = player.match(/async loadEpisode\(episode,[\s\S]*?\n  \},\n\n  playEmbedStream/)?.[0] || '';
  assert.doesNotMatch(loadEpisode, /getPlaybackTicket|link_m3u8|loadStream/);
  assert.doesNotMatch(player, /preferProtectedPlayer/);
  assert.match(player, /playEmbedStream\(embedUrl\)[\s\S]*?iframe\.src = safeEmbedUrl/);
  const authoritativeApi = pagesWorker.match(/const authoritativeApi =[\s\S]*?;\n    if \(authoritativeApi\)/)?.[0] || '';
  assert.doesNotMatch(authoritativeApi, /\/api\/movies\/detail\//);
  assert.match(pagesWorker, /request\.method === 'GET' && url\.pathname\.startsWith\('\/api\/movies\/'\)[\s\S]*?fetchDirectMovieCatalog/);
  assert.match(app, /if \(episode\?\.stream_ref\) return episode;[\s\S]*?stream_ref:/);
  assert.doesNotMatch(pagesWorker, /usesBrowserPlayer/);
  assert.match(player, /resolutionBadge\.className = 'badge-real-res hidden'/);
  assert.match(backend, /embed\.hostname !== "player\.phimapi\.com"/);
  assert.match(backend, /link_embed: embed\.href/);
  assert.match(backend, /_source_id, 40\)\.toLowerCase\(\) === "phimapi"/);
});

test('broken catalogue artwork is removed instead of showing the generic 4K poster', () => {
  assert.match(app, /image\.closest\?\.\('\.movie-card, \.schedule-card, \.search-item, \.coverflow-item'\)/);
  assert.match(app, /if \(brokenCard\) \{[\s\S]*?brokenCard\.remove\(\);[\s\S]*?return;/);
});

test('server labels come from provider language metadata without fake regions', () => {
  const source = player.match(/function formatMovieServerName\([\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const format = vm.runInNewContext(`${source}; formatMovieServerName`);
  assert.equal(format({ server_name: 'Vietsub #1' }, 0, { lang: 'Lồng Tiếng' }), 'Vietsub');
  assert.equal(format({ server_name: 'Thuyết minh #2' }, 1, { lang: 'Vietsub' }), 'Thuyết minh');
  assert.equal(format({ server_name: 'Lồng Tiếng' }, 2, { lang: 'Vietsub' }), 'Lồng tiếng');
  assert.equal(format({ server_name: 'Server 4' }, 3, {}), 'Server 4');
});

test('ENSMovie iframe chrome auto-hides after 2.6 seconds and wakes from a full-screen tap', () => {
  assert.match(player, /const embedActive = this\.wrapper\?\.classList\.contains\('embed-active'\)/);
  assert.match(player, /playEmbedStream\(embedUrl\)[\s\S]*?this\.resetInactivityTimer\(\)/);
  assert.match(player, /embed\?\.addEventListener\('load'[\s\S]*?this\.resetInactivityTimer\(\)/);
  assert.match(player, /enterCinemaFullscreen\(\)\.finally[\s\S]*?this\.resetInactivityTimer\(\)/);
  assert.match(player, /window\.setTimeout\(hideWhenDue, 2700\)/);
  assert.match(player, /event\.target === this\.wrapper[\s\S]*?contains\('embed-active'\)[\s\S]*?contains\('inactive'\)/);
  assert.match(css, /\.cinema-player-wrapper\.inactive\.embed-active::after/);
  assert.match(css, /\.cinema-player-wrapper\.inactive\.embed-active::after\s*\{[\s\S]*?inset:\s*0;/);
  assert.match(css, /\.cinema-player-wrapper\.inactive\.embed-active #playerTopBar > \*/);
});

test('hidden native video cannot cover an active EnsMovie embed with a false stall warning', () => {
  const diagnostics = fs.readFileSync(path.join(root, 'public/js/diagnostics.js'), 'utf8');
  assert.match(diagnostics, /if \(this\.suppressBuffering \|\| this\.wrapper\?\.classList\.contains\('embed-active'\) \|\| !this\.activeStreamUrl\) return;/);
});

test('exhausted servers stop the failed media element instead of buffering forever', () => {
  assert.match(player, /onVideo\('waiting',[\s\S]*?if \(this\.suppressBuffering\) return/);
  assert.match(player, /Tất cả server hiện có đều không phản hồi[\s\S]*?this\.suppressBuffering = true;[\s\S]*?this\.video\.removeAttribute\('src'\)/);
  assert.match(player, /async loadEpisode\(episode, _options = \{\}\)[\s\S]*?this\.suppressBuffering = false/);
});

test('backend accepts every direct stream field exposed by the EnsMovie gateway', () => {
  assert.match(backend, /episode\?\.direct_url \|\| episode\?\.directUrl \|\| episode\?\.playback_url/);
  assert.match(backend, /episode\?\.link_m3u8 \|\| episode\?\.linkM3u8/);
  assert.match(backend, /episode\?\.link_embed \|\| episode\?\.linkEmbed/);
  assert.match(backend, /rawHeaders\.referer \|\| rawHeaders\.Referer/);
});

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

test('landscape player header keeps server and report actions clear of the title', () => {
  assert.match(css, /grid-template-columns: auto minmax\(0, 1fr\) max-content/);
  assert.match(css, /orientation: landscape\) and \(max-height: 760px\) and \(max-width: 1600px/);
  assert.match(css, /\.player-top-actions \.btn-player-report\s*\{[\s\S]*?white-space: nowrap !important/);
  assert.match(css, /env\(safe-area-inset-right\)[\s\S]*?env\(safe-area-inset-left\)/);
});

test('embedded player chrome uses a WKWebView-safe deadline and direct hidden state', () => {
  assert.match(player, /chromeHideDeadline = performance\.now\(\) \+ 2600/);
  assert.match(player, /requestAnimationFrame\?\.\(hideWhenDue\)/);
  assert.match(player, /setControlsHidden\(hidden\)[\s\S]*?player-chrome-hidden/);
  assert.match(player, /if \(!this\.embedReady[\s\S]*?this\.embedReady = true/);
  assert.match(css, /\.player-top-bar\.player-chrome-hidden\s*\{[\s\S]*?visibility:\s*hidden !important/);
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
  const nativeIndex = player.indexOf("this.nativePlatform() === 'ios'");
  const hlsJsIndex = player.indexOf('const HlsEngine = window.Hls');
  assert.ok(nativeIndex >= 0);
  assert.ok(hlsJsIndex > nativeIndex);
  assert.match(player, /this\.usingNativeHls = true/);
});

test('stalled playback refreshes the current stream before abandoning the server', () => {
  assert.match(player, /onVideo\('stalled'/);
  assert.match(player, /armStallWatchdog\('waiting'\)/);
  assert.match(player, /armStallWatchdog\('stalled'\)/);
  assert.match(player, /streamRefreshAttempts < 1/);
  assert.match(player, /await this\.loadEpisode\(this\.currentEpisode, \{ resumeTime, autoplay: true \}\)/);
  assert.match(player, /recoverPlayback\('native_video_error'\)/);
  assert.match(player, /recoverPlayback\('hls_fatal'\)/);
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

test('all platforms auto-skip embedded ad windows once and keep a user toggle', () => {
  assert.match(index, /id="btnAutoSkipAds"[^>]*onclick="toggleAutoSkipAds\(\)"/);
  assert.match(index, /id="btnAutoSkipAdsTop"[^>]*onclick="toggleAutoSkipAds\(\)"/);
  assert.doesNotMatch(player, /this\.nativePlatform\(\) !== 'ios'/);
  assert.match(player, /PlayerCore\.autoAdSkipTarget/);
  assert.match(player, /this\.skippedAdMarkers\.add\(result\.marker\)/);
  assert.match(player, /phim4k-auto-skip-ads-v2/);
});

test('every movie displays the requested small faint handwritten mnhut watermark', () => {
  assert.match(index, /class="movie-copyright-watermark"[^>]*>mnhut<\/div>/);
  assert.doesNotMatch(index, /đã đóng dấu bản quyền/);
  assert.match(css, /\.movie-copyright-watermark\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(css, /font-family:[^;]*(?:Chalkboard SE|Segoe Print)[^;]*cursive/);
  assert.match(css, /font-size:\s*clamp\(18px, 2vw, 30px\)/);
  assert.match(css, /opacity:\s*\.74/);
  assert.match(css, /pointer-events:\s*none/);
});

test('server picker identifies the active source and preserves the current episode', () => {
  assert.match(index, /id="btnPlayerServer"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
  assert.match(player, /findEquivalentEpisode\(targetEpisodes, this\.currentEpisode, this\.currentEpIndex\)/);
  assert.match(player, /button\.setAttribute\('aria-checked', String\(index === this\.currentServerIndex\)\)/);
  assert.match(player, /episodeCount.*tập/);
});
