# Batched facility review

`python -m app.cli batch-review` automates the repeatable parts of online reconciliation while leaving identity decisions evidence-backed.

## 1. Prepare parallel jobs

```text
uv run python -m app.cli batch-review prepare --batch-size 10 --batches 4
```

This selects unresolved facilities not already present in a completed batch, evidence artifact, provisional artifact, or queued job. It writes:

- `data/review/batches/<batch-id>.queue.json`
- `data/review/batches/<job-id>.prompt.md`

Queued IDs are reserved so a second prepare run does not duplicate work.

## 2. Run evidence workers

Give each prompt file to an independent worker. Workers must return JSON matching the schema in the prompt. Every input facility must appear exactly once.

## 3. Validate worker output

```text
uv run python -m app.cli batch-review validate \
  --input worker-output.json \
  --queue data/review/batches/<batch-id>.queue.json \
  --output data/review/batches/<job-id>.validated.json \
  --workers 8
```

Validation fetches candidate OSM objects concurrently and checks:

- valid OSM object IDs and live retrieval;
- Maldives coordinate bounds;
- compatible facility/category tags;
- exact official-island versus candidate-island agreement;
- one selected candidate only;
- no duplicate selected OSM object inside the batch.

Only a `reviewed_osm_match` that passes every check is marked mergeable. Provisional and unresolved results remain separate.

## 4. Merge and rebuild

Preview first:

```text
uv run python -m app.cli batch-review merge \
  --input data/review/batches/<job-id>.validated.json
```

Apply the validated batch and regenerate canonical derived artifacts:

```text
uv run python -m app.cli batch-review merge \
  --input data/review/batches/<job-id>.validated.json \
  --apply --rebuild
```

The merge updates reviewed OSM features, overrides, evidence, provisional records and a batch provenance manifest. `--rebuild` runs prewarm, the SQLite audit and the reconciliation ledger export.

This does not auto-accept fuzzy matches, generic buildings, resort polygons, nearby facilities, or candidates without island agreement.

## 5. Bounded OSM query discovery

Use the documented OSM query APIs in `D:/datathon/apis.docs.md` before or alongside worker review:

```text
uv run python -m app.cli batch-review query \
  --queue data/review/batches/<batch-id>.queue.json \
  --job <job-id>
```

The command derives each official island bounding box from the normalized OneMap island geometry and performs two complementary searches:

1. Narrow Overpass queries for facility-relevant tags (`healthcare`, `hospital`, `clinic`, `doctors`, `school`, and compatible building/office tags).
2. Bounded Nominatim `/search` requests using `viewbox=<island bbox>&bounded=1` for each official facility name, island, atoll, and Maldives.

It uses the Overpass provider failover order and cache policy from `apis.docs.md`, obeys Nominatim's one-request-per-second public-service limit, writes compressed Overpass responses and cached Nominatim JSON under `data/cache/raw/osm/`, and emits:

```text
data/review/batches/<job-id>.osm-query.json
```

Overpass results are discovery evidence only. Workers must still verify official identity, island agreement, category compatibility, and the live object through the OSM object API before a mapping can be merged. National extraction remains a PBF task; these queries are bounded per-island validation/discovery calls.

## 6. Deterministic pass without AI agents

After a bounded query artifact exists, run the local deterministic candidate pass:

```text
uv run python -m app.cli batch-review auto-review \
  --queue data/review/batches/<batch-id>.queue.json \
  --job <job-id> \
  --query data/review/batches/<job-id>.osm-query.json \
  --output data/review/batches/<job-id>.auto.json
```

This pass does not use an AI agent. It only promotes a candidate to the validation stage when the OSM object has:

- a specific facility name matching the official name or a strong normalized variant;
- compatible facility/category tags;
- coordinates from the bounded island query;
- a unique top candidate.

Unnamed `healthcare=yes` buildings, generic objects, category conflicts, and ambiguous ties remain provisional or unresolved. Run the normal `validate` and `merge` commands afterward; the live OSM API and official-island checks remain mandatory.

This supports a faster hybrid workflow: deterministic local matching handles obvious exact cases, while AI/manual research is reserved for ambiguous identity, alternate spelling, operator, and source conflicts.
