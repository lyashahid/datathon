# Alternate-category OSM investigation — 10 unresolved HEMS health centres

Accessed 2026-10-13. Canonical files modified: **no**.

## Outcome

- Safe OSM mappings accepted: **0/10**.
- Exact Google Maps island-specific place evidence but no defensible facility-level OSM object: **7**.
- Island-context-only after no exact Google result and no OSM health object: **3**.
- Maamigili had one nearby unnamed `amenity=pharmacy` node; it was rejected, not mapped.
- Alternate checks covered `amenity=clinic|hospital|doctors|pharmacy`, `healthcare=*`, health-specific `building=*`, `office=doctor`, and health/clinic/hospital/medical/pharmacy/dispensary/centre/center/post name tokens.
- Combined Overpass query was attempted against two public mirrors; `overpass-api.de` returned HTTP 504 and `overpass.kumi.systems` timed out. No Overpass-only candidate was accepted.

## facility:health:716 — A.A. Maalhos Health Centre
- Official context: Maalhos (Alifu Alifu); HEMS source record `716`.
- Google Maps: **exact_place**; AA.Maalhos Health Center; XPPC+RPV, aa. male, Maalhos.
- OSM scan: [https://api.openstreetmap.org/api/0.6/map?bbox=72.7128639,3.9829854,72.7251716,3.9899609](https://api.openstreetmap.org/api/0.6/map?bbox=72.7128639,3.9829854,72.7251716,3.9899609); HTTP 200; no defensible facility-level health object.
- Decision: **source_not_in_osm**; confidence **high**; safe mapping **no**.
- Evidence: Google Maps supplied an exact island-specific place (AA.Maalhos Health Center) but the live OSM island bbox scan found no defensible facility-level object under alternate health tags; no facility-level OSM candidate was found.
- Sources: [HEMS](https://hems.health.gov.mv/establishments), [public health list](https://maaharaa.health.gov.mv/Public/Home/ListHealthCare), [Google Maps search](https://www.google.com/maps/search/?api=1&query=A.A.+Maalhos+Health+Centre+Maldives).

## facility:health:500 — A.Dh Dhidhoo Health Centre
- Official context: Dhidhdhoo (Alifu Dhaalu); HEMS source record `500`.
- Google Maps: **no_exact_place**; no exact place; Search list showed unrelated Dh. Meedhoo, Thulusdhoo, A Dh Dhigurah and a generic Health Center; no Dhidhdhoo place card.
- OSM scan: [https://api.openstreetmap.org/api/0.6/map?bbox=72.8725699,3.4793849,72.8861677,3.4906407](https://api.openstreetmap.org/api/0.6/map?bbox=72.8725699,3.4793849,72.8861677,3.4906407); HTTP 200; no defensible facility-level health object.
- Decision: **island_context_only**; confidence **medium-high**; safe mapping **no**.
- Evidence: Official HEMS/OneMap island context is retained, but Google Maps did not return an exact place and the live OSM island bbox scan found no health/medical facility object. Keep island context only; do not invent geometry.
- Sources: [HEMS](https://hems.health.gov.mv/establishments), [public health list](https://maaharaa.health.gov.mv/Public/Home/ListHealthCare), [Google Maps search](https://www.google.com/maps/search/?api=1&query=A.Dh+Dhidhoo+Health+Centre+Maldives).

## facility:health:504 — A.Dh Maamigilee Health Centre
- Official context: Maamigili (Alifu Dhaalu); HEMS source record `504`.
- Google Maps: **exact_place**; Maamigili Health Centre; Ameenee Magu, Maamigili 00100; FRGQ+H5 Maamigili.
- OSM scan: [https://api.openstreetmap.org/api/0.6/map?bbox=72.8152023,3.4673091,72.8472307,3.4840836](https://api.openstreetmap.org/api/0.6/map?bbox=72.8152023,3.4673091,72.8472307,3.4840836); HTTP 200; nearby candidate rejected: `osm:node:12925283001`, `amenity=pharmacy`, [API](https://api.openstreetmap.org/api/0.6/node/12925283001.json), [browse](https://www.openstreetmap.org/node/12925283001).
- Decision: **source_not_in_osm**; confidence **high**; safe mapping **no**.
- Evidence: Google Maps supplied an exact island-specific place (Maamigili Health Centre) but the live OSM island bbox scan found no defensible facility-level object under alternate health tags; the nearby pharmacy candidate is rejected.
- Sources: [HEMS](https://hems.health.gov.mv/establishments), [public health list](https://maaharaa.health.gov.mv/Public/Home/ListHealthCare), [Google Maps search](https://www.google.com/maps/search/?api=1&query=A.Dh+Maamigilee+Health+Centre+Maldives).

## facility:health:501 — A.Dh Mandhoo Health Centre
- Official context: Mandhoo (Alifu Dhaalu); HEMS source record `501`.
- Google Maps: **no_exact_place**; no exact place; Search list showed unrelated Dh. Meedhoo, Baa Fehendhoo, ADK Hospital, A Dh Dhigurah and a Male clinic; no Mandhoo place card.
- OSM scan: [https://api.openstreetmap.org/api/0.6/map?bbox=72.7057436,3.6901506,72.7142757,3.7056995](https://api.openstreetmap.org/api/0.6/map?bbox=72.7057436,3.6901506,72.7142757,3.7056995); HTTP 200; no defensible facility-level health object.
- Decision: **island_context_only**; confidence **medium-high**; safe mapping **no**.
- Evidence: Official HEMS/OneMap island context is retained, but Google Maps did not return an exact place and the live OSM island bbox scan found no health/medical facility object. Keep island context only; do not invent geometry.
- Sources: [HEMS](https://hems.health.gov.mv/establishments), [public health list](https://maaharaa.health.gov.mv/Public/Home/ListHealthCare), [Google Maps search](https://www.google.com/maps/search/?api=1&query=A.Dh+Mandhoo+Health+Centre+Maldives).

## facility:health:635 — AA. Himandhoo Health center
- Official context: Himandhoo (Alifu Alifu); HEMS source record `635`.
- Google Maps: **exact_place**; Himandhoo Health Center; WPCV+2MV, Beach Rd, Himandhoo 09080.
- OSM scan: [https://api.openstreetmap.org/api/0.6/map?bbox=72.7391727,3.9176055,72.7496675,3.9248661](https://api.openstreetmap.org/api/0.6/map?bbox=72.7391727,3.9176055,72.7496675,3.9248661); HTTP 200; no defensible facility-level health object.
- Decision: **source_not_in_osm**; confidence **high**; safe mapping **no**.
- Evidence: Google Maps supplied an exact island-specific place (Himandhoo Health Center) but the live OSM island bbox scan found no defensible facility-level object under alternate health tags; no facility-level OSM candidate was found.
- Sources: [HEMS](https://hems.health.gov.mv/establishments), [public health list](https://maaharaa.health.gov.mv/Public/Home/ListHealthCare), [Google Maps search](https://www.google.com/maps/search/?api=1&query=AA+Himandhoo+Health+Centre+Maldives).

## facility:health:712 — F. Biledhoo Health Centre
- Official context: Bileiydhoo (Faafu); HEMS source record `712`.
- Google Maps: **exact_place**; Bilehdhoo Health Center; 4X9J+QRQ, Bileiydhoo.
- OSM scan: [https://api.openstreetmap.org/api/0.6/map?bbox=72.9787264,3.1136314,72.9890096,3.1231564](https://api.openstreetmap.org/api/0.6/map?bbox=72.9787264,3.1136314,72.9890096,3.1231564); HTTP 200; no defensible facility-level health object.
- Decision: **source_not_in_osm**; confidence **high**; safe mapping **no**.
- Evidence: Google Maps supplied an exact island-specific place (Bilehdhoo Health Center) but the live OSM island bbox scan found no defensible facility-level object under alternate health tags; no facility-level OSM candidate was found.
- Sources: [HEMS](https://hems.health.gov.mv/establishments), [public health list](https://maaharaa.health.gov.mv/Public/Home/ListHealthCare), [Google Maps search](https://www.google.com/maps/search/?api=1&query=F+Biledhoo+Health+Centre+Maldives).

## facility:health:490 — F. Dharanboodhoo Health Centre
- Official context: Dharanboodhoo (Faafu); HEMS source record `490`.
- Google Maps: **exact_place**; Dharanboodhoo health centre; 3W7G+HG8, Lilee Magu, Dharanboodhoo.
- OSM scan: [https://api.openstreetmap.org/api/0.6/map?bbox=72.9180577,3.0592778,72.9328642,3.0668099](https://api.openstreetmap.org/api/0.6/map?bbox=72.9180577,3.0592778,72.9328642,3.0668099); HTTP 200; no defensible facility-level health object.
- Decision: **source_not_in_osm**; confidence **high**; safe mapping **no**.
- Evidence: Google Maps supplied an exact island-specific place (Dharanboodhoo health centre) but the live OSM island bbox scan found no defensible facility-level object under alternate health tags; no facility-level OSM candidate was found.
- Sources: [HEMS](https://hems.health.gov.mv/establishments), [public health list](https://maaharaa.health.gov.mv/Public/Home/ListHealthCare), [Google Maps search](https://www.google.com/maps/search/?api=1&query=F+Dharanboodhoo+Health+Centre+Maldives).

## facility:health:641 — F. Feeali Health Center
- Official context: Feeali (Faafu); HEMS source record `641`.
- Google Maps: **no_result**; no exact place; Limited-view Maps page returned no text/place result for this query.
- OSM scan: [https://api.openstreetmap.org/api/0.6/map?bbox=72.9971673,3.2661143,73.0058407,3.2737925](https://api.openstreetmap.org/api/0.6/map?bbox=72.9971673,3.2661143,73.0058407,3.2737925); HTTP 200; no defensible facility-level health object.
- Decision: **island_context_only**; confidence **medium-high**; safe mapping **no**.
- Evidence: Official HEMS/OneMap island context is retained, but Google Maps did not return an exact place and the live OSM island bbox scan found no health/medical facility object. Keep island context only; do not invent geometry.
- Sources: [HEMS](https://hems.health.gov.mv/establishments), [public health list](https://maaharaa.health.gov.mv/Public/Home/ListHealthCare), [Google Maps search](https://www.google.com/maps/search/?api=1&query=F+Feeali+Health+Center+Maldives).

## facility:health:585 — GA. Dhevvadhoo Health Centre
- Official context: Dhevvadhoo (Gaafu Alifu); HEMS source record `585`.
- Google Maps: **exact_place**; Dhevvadhoo Health Centre; H64R+JCH, Dhevvadhoo.
- OSM scan: [https://api.openstreetmap.org/api/0.6/map?bbox=73.2375153,0.5528761,73.2466846,0.5607730](https://api.openstreetmap.org/api/0.6/map?bbox=73.2375153,0.5528761,73.2466846,0.5607730); HTTP 200; no defensible facility-level health object.
- Decision: **source_not_in_osm**; confidence **high**; safe mapping **no**.
- Evidence: Google Maps supplied an exact island-specific place (Dhevvadhoo Health Centre) but the live OSM island bbox scan found no defensible facility-level object under alternate health tags; no facility-level OSM candidate was found.
- Sources: [HEMS](https://hems.health.gov.mv/establishments), [public health list](https://maaharaa.health.gov.mv/Public/Home/ListHealthCare), [Google Maps search](https://www.google.com/maps/search/?api=1&query=GA+Dhevvadhoo+Health+Centre+Maldives).

## facility:health:589 — GA. Gemanafushi Health Centre
- Official context: Gemanafushi (Gaafu Alifu); HEMS source record `589`.
- Google Maps: **exact_place**; Gemanafushi Health Center; CHR8+XX4, Gemanafushi.
- OSM scan: [https://api.openstreetmap.org/api/0.6/map?bbox=73.5637282,0.4334633,73.5727517,0.4509902](https://api.openstreetmap.org/api/0.6/map?bbox=73.5637282,0.4334633,73.5727517,0.4509902); HTTP 200; no defensible facility-level health object.
- Decision: **source_not_in_osm**; confidence **high**; safe mapping **no**.
- Evidence: Google Maps supplied an exact island-specific place (Gemanafushi Health Center) but the live OSM island bbox scan found no defensible facility-level object under alternate health tags; no facility-level OSM candidate was found.
- Sources: [HEMS](https://hems.health.gov.mv/establishments), [public health list](https://maaharaa.health.gov.mv/Public/Home/ListHealthCare), [Google Maps search](https://www.google.com/maps/search/?api=1&query=GA+Gemanafushi+Health+Centre+Maldives).
