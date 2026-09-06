"""Repackage an unsigned native shell with tested web assets, entirely locally.

This is NOT an Xcode/native rebuild. Native executables, frameworks, entitlements
and the Capacitor configuration are copied byte-for-byte. ESign must sign the
result before installation. Refuses signed inputs and existing output files.
"""
import argparse
import hashlib
import json
import plistlib
from pathlib import Path, PurePosixPath
import re
import zipfile


PUBLIC_PREFIX = 'Payload/App.app/public/'
PRODUCTION_EXCLUDES = {
    'standalone.html',
    'media/qa-original.mp4',
    'media/qa-seek.mp4',
}
CAPACITOR_RUNTIME_FILES = {
    'cordova.js',
    'cordova_plugins.js',
    'capacitor.js',
    'capacitor_plugins.js',
}
TEXT_EXTENSIONS = {
    '.html', '.js', '.css', '.json', '.xml', '.plist', '.txt', '.md',
    '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.yml', '.yaml',
}
FORBIDDEN_PATH_RULES = {
    'environment_file': re.compile(r'(^|/)\.env(?:\.|$)', re.I),
    'cookie_export': re.compile(r'(^|/)(?:cookies?\.(?:txt|json)|cookiejar)(?:$|/)', re.I),
    'credential_file': re.compile(r'(^|/)(?:credentials?|client[_-]?secret|service[_-]?account|id_rsa)(?:[./_-]|$)', re.I),
    'private_key_file': re.compile(r'\.(?:pem|p12|pfx|key)$', re.I),
    'database_or_log': re.compile(r'\.(?:db|sqlite|sqlite3|log|sql)$', re.I),
    'source_map': re.compile(r'\.map$', re.I),
}
SECRET_CONTENT_RULES = {
    'private_key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'google_api_key': re.compile(rb'AIza[0-9A-Za-z_-]{30,}'),
    'github_token': re.compile(rb'gh[pousr]_[0-9A-Za-z_]{20,}'),
    'telegram_bot_token': re.compile(rb'\b[0-9]{8,12}:[A-Za-z0-9_-]{30,}\b'),
    'jwt_literal': re.compile(rb'\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b'),
    'assigned_secret': re.compile(
        rb'(?:client[_-]?secret|admin[_-]?(?:key|secret)|api[_-]?secret|password)\s*[:=]\s*["\'][^"\']{6,}["\']',
        re.I,
    ),
    'netscape_cookie_export': re.compile(rb'(?:# Netscape HTTP Cookie File|\.(?:douyin|youtube)\.com\s+TRUE\s+/)', re.I),
    'hardcoded_admin_identity': re.compile(
        rb'(?:(?:configured[_-]?admin[_-]?telegram|admin[_-]?telegram[_-]?id)\s*[:=]\s*["\']\d{9,12}["\']|(?:isAdmin|telegramId)[^\r\n]{0,120}(?:===|==)\s*["\']\d{9,12}["\'])',
        re.I,
    ),
    'embedded_movie_provider': re.compile(rb'(?:phimapi\.com|ophim1\.com|phimimg\.com|api/media/image\?url=)', re.I),
    'raw_media_source': re.compile(rb'link_(?:m3u8|embed)\s*[:=]\s*["\']https?://', re.I),
}
PUBLIC_CLIENT_RULES = {
    'upstream_catalog_contract': re.compile(rb'(?:/v1/api|/danh-sach/phim-moi-cap-nhat)', re.I),
    'raw_media_contract': re.compile(rb'link_(?:m3u8|embed)', re.I),
}


def audit_entries(entries):
    """Return redacted findings; never include a matched credential value."""
    findings = []
    for archive_name, data in entries.items():
        relative = archive_name[len(PUBLIC_PREFIX):] if archive_name.startswith(PUBLIC_PREFIX) else archive_name
        for category, rule in FORBIDDEN_PATH_RULES.items():
            if rule.search(relative):
                findings.append({'entry': archive_name, 'category': category})
        # High-confidence ASCII credential signatures are safe to scan in both
        # text and native/binary entries. This catches secrets outside public/.
        for category, rule in SECRET_CONTENT_RULES.items():
            if rule.search(data):
                findings.append({'entry': archive_name, 'category': category})
    return findings


def audit_public_assets(assets):
    findings = audit_entries(assets)
    for archive_name, data in assets.items():
        for category, rule in PUBLIC_CLIENT_RULES.items():
            if rule.search(data):
                findings.append({'entry': archive_name, 'category': category})
    return findings


def audit_ipa(path):
    """Audit an IPA without extracting it and return a value-redacted report."""
    archive = Path(path).resolve()
    with zipfile.ZipFile(archive) as source:
        names = source.namelist()
        archive_entries = {
            name: source.read(name)
            for name in names
            if not name.endswith('/')
        }
        public_assets = {name: data for name, data in archive_entries.items() if name.startswith(PUBLIC_PREFIX)}
        findings = audit_entries(archive_entries)
        for archive_name, data in public_assets.items():
            for category, rule in PUBLIC_CLIENT_RULES.items():
                if rule.search(data):
                    findings.append({'entry': archive_name, 'category': category})
        for name in names:
            normalized = PurePosixPath(name)
            if normalized.is_absolute() or '..' in normalized.parts:
                findings.append({'entry': name, 'category': 'unsafe_archive_path'})
        if len(names) != len(set(names)):
            findings.append({'entry': '<archive>', 'category': 'duplicate_entries'})
        corrupt = source.testzip()
        if corrupt:
            findings.append({'entry': corrupt, 'category': 'crc_failure'})
    return {
        'archive': str(archive),
        'bytes': archive.stat().st_size,
        'entries': len(names),
        'public_assets': len(public_assets),
        'findings': findings,
        'passed': not findings,
    }


def package(base, web, output, version, build, display_name=None):
    base, web, output = Path(base).resolve(), Path(web).resolve(), Path(output).resolve()
    if output.exists() or output == base:
        raise ValueError('Refusing to overwrite an existing package')
    prefix = PUBLIC_PREFIX
    info_name = 'Payload/App.app/Info.plist'
    allowed = {'.html', '.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.mp4', '.woff', '.woff2', '.ttf', '.txt'}
    assets = {}
    excluded = []
    for path in web.rglob('*'):
        if not path.is_file():
            continue
        if path.is_symlink() or not path.resolve().is_relative_to(web):
            raise ValueError('Web asset escapes bundle root')
        relative = path.relative_to(web).as_posix()
        if relative in PRODUCTION_EXCLUDES:
            excluded.append(relative)
            continue
        if path.suffix.lower() not in allowed or any(p.startswith('.') for p in path.relative_to(web).parts):
            raise ValueError(f'Unexpected asset: {relative}')
        assets[prefix + relative] = path.read_bytes()
    findings = audit_public_assets(assets)
    if findings:
        summary = ', '.join(f"{item['entry']} ({item['category']})" for item in findings)
        raise ValueError(f'Refusing secret-like content in public bundle: {summary}')
    if prefix+'index.html' not in assets:
        raise ValueError('Missing web entry point')
    if f"return '{version}'".encode() not in assets.get(prefix+'js/api.js', b''):
        raise ValueError('Web version does not match package version')
    partial = output.with_suffix('.ipa.partial')
    if partial.exists():
        raise ValueError('Partial output already exists; inspect it first')
    output.parent.mkdir(parents=True, exist_ok=True)
    native_hashes = {}
    with zipfile.ZipFile(base) as src:
        names = src.namelist()
        if len(names) != len(set(names)) or src.testzip():
            raise ValueError('Invalid source archive')
        if any('_CodeSignature' in name or name.endswith('embedded.mobileprovision') for name in names):
            raise ValueError('Only an unsigned shell is accepted')
        # Capacitor/Xcode may generate runtime shims after the reviewed web
        # directory is prepared. Preserve only these exact, known filenames so
        # a locally repackaged IPA has the same file set sealed into the native
        # integrity manifest.
        for relative in CAPACITOR_RUNTIME_FILES:
            archive_name = prefix + relative
            if archive_name in names:
                assets[archive_name] = src.read(archive_name)
        runtime_findings = audit_public_assets(assets)
        if runtime_findings:
            summary = ', '.join(f"{item['entry']} ({item['category']})" for item in runtime_findings)
            raise ValueError(f'Refusing secret-like content in packaged web runtime: {summary}')
        native_entries = {
            name: src.read(name)
            for name in names
            if not name.startswith(prefix) and not name.endswith('/')
        }
        native_findings = audit_entries(native_entries)
        if native_findings:
            summary = ', '.join(f"{item['entry']} ({item['category']})" for item in native_findings)
            raise ValueError(f'Refusing secret-like content in native shell: {summary}')
        info = plistlib.loads(src.read(info_name))
        if info.get('CFBundleIdentifier') != 'com.phim4k.cinema':
            raise ValueError('Wrong application shell')
        info['CFBundleShortVersionString'], info['CFBundleVersion'] = version, str(build)
        if display_name:
            info['CFBundleDisplayName'] = str(display_name)[:32]
            info['CFBundleName'] = str(display_name)[:32]
        native_executable = 'Payload/App.app/' + info['CFBundleExecutable']
        if native_executable not in names:
            raise ValueError('Native executable missing')
        with zipfile.ZipFile(partial, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as dst:
            for entry in src.infolist():
                if PurePosixPath(entry.filename).is_absolute() or '..' in PurePosixPath(entry.filename).parts:
                    raise ValueError('Unsafe source entry')
                if entry.filename.startswith(prefix):
                    continue
                data = src.read(entry.filename)
                if entry.filename == info_name:
                    data = plistlib.dumps(info, fmt=plistlib.FMT_BINARY)
                else:
                    native_hashes[entry.filename] = hashlib.sha256(data).hexdigest()
                # Preserve executable permissions and other original ZIP metadata.
                dst.writestr(entry, data)
            for name, data in assets.items():
                dst.writestr(name, data)
    with zipfile.ZipFile(partial) as check:
        if check.testzip():
            raise ValueError('Output CRC validation failed')
        for name, digest in native_hashes.items():
            if hashlib.sha256(check.read(name)).hexdigest() != digest:
                raise ValueError(f'Native shell changed: {name}')
        for name, data in assets.items():
            if check.read(name) != data:
                raise ValueError(f'Web asset mismatch: {name}')
        verified = plistlib.loads(check.read(info_name))
        if verified['CFBundleVersion'] != str(build) or verified['CFBundleShortVersionString'] != version:
            raise ValueError('Metadata mismatch')
        output_entries = {
            name: check.read(name)
            for name in check.namelist()
            if not name.endswith('/')
        }
        output_findings = audit_entries(output_entries)
        if output_findings:
            summary = ', '.join(f"{item['entry']} ({item['category']})" for item in output_findings)
            raise ValueError(f'Packaged archive failed security audit: {summary}')
    partial.rename(output)
    return dict(output=str(output), version=version, build=str(build),
                bytes=output.stat().st_size, sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                web_assets_verified=len(assets), native_entries_unchanged=len(native_hashes),
                display_name=info.get('CFBundleDisplayName', info.get('CFBundleName', '')),
                native_recompiled=False, signature='unsigned; requires ESign',
                production_assets_excluded=sorted(excluded), security_audit='passed',
                base_sha256=hashlib.sha256(base.read_bytes()).hexdigest())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit-only', metavar='IPA')
    parser.add_argument('--base')
    parser.add_argument('--web')
    parser.add_argument('--output')
    parser.add_argument('--version')
    parser.add_argument('--build', type=int)
    parser.add_argument('--display-name')
    args = parser.parse_args()
    if args.audit_only:
        print(json.dumps(audit_ipa(args.audit_only), indent=2))
    else:
        missing = [name for name in ('base', 'web', 'output', 'version', 'build') if getattr(args, name) is None]
        if missing:
            parser.error('missing required package arguments: ' + ', '.join('--' + name for name in missing))
        print(json.dumps(package(args.base, args.web, args.output, args.version, args.build, args.display_name), indent=2))
