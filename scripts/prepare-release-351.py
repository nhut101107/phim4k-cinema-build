#!/usr/bin/env python3
"""Prepare 3.51 sources; no generated binary or existing release is modified."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    '.github/workflows/build-android-phone.yml',
    '.github/workflows/build-ios-ipa.yml',
    '.github/workflows/build-tv-windows.yml',
    'android/app/build.gradle',
    'backend-worker/src/worker.mjs',
    'backend-worker/test/releases.test.mjs',
    'electron-builder.json',
    'ios/App/App.xcodeproj/project.pbxproj',
    'package.json', 'package-lock.json',
    'public/index.html', 'public/js/api.js', 'public/js/coverflow.js',
    'public/js/diagnostics.js',
    'scripts/rebuild-release.flag', 'scripts/verify-release.cjs', 'server.js',
    'test/mobile-runtime-contract.test.js',
]

for relative in TARGETS:
    path = ROOT / relative
    source = path.read_text(encoding='utf-8')
    if relative in ('backend-worker/test/releases.test.mjs', 'test/mobile-runtime-contract.test.js'):
        source = source.replace(r'3\.50', r'3\.51')
    if '3.51' in source and '3.50' not in source:
        continue
    if '3.50' not in source:
        raise SystemExit(f'Refusing to patch versionless file: {relative}')
    updated = source.replace('3.50', '3.51')
    if relative == 'android/app/build.gradle':
        assert 'versionCode 50' in updated
        updated = updated.replace('versionCode 50', 'versionCode 51')
    elif relative == 'ios/App/App.xcodeproj/project.pbxproj':
        assert updated.count('CURRENT_PROJECT_VERSION = 50;') == 2
        updated = updated.replace('CURRENT_PROJECT_VERSION = 50;', 'CURRENT_PROJECT_VERSION = 51;')
    elif relative == 'test/mobile-runtime-contract.test.js':
        assert '/versionCode 50/' in updated
        updated = updated.replace('/versionCode 50/', '/versionCode 51/')
        # JavaScript regular-expression literals escape the version dot, so
        # the plain-text 3.50 replacement above does not update them. Keep the
        # release contract tests aligned with the sources produced in this
        # same workflow instead of failing after a successful version bump.
        updated = updated.replace(r'3\.50', r'3\.51')
        updated = updated.replace("['50', '50']", "['51', '51']")
    elif relative in ('.github/workflows/build-android-phone.yml', '.github/workflows/build-tv-windows.yml'):
        updated = updated.replace("versionCode='50'", "versionCode='51'")
    elif relative == '.github/workflows/build-ios-ipa.yml':
        assert '" = "50"' in updated
        updated = updated.replace('" = "50"', '" = "51"')
    if relative.startswith('.github/workflows/build-'):
        assert 'ios-v3.51' in updated, relative
        assert 'ios-v3.50' not in updated, relative
    path.write_text(updated, encoding='utf-8')
    print('Updated', relative)

html = ROOT / 'public/index.html'
source = html.read_text(encoding='utf-8')
needle = '  <script src="/js/native-downloads.js?v=3.51"></script>'
insert = '  <script src="/js/release-copy.js?v=3.51"></script>\n' + needle
if 'release-copy.js?v=3.51' not in source:
    assert source.count(needle) == 1
    source = source.replace(needle, insert)
    html.write_text(source, encoding='utf-8')

style_path = ROOT / 'public/css/modal.css'
styles = '''\n/* Download and copy actions remain visible in small phone/TV dialogs. */
.download-action-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: stretch; width: 100%; }
.download-action-row .btn-download-action { flex: 1 1 150px; min-width: 0; }
.btn-copy-release { flex: 1 1 140px; min-height: 44px; border: 1px solid rgba(255, 210, 100, .65); border-radius: 10px; background: rgba(255, 210, 100, .13); color: #ffe5a0; font: inherit; font-weight: 700; cursor: pointer; padding: 10px 12px; }
.btn-copy-release:disabled { opacity: .45; cursor: not-allowed; }
.btn-copy-release:focus-visible { outline: 3px solid #ffcf59; outline-offset: 2px; }
'''
css = style_path.read_text(encoding='utf-8')
if '.btn-copy-release {' not in css:
    style_path.write_text(css + styles, encoding='utf-8')

assert (ROOT / 'public/js/release-copy.js').exists()
assert 'release-copy.js?v=3.51' in html.read_text(encoding='utf-8')
assert 'versionCode 51' in (ROOT / 'android/app/build.gradle').read_text(encoding='utf-8')
assert 'MARKETING_VERSION = 3.51;' in (ROOT / 'ios/App/App.xcodeproj/project.pbxproj').read_text(encoding='utf-8')
assert '3.51.0' in (ROOT / 'package-lock.json').read_text(encoding='utf-8')
assert 'ios-v3.51' in (ROOT / 'backend-worker/src/worker.mjs').read_text(encoding='utf-8')
print('3.51 sources and all eight copy-link buttons ready for validation')
