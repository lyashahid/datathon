# Alternate-category OSM investigation — 10 unresolved HEMS health centres

**Accessed:** 2026-10-13.  
**Canonical files modified:** no.  

## Outcome

- Safe facility-level OSM mappings accepted: **0/10**.
- Island-agreeing Google Maps discovery: **10/10**; two are generic-name island places/variants rather than exact official-name matches.
- `source_not_in_osm`: **10/10**; no defensible facility-level OSM object survived category/name/island review.
- Rejected OSM candidates/objects: **7** — one generic `healthcare=yes` building, one school, one fire station, and four mosques; none is facility-level health-centre evidence.
- Alternate checks covered `amenity=*`, `healthcare=*`, `building=healthcare|clinic|hospital`, `office=*`, and health/clinic/hospital/doctor/medical/pharmacy/dispensary/centre/center name tokens.
- Overpass query returned HTTP 200 with 550 elements; no accepted facility candidate. Nominatim exact-facility searches returned no result where successful, then HTTP 429; Nominatim was discovery-only and not used as absence proof.

## Per-record evidence and decision
### `facility:health:588` — GA. Kan'dhuhulhudhoo Health Centre
- **Official context:** Kan'duhulhudhoo (Gaafu Alifu); HEMS source record `588`; Health Centre Grade 1.
- **Google Maps:** `exact_island_place`; **Kanduhulhudhoo Health Centre**; category `Community health center`; `9G3Q+5QR, Kanduhulhudhoo`; [search](https://www.google.com/maps/search/?api=1&query=GA.+Kan%27dhuhulhudhoo+Health+Centre+Maldives). Google normalizes Kan'dhuhulhudhoo to Kanduhulhudhoo and shows the same official island.
- **Nominatim:** island query returned 0 result(s) in the available attempt(s); exact facility query returned 0 result(s). Discovery only; no rate-limit note
- **OSM API island scan:** [map bbox](https://api.openstreetmap.org/api/0.6/map?bbox=73.5356094,0.3461624,73.5439956,0.3568181); HTTP 200; 156 objects / 65 tagged objects; 0 alternate-tag object(s).
- No alternate-category OSM candidate was found in the official-island bbox.
- **Decision:** `source_not_in_osm`; confidence **high**; safe mapping **no**.
- **Evidence:** Google Maps supplies island-specific place evidence, but live OSM map/Overpass scans found no defensible facility-level health object. No alternate-category facility object was found.

### `facility:health:591` — GA. Kolamafushi Health Centre
- **Official context:** Kolamaafushi (Gaafu Alifu); HEMS source record `591`; Health Centre Grade 3.
- **Google Maps:** `exact_island_place`; **GA Kolamaafushi Health Center**; category `Hospital`; `R5PP+V8P, Kolamaafushi`; [search](https://www.google.com/maps/search/?api=1&query=GA.+Kolamafushi+Health+Centre+Maldives). Google normalizes Kolamafushi to Kolamaafushi and returns the official island.
- **Nominatim:** island query returned 1 result(s) in the available attempt(s); exact facility query returned 0 result(s). Discovery only; no rate-limit note
- **OSM API island scan:** [map bbox](https://api.openstreetmap.org/api/0.6/map?bbox=73.1798617,0.8312005,73.1902940,0.8432974); HTTP 200; 666 objects / 102 tagged objects; 0 alternate-tag object(s).
- No alternate-category OSM candidate was found in the official-island bbox.
- **Decision:** `source_not_in_osm`; confidence **high**; safe mapping **no**.
- **Evidence:** Google Maps supplies island-specific place evidence, but live OSM map/Overpass scans found no defensible facility-level health object. No alternate-category facility object was found.

### `facility:health:584` — GA. Kondey Health Centre
- **Official context:** Kondey (Gaafu Alifu); HEMS source record `584`; Health Centre Grade 1.
- **Google Maps:** `island_specific_generic_name`; **Health Center**; category `Community health center`; `Health Center, Kondey`; [search](https://www.google.com/maps/search/?api=1&query=GA.+Kondey+Health+Centre+Maldives). Google returns a generic Health Center place explicitly located on Kondey; name is not facility-specific.
- **Nominatim:** island query returned 1 result(s) in the available attempt(s); exact facility query returned 0 result(s). Discovery only; no rate-limit note
- **OSM API island scan:** [map bbox](https://api.openstreetmap.org/api/0.6/map?bbox=73.5408683,0.4900140,73.5566618,0.5095012); HTTP 200; 460 objects / 57 tagged objects; 0 alternate-tag object(s).
- No alternate-category OSM candidate was found in the official-island bbox.
- **Decision:** `source_not_in_osm`; confidence **medium-high**; safe mapping **no**.
- **Evidence:** Google Maps supplies island-specific place evidence, but live OSM map/Overpass scans found no defensible facility-level health object. No alternate-category facility object was found.

### `facility:health:586` — GA. Nilandhoo Health Centre
- **Official context:** Nilandhoo (Gaafu Alifu); HEMS source record `586`; Health Centre Grade 1.
- **Google Maps:** `exact_island_place`; **Ga. Nilandhoo Health Center**; category `Hospital`; `JCMW+GH5, Nilandhoo`; [search](https://www.google.com/maps/search/?api=1&query=GA.+Nilandhoo+Health+Centre+Maldives). Google title includes Ga. Nilandhoo, resolving the otherwise ambiguous island name.
- **Nominatim:** island query returned 3 result(s) in the available attempt(s); exact facility query returned 0 result(s). Discovery only; no rate-limit note
- **OSM API island scan:** [map bbox](https://api.openstreetmap.org/api/0.6/map?bbox=73.4399910,0.6296125,73.4521776,0.6434764); HTTP 200; 568 objects / 67 tagged objects; 0 alternate-tag object(s).
- No alternate-category OSM candidate was found in the official-island bbox.
- **Decision:** `source_not_in_osm`; confidence **high**; safe mapping **no**.
- **Evidence:** Google Maps supplies island-specific place evidence, but live OSM map/Overpass scans found no defensible facility-level health object. No alternate-category facility object was found.

### `facility:health:582` — Gaafu Dhaalu Gadhdhoo Health Centre
- **Official context:** Gadhdhoo (atoll not recorded in normalized context); HEMS source record `582`; Health Centre Grade 4.
- **Google Maps:** `exact_island_place`; **Gadhdhoo Health Center**; category `Hospital`; `7FQ3+5RG, Gadhdhoo`; [search](https://www.google.com/maps/search/?api=1&query=Gaafu+Dhaalu+Gadhdhoo+Health+Centre+Maldives). Google returns the official Gadhdhoo island and a health-centre place.
- **Nominatim:** island query returned 1 result(s) in the available attempt(s); exact facility query returned 0 result(s). Discovery only; no rate-limit note
- **OSM API island scan:** [map bbox](https://api.openstreetmap.org/api/0.6/map?bbox=73.4514334,0.2836436,73.4651501,0.2969411); HTTP 200; 1320 objects / 185 tagged objects; 0 alternate-tag object(s).
- No alternate-category OSM candidate was found in the official-island bbox.
- **Decision:** `source_not_in_osm`; confidence **high**; safe mapping **no**.
- **Evidence:** Google Maps supplies island-specific place evidence, but live OSM map/Overpass scans found no defensible facility-level health object. No alternate-category facility object was found.

### `facility:health:579` — GDh. Faresmaathodaa Health Centre
- **Official context:** Faresmaathodaa (Gaafu Dhaalu); HEMS source record `579`; Health Centre Grade 3.
- **Google Maps:** `exact_island_place`; **Faresmaathodaa Health Centre**; category `Hospital`; `Faresmaathodaa`; [search](https://www.google.com/maps/search/?api=1&query=GDh.+Faresmaathodaa+Health+Centre+Maldives). Google corrects the spelling in the result query but returns the official island and facility.
- **Nominatim:** island query returned 0 result(s) in the available attempt(s); exact facility query returned 0 result(s). Discovery only; HTTP 429 after the first five records; Nominatim was discovery-only and not used as absence proof.
- **OSM API island scan:** [map bbox](https://api.openstreetmap.org/api/0.6/map?bbox=73.1809671,0.1931282,73.1936168,0.2052287); HTTP 200; 1096 objects / 126 tagged objects; 1 alternate-tag object(s).
  - Rejected `osm:way:1104753218` tags `{'amenity': 'fire_station'}` — Unrelated OSM object; not a health facility. [API](https://api.openstreetmap.org/api/0.6/way/1104753218.json).
- **Decision:** `source_not_in_osm`; confidence **high**; safe mapping **no**.
- **Evidence:** Google Maps supplies island-specific place evidence, but live OSM map/Overpass scans found no defensible facility-level health object. Nearby non-health objects are rejected.

### `facility:health:580` — GDh. Fiyoaree Health Centre
- **Official context:** Fiyoaree (Gaafu Dhaalu); HEMS source record `580`; Health Centre Grade 2.
- **Google Maps:** `exact_island_place`; **Fiyoaree Health Center**; category `Hospital`; `64CQ+H6R, Baraasil Magu`; [search](https://www.google.com/maps/search/?api=1&query=GDh.+Fiyoaree+Health+Centre+Maldives). Google returns Fiyoaree Health Center on Fiyoaree; a separate boat-builder result is unrelated.
- **Nominatim:** island query returned 0 result(s) in the available attempt(s); exact facility query returned 0 result(s). Discovery only; HTTP 429 after the first five records; Nominatim was discovery-only and not used as absence proof.
- **OSM API island scan:** [map bbox](https://api.openstreetmap.org/api/0.6/map?bbox=73.1300784,0.2126784,73.1431613,0.2296552); HTTP 200; 998 objects / 132 tagged objects; 4 alternate-tag object(s).
  - Rejected `osm:node:11221812118` tags `{'addr:city': 'Fiyoari', 'addr:street': 'Baraasil Magu', 'amenity': 'school', 'description': 'Fiyoaree School is a school in Fiyoaree, an island of Gaafu Dhaalu Atoll, Maldives. The school was opened on 17 September 1980 under the name of Fiyoaree Makthab.', 'mobile': '(+960)7983086', 'name': 'Fiyoaree School', 'name:dv': 'ފިޔޯރީ ސްކޫލް', 'name:en': 'Fiyoaree School', 'operator': 'Government of Maldives', 'operator:type': 'government', 'religion': 'muslim', 'website': 'https://fiyoarischool.edupage.org/', 'wikidata': 'Q27961820', 'wikipedia': 'en:Fiyoaree School'}` — Unrelated OSM object; not a health facility. [API](https://api.openstreetmap.org/api/0.6/node/11221812118.json).
  - Rejected `osm:way:751750170` tags `{'building': 'yes', 'healthcare': 'yes'}` — Generic healthcare=yes building without name, operator, or clinic/hospital category; alternate tag alone is insufficient. [API](https://api.openstreetmap.org/api/0.6/way/751750170.json).
  - Rejected `osm:way:1467225959` tags `{'amenity': 'place_of_worship', 'building': 'yes', 'religion': 'muslim'}` — Unrelated OSM object; not a health facility. [API](https://api.openstreetmap.org/api/0.6/way/1467225959.json).
  - Rejected `osm:way:1467225960` tags `{'amenity': 'place_of_worship', 'building': 'yes', 'religion': 'muslim'}` — Unrelated OSM object; not a health facility. [API](https://api.openstreetmap.org/api/0.6/way/1467225960.json).
- **Decision:** `source_not_in_osm`; confidence **high**; safe mapping **no**.
- **Evidence:** Google Maps supplies island-specific place evidence, but live OSM map/Overpass scans found no defensible facility-level health object. The only alternate-tag object is a generic healthcare=yes building and is rejected.

### `facility:health:576` — GDh. Nadella Health Centre
- **Official context:** Nadellaa (Gaafu Dhaalu); HEMS source record `576`; Health Centre Grade 2.
- **Google Maps:** `exact_island_place`; **Nadella Health Center**; category `Hospital`; `72VR+F26, Nadallaa`; [search](https://www.google.com/maps/search/?api=1&query=GDh.+Nadella+Health+Centre+Maldives). Google uses the OSM/official spelling variant Nadallaa for Nadella.
- **Nominatim:** island query returned 0 result(s) in the available attempt(s); exact facility query returned 0 result(s). Discovery only; HTTP 429 after the first five records; Nominatim was discovery-only and not used as absence proof.
- **OSM API island scan:** [map bbox](https://api.openstreetmap.org/api/0.6/map?bbox=73.0353779,0.2888128,73.0465162,0.2985776); HTTP 200; 1298 objects / 203 tagged objects; 0 alternate-tag object(s).
- No alternate-category OSM candidate was found in the official-island bbox.
- **Decision:** `source_not_in_osm`; confidence **high**; safe mapping **no**.
- **Evidence:** Google Maps supplies island-specific place evidence, but live OSM map/Overpass scans found no defensible facility-level health object. No alternate-category facility object was found.

### `facility:health:703` — Gdh. Rathafandhoo Health Center
- **Official context:** Rathafandhoo (Gaafu Dhaalu); HEMS source record `703`; Health Centre Grade 2.
- **Google Maps:** `exact_island_place`; **Rathafandhoo Health Centre**; category `Hospital`; `7434+F4R, Rathafandhoo`; [search](https://www.google.com/maps/search/?api=1&query=Gdh.+Rathafandhoo+Health+Center+Maldives). Google returns the official Rathafandhoo island and facility.
- **Nominatim:** island query returned 0 result(s) in the available attempt(s); exact facility query returned 0 result(s). Discovery only; HTTP 429 after the first five records; Nominatim was discovery-only and not used as absence proof.
- **OSM API island scan:** [map bbox](https://api.openstreetmap.org/api/0.6/map?bbox=73.0998414,0.2477917,73.1099193,0.2578757); HTTP 200; 1049 objects / 183 tagged objects; 0 alternate-tag object(s).
- No alternate-category OSM candidate was found in the official-island bbox.
- **Decision:** `source_not_in_osm`; confidence **high**; safe mapping **no**.
- **Evidence:** Google Maps supplies island-specific place evidence, but live OSM map/Overpass scans found no defensible facility-level health object. No alternate-category facility object was found.

### `facility:health:745` — Haa Alifu Filladhoo Health Centre
- **Official context:** Filladhoo (Haa Alifu); HEMS source record `745`; Health Centre Grade 1.
- **Google Maps:** `island_specific_generic_name_variant`; **Hospital**; category `Hospital`; `V6JH+5X6, Filladhoo`; [search](https://www.google.com/maps/search/?api=1&query=Filladhoo+Health+Centre+Maldives). The full Haa Alifu query returned unrelated islands, but the short-name query Filladhoo Health Centre Maldives returned a generic Hospital on Filladhoo; retain island agreement but not exact facility identity.
- **Nominatim:** island query returned 0 result(s) in the available attempt(s); exact facility query returned 0 result(s). Discovery only; HTTP 429 after the first five records; Nominatim was discovery-only and not used as absence proof.
- **OSM API island scan:** [map bbox](https://api.openstreetmap.org/api/0.6/map?bbox=73.2191729,6.8690629,73.2368213,6.9250522); HTTP 200; 1934 objects / 344 tagged objects; 2 alternate-tag object(s).
  - Rejected `osm:way:750425461` tags `{'amenity': 'place_of_worship', 'building': 'yes', 'name': 'Kuda Miskiyy', 'religion': 'muslim'}` — Unrelated OSM object; not a health facility. [API](https://api.openstreetmap.org/api/0.6/way/750425461.json).
  - Rejected `osm:way:1332135327` tags `{'amenity': 'place_of_worship', 'building': 'yes', 'name': 'Hukuru Miskiy', 'religion': 'muslim'}` — Unrelated OSM object; not a health facility. [API](https://api.openstreetmap.org/api/0.6/way/1332135327.json).
- **Decision:** `source_not_in_osm`; confidence **medium-high**; safe mapping **no**.
- **Evidence:** Google Maps supplies island-specific place evidence, but live OSM map/Overpass scans found no defensible facility-level health object. Nearby non-health objects are rejected.

## Method and source endpoints

- Official HEMS: <https://hems.health.gov.mv/establishments>
- Public HPA/Maaharaa facility list: <https://maaharaa.health.gov.mv/Public/Home/ListHealthCare>
- Google Maps discovery: per-record links above.
- Nominatim: per-record URLs in the JSON evidence artifact.
- OpenStreetMap API map/object endpoints: per-record links above and in the JSON artifact.
- Overpass query: `data/review/online-facility-health-ga-gdh-ha-overpass-20261013.query.txt` against <https://overpass.kumi.systems/api/interpreter>.

No canonical cache, normalized facility file, or application source file was modified. This is an evidence/disposition artifact only; it does not add guessed clinic geometry.
