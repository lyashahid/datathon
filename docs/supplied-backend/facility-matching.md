# OSM facility matching

The normalized facility output uses conservative matching rules. A facility is
only assigned OSM geometry automatically when the identity is sufficiently
strong and deterministic.

## Current result

| Result | Count |
| --- | ---: |
| Exact normalized-name match | 55 |
| Exact CAA ICAO identifier match | 18 |
| OSM best-effort matches | 28 |
| Manually reviewed obvious matches | 23 |
| Provisional same-island matches | 39 |
| Island-context-only records | 323 |
| OSM-match-review-required records | 104 |
| Source-not-in-OSM records | 250 |
| Reviewable candidate records | 171 |

The source facility total is 840. The two exact-match classes are mutually
exclusive. Every non-exact record is assigned an explicit resolution state;
the pipeline does not leave a generic `unmatched` state behind.

## Automatic matching rules

1. CAA airport records use the official ICAO code when OSM publishes the same
   `icao` tag. This handles spelling differences such as `Kooddoo`/`Kuddoo`.
2. Other records use an exact normalized name, restricted to compatible OSM
   categories.
3. If an official record has a unique island candidate, exact-name and
   best-effort OSM candidates are restricted to that island.
4. High-confidence spelling variants are assigned as `osm_best_effort` and
   retain their similarity score.
5. OSM node/way duplicates are collapsed only when they are on the same island
   and their representative points are near-coincident. Distinct nearby
   facilities remain separate.

The deeper reconciliation pass also checks OSM `alt_name`, `official_name`,
and `short_name` tags, compares distinctive name tokens after removing generic
facility words, and preserves unnamed but unique island-scoped features as
review leads. An OSM object already assigned to an exact or stronger official
record is reserved; weaker duplicate claims remain unresolved.

Candidates that do not meet the reviewed or provisional evidence thresholds
remain in the review artifact. They are stored in:

```text
backend/data/cache/normalized/facility-match-candidates.json
```

Each candidate includes the official facility ID, source name, candidate OSM
object, score, island context, and whether a best-effort assignment was made.

## Complete mapping audit

The full 840-record audit is available at:

```text
backend/data/cache/normalized/facility-mapping-review.json
```

Current audit decisions:

| Decision | Count |
| --- | ---: |
| Accepted exact match | 73 |
| Accepted best-effort match | 28 |
| Accepted manually reviewed match | 23 |
| Provisional match requiring review | 39 |
| Not approved: ambiguous OSM candidate | 104 |
| Not approved: no defensible OSM match | 573 |

Every record has a decision, evidence, priority, and recommended next action.
The not-approved records are not assigned an invented point; ambiguous
candidates retain their competing OSM objects and scores for further
human/source review.

Provisional matches are included in map GeoJSON for MVP coverage, but their
`match_status` is `osm_provisional_review_required` and their
`mapping_review.review_required` flag is true. They are excluded from
deterministic accessibility scoring. If multiple official records point to
one OSM object, the later records retain `provisional_duplicate=true` and the
owning facility ID in the review evidence.

The current queue contains 46 provisional same-island matches requiring
confirmation, 18 records needing an official coordinate to choose among
multiple island features, 305 likely OSM coverage gaps, and 237 records where
the official island or coordinates must be recovered first.

## Why unmatched remains high

- OSM contains 100 named school features versus 220 official school records.
- OSM contains 77 hospital/clinic features versus 601 HEMS records.
- Many HEMS records are resort, branch, or closed-clinic records without a
  structured island field.
- Name similarity alone can produce false matches between different facilities
  or neighboring atolls, so those records remain review-only.

The normalized facility records retain `location_context` and source
attributes to support the next reviewed matching pass. A record with
`island_context_only` has an official island relationship but deliberately has
no facility-level OSM point. A record with `source_not_in_osm` has no defensible
OSM feature or island context. A record with `osm_match_review_required` has
one or more name candidates but requires review before geometry is attached.
