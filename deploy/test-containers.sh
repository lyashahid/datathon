#!/usr/bin/env bash
# Smoke-test the exact production Compose file on an isolated CI runner.
# Requires the two images to have been built/pulled already. No shared DB is used.
set -euo pipefail
: "${DATATHON_FRONTEND_IMAGE:?Supply the tested frontend image}"
: "${DATATHON_BACKEND_IMAGE:?Supply the tested backend image}"
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d)
project=datathon-container-check
compose=(docker compose --project-name "$project" --project-directory "$work/control" --env-file "$work/control/release.env" -f "$work/control/compose.yaml")
cleanup() {
  "${compose[@]}" down --timeout 15 > /dev/null 2>&1 || true
  # The runner-created folder is fixed for this invocation; no production paths.
  docker run --rm --network none --user 0 --mount "type=bind,src=$work,dst=/check" --entrypoint /bin/chown "$DATATHON_BACKEND_IMAGE" -R "$(id -u):$(id -g)" /check > /dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT
mkdir -p "$work/control" "$work/state/"{runtime,live-cache,live-raw,forecast-issues}
cp "$source_dir/server/compose.yaml" "$work/control/compose.yaml"
printf 'DATATHON_FRONTEND_IMAGE=%s\nDATATHON_BACKEND_IMAGE=%s\n' "$DATATHON_FRONTEND_IMAGE" "$DATATHON_BACKEND_IMAGE" > "$work/control/release.env"
printf 'VELA_API_KEY=container-check-only\n' > "$work/control/frontend.env"
cat > "$work/control/backend.env" <<'ENV'
VELA_API_KEY=container-check-only
VELA_BROWSER_ENABLED=true
MOBILITY_LIVE_AIRCRAFT_ENABLED=false
MOBILITY_LIVE_VESSEL_ENABLED=false
MOBILITY_LIVE_FOLLOWME_ENABLED=false
ENV
docker run --rm --network none --user 0 --mount "type=bind,src=$work/state,dst=/state" --entrypoint /bin/chown "$DATATHON_BACKEND_IMAGE" -R 10001:10001 /state
"${compose[@]}" up -d --wait --wait-timeout 180 --no-build --pull never
"${compose[@]}" exec -T backend /opt/venv/bin/python - <<'PY'
import asyncio
from playwright.async_api import async_playwright

async def check():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content('<h1>Container browser ready</h1>')
        assert await page.locator('h1').inner_text() == 'Container browser ready'
        await browser.close()
asyncio.run(check())
print('Chromium works as the restricted app user.')
PY
python3 - <<'PY'
import json
from html.parser import HTMLParser
import urllib.error
import urllib.parse
import urllib.request

base = 'http://127.0.0.1:18730/apps/datathon'
with urllib.request.urlopen(base + '/', timeout=30) as response:
    html = response.read().decode()
    assert response.status == 200
class Assets(HTMLParser):
    hrefs = []
    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in ('src', 'href') and value and '_app/' in value:
                self.hrefs.append(value)
assets = Assets()
assets.feed(html)
assert assets.hrefs, 'Expected built frontend assets.'
for href in assets.hrefs[:2]:
    url = urllib.parse.urljoin(base + '/', href)
    assert urllib.parse.urlparse(url).path.startswith('/apps/datathon/_app/')
    with urllib.request.urlopen(url, timeout=30) as response:
        assert response.status == 200
for endpoint in ('health', 'national/summary', 'planning/baseline'):
    with urllib.request.urlopen(base + '/api/backend/' + endpoint, timeout=60) as response:
        data = json.load(response)
        assert response.status == 200 and isinstance(data, dict), endpoint
        if endpoint == 'health':
            assert data['status'] == 'ok' and data['environment'] == 'production'
# A malformed body must still be refused by the production maintenance boundary.
request = urllib.request.Request(
    base + '/api/backend/forecasts/sources/stage', data=b'{}',
    headers={'Content-Type': 'application/json'}, method='POST',
)
try:
    urllib.request.urlopen(request, timeout=30)
except urllib.error.HTTPError as error:
    assert error.code == 403, error.code
else:
    raise AssertionError('Production accepted a source-maintenance operation.')
request = urllib.request.Request(
    base + '/api/backend/planning/report.pdf',
    data=json.dumps({'island_id': 'island:1443', 'operations': []}).encode(),
    headers={'Content-Type': 'application/json'}, method='POST',
)
with urllib.request.urlopen(request, timeout=90) as response:
    assert response.status == 200 and response.read(5) == b'%PDF-'
print('Production containers passed: mounted frontend, real API, planning data, PDF and source-write protection.')
PY
