import importlib.util
import plistlib
import tempfile
import unittest
import zipfile
from pathlib import Path

spec=importlib.util.spec_from_file_location('packager',Path(__file__).resolve().parents[1]/'scripts/package_ios_web_update.py')
packager=importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PackageTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.web=self.root/'web'
        (self.web/'js').mkdir(parents=True)
        (self.web/'index.html').write_text('<html>Test fixture</html>')
        (self.web/'js/api.js').write_text("function version(){return '3.4.18';}")
        self.base=self.root/'base.ipa'
        with zipfile.ZipFile(self.base,'w') as z:
            z.writestr('Payload/App.app/Info.plist',plistlib.dumps(dict(CFBundleIdentifier='com.phim4k.cinema',CFBundleExecutable='App')))
            info=zipfile.ZipInfo('Payload/App.app/App')
            info.external_attr=0o100755<<16
            z.writestr(info,b'Native fixture, not an installable app')
            z.writestr('Payload/App.app/public/index.html','Old fixture')
            z.writestr('Payload/App.app/public/cordova.js','Capacitor-generated runtime fixture')
            z.writestr('Payload/App.app/capacitor.config.json','{"fixture":true}')
        self.output=self.root/'new.ipa'

    def run_package(self):
        return packager.package(self.base,self.web,self.output,'3.4.18',18,'Phim4K 3.4.18')

    def test_preserves_native_bytes_and_permissions_updates_web_and_version(self):
        report=self.run_package()
        self.assertFalse(report['native_recompiled'])
        with zipfile.ZipFile(self.output) as z, zipfile.ZipFile(self.base) as original:
            self.assertEqual(z.read('Payload/App.app/App'),original.read('Payload/App.app/App'))
            self.assertEqual(z.getinfo('Payload/App.app/App').external_attr,original.getinfo('Payload/App.app/App').external_attr)
            self.assertEqual(plistlib.loads(z.read('Payload/App.app/Info.plist'))['CFBundleVersion'],'18')
            self.assertEqual(plistlib.loads(z.read('Payload/App.app/Info.plist'))['CFBundleDisplayName'],'Phim4K 3.4.18')
            self.assertEqual(z.read('Payload/App.app/public/index.html'),(self.web/'index.html').read_bytes())
            self.assertEqual(z.read('Payload/App.app/public/cordova.js'),b'Capacitor-generated runtime fixture')
            self.assertIsNone(z.testzip())

    def test_refuses_existing_output(self):
        self.output.write_bytes(b'keep')
        with self.assertRaises(ValueError): self.run_package()
        self.assertEqual(self.output.read_bytes(),b'keep')

    def test_refuses_signed_shell(self):
        with zipfile.ZipFile(self.base,'a') as z: z.writestr('Payload/App.app/_CodeSignature/CodeResources','signature fixture')
        with self.assertRaises(ValueError): self.run_package()

    def test_refuses_version_mismatch(self):
        (self.web/'js/api.js').write_text("return '3.4.17';")
        with self.assertRaises(ValueError): self.run_package()

    def test_excludes_qa_media_from_production_ipa(self):
        media=self.web/'media'
        media.mkdir()
        (media/'qa-original.mp4').write_bytes(b'qa fixture')
        (media/'qa-seek.mp4').write_bytes(b'qa fixture')
        report=self.run_package()
        self.assertEqual(report['production_assets_excluded'],['media/qa-original.mp4','media/qa-seek.mp4'])
        with zipfile.ZipFile(self.output) as z:
            self.assertNotIn('Payload/App.app/public/media/qa-original.mp4',z.namelist())
            self.assertNotIn('Payload/App.app/public/media/qa-seek.mp4',z.namelist())

    def test_refuses_hardcoded_admin_identity(self):
        (self.web/'js/admin.js').write_text("const configuredAdminTelegram = '1234567890';")
        with self.assertRaisesRegex(ValueError,'hardcoded_admin_identity'):
            self.run_package()

    def test_refuses_private_key_material(self):
        (self.web/'js/leak.js').write_text('-----BEGIN PRIVATE KEY-----\\nfixture')
        with self.assertRaisesRegex(ValueError,'private_key'):
            self.run_package()

    def test_refuses_provider_routes_and_raw_media_contracts_in_public_js(self):
        (self.web/'js/provider.js').write_text("const route='/v1/api/catalog'; const field='link_m3u8';")
        with self.assertRaisesRegex(ValueError,'upstream_catalog_contract|raw_media_contract'):
            self.run_package()

    def test_refuses_all_known_provider_hostnames(self):
        (self.web/'js/provider.js').write_text("const origin='https://ophim1.com';")
        with self.assertRaisesRegex(ValueError,'embedded_movie_provider'):
            self.run_package()

    def test_finished_archive_passes_redacted_audit(self):
        self.run_package()
        report=packager.audit_ipa(self.output)
        self.assertTrue(report['passed'])
        self.assertEqual(report['findings'],[])

    def test_refuses_sensitive_native_shell_entry(self):
        with zipfile.ZipFile(self.base,'a') as z:
            z.writestr('Payload/App.app/private-key.pem','-----BEGIN PRIVATE KEY-----\\nfixture')
        with self.assertRaisesRegex(ValueError,'native shell'):
            self.run_package()

    def test_archive_audit_checks_outside_public_directory(self):
        with zipfile.ZipFile(self.base,'a') as z:
            z.writestr('Payload/App.app/.env','ADMIN_SECRET=fixture')
        report=packager.audit_ipa(self.base)
        self.assertFalse(report['passed'])
        self.assertIn('environment_file',{item['category'] for item in report['findings']})


if __name__=='__main__': unittest.main()
