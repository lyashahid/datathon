"""Public, bounded operational acquisition. Never modifies the planning baseline."""
import argparse
import datetime as dt
import hashlib
import json
import re
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / 'data/public/archive/operations'
OUT = ROOT / 'data/public/operations'
TRANSFORM = 'operations-public-2'
SPECS = [
    dict(id='mms-cap-feed', file='mms-feed.xml', url='https://cap.meteorology.gov.mv/rss/alerts/', title='MMS public CAP alert RSS', publisher='Maldives Meteorological Service', coverage='Publisher warning polygons across Maldives; last 20 feed records, not exhaustive historical archive', referencePeriod='Dated warning validity intervals', units='Warnings and CAP longitude/latitude polygons', licenseStatus='Feed copyright explicitly public domain'),
    dict(id='maavehi-road-map', file='maavehi-roads.json', url='https://api.maavehi.gov.mv/api/v1/roadMaps', title='Maavehi public road works map', publisher='Malé City Council', coverage='Published municipal map records; an empty result does not establish roads are clear', referencePeriod='Retrieval snapshot', units='Public map records', licenseStatus='Public council endpoint; explicit reuse licence not stated'),
    dict(id='rtl-bus-service-check', file='rtl-bus.json', url='https://bo.rtl.mv:4455/maldives/api/booking/v2/bus/routedetails', title='RTL public bus service evidence check', publisher='RTL / MTCC', coverage='Returned Greater Malé and atoll route/stop departure snapshot; complete calendars not verified', referencePeriod='Retrieval snapshot', units='Published route, stop and departure records', licenseStatus='Public operator endpoint; explicit reuse licence not stated'),
    dict(id='rtl-vessel-service-check', file='rtl-vessels.json', url='https://bo.rtl.mv:4455/maldives/api/booking/v1/vessel/routedetails', title='RTL public ferry service evidence check', publisher='RTL / MTCC', coverage='Returned vessel route catalogue; paired arrival times not verified', referencePeriod='Retrieval snapshot', units='Published route and terminal departure records', licenseStatus='Public operator endpoint; explicit reuse licence not stated'),
    dict(id='rtl-terminal-catalog', file='rtl-terminals.json', url='https://bo.rtl.mv:4455/maldives/api/booking/v1/ferries/backofficeinfo', title='RTL public ferry terminal catalogue', publisher='RTL / MTCC', coverage='Atoll-prefixed terminal label positions; not national journey coverage', referencePeriod='Retrieval snapshot', units='Terminal longitude/latitude', licenseStatus='Public operator endpoint; explicit reuse licence not stated'),
    dict(id='eox-wmts-catalog', file='eox-wmts.xml', url='https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml', title='EOX annual Sentinel-2 mosaic catalogue', publisher='EOX IT Services GmbH / Copernicus', coverage='Global viewing mosaics including Maldives; context imagery, not measured built-up change', referencePeriod='Annual mosaics 2020 and 2025', units='RGB visualization; nominal 10 m input resolution', licenseStatus='EOX map layers 2018–2025: CC BY-NC-SA 4.0, noncommercial use with attribution; https://cloudless.eox.at/pricing'),
]

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temporary.replace(path)

def iso(value):
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            return None
        return parsed.isoformat()
    except ValueError:
        return None

def fetch_one(spec, previous):
    path = ARCHIVE / spec['file']
    attempt = now()
    try:
        request = urllib.request.Request(spec['url'], headers={'User-Agent': 'MobilitySandboxMV/1 public-source-research', 'Accept': 'application/xml,application/json,text/html;q=0.8'})
        with urllib.request.urlopen(request, timeout=25) as response:
            body = response.read(5_000_001)
            if len(body) > 5_000_000 or not body:
                raise ValueError('Empty or oversized public response')
        if spec['file'].endswith('.xml'):
            xml = ET.fromstring(body)
            if spec['file'].startswith('cap-'):
                parse_cap(body, spec['url'])
            elif spec['id'] == 'mms-cap-feed' and (xml.tag != 'rss' or xml.find('channel') is None):
                raise ValueError('CAP feed schema changed')
        elif spec['file'].endswith('.json'):
            payload = json.loads(body)
            if spec['id'] == 'maavehi-road-map' and (not isinstance(payload, dict) or payload.get('success') is not True or not isinstance(payload.get('data'), list)):
                raise ValueError('Council road-map schema changed')
            if spec['id'] == 'rtl-bus-service-check' and (not isinstance(payload, dict) or not isinstance(payload.get('routeResponse'), list) or not isinstance(payload.get('atollRouteResponse'), list)):
                raise ValueError('RTL bus schema changed')
            if spec['id'] == 'rtl-vessel-service-check' and not isinstance(payload, list):
                raise ValueError('RTL vessel schema changed')
            if spec['id'] == 'rtl-terminal-catalog' and (not isinstance(payload, dict) or not isinstance(payload.get('ferryStops'), list)):
                raise ValueError('RTL terminal schema changed')
        temporary = path.with_suffix(path.suffix + '.tmp')
        temporary.write_bytes(body)
        temporary.replace(path)
        return {**spec, 'retrievedAt': attempt, 'checksum': hashlib.sha256(body).hexdigest(), 'status': 'downloaded', 'transformationVersion': TRANSFORM, 'gapReasons': []}
    except Exception as error:
        if path.exists() and previous:
            return {**previous, 'status': 'cached', 'gapReasons': ['Refresh failed; retaining the last validated source: ' + str(error)], 'lastAttemptedAt': attempt}
        return {**spec, 'retrievedAt': None, 'checksum': None, 'status': 'unavailable', 'transformationVersion': TRANSFORM, 'gapReasons': [str(error)], 'lastAttemptedAt': attempt}

def cap_links(xml):
    root = ET.fromstring(xml)
    links = []
    for item in root.findall('./channel/item'):
        link = item.findtext('link', '')
        if re.fullmatch(r'https://cap\.meteorology\.gov\.mv/rss/alerts/\d+', link):
            links.append(link)
    return list(dict.fromkeys(links))[:20]

def parse_cap(xml, source_url):
    root = ET.fromstring(xml)
    ns = '{urn:oasis:names:tc:emergency:cap:1.2}'
    if root.tag != ns + 'alert':
        raise ValueError('Expected CAP 1.2 alert')
    text = lambda element, name: (element.findtext(ns + name) or '').strip()
    identifier = text(root, 'identifier')
    sent = iso(text(root, 'sent'))
    message = text(root, 'msgType')
    if not identifier or sent is None or message not in ['Alert', 'Update', 'Cancel']:
        raise ValueError('Invalid CAP identity, issue time or message type')
    infos = root.findall(ns + 'info')
    info = next((i for i in infos if text(i, 'language').lower().startswith('en')), infos[0] if infos else None)
    references = [part.split(',')[1] for part in text(root, 'references').split() if len(part.split(',')) == 3]
    if info is None:
        if message != 'Cancel':
            raise ValueError('CAP alert has no information block')
        info = ET.Element(ns + 'info')
    rings, areas = [], []
    for area in info.findall(ns + 'area'):
        areas.append(text(area, 'areaDesc'))
        for polygon in area.findall(ns + 'polygon'):
            ring = []
            for pair in (polygon.text or '').split():
                lat, lon = map(float, pair.split(','))
                if not -90 <= lat <= 90 or not -180 <= lon <= 180:
                    raise ValueError('CAP coordinate outside world bounds')
                ring.append([lon, lat])
            if len(ring) >= 3:
                if ring[0] != ring[-1]:
                    ring.append(ring[0])
                rings.append(ring)
    geometry = {'type': 'MultiPolygon', 'coordinates': [[ring] for ring in rings]} if len(rings) > 1 else {'type': 'Polygon', 'coordinates': rings} if rings else None
    return dict(id=identifier, sourceId='mms-cap-feed', sourceUrl=source_url, sentAt=sent, messageType=message, references=references, status=text(root, 'status'), scope=text(root, 'scope'), headline=text(info, 'headline') or text(info, 'event') or message, description=text(info, 'description'), instruction=text(info, 'instruction'), severity=text(info, 'severity'), urgency=text(info, 'urgency'), certainty=text(info, 'certainty'), event=text(info, 'event'), areaLabel='; '.join(filter(None, areas)), validFrom=iso(text(info, 'onset') or text(info, 'effective')), validUntil=iso(text(info, 'expires')), geometry=geometry, evidenceStatus='publisher-issued', provenance='observed', routingEffect='advisory-only', qualification='Publisher weather advisory. Exposure does not establish road flooding, ferry cancellation or a routing closure. Historical alerts remain available for dated replay.')

def normalize(value):
    value = unicodedata.normalize('NFKD', str(value)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', value)

def national_readiness():
    """Keep official locality keys; match only unique names to OSM label points."""
    import openpyxl
    source_id = 'mbs-island-projections'
    census = {}
    for row in openpyxl.load_workbook(ROOT / 'data/raw/census2022-population.xlsx', data_only=True).active.values:
        if isinstance(row[0], str) and isinstance(row[1], str) and isinstance(row[2], (int, float)):
            census[(normalize(row[0]), normalize(row[1]))] = row[2]
    records = []
    for row in openpyxl.load_workbook(ROOT / 'data/raw/island-projections2022-2030.xlsx', data_only=True)['Resident Population'].values:
        if isinstance(row[0], str) and isinstance(row[1], str) and len(row) > 26 and isinstance(row[14], (int, float)):
            atoll, name = row[0].strip(), row[1].strip()
            if len(atoll) > 4:
                continue
            records.append(dict(id='mbs:' + normalize(atoll) + ':' + normalize(name), name=name, atoll=atoll, coordinates=None, census2022Population=census.get((normalize(atoll), normalize(name))), population2026=row[14], population2030=row[26], sourceIds=[source_id, 'mbs-census2022-population'], accessReadiness='population-only', routingAvailable=False, qualification='Official administrative-island totals. 2026/2030 are projections; no national transit routing, neighborhood demand, or validated access score.'))
    baseline = json.loads((ROOT / 'data/public/planning-baseline.json').read_text(encoding='utf-8'))
    for island in baseline['islands']:
        if island['id'] == 'hulhule':
            continue
        bounds = island['bounds']
        records.append(dict(id=island['id'], name=island['name'], atoll='Greater Malé', coordinates=[(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2], census2022Population=island.get('census2022Population'), population2026=island.get('population2026'), population2030=island.get('population2030'), sourceIds=island['sourceIds'], accessReadiness='flagship', routingAvailable=True, qualification='Flagship study coverage; service calendars and facility hours remain partial. Map point is an island label, not a population centroid.'))
    try:
        import osmium
        points = {}
        class Places(osmium.SimpleHandler):
            def node(self, node):
                if node.tags.get('place') not in ['island', 'village', 'town', 'city'] or not node.location.valid():
                    return
                for key in ['name:en', 'name']:
                    name = normalize(node.tags.get(key, ''))
                    if name:
                        points.setdefault(name, set()).add((node.location.lon, node.location.lat))
        Places().apply_file(str(ROOT / 'data/raw/maldives-latest.osm.pbf'))
        # Repeated source localities are never resolved by guessing their atoll.
        names = {}
        for record in records:
            names[normalize(record['name'])] = names.get(normalize(record['name']), 0) + 1
        for record in records:
            name = normalize(record['name'])
            matches = points.get(name, set())
            if record['coordinates'] is None and len(matches) == 1 and names[name] == 1:
                record['coordinates'] = list(next(iter(matches)))
                record['sourceIds'].append('osm-geofabrik')
                record['qualification'] += ' Unique-name OSM settlement/island label match; approximate display point, not a surveyed administrative boundary.'
    except ImportError:
        pass
    terminal_path = ARCHIVE / 'rtl-terminals.json'
    if terminal_path.exists():
        terminals = json.loads(terminal_path.read_text(encoding='utf-8')).get('ferryStops', [])
        by_key = {}
        for terminal in terminals:
            parts = str(terminal.get('name', '')).split('.', 1)
            if len(parts) != 2:
                continue
            try:
                lat, lon = float(terminal['latitude']), float(terminal['longitude'])
                if not -2 <= lat <= 8 or not 72 <= lon <= 75:
                    continue
                by_key.setdefault((normalize(parts[0]), normalize(parts[1])), set()).add((lon, lat))
            except (KeyError, ValueError, TypeError):
                continue
        for record in records:
            matches = by_key.get((normalize(record['atoll']), normalize(record['name'])), set())
            if record['coordinates'] is None and len(matches) == 1:
                record['coordinates'] = list(next(iter(matches)))
                record['sourceIds'].append('rtl-terminal-catalog')
                record['qualification'] += ' Display point is the official RTL terminal matched by atoll and island name, not an island boundary or population centroid.'
    return records, [s for s in baseline['sources'] if s['id'] in ['mbs-island-projections', 'mbs-census2022-population', 'mbs-census2022-male-table', 'osm-geofabrik']]

def prepare(registry):
    alerts, gaps, sources = [], [], list(registry.values())
    feed = ARCHIVE / 'mms-feed.xml'
    if feed.exists():
        for url in cap_links(feed.read_bytes()):
            path = ARCHIVE / ('cap-' + url.rsplit('/', 1)[-1] + '.xml')
            if not path.exists():
                gaps.append('CAP detail unavailable: ' + url)
                continue
            try:
                alerts.append(parse_cap(path.read_bytes(), url))
            except Exception as error:
                gaps.append('CAP record rejected: ' + url + ': ' + str(error))
    events = []
    road_path = ARCHIVE / 'maavehi-roads.json'
    if road_path.exists():
        payload = json.loads(road_path.read_text(encoding='utf-8'))
        rows = payload.get('data')
        if not isinstance(rows, list):
            raise ValueError('Maavehi schema changed: expected data array')
        if not rows:
            for source in sources:
                if source['id'] == 'maavehi-road-map' and source['status'] != 'cached':
                    source['status'] = 'empty'
            gaps.append('Maavehi returned no published map records at retrieval. Coverage is unresolved; this does not establish roads are open or unobstructed.')
        for index, row in enumerate(rows):
            # Source point formats are not authoritative blocked-segment geometries.
            events.append(dict(id='maavehi:' + str(row.get('id', index)), sourceId='maavehi-road-map', sourceUrl='https://maavehi.gov.mv/city-map', title=str(row.get('title') or row.get('name') or 'Council map record'), description=str(row.get('description') or ''), validFrom=iso(row.get('startDate')), validUntil=iso(row.get('endDate')), geometry=None, locationLabel=str(row.get('location') or ''), mode='road', evidenceStatus='candidate', provenance='observed', routingEffect='candidate-only', qualification='Council map record requires manual road-segment, date and direction matching. A point does not establish a blocked street.'))
    national, baseline_sources = national_readiness()
    for source in baseline_sources:
        sources.append(dict(id=source['id'], title=source['title'], publisher='OpenStreetMap contributors / Geofabrik' if source['id'] == 'osm-geofabrik' else 'Maldives Bureau of Statistics', url=source['url'], retrievedAt=source.get('fetchedAt'), checksum=source.get('sha256'), status='downloaded', coverage='Official national island indicators' if source['id'].startswith('mbs') else 'Maldives label points', referencePeriod=str(source.get('referencePeriod', source.get('referenceYear'))), units='People' if source['id'].startswith('mbs') else 'Longitude/latitude', licenseStatus=source.get('license', 'See publisher'), transformationVersion=TRANSFORM, gapReasons=[]))
    gaps += ['Weather alert polygons are advisory exposure areas; no observed road speed, flooding, ferry cancellation or demand inference.', 'No public historical road-speed training dataset verified. Congestion controls must be labeled scenario stress tests.', 'Outer-island map is population/evidence readiness only. Unmatched locations remain unplotted; no nationwide routing is fabricated.', 'Satellite imagery is display/context evidence. No unverified building-growth, congestion or obstruction measurements are generated.']
    service = [dict(id='rtl-bus-calendar', mode='bus', name='Greater Malé recurring bus calendars', sourceUrl=SPECS[2]['url'], status='partial', missingInputs=['Complete dated daily trip calendars', 'Friday/holiday exceptions', 'Published paired stop arrivals'], qualification='Fresh route-detail response is a remaining-departure snapshot. No recurring calendar or historical speed series was inferred from it.'), dict(id='vilimale-crossing', mode='ferry', name='Malé–Vilimalé ferry runtime', sourceUrl='https://mtcc.mv/wp-content/uploads/2025/12/Vili-male-Ferry-Schedule-2026-V1.pdf', status='unavailable', missingInputs=['Verified arrival or crossing duration', 'Dated cancellation/holiday exceptions', 'Verified suitable care destination on Vilimalé'], qualification='Official frequency calendar cached. Opposite-direction departure columns are not arrivals. Planner may explicitly supply a crossing-time assumption without turning it into observed baseline evidence.')]
    bundle = dict(schemaVersion=1, version='', generatedAt=now(), status='partial', stale=any(s['status'] == 'cached' for s in sources), sources=sources, weatherAlerts=alerts, roadEvents=events, noticeCandidates=[], nationalReadiness=national, serviceEvidence=service, gaps=gaps, profile='public-only', ai=dict(enabled=False, available=False, method='rules', reason='Deterministic extraction is available without a key; optional server-side AI requires explicit configuration.'))
    calendar_path = ROOT / 'data/public/policy-evidence/service-calendars.json'
    if calendar_path.exists():
        calendar_bundle = json.loads(calendar_path.read_text(encoding='utf-8'))
        calendar = next((c for c in calendar_bundle.get('calendars', []) if c['route'] == 'vilimale'), None)
        vessel_path = ARCHIVE / 'rtl-vessels.json'
        routes = json.loads(vessel_path.read_text(encoding='utf-8')) if vessel_path.exists() else []
        route = next((r for r in routes if r.get('code') == '119'), None)
        if calendar and route and len(route.get('stopList', [])) == 2:
            terminals = [dict(id='rtl:' + str(t['code']), name=t['name'], coordinates=[float(t['longitude']), float(t['latitude'])], islandId='male' if str(t['code']) == '101' else 'vilimale') for t in route['stopList']]
            bundle['ferryEvidence'] = dict(calendar=calendar, terminals=terminals, sourceUrl=service[1]['sourceUrl'], fareMvr=route.get('fare'))
            for source in calendar_bundle.get('sources', []):
                if source['id'] == calendar['sourceId']:
                    sources.append({**{key:source[key] for key in ['id', 'title', 'url', 'publisher', 'referencePeriod', 'retrievedAt', 'checksum', 'coverage', 'units', 'licenseStatus', 'transformationVersion']}, 'status': 'downloaded', 'gapReasons': []})
    eo_path = ARCHIVE / 'eox-wmts.xml'
    if eo_path.exists():
        tree = ET.fromstring(eo_path.read_bytes())
        ns = {'w':'http://www.opengis.net/wmts/1.0', 'o':'http://www.opengis.net/ows/1.1'}
        available = {layer.findtext('o:Identifier', namespaces=ns):layer for layer in tree.findall('.//w:Layer', ns)}
        mosaics = []
        for year in [2020, 2025]:
            layer_id = 's2cloudless-' + str(year) + '_3857'
            layer = available.get(layer_id)
            if layer is None:
                continue
            template = next((resource.get('template') for resource in layer.findall('w:ResourceURL', ns) if resource.get('format') == 'image/jpeg'), None)
            if template:
                template = template.replace('http://tiles.maps.eox.at/', 'https://tiles.maps.eox.at/').replace('{TileMatrixSet}', 'g').replace('{TileMatrix}', '{z}').replace('{TileRow}', '{y}').replace('{TileCol}', '{x}')
                mosaics.append(dict(id=layer_id, year=year, tileUrl=template, tileSize=256, maxZoom=14, sourceId='eox-wmts-catalog', attribution='EOxCloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ' + str(year) + ') · CC BY-NC-SA 4.0', licenseUrl='https://creativecommons.org/licenses/by-nc-sa/4.0/'))
        bundle['earthObservation'] = dict(mosaics=mosaics, interpretation='visual-context-only', qualification='Annual color-corrected cloud-free viewing mosaics; a mosaic year is not a single acquisition date. Compare visible land context manually; no building growth, street obstruction, flood extent, or congestion is measured. Satellite tiles require an online provider connection; planning data remain cached.')
    digest = hashlib.sha256(json.dumps({k:v for k,v in bundle.items() if k not in ['version', 'generatedAt']}, sort_keys=True).encode()).hexdigest()[:12]
    bundle['version'] = 'operations-' + TRANSFORM + '-' + digest
    validate(bundle)
    atomic_json(OUT / 'bundle.json', bundle)
    atomic_json(OUT / 'source-manifest.json', {'schemaVersion': 1, 'version': bundle['version'], 'generatedAt': bundle['generatedAt'], 'sources': sources})
    print(json.dumps({'version': bundle['version'], 'weatherAlerts': len(alerts), 'roadEvents': len(events), 'nationalRows': len(national), 'nationalMapPoints': sum(r['coordinates'] is not None for r in national), 'stale': bundle['stale']}))

def validate(bundle):
    assert bundle['schemaVersion'] == 1 and bundle['profile'] == 'public-only'
    assert len({s['id'] for s in bundle['sources']}) == len(bundle['sources'])
    for alert in bundle['weatherAlerts']:
        assert iso(alert['sentAt']) and alert['routingEffect'] == 'advisory-only'
        if alert['validFrom'] and alert['validUntil']:
            assert dt.datetime.fromisoformat(alert['validUntil']) > dt.datetime.fromisoformat(alert['validFrom'])
    for record in bundle['nationalReadiness']:
        assert record['population2026'] is None or record['population2026'] >= 0
        assert record['population2030'] is None or record['population2030'] >= 0
        assert record['accessReadiness'] == 'flagship' or not record['routingAvailable']

def run():
    command = argparse.ArgumentParser()
    command.add_argument('command', choices=['all', 'fetch', 'prepare', 'validate'], default='all', nargs='?')
    options = command.parse_args()
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    manifest_path = ARCHIVE / 'fetch-registry.json'
    registry = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
    if options.command in ['all', 'fetch']:
        for spec in SPECS:
            registry[spec['id']] = fetch_one(spec, registry.get(spec['id']))
        feed = ARCHIVE / 'mms-feed.xml'
        if feed.exists():
            for url in cap_links(feed.read_bytes()):
                spec = dict(id='mms-cap-' + url.rsplit('/', 1)[-1], file='cap-' + url.rsplit('/', 1)[-1] + '.xml', url=url, title='MMS CAP warning record', publisher='Maldives Meteorological Service', coverage='Publisher warning polygon', referencePeriod='CAP validity interval', units='CAP message', licenseStatus='Public domain per MMS alert RSS')
                registry[spec['id']] = fetch_one(spec, registry.get(spec['id']))
        atomic_json(manifest_path, registry)
    if options.command in ['all', 'prepare']:
        prepare(registry)
    if options.command == 'validate':
        validate(json.loads((OUT / 'bundle.json').read_text(encoding='utf-8')))
        print('Validated public operations bundle')

if __name__ == '__main__':
    run()
