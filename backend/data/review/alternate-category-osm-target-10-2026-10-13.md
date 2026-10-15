# Alternate-category OSM review — target 10 unresolved private/resort clinic records

**Retrieved:** 2026-10-13 (UTC)  
**Scope:** official HEMS/MoH and Tourism pages, official/owner pages, Google Maps discovery, Nominatim/Overpass-style OSM discovery, OSM API object checks, and narrow OSM map checks.  
**Safety rule:** an island/islet polygon, resort/hotel object, generic building, office address, nearby clinic, or pharmacy is context only. It is not clinic geometry without a clinic-level identity match.

## Disposition summary

| Facility ID | Official name | Best alternate-category evidence | Safe disposition |
|---|---|---|---|
| `facility:health:261` | Aahiyans Medical Clinic | Hinnavaru islet only; no named clinic/doctor/facility object found | `unresolved_island_context_only` |
| `facility:health:12` | Aanugandu Island Resort Clinic | Official Tourism/owner evidence links Aanugandu to Aanugan'du Finolhu/Huraa; OSM has the resort islet under legacy/current brand `OBLU XPERIENCE AILAFUSHI`, but no clinic object | `unresolved_island_context_only` |
| `facility:health:191` | Aarah Clinic | Raa Aarah islet way has `alt_name:en=Heritance Aarah`; no clinic object | `unresolved_island_context_only` |
| `facility:health:199` | Emerald Faarufushi Clinic | Faarufushi islet/resort context; no clinic object | `unresolved_island_context_only` |
| `facility:health:41` | Emerald Maldives Resort Clinic | Fasmendhoo islet way has Emerald resort alternate name; no clinic object | `unresolved_island_context_only` |
| `facility:health:28` | Eri Maldives Clinic | OSM `Eri Maldives` is explicitly a `tourism=hotel`; conflicts with HEMS/Maaharaa urban Malé address | `rejected_candidate_unresolved` |
| `facility:health:239` | Eriyadu Clinic Closed | OSM Eriyadu context is a bar/resort hotel; no clinic object; preserve closed official record | `rejected_candidate_unresolved` |
| `facility:health:246` | Esma Dhivehi Beys Clinic Closed | Google active/closed duplicates and an official current Dhivehi Beys listing, but no matching OSM clinic object | `rejected_candidate_unresolved` |
| `facility:health:760` | Eve Clinic | Official address is M. Kovarik, Malé; nearby OSM clinics are distinct names; no EVE object | `unresolved_no_osm_candidate` |
| `facility:health:886` | Eve Clinic Vinares | Official EVE location is Vinares Tower 1, Unit V1-1-101, Hulhumalé Phase 2; OSM has no Vinares/EVE clinic object | `unresolved_no_osm_candidate` |

## Per-record evidence

### `facility:health:261` — Aahiyans Medical Clinic

- **HEMS:** General Clinic; owner `Aahiyans Pvt Ltd (C-0615/2011)`; registration `HF-21/ALT/PVT/588`; license `PVT-GC-21-083-00`; contacts `7933326 / 7783818`.
- **Maaharaa:** `Aahiyaa, Lh. Hinnavaru`.
- **Google Maps discovery:** no exact Aahiyans result; surfaced unrelated Hulhumalé clinics. No identity match.
- **OSM:** [way 441740990](https://www.openstreetmap.org/way/441740990) is Hinnavaru, `place=islet`, `name:en=Hinnavaru`, approximately `5.494,73.413`. Narrow map check found no named clinic/doctor/facility building for Aahiyans.
- **Decision:** Hinnavaru is context only. Do not assign the islet geometry or an unrelated Malé/Hulhumalé clinic.

### `facility:health:12` — Aanugandu Island Resort Clinic

- **HEMS:** General Clinic; owner `Promonant Private Limited`; registration `HF-25/ALP/PVT/837`; license `PVT-GC-25-560-00`; contact `3300668`.
- **Maaharaa:** `Aanugandu Island Resort Clinic, K. Male'`.
- **Official Tourism evidence:** the registered resort is `Aanugandu Island Resort`, Kaafu, `Aanugan'du Finolhu and Aanugan'du Huraa`, 384 rooms/768 beds, operator `Promonant Pvt Ltd` ([Tourism registry](https://www.tourism.gov.mv/en/registered/facilities/filter-t1)).
- **Owner/resort evidence:** Atmosphere/OBLU-linked listings and company records associate the resort with Ailafushi/Aanugan'du Finolhu. OSM [way 1061977111](https://www.openstreetmap.org/way/1061977111) is `OBLU XPERIENCE AILAFUSHI`, `place=islet`, approximately `4.3061,73.5053`, with OBLU website/contact tags. This is a useful resort/island context lead, not a clinic representation; the name/operator history is not sufficient to place the clinic inside any particular building.
- **OSM:** no named `Aanugandu Island Resort Clinic` object or clinic amenity found.
- **Decision:** retain Aanugandu/Ailafushi context only. Do not map the islet/resort polygon or OBLU resort object as the clinic.

### `facility:health:191` — Aarah Clinic

- **HEMS:** General Clinic; owner `Cowrie Investment Pvt Ltd`; registration `HF-22/ALP/PVT/658`; license `PVT-GC-22-249-00`; contact `3315236`.
- **Maaharaa:** `Aarah, Raa Atoll`.
- **Google Maps:** resort result resolves to Heritance Aarah; no exact clinic place card.
- **OSM:** [way 19879650](https://www.openstreetmap.org/way/19879650) is `Aarah`, `is_in:archipelago=Raa`, `alt_name:en=Heritance Aarah`, approximately `5.4475,72.9416`. Narrow check found no clinic object.
- **Decision:** Raa Aarah/Heritance is context only. Do not map the islet or resort geometry as the clinic.

### `facility:health:199` — Emerald Faarufushi Clinic

- **HEMS:** General Clinic; owner `Emil Resort Private Limited`; registration `HF-22/ALP/PVT/650`; license `PVT-GC-23-354-00`; contact `3333644`.
- **Maaharaa:** `Faarufushi Island, Raa Atoll, Maldives`.
- **Google Maps/owner:** Emerald Faarufushi Resort & Spa; `emerald-faarufushi.com`.
- **OSM:** [way 19879582](https://www.openstreetmap.org/way/19879582) is `Faarufushi`, `place=islet`, `alt_name:en=Faarufushi Maldives`, approximately `5.7680,72.9658`, with the resort website. A nearby hotel multipolygon and generic building footprints are not clinic objects.
- **Decision:** keep Faarufushi/resort context only. No safe clinic geometry.

### `facility:health:41` — Emerald Maldives Resort Clinic

- **HEMS:** General Clinic; owner `Emil Resort Pvt Ltd`; registration `HF-24/ALP/PVT/808`; license `PVT-GC-24-528-00`; contact `7979718`.
- **Maaharaa:** `6th Floor, H. Aage, Boduthakurufaanu Magu, Male'`.
- **Google Maps/owner:** Emerald Maldives Resort & Spa, Fasmendhoo Island; `emerald-maldives.com`.
- **OSM:** [way 19879687](https://www.openstreetmap.org/way/19879687) is `Fasmendhoo`, `place=islet`, `alt_name:en=Emerald Maldives Resort & Spa Fasmendho`, approximately `5.4938,72.8810`. No clinic object was found in the checked resort/islet extract.
- **Decision:** Fasmendhoo/Emerald is plausible context only. Do not map the resort polygon or the Malé office address as clinic geometry.

### `facility:health:28` — Eri Maldives Clinic

- **HEMS:** General Clinic; owner `ERI Holding Pvt Ltd`; registration `HF-24/ALP/PVT/821`; license `PVT-GC-24-543-00`; contact `7785842`.
- **Maaharaa:** `Kaneeru Villa, Orchid Magu, Male'`.
- **Official owner page:** Eri Maldives publishes an in-house medical clinic for the resort, confirming a resort medical service exists, but not its separate geometry.
- **OSM candidate rejected:** [way 19881893](https://www.openstreetmap.org/way/19881893) is explicitly `tourism=hotel`, `building=yes`, `name=Eri Maldives`, approximately `4.5898,73.4144`; it is not tagged as a clinic. The similarly named Eriyadu context object is a bar.
- **Decision:** reject the resort hotel as a clinic mapping because it conflicts with the HEMS/Maaharaa Malé address and category. Retain unresolved.

### `facility:health:239` — Eriyadu Clinic Closed

- **HEMS:** closed General Clinic; owner `Platinum Capital Holdings Pvt Ltd (C0702/2005)`; registration `HF-21/ALP/PVT/610`; license `PVT-GC-23-351-00`; contact `3343840`.
- **Maaharaa:** `Eriyadu Island Resort, Maldives`.
- **Google Maps/owner:** current resort results resolve to Eri Maldives, a resort rename/context lead rather than a clinic point.
- **OSM candidate rejected:** [way 19881893](https://www.openstreetmap.org/way/19881893) is the resort hotel; the older Eriyadu object is a bar (`amenity=bar`, [node 583580926](https://www.openstreetmap.org/node/583580926)). Neither is clinic geometry.
- **Decision:** preserve the closed official record; do not map it to the bar, hotel, or island polygon.

### `facility:health:246` — Esma Dhivehi Beys Clinic Closed

- **HEMS:** closed Traditional Medicine Clinic; owner `Abdulla Rasheed`; registration `HF-21/ALT/PVT/603`; license `PVT-TMC-21-037-00`; contact `7592811`.
- **Maaharaa search:** a current `Dhivehi Beys Clinic` listing is shown as a private facility in K. Male', with `Lot No 10176, Hulhumale'`, but this is not enough to prove identity with the closed HEMS record.
- **Google Maps:** active `Dhivehi Beys Clinic` and a separate permanently closed result were returned. Duplicate/current/closed place cards do not identify an OSM object for the HEMS record.
- **OSM:** exact-name Overpass/Nominatim discovery found no matching `Dhivehi Beys` clinic object. Nearby Hulhumalé healthcare objects have different names and must not be conflated.
- **Decision:** no safe alternate-category mapping. Preserve closed status and leave unresolved.

### `facility:health:760` — Eve Clinic

- **HEMS:** General Clinic; owner `Fathimath Shenaalee Hussain (A036027)`; registration `HF-12/ALP/PVT/074`; license `PVT-GC-21-077-00`; contacts `7900788 / 3300788`.
- **Maaharaa:** `M. Kovarik, K. Male'`.
- **Official EVE locations/business registry:** the Malé flagship is at `M. Kovarik, Fareedhee Magu`; the same brand has separate Vinares and West Park branches. These are distinct HEMS records and must not be merged.
- **OSM:** nearby objects include `Poli Clinic & Medicals` (node 4584491564), `Family Care` (node 6294957686), `Advance Medical Clinic` (node 9951457715), `Central Clinic` (node 9951500245), and `Medica` (way 762119227). None is named EVE and none is an identity match.
- **Decision:** no safe OSM candidate. Do not map a nearby clinic or generic M. Kovarik building.

### `facility:health:886` — Eve Clinic Vinares

- **HEMS:** General Clinic; owner `Fathimath Shenaly Hussain`; registration `HF-25/ALP/PVT/853`; license `PVT-GC-25-574-00`.
- **Official EVE locations:** `Vinares Tower 1, Hithigas Magu, Phase 2, Hulhumale'`; official business-register result gives `Vinares Tower 1, Unit V1-1-101` / commercial unit `V1-1-01`.
- **Owner/news corroboration:** EVE's location page and Sun news identify the Phase 2 branch at Vinares Tower 1, Unit V1-1-101.
- **OSM:** countrywide exact-name query returned no `EVE`/`Vinares` object. The checked Hulhumalé Phase 2 extract had generic buildings/healthcare objects but no named Vinares Tower 1 or EVE clinic. A generic building or tower footprint would not satisfy clinic-level identity.
- **Decision:** no safe alternate-category mapping. Retain the official Vinares/unit address as evidence and leave unresolved.

## Source endpoints

- HEMS official directory: <https://hems.health.gov.mv/establishments>
- Maaharaa public facility directory: <https://maaharaa.health.gov.mv/Public/Home/ListHealthCare>
- Maldives Tourism registered facilities: <https://www.tourism.gov.mv/en/registered/facilities/filter-t1>
- EVE official locations: <https://eveclinic.mv/locations>
- EVE business-register result: <https://business.egov.mv/BusinessRegistry/ViewDetails/133363?key=1108563651>
- OSM API object endpoint: <https://api.openstreetmap.org/api/0.6/{type}/{id}.json>
- OSM Overpass endpoint used for exact-name checks: <https://overpass-api.de/api/interpreter>
- Google Maps discovery base: <https://www.google.com/maps/search/?api=1&query=>

## Canonical-file safety

No canonical cache, normalized facility file, application source file, or existing ledger was modified. This is a new review artifact only. No clinic geometry was added or inferred.
