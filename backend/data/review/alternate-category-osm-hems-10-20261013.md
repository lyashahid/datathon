# Alternate-category OSM review — 10 unresolved HEMS clinic/optical records

**Reviewed:** 2026-10-13T03:21:26Z  
**Canonical files modified:** no  
**Safe OSM geometry changes:** 0/10

## Outcome

- **1 provisional candidate:** `facility:health:428` Eye Care Opticals → OSM node `12289743584`, exact name and Fareedhee Magu context, but only `shop=optician`; keep review-required and outside canonical deterministic mappings.
- **1 rejected duplicate/closed-vs-active candidate:** `facility:health:796` closed Eye Care Clinic Fareedhee Magu must not be mapped to the active-looking `Eye Care Opticals` node used as the candidate for record 428.
- **8 records remain unresolved:** no exact facility-level OSM representation was found after checking `name`, `name:en`, `alt_name`, `operator`, `amenity`, `healthcare`, `shop`, `office`, `building`, Nominatim, and targeted Overpass area scans.
- Nearby hospitals, pharmacies, optical shops, government offices, court buildings, resort/island context, and generic buildings were retained as context or explicitly rejected—not used as clinic geometry.

## Disposition table

| Facility | Official HEMS identity/status | Alternate OSM evidence | Decision |
|---|---|---|---|
| `facility:health:92` | Eve Clinic West Park; open; HF-24/ALP/PVT/758 | No exact object. HEMS lists distinct Eve Clinic and Eve Clinic Vinares records; other Eve results rejected as branch conflation. | `unresolved_no_osm_candidate` |
| `facility:health:796` | Eye Care Clinic, Fareedhee Magu Branch; **closed**; HF-11/ALP/PVT/038 | `node:12289743584` is `Eye Care Opticals`, `shop=optician`, and belongs to the separate optical record 428. | `rejected_candidate_keep_unresolved` |
| `facility:health:428` | Eye Care Opticals; open; HF-14/ALP/PVT/416 | `node:12289743584`, `name=Eye Care Opticals`, `shop=optician`, 4.1780459, 73.5099048; second Hulhumale optical node `13414962127` rejected as separate branch/context. | `osm_provisional_review_required` |
| `facility:health:56` | Eye to Eye Opticals & Clinic; open; HF-24/ALP/PVT/793 | Other Male optical shops (`Vision Opticals`, `Advance Optical`) lack Eye to Eye identity, operator, or address. | `unresolved_no_osm_candidate` |
| `facility:health:46` | Eye to Eye Opticals & Clinic 2; open; HF-24/ALP/PVT/803 | No Eye to Eye 2 OSM object; do not merge with record 56 or another optical shop. | `unresolved_no_osm_candidate` |
| `facility:health:25` | Eye Zone Clinic; open; HF-24/ALP/PVT/824 | GDh. Thinadhoo scan found hospital/stadium/government context only; no Eye Zone or optical object. | `unresolved_no_osm_candidate` |
| `facility:health:1393` | EyeCare Clinic Laamu Branch; open; HF-26/ALP/PVT/902 | Laamu Gan/Mathimaradhoo scan found L. Gan Regional Hospital and generic hospital context only. | `unresolved_source_not_in_current_osm_coverage` |
| `facility:health:457` | F & C Medicare and Scan Center; open; HF-12/ALP/PVT/387 | No F & C scan-center object in the Male scan. Hithadhoo `F & C Chemist 3` is `amenity=pharmacy` and a different identity. | `unresolved_source_not_in_current_osm_coverage` |
| `facility:health:277` | F & C Medicare, Meedhoo; open; HF-20/ALP/PVT/572 | S. Meedhoo/Hulhumeedhoo scan found HMHC and pharmacies only; no F & C clinic object. | `unresolved_source_not_in_current_osm_coverage` |
| `facility:health:366` | Family Relationship Services; open; HF-17/ALP/PVT/483 | Family Court, Family Protection Authority, and Ministry offices are unrelated context; no exact clinic object. | `unresolved_no_osm_candidate` |

## Identity and duplicate checks

- HEMS page 10 distinguishes **Eve Clinic**, **Eve Clinic Vinares**, and **Eve Clinic West Park**; they have different registrations/owners and must not be collapsed.
- HEMS page 10 distinguishes **Eye Care Clinic**, the **closed Fareedhee Magu Branch**, **Eye Care Hospital**, and **Eye Care Opticals**. The OSM optical node is not evidence for the closed clinic.
- HEMS page 10 gives separate registrations for **Eye to Eye Opticals & Clinic** and **Eye to Eye Opticals & Clinic 2**.
- HEMS page 11 gives separate records for **F & C Medicare**, **F & C Medicare and Scan Center**, and **F & C Medicare, Meedhoo** even though the owner/contact are shared.
- `EyeCare Clinic Laamu Branch` is a distinct newer HEMS registration from the Addu and Kulhudhuffushi branches.

## Evidence and queries

- Live HEMS directory pages: [page 10](https://hems.health.gov.mv/establishments?page=10), [page 11](https://hems.health.gov.mv/establishments?page=11), [page 12](https://hems.health.gov.mv/establishments?page=12).
- Official health-facility directory and address discovery: [Maaharaa](https://maaharaa.health.gov.mv/Public/Home/ListHealthCare).
- Regulatory cross-checks: the indexed [HPA private-facilities listing](https://hpa.gov.mv/wp-content/uploads/2025/03/Private-Health-Facilities.pdf) and [EyeCare branch information](https://eyecare.mv/branches). The HPA PDF URL returned HTTP 404 when fetched directly during this review, so live HEMS was used as the current status/identity source; HPA evidence remains secondary context.
- OSM candidate API: [node 12289743584](https://api.openstreetmap.org/api/0.6/node/12289743584.json), [node 13414962127](https://api.openstreetmap.org/api/0.6/node/13414962127.json), [node 9886526803](https://api.openstreetmap.org/api/0.6/node/9886526803.json).
- Nominatim exact and variant searches were run for every target name and broad brand variants; only `Eye Care Opticals` returned an exact named object.
- Targeted Overpass scans covered Male/Hulhumale, GDh. Thinadhoo, Laamu Gan/Mathimaradhoo, S. Meedhoo/Hulhumeedhoo, and Hithadhoo, querying names and alternate categories/tags listed above.

## Safe follow-up

Keep the JSON ledger as review evidence only. The only candidate worth human follow-up is `node:12289743584` for record 428; confirm official coordinates/operator or update OSM category before any canonical mapping. Leave the other nine records unresolved and preserve official HEMS status, especially the closed record 796.
