# Timetable import verification

Run `node scripts/verify-timetable-import-browser.mjs` with the frontend running.
The script starts a separate FastAPI process on a temporary local port, using
copies of the retained normalized data, graph cache, derived data and public
planning sources. Its runtime store starts empty. Browser requests are forwarded
to that real backend; response payloads are not mocked.

The timetable fixture is explicitly marked **SYNTHETIC QA ONLY** in its source
title, publisher, licence, limitations, terminal names and service names. It
tests application behavior and is not an operator timetable or planning evidence.
The fixture and accepted snapshot stay inside
`artifacts/qa/timetable-import/isolated-*/`; the saved itinerary is retained in
the same QA artifact directory alongside the report. No synthetic timetable is imported
into the normal application source store.

All eight checks pass:

1. A real isolated API starts with an empty active timetable catalogue.
2. Routing remains disabled before a source is accepted.
3. Uploading JSON stages two services for review without activating them.
4. Acceptance requires both a review note and explicit source acknowledgment.
5. Acceptance persists a receipt and activates exactly the reviewed services.
6. The dated planner finds the two-leg journey and respects the transfer allowance.
7. The accepted source survives reload and the planner works at 390px without
   horizontal overflow.
8. The four protected main source files retain their SHA-256 checksums and the
   main timetable snapshot store remains unchanged.

The QA itinerary starts on 14 October 2026 at 07:30 Maldives time. Its synthetic
Malé–Hulhumalé leg departs at 08:00 and arrives at 09:00, followed by a synthetic
Hulhumalé–Vilimalé leg from 09:40 to 10:15. The result correctly reports 165
elapsed minutes and waiting times of 30 and 40 minutes with a 30-minute transfer
allowance. These times describe the test fixture only.

The machine-readable report and desktop/mobile screenshots are retained in
`artifacts/qa/timetable-import/`. The latest successful run has eight passed
checks and no browser page errors. The report includes before/after main source
checksums and accepted-source counts so isolation can be reviewed directly.
