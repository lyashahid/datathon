import importlib.util
import unittest
import tempfile
import io
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('operations_data', Path(__file__).with_name('operations-data.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

CAP = '''<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>example</identifier><sender>mms</sender><sent>2026-10-11T02:00:00+05:00</sent><status>Actual</status><msgType>{message}</msgType><scope>Public</scope>{reference}{info}</alert>'''
INFO = '''<info><language>en</language><event>Rain</event><onset>2026-10-11T02:30:00+05:00</onset><expires>2026-10-11T08:30:00+05:00</expires><area><areaDesc>Malé</areaDesc><polygon>4.1,73.4 4.1,73.5 4.2,73.5 4.1,73.4</polygon></area></info>'''

class CapParsing(unittest.TestCase):
    def test_polygon_reverses_cap_lat_lon(self):
        result = module.parse_cap(CAP.format(message='Alert', reference='', info=INFO), 'https://cap.meteorology.gov.mv/rss/alerts/1')
        self.assertEqual(result['geometry']['coordinates'][0][0], [73.4, 4.1])
        self.assertEqual(result['routingEffect'], 'advisory-only')

    def test_cancel_without_info_and_update_references(self):
        reference = '<references>mms,previous-id,2026-10-11T01:00:00+05:00</references>'
        result = module.parse_cap(CAP.format(message='Cancel', reference=reference, info=''), 'https://cap.meteorology.gov.mv/rss/alerts/2')
        self.assertEqual(result['references'], ['previous-id'])
        self.assertIsNone(result['validUntil'])

    def test_feed_detail_host_allowlist_and_empty_feed(self):
        self.assertEqual(module.cap_links('<rss><channel /></rss>'), [])
        xml = '<rss><channel><item><link>https://localhost/private</link></item><item><link>https://cap.meteorology.gov.mv/rss/alerts/42</link></item></channel></rss>'
        self.assertEqual(module.cap_links(xml), ['https://cap.meteorology.gov.mv/rss/alerts/42'])

    def test_failed_refresh_preserves_last_validated_raw_and_metadata(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'ARCHIVE', Path(directory)):
            previous = dict(id='source', retrievedAt='2026-10-10T01:00:00Z', checksum='a' * 64, status='downloaded')
            original = b'<rss><channel /></rss>'
            Path(directory, 'cached.xml').write_bytes(original)
            with patch.object(module.urllib.request, 'urlopen', side_effect=OSError('offline')):
                result = module.fetch_one(dict(id='source', file='cached.xml', url='https://example.org/public'), previous)
            self.assertEqual(result['status'], 'cached')
            self.assertEqual(result['retrievedAt'], previous['retrievedAt'])
            self.assertEqual(Path(directory, 'cached.xml').read_bytes(), original)
            self.assertIn('retaining the last validated source', result['gapReasons'][0])

    def test_missing_source_on_failed_fetch_remains_unavailable(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'ARCHIVE', Path(directory)):
            with patch.object(module.urllib.request, 'urlopen', side_effect=OSError('offline')):
                result = module.fetch_one(dict(id='source', file='absent.xml', url='https://example.org/public'), None)
            self.assertEqual(result['status'], 'unavailable')
            self.assertIsNone(result['checksum'])
            self.assertFalse(Path(directory, 'absent.xml').exists())

    def test_semantically_invalid_cap_replacement_is_not_written(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'ARCHIVE', Path(directory)):
            original = CAP.format(message='Alert', reference='', info=INFO).encode()
            Path(directory, 'cap-1.xml').write_bytes(original)
            previous = dict(id='mms-cap-1', retrievedAt='2026-10-10T01:00:00Z', checksum='a' * 64, status='downloaded')
            bad = CAP.format(message='InvalidMessage', reference='', info=INFO).encode()
            with patch.object(module.urllib.request, 'urlopen', return_value=io.BytesIO(bad)):
                result = module.fetch_one(dict(id='mms-cap-1', file='cap-1.xml', url='https://cap.meteorology.gov.mv/rss/alerts/1'), previous)
            self.assertEqual(result['status'], 'cached')
            self.assertEqual(Path(directory, 'cap-1.xml').read_bytes(), original)

if __name__ == '__main__':
    unittest.main()
