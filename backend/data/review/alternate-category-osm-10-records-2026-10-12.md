# Alternate-category OSM review — 10 unresolved HEMS clinic records

**Retrieved:** 2026-10-12T20:21:23Z (UTC)  
**Scope:** official HEMS/MoH records, Maaharaa public facility directory, Google Maps discovery, Nominatim, OSM API, and narrow OSM map/Overpass-style nearby-category checks.  
**Safety rule:** resort/islet polygons, hotel objects, generic buildings, offices, pharmacies, and nearby health facilities are context only. They are not clinic geometry.

## Disposition summary

| Facility ID | Official name | Alternate OSM evidence | Decision |
|---|---|---|---|
| `facility:health:261` | Aahiyans Medical Clinic | Hinnavaru islet only; no clinic/doctor/building facility object in the checked OSM area | `unresolved_island_context_only` |
| `facility:health:12` | Aanugandu Island Resort Clinic | No Nominatim/OSM named candidate; Google Maps returned unrelated Malé clinics | `unresolved_no_osm_candidate` |
| `facility:health:191` | Aarah Clinic | Raa Aarah islet way has `alt_name:en=Heritance Aarah`; no clinic object | `unresolved_island_context_only` |
| `facility:health:199` | Emerald Faarufushi Clinic | Faarufushi islet way, hotel multipolygon, and building footprints; no clinic object | `unresolved_island_context_only` |
| `facility:health:41` | Emerald Maldives Resort Clinic | Fasmendhoo islet way has Emerald resort alternate name; no clinic object | `unresolved_island_context_only` |
| `facility:health:28` | Eri Maldives Clinic | `Eri Maldives` OSM hotel is a resort object and conflicts with HEMS urban Malé address | `rejected_candidate_unresolved` |
| `facility:health:239` | Eriyadu Clinic Closed | Eriyadu resort context (`Eriyadu` bar node / `Eri Maldives` hotel); no clinic object | `unresolved_island_context_only` |
| `facility:health:246` | Esma Dhivehi Beys Clinic Closed | Google has active and permanently-closed place results; no matching OSM clinic object | `rejected_candidate_unresolved` |
| `facility:health:394` | European Clinic Maldives Closed | Exact OSM clinic node and Google permanently-closed place agree | `reviewed_osm_match` |
| `facility:health:760` | Eve Clinic | No exact Google Maps result or OSM EVE clinic object; other Eve branches are distinct records | `unresolved_no_osm_candidate` |

## Per-record evidence and decision

### `facility:health:261` — Aahiyans Medical Clinic

- **Official HEMS:** establishment 261; General Clinic; owner `Aahiyans Pvt Ltd (C-0615/2011)`; registration `HF-21/ALT/PVT/588`; license `PVT-GC-21-083-00`; contacts `7933326 / 7783818`.
- **Official address:** Maaharaa facility directory lists `Aahiyaa, Lh. Hinnavaru`.
- **Google Maps discovery:** exact query returned no Aahiyans result; it surfaced unrelated `HIYAA MEDICAL CENTER` in Hulhumalé and `Dhivehi Beys Clinic` in Hulhumalé. These are not identity matches.
- **Nominatim:** exact clinic search returned no result. OSM map check around Hinnavaru found the islet way and ferry-route ways, but no named clinic, doctor, hotel/resort, office, or facility building suitable for this record.
- **OSM context:** [way 441740990](https://www.openstreetmap.org/way/441740990), `name:en=Hinnavaru`, `place=islet`.
- **Decision:** retain official record with Hinnavaru as context only. Do not assign island geometry or any unrelated Malé clinic.

### `facility:health:12` — Aanugandu Island Resort Clinic

- **Official HEMS:** establishment 12; General Clinic; owner `Promonant Private Limited`; registration `HF-25/ALP/PVT/837`; license `PVT-GC-25-560-00`; contact `3300668`.
- **Official address:** Maaharaa lists `Aanugandu Island Resort Clinic`, `K. Male'`.
- **Google Maps discovery:** exact query returned only unrelated `Island Polyclinic` and `AMDC Clinic` in Malé; no Aanugandu place card.
- **Nominatim/OSM:** exact and broad `Aanugandu` searches returned no candidate. No safe OSM island, hotel, resort, office, or building candidate was found under that name.
- **Decision:** unresolved; retain official record and do not infer an island or map a generic Malé clinic.

### `facility:health:191` — Aarah Clinic

- **Official HEMS:** establishment 191; General Clinic; owner `Cowrie Investment Pvt Ltd`; registration `HF-22/ALP/PVT/658`; license `PVT-GC-22-249-00`; contact `3315236`.
- **Official address:** Maaharaa lists `Aarah, Raa Atoll`.
- **Google Maps discovery:** exact clinic query returned unrelated Malé clinics; no Aarah Clinic result.
- **Nominatim:** `Aarah` produced three distinct islet candidates, so name-only matching is ambiguous. The Raa-atoll candidate is at approximately `5.4475,72.9411`.
- **OSM context:** [way 19879650](https://www.openstreetmap.org/way/19879650) is `Aarah`, `is_in:archipelago=Raa`, with `alt_name:en=Heritance Aarah`; OSM nearby check found no clinic object. The Kaafu and Vaavu Aarah candidates are different islands and were rejected by atoll/name context.
- **Decision:** retain Raa Aarah as island/resort context only. Do not map the clinic to the islet/resort polygon.

### `facility:health:199` — Emerald Faarufushi Clinic

- **Official HEMS:** establishment 199; General Clinic; owner `Emil Resort Private Limited`; registration `HF-22/ALP/PVT/650`; license `PVT-GC-23-354-00`; contact `3333644`.
- **Official address:** Maaharaa lists `Faarufushi Island, Raa Atoll, Maldives`.
- **Google Maps discovery:** query resolved to `Emerald Faarufushi Resort & Spa`, `Faarufushi Island, 20002`, website `emerald-faarufushi.com`; this verifies resort context, not clinic geometry.
- **Nominatim/OSM:** Faarufushi resolves to islet way `19879582` at approximately `5.76786,72.96547`.
- **OSM context:** [way 19879582](https://www.openstreetmap.org/way/19879582) has `alt_name:en=Faarufushi Maldives` and the resort website; [relation 19282045](https://www.openstreetmap.org/relation/19282045) is an unnamed `tourism=hotel` multipolygon; nearby OSM also has many `building=yes` footprints. No clinic/doctor object was found.
- **Decision:** retain Faarufushi/resort context only. Resort polygon, hotel relation, and generic buildings are explicitly not facility geometry.

### `facility:health:41` — Emerald Maldives Resort Clinic

- **Official HEMS:** establishment 41; General Clinic; owner `Emil Resort Pvt Ltd`; registration `HF-24/ALP/PVT/808`; license `PVT-GC-24-528-00`; contact `7979718`.
- **Registry address:** Maaharaa lists `6th Floor, H. Aage, Boduthakurufaanu Magu, Male'`; this is not a clinic-level resort coordinate.
- **Google Maps discovery:** exact query resolved to `Emerald Maldives Resort & Spa`, `Fasmendhoo Island`, website `emerald-maldives.com`, phone `658-2100`.
- **Nominatim/OSM:** Fasmendhoo resolves to islet way `19879687` at approximately `5.49419,72.88166`.
- **OSM context:** [way 19879687](https://www.openstreetmap.org/way/19879687) has `alt_name:en=Emerald Maldives Resort & Spa Fasmendho` and the resort website, but no clinic/hotel facility object in the checked map extract.
- **Decision:** Fasmendhoo/ Emerald resort is a plausible context candidate, but no clinic-level geometry exists. Keep unresolved island context only; do not map the islet polygon.

### `facility:health:28` — Eri Maldives Clinic

- **Official HEMS:** establishment 28; General Clinic; owner `ERI Holding Pvt Ltd`; registration `HF-24/ALP/PVT/821`; license `PVT-GC-24-543-00`; contact `7785842`.
- **Official address:** Maaharaa lists `Kaneeru Villa, Orchid Magu, Male'`.
- **Google Maps discovery:** exact query returned separate `EVE clinic - vinares`, `Eve Clinic`, `EVE CLINIC WESTPARK`, and an `Eri Maldives` hotel result. The hotel is not the official urban clinic address.
- **Nominatim/OSM:** `Eri Maldives` resolves to the resort/hotel way at approximately `4.59004,73.41466`.
- **OSM context/candidate:** [way 19881893](https://www.openstreetmap.org/way/19881893) is explicitly `tourism=hotel`, `building=yes`, `name=Eri Maldives`, with resort website and phone. Nearby [node 583580926](https://www.openstreetmap.org/node/583580926) is `amenity=bar`, `name=Eriyadu`.
- **Decision:** reject the hotel as a clinic mapping. The OSM resort candidate conflicts with the HEMS Malé address and category; retain unresolved.

### `facility:health:239` — Eriyadu Clinic Closed

- **Official HEMS:** establishment 239; closed General Clinic; owner `Platinum Capital Holdings Pvt Ltd (C0702/2005)`; registration `HF-21/ALP/PVT/610`; license `PVT-GC-23-351-00`; contact `3343840`.
- **Official address:** Maaharaa lists `Eriyadu Island Resort, Maldives`.
- **Google Maps discovery:** exact query resolved to the `Eri Maldives` resort/hotel rather than a clinic; this is consistent with a resort rename/context lead, not facility geometry.
- **Nominatim/OSM:** Eriyadu search returned [node 583580926](https://www.openstreetmap.org/node/583580926), `amenity=bar`, `name=Eriyadu`; the same island has [way 19881893](https://www.openstreetmap.org/way/19881893), `tourism=hotel`, `name=Eri Maldives`.
- **Decision:** keep resort/island context only and preserve the closed official record. Do not map a closed clinic to the bar or hotel object.

### `facility:health:246` — Esma Dhivehi Beys Clinic Closed

- **Official HEMS:** establishment 246; closed Traditional Medicine Clinic; owner `Abdulla Rasheed`; registration `HF-21/ALT/PVT/603`; license `PVT-TMC-21-037-00`; contact `7592811`.
- **Google Maps discovery:** exact query returned an active `Dhivehi Beys Clinic` at `Nirolhumagu, 7 No. Goalhi Lot No.10176` and a separate `Dhivehi Beys Clinic` marked `Permanently closed` at Plus Code `5GF5+F9M`. The active/closed duplicate situation is not enough to identify an OSM object.
- **Nominatim/OSM:** exact name search returned no result. Hulhumalé OSM map check found nearby pharmacies, doctors, hospitals, and generic buildings, but no `Dhivehi Beys` clinic object.
- **Decision:** reject the Google place as an OSM mapping candidate; retain closed status as official/Google evidence only and leave unresolved.

### `facility:health:394` — European Clinic Maldives Closed

- **Official HEMS:** establishment 394; closed General Clinic; owner `C.Z MALDIVES PVT LTD (C-1082/2015)`; registration `HF-16/ALP/PVT/455`; license `PVT-GC-21-139-00`; contact `7773716`.
- **Google Maps discovery:** exact place card `European Clinic Maldives`, rating 5.0, `Permanently closed`, address `MAVI Ground floor Hulhumale Lot No 10038 6G9W+QC Hulhumale Malé, 23000`, phone `335-7772`, website `drusamaclinic.com`.
- **OSM exact match:** [node 11186258448](https://www.openstreetmap.org/node/11186258448) has `name:en=European Clinic`, `amenity=clinic`, `healthcare=clinic`, coordinates approximately `4.2194254,73.5461254`. Live OSM API response: version 2, timestamp `2024-03-17T11:06:52Z`.
- **Decision:** `reviewed_osm_match`. Exact name and clinic category match; Google and HEMS independently support the closed status. Use the OSM node as the facility point, not a nearby building/office.

### `facility:health:760` — Eve Clinic

- **Official HEMS:** establishment 760; General Clinic; owner `Fathimath Shenaalee Hussain (A036027)`; registration `HF-12/ALP/PVT/074`; license `PVT-GC-21-077-00`; contacts `7900788 / 3300788`.
- **Official address:** Maaharaa lists `M. Kovarik, K. Male'`.
- **Google Maps discovery:** exact query produced no place card. Separate search results for `EVE clinic - vinares`, `Eve Clinic` on Fareedhee Magu, and `EVE CLINIC WESTPARK` correspond to other HEMS records (`facility:health:886` and `facility:health:92`) and must not be conflated.
- **Nominatim/OSM:** no exact EVE clinic object was found in the checked Malé/Hulhumalé OSM extract; nearby healthcare objects are unrelated.
- **Decision:** unresolved; retain the official record and do not map another Eve branch or a generic building.

## Source endpoints

- HEMS official directory: <https://hems.health.gov.mv/establishments>
- Maaharaa public facility directory: <https://maaharaa.health.gov.mv/Public/Home/ListHealthCare>
- Nominatim search endpoint: <https://nominatim.openstreetmap.org/search>
- OSM API object endpoint: <https://api.openstreetmap.org/api/0.6/{type}/{id}.json>
- Google Maps discovery base: <https://www.google.com/maps/search/?api=1&query=>

## Canonical-file safety

No canonical cache, normalized facility file, or application source file was modified. This is a review artifact only; it records evidence and dispositions without adding guessed clinic geometry.
