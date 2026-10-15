# Facility Mapping Audit

Generated: 2026-10-13T10:55:40.445230+00:00

Scope: 840 official facilities; 172 mapped facilities; 169 unique OSM objects.

## Findings
- **weak_name_overlap**: 18
- **duplicate_osm_claim**: 5

## Duplicate OSM claims
- `osm:node:9951457715` Advance Medical Clinic: facility:health:397 — Advance Eye Clinic; facility:health:1223 — Advance Hospital; facility:health:471 — Advance Medical Clinic
- `osm:node:9951500245` Central Clinic: facility:health:809 — Central Clinic; facility:health:633 — Central Medical Center

## Explicitly rejected false mappings detached by the normalizer
- DETACHED `facility:health:86` → `osm:way:465261759`: Private resort clinic was attached to the public Dhigurah Medical Post; official operator and facility identity conflict.
- DETACHED `facility:health:1483` → `osm:node:4174150465`: Private Mathiveri Eesa Clinic was attached to the government Mathiveri Health Centre; operator and name conflict.
- DETACHED `facility:health:1483` → `osm:way:1066957223`: Second candidate is another representation of the government Mathiveri Health Centre; reject all current candidates for the private clinic.
- DETACHED `facility:school:634` → `osm:way:1323678631`: Second candidate is Aminiya School, also a different official school; reject all current candidates for Jamaluddin School.
- DETACHED `facility:school:654` → `osm:node:12196297366`: Villa International High School is a different school; reject the only candidate.
- DETACHED `facility:health:1392` → `osm:node:4823302223`: EyeCare Clinic Kulhudhuffushi Branch was attached to Kulhudhuffushi Regional Hospital; name/operator/category conflict.
- DETACHED `facility:health:275` → `osm:node:4823302223`: Vital Care Kulhudhuffushi Anex was attached to Kulhudhuffushi Regional Hospital; name/operator/category conflict.
- DETACHED `facility:health:469` → `osm:way:679843731`: Four Seasons resort clinic was attached to the public K. Huraa Health Centre; operator and identity conflict.
- DETACHED `facility:health:115` → `osm:way:679843731`: Hakuraa Medical Centre was attached to the public K. Huraa Health Centre; operator and identity conflict.
- DETACHED `facility:health:1259` → `osm:way:216221235`: Private Maafushi Pain Clinic was attached to the public Kaafu Maafushi Health Centre; name/operator conflict.
- DETACHED `facility:health:153` → `osm:way:590298924`: Private Naifaru Medical Center was attached to Lhaviyani Atoll Hospital; name/operator conflict.
- DETACHED `facility:health:244` → `osm:node:14267725202`: Closed private My Lab facility was attached to the public Dharavandhoo Medical Centre; identity and operator conflict.
- DETACHED `facility:health:1627` → `osm:node:12462668301`: Private Bluspan Care Thulusdhoo was attached to the unnamed public Thulusdhoo hospital object; no identity evidence.
- DETACHED `facility:health:236` → `osm:node:9532890185`: Fuvahmulah Medical Centre was attached to a drug-treatment/detoxification object; facility identity and category conflict.
- DETACHED `facility:health:50` → `osm:node:6294957686`: My Family Dentist Male' was attached to the unrelated Family Care clinic; exact facility name and operator conflict.
- DETACHED `facility:health:42` → `osm:node:14267725202`: Private Dharavandhoo Medical Center was attached to the public Dharavandhoo Medical Centre; operator and identity conflict.
- DETACHED `facility:school:599` → `osm:way:364882221`: Mukurimagu School was attached to Hamadh School Ground, a different named school context on the same island.
- DETACHED `facility:school:600` → `osm:way:364882221`: Ihadhdhoo School was attached to Hamadh School Ground, a different named school context on the same island.
- DETACHED `facility:school:634` → `osm:node:4866622621`: Jamaluddin School was attached to Imaduddin School; exact school identity conflict.
- DETACHED `facility:school:636` → `osm:node:4866622621`: Thaajuddeen School was attached to Imaduddin School; exact school identity conflict.
- DETACHED `facility:school:639` → `osm:way:1323678631`: Majeediyya School was attached to Aminiya School; exact school identity conflict.
- DETACHED `facility:school:641` → `osm:way:1323678631`: Hiriya School was attached to Aminiya School; exact school identity conflict.
- DETACHED `facility:school:647` → `osm:way:697262511`: Huravee School was attached to Ghaazee School; exact school identity conflict.
- DETACHED `facility:school:649` → `osm:node:14268489201`: Mohamed Qasim Preschool was attached to Shaheed Ali School; exact school identity conflict.
- DETACHED `facility:health:715` → `osm:way:1133986301`: Unnamed pharmacy is not the Omadhoo Health Centre.
- DETACHED `facility:health:511` → `osm:way:1001663721`: Unnamed hospital building lacks health-centre identity; do not attach by island/category alone.
- DETACHED `facility:health:512` → `osm:way:1069271437`: Unnamed pharmacy building is not a health-centre identity.
- DETACHED `facility:school:492` → `osm:way:1038348911`: Dhuvaafaru Primary School is the distinct Ministry school record 506, not R. Atoll School; same-island name conflict.
- DETACHED `facility:health:133` → `osm:node:10142752042`: Hussan Abdul Samad memorial clinic conflicts with the supplied JP Hospital identity and has no operator/address linkage.
- DETACHED `facility:health:509` → `osm:node:7208742187`: Vaavu Atoll Hospital is a different hospital identity, not V. Keyodhoo Health Centre.
- DETACHED `facility:health:504` → `osm:node:12925283001`: Unnamed pharmacy is not A.Dh Maamigilee Health Centre.
- DETACHED `facility:health:577` → `osm:way:672670311`: Thoddoo Hospital is on a different island from official GDh. Hoadedhoo Health Centre; reject cross-island attachment.
- DETACHED `facility:health:577` → `osm:node:3979112656`: Dhaandhoo Health Centre is on a different island from official GDh. Hoadedhoo Health Centre; reject cross-island attachment.
- DETACHED `facility:health:577` → `osm:way:1323805892`: N. Holhudhoo Health Center is on a different island from official GDh. Hoadedhoo Health Centre; reject cross-island attachment.
- DETACHED `facility:health:577` → `osm:node:10196643638`: Thakandhoo Health Center is on a different island from official GDh. Hoadedhoo Health Centre; reject cross-island attachment.
- DETACHED `facility:health:577` → `osm:way:976103994`: Ga. Maamendhoo Health Centre is on a different island from official GDh. Hoadedhoo Health Centre; reject cross-island attachment.
- DETACHED `facility:health:579` → `osm:way:1104753218`: Faresmaathodaa fire station is unrelated to the official GDh. Faresmaathodaa Health Centre.
- DETACHED `facility:health:580` → `osm:way:751750170`: Unnamed healthcare=yes building on Fiyoaree has no facility identity, name, operator, or address linking it to the official health centre.
- DETACHED `facility:health:580` → `osm:node:11221812118`: Fiyoaree School is unrelated to the official GDh. Fiyoaree Health Centre.
- DETACHED `facility:health:580` → `osm:way:1467225959`: Unnamed Muslim place-of-worship building is unrelated to the official GDh. Fiyoaree Health Centre.
- DETACHED `facility:health:580` → `osm:way:1467225960`: Unnamed Muslim place-of-worship building is unrelated to the official GDh. Fiyoaree Health Centre.
- DETACHED `facility:health:697` → `osm:way:1478463933`: Vaadhoo school feature is category-incompatible and unrelated to the official Raa Vaadhoo Health Centre.
- DETACHED `facility:health:697` → `osm:way:1478463934`: Vaadhoo school feature is category-incompatible and unrelated to the official Raa Vaadhoo Health Centre.
- DETACHED `facility:health:697` → `osm:way:1478463935`: Vaadhoo school feature is category-incompatible and unrelated to the official Raa Vaadhoo Health Centre.
- DETACHED `facility:health:697` → `osm:way:1478463936`: Vaadhoo school feature is category-incompatible and unrelated to the official Raa Vaadhoo Health Centre.
- DETACHED `facility:health:697` → `osm:way:1478463937`: Vaadhoo school feature is category-incompatible and unrelated to the official Raa Vaadhoo Health Centre.
- DETACHED `facility:health:697` → `osm:way:1478463938`: Vaadhoo school feature is category-incompatible and unrelated to the official Raa Vaadhoo Health Centre.
- DETACHED `facility:health:697` → `osm:way:1478463939`: Vaadhoo school feature is category-incompatible and unrelated to the official Raa Vaadhoo Health Centre.
- DETACHED `facility:health:697` → `osm:way:1478463940`: Vaadhoo school feature is category-incompatible and unrelated to the official Raa Vaadhoo Health Centre.
- DETACHED `facility:health:708` → `osm:way:791616201`: Tha Atoll Education Centre is a school, not the official Th. Thimarafushi Health Centre.
- DETACHED `facility:health:739` → `osm:way:759001101`: Kanditheemu harbor is unrelated to Shaviyani Kan'ditheemu Health Centre.
- DETACHED `facility:health:740` → `osm:way:755987461`: Narudhoo harbor is unrelated to Shaviyani Narudhoo Health Centre.
- DETACHED `facility:school:463` → `osm:node:4823483321`: Nolhivaranfaru Health post is a hospital/health facility, not Nolhivaranfaru School.
- DETACHED `facility:school:513` → `osm:way:19879283`: Kamadhoo island coastline/islet object is not Kamadhoo School geometry.
- DETACHED `facility:school:514` → `osm:way:19879500`: Kendhoo island coastline/islet object is not Kendhoo School geometry.
- DETACHED `facility:school:516` → `osm:way:19879572`: Kudarikilu island coastline/islet object is not Kudarikilu School geometry.
- DETACHED `facility:school:517` → `osm:way:19879346`: Maalhos island coastline/islet object is not Maalhohu School geometry.
- DETACHED `facility:school:518` → `osm:way:176651325`: Fehendhoo island coastline/islet object is not Fehendhoo School geometry.
- DETACHED `facility:school:519` → `osm:way:19879690`: Thulhaadhoo island coastline/islet object is not Thulhaadhoo School geometry.
- DETACHED `facility:school:520` → `osm:way:441740990`: Hinnavaru island coastline/islet object is not Lh. Atoll Education Centre geometry.
- DETACHED `facility:school:521` → `osm:way:19879351`: Kurendhoo island coastline/islet object is not Lh. Atoll school geometry.
- DETACHED `facility:school:522` → `osm:way:19879413`: Olhuvelifushi island coastline/islet object is not Olhuvelifushi School geometry.
- DETACHED `facility:school:530` → `osm:way:19882022`: Gaafaru island coastline/islet object is not Gaafaru School geometry.

## Review-required mapped records
- `facility:health:495` AA. Bodufolhudhoo Health Centre → `osm:way:1066962466` hospital [osm_provisional_review_required]
- `facility:health:654` F.Magoodhoo Health Centre → `osm:node:11633175417` (unnamed) [osm_provisional_review_required]
- `facility:health:581` GDh. Vaadhoo Health Centre → `osm:node:5729756639` (unnamed) [osm_provisional_review_required]
- `facility:health:743` Haa Alifu Uligan Health Centre → `osm:node:12319802702` (unnamed) [osm_provisional_review_required]
- `facility:health:693` K. Thulusdhoo Health Centre → `osm:node:12462668301` (unnamed) [osm_provisional_review_required]
- `facility:health:510` K.Gulhi Health Centre → `osm:way:384227881` Island Clinic [osm_provisional_review_required]
- `facility:health:545` L. Fonadhoo Health Centre → `osm:way:364915911` Health Centre [osm_provisional_review_required]
- `facility:health:600` Shaviyani Milandhoo Health Centre → `osm:way:298204771` Health Centre [osm_provisional_review_required]
- `facility:health:539` TH. Kin'bidhoo health Centre → `osm:way:650454845` ކިބިދޫ ސިއްޙީ މަރުކަޒު [osm_provisional_review_required]
- `facility:health:126` Ellaidhoo Clinic → `osm:way:143013442` Clinic [osm_provisional_review_required]
- `facility:school:440` Ha. Atoll school → `osm:node:4721519795` (unnamed) [osm_provisional_review_required]
- `facility:school:497` Kinolhahu School → `osm:node:9620924475` (unnamed) [osm_provisional_review_required]
- `facility:school:533` Aa. Atoll Education Centre → `osm:node:9283732117` (unnamed) [osm_provisional_review_required]
- `facility:school:534` Aa. Atoll School → `osm:way:1066958751` Alif ALif Atoll School [osm_provisional_review_required]
- `facility:school:556` M. Atoll Education Center → `osm:node:4340333890` MAEC [osm_provisional_review_required]
- `facility:school:566` F. Magoodhoo School → `osm:node:11631471886` (unnamed) [osm_provisional_review_required]
