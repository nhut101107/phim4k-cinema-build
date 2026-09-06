"""Read-only IPA inventory. Reports URL origins/paths, never queries or credentials."""
import hashlib
import json
import plistlib
import re
import sys
import zipfile
from urllib.parse import urlsplit


def inspect(path):
    with zipfile.ZipFile(path) as archive:
        info = plistlib.loads(archive.read('Payload/EnsMovie.app/Info.plist'))
        binary = archive.read('Payload/EnsMovie.app/' + info['CFBundleExecutable'])
        urls = set()
        for match in re.finditer(rb'https?://[\x21-\x7e]{3,250}', binary):
            raw = match.group().decode('ascii').split('"')[0].split('<')[0]
            try:
                url = urlsplit(raw)
                if not url.hostname or not re.fullmatch(r'[A-Za-z0-9.-]+', url.hostname):
                    continue
                # Drop user-info, query, fragment and opaque/credential-like path segments.
                parts = url.path.split('/')
                safe = '/'.join('[redacted]' if len(p) > 48 or re.search(r'token|secret|password', p, re.I) else p for p in parts)
                urls.add(url.scheme + '://' + url.hostname + safe)
            except ValueError:
                continue
        routes = set()
        for item in re.findall(rb'[\x20-\x7e]{5,180}', binary):
            s = item.decode('ascii')
            if re.fullmatch(r'/(?:api|v1|v2|v3|phim|danh-sach|the-loai|quoc-gia)/[A-Za-z0-9_/?=&.{}%-]{0,120}', s):
                routes.add(s.split('?')[0])
        domains = sorted(set(m.group().decode('ascii') for m in re.finditer(
            rb'(?<![A-Za-z0-9_-])(?:[a-z0-9-]+\.)+(?:com|net|org|app|live|cc|tv|xyz|io|me|vn)(?![A-Za-z0-9_-])', binary)))
        catalog_literals = sorted(set(s.decode('ascii') for s in re.findall(rb'[\x20-\x7e]{4,160}', binary)
            if re.fullmatch(rb'[A-Za-z0-9_./?=&{}%-]{4,140}', s)
            and (s.startswith(b'/') or s in {b'ophim', b'phimapi', b'nguonphim', b'phimAPI'})
            and not re.search(rb'(?:secret|token|key|password)', s, re.I)))
        return {'file': str(path), 'bundle': info.get('CFBundleIdentifier'),
                'version': info.get('CFBundleShortVersionString'), 'build': info.get('CFBundleVersion'),
                'executable_sha256': hashlib.sha256(binary).hexdigest(),
                'url_paths_without_queries': sorted(urls), 'route_literals': sorted(routes),
                'domain_literals': domains, 'catalog_literals': catalog_literals,
                'private_account_files_read': False, 'credential_values_exported': False}


if __name__ == '__main__':
    print(json.dumps(inspect(sys.argv[1]), ensure_ascii=True, indent=2))
