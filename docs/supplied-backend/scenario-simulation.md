# Phase 5 scenario simulation

The scenario engine applies validated operations to a deep clone of the
prewarmed routing and transport artifacts. Baseline cache data is never mutated
by a request.

## Endpoints

```text
POST /api/v1/simulation/run
POST /api/v1/simulation/compare
```

`run` accepts one scenario and returns the serialized scenario, applied
operations, warnings, baseline counts, effective-world counts, and count deltas.
`compare` runs two independent clones and returns their relative deltas.

Optional `island_id` scopes land, marine, air, and transport summaries to the
selected island. Baseline and effective counts always use the same scope.

## Supported operations

- add, move, or remove a bus stop;
- add, move, or disable a ferry terminal;
- add, remove, or change a ferry route;
- add parking, park-and-ride, or a mobility hub;
- close a road by edge or source way ID;
- add a pedestrian connection;
- add an airport-access connection; and
- disable selected land or marine permissions for a weather/disruption state.

Ferry routes added by a scenario retain their explicit `passenger_eligible`
flag. No live schedules or unverified service are inferred.

## Isolated editing support

`ScenarioEngine.new_session()` provides an isolated working copy with
`apply`, `reset`, `clone`, `undo`, and `redo`. The API uses a fresh session for
each request, so concurrent requests cannot share scenario mutations.
