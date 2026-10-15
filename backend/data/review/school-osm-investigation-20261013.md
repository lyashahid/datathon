# Ministry school OSM investigation — 2026-10-13

Scope: ten Ministry of Education records previously marked `island_context_only`. No canonical cache or source files were modified. Decisions below are deliberately conservative: official island agreement is required; a named school on another island is rejected, and an unnamed same-island school object remains provisional.

## Method and evidence

- **Official identity/island:** Ministry pages `https://www.moe.gov.mv/en/schools/{id}` and the existing raw Ministry captures under `data/cache/raw/education/schools/`. Official address/island/atoll text was preserved from the normalized records.
- **Google Maps discovery:** queried the ten exact-name + Maldives searches using the Google Maps search URL form. The browser exposed only the generic Maps shell/no independently verifiable facility card, so Google Maps was used only as discovery and did not upgrade any match.
- **Nominatim:** exact school-name queries for all ten official names returned no result. Island discovery returned OSM island objects for the first four queries; later island requests were rate-limited (`429`). Nominatim results were not used alone for identity.
- **OSM API:** fetched narrow `map` bboxes around each official island, checking `amenity=school`, `building=school`, `education=school`, `operator`, `government`, `name`, `name:en`, and related school/kindergarten tags. Candidate objects were then fetched from the OSM API with full geometry/tags. Overpass broad queries timed out/returned `504`, so the OSM API bbox scans are the reproducible live validation used here.

## Decisions

| Ministry ID | Official record / island | OSM findings | Conservative decision |
|---|---|---|---|
| `facility:school:438` | Filladhoo School — Filladhoo, Haa Alifu | OSM island way `19879519` is `Filladhoo`; bbox scan found no school-tagged, named, operator, government, or alternate-category representation. Nominatim exact school query: no result. | **`source_not_in_osm`** — island context confirmed; no defensible school object found. Do not invent geometry. |
| `facility:school:443` | Maarandhoo School — Maarandhoo, Haa Alifu | OSM node `10196475671` is a real school with `operator=Ministry of Education`, but it is on OSM `Thakandhoo` (way `19879278`), not official Maarandhoo (way `19879729`). Approx. school-to-island-center distances: 277 m to Thakandhoo vs 1,667 m to Maarandhoo. | **`rejected_candidate` / keep unresolved** — preserve explicit wrong-island rejection; no valid Maarandhoo school match. |
| `facility:school:444` | Vashafaru School — Vashafaru, Haa Alifu | OSM island way `19879406` is `Vashafaru`; no school-tagged or alternate-category candidate in the island bbox. Nominatim exact school query: no result. | **`source_not_in_osm`** — no defensible OSM school representation. |
| `facility:school:445` | Molhadhoo School — Molhadhoo, Haa Alifu | OSM island way `19879752` is `Mulhadhoo` (`name:en`), a spelling variant of the official island; no school-tagged or alternate-category candidate. | **`source_not_in_osm`** — island spelling variant is not facility evidence. |
| `facility:school:446` | Muraidhoo School — Muraidhoo, Haa Alifu | OSM island way `19879436` is `Muraidhoo`; no school-tagged or alternate-category candidate in the bbox. | **`source_not_in_osm`** — no defensible OSM school representation. |
| `facility:school:447` | Thuraakunu School — Thuraakunu, Haa Alifu | OSM has seven `building=school` ways and named school way `1287079702` (`Uligamu School`), but all are on OSM `Uligan` (way `19879531`), not official Thuraakunu (way `19879682`). Approx. named-school-to-island-center distances: 56 m to Uligan vs 3,443 m to Thuraakunu. | **`rejected_candidate` / keep unresolved** — preserve explicit wrong-island rejection; do not map Thuraakunu to Uligamu/Uligan. |
| `facility:school:454` | Finey School — Finey, Haa Dhaalu | OSM island way `19879506` is `Finey`; no school-tagged or alternate-category candidate in the bbox. | **`source_not_in_osm`** — no defensible OSM school representation. |
| `facility:school:455` | Kumundhoo School — Kumundhoo, Haa Dhaalu | Same-island OSM way `1554432122` has `amenity=school` + `education=school`, but no `name`, `name:en`, `operator`, or government tag. Its geometry is beside OSM road `122946797` `Zamaany Hingun`, a plausible spelling variant of the Ministry address `Zamaanee Hingun`; minimum node-to-road distance is about 5 m. Nearby node `14152834523` is separately tagged `Tharaha Pre-School` (`amenity=kindergarten`). | **`osm_provisional_review_required`** — plausible same-island school object, but identity/operator/name evidence is insufficient for acceptance. Do not treat the kindergarten as the Ministry school. |
| `facility:school:456` | Kurinbee School — official island text `Kurinbi`, Haa Dhaalu | OSM island way `19879371` is `Kurinbi`; no school-tagged or alternate-category candidate in the bbox. | **`source_not_in_osm`** — official `Kurinbee`/`Kurinbi` spelling variation does not identify a facility. |
| `facility:school:457` | Naivaadhoo School — Naivaadhoo, Haa Dhaalu | OSM island way `19879577` is `Naavaidhoo`; no school-tagged or alternate-category candidate in the bbox. | **`source_not_in_osm`** — island spelling variant is not facility evidence. |

## Result counts

- 10/10 official records reviewed.
- 7/10: no defensible school representation found in the current OSM scan (`source_not_in_osm`).
- 2/10: school candidates found but rejected for wrong island (`Maarandhoo → Thakandhoo`; `Thuraakunu → Uligan`); official records remain unresolved.
- 1/10: same-island unnamed school object retained as provisional only (`Kumundhoo`).
- 0 accepted `reviewed_osm_match` or `osm_best_effort` mappings.

## Reproducible evidence artifacts

Created in `data/review/`:

- `school-osm-map-scan.json` — OSM API bbox URLs, counts, and school-ish objects for all ten islands.
- `school-osm-context.json` — OSM island objects, school candidates, and government/operator context.
- `school-osm-object-verification.json` — live OSM API object/geometry/tag fetches for the two wrong-island candidates, the Kumundhoo provisional object, nearby kindergarten, and comparison island ways.
- `school-osm-address-check.json` — live OSM road check for the Ministry `Zamaanee Hingun` address versus OSM `Zamaany Hingun`.

Primary URL patterns used:

- Ministry: `https://www.moe.gov.mv/en/schools/{438,443,444,445,446,447,454,455,456,457}`
- OSM object/API: `https://api.openstreetmap.org/api/0.6/{node|way}/{id}.json` and `/full.json`
- Google Maps discovery: `https://www.google.com/maps/search/?api=1&query={exact school name}+Maldives`
- Nominatim: `https://nominatim.openstreetmap.org/search`

No canonical files were changed.
