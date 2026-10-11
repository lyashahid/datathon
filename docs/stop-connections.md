# Bus stop and connection editing

Bus stops and the services that use them can be edited separately. A stop without an active service adds no transit-access benefit.

## Interactions

- **Move a stop:** select a bus stop, then drag it in edit mode or choose **Move stop** and tap a road. The preview snaps to a permitted driving-network node. **Keep bus connections** is enabled by default; every active bus direction using the stop follows the new location. Existing frequency and fleet are retained.
- **Connect existing stops:** choose **Connect stop**, or start a connection from Services. In **New connection**, tap stops in travel order or use **Find an existing stop**. Reorder or remove stops in the sequence, review the preview, then choose **Apply connection**. Outward and return paths are calculated independently.
- **Place and connect new stops:** in the connection editor, tap a road to add a provisional stop. It becomes part of the selected sequence and is committed with the service. Cancel discards the draft and its provisional stops.
- **Add to a route:** choose an active bus direction and an **Insert after** stop, then select an existing stop or place a new one. Insertion preserves the other stops' order and updates the matching reverse gap. Inserting after the last outward stop extends the outward end and the return beginning. A mismatched return sequence is rejected with guidance to create a new connection.
- **Build a stop first:** the build controls offer **Stop first** alongside **Auto-connect**. A standalone stop can be committed and connected later. Reusing an existing stop in another service does not charge for a second stop.

The connection editor uses custom route and insertion pickers, a collapsible stop search and service options. New connections expose departure frequency and diesel/electric fleet choices. Frequency-route insertion retains existing frequency and fleet.

## Preview, history and persistence

Draft results use the same action that is applied. New service plus provisional stops, or route insertion plus its new stop, is one action and one undo step. Moving a stop can prepare several route replacements, but committing the complete history creates one undo step for the gesture. Stop and pattern IDs stay stable so later frequency and fleet controls continue to refer to the same service.

Undo, redo and JSON export/import preserve the actions and planning assumptions. Saved scenarios remain pinned to their dataset and model versions. Route replacements are validated before replay; an incomplete replacement cannot partially add its stops or overwrite an existing connection.

## Timing and coverage limits

Changed routes use OSM-directed driving distance, the selected bus moving-speed assumption and dwell time. They are modeled proposals, not observed travel times or congestion forecasts. Return paths must exist independently; the model does not reverse a one-way path to manufacture a return service.

New connections default to buses every 15 minutes, daily from 07:00 to 19:00 Maldives time. Changing a captured scheduled route requires an explicit assumed frequency and replaces its captured departures with that proposed operating window. When moving with **Keep bus connections**, the same assumption is shown for scheduled services; existing frequency windows are retained. Turning this option off invalidates affected published timing rather than treating it as valid at a moved stop.

Stops must connect to permitted roads within the planning snap limit and supported island coverage. Ferry terminals cannot be moved onto bus roads. New connections require 2–50 distinct active bus stops. The model accepts headways of 1–240 minutes; the connection editor's frequency control offers 5–180 minutes.

Costs distinguish new stop investment from added service operations. Changed services with incomplete published annual operations retain unavailable cost/carbon results. Access gains do not imply ridership or private-trip displacement; carbon can increase when service is added.

## Model verification

The planning suite passed 72 tests across six files, including eight connection cases in `src/lib/planning/connections.spec.ts`. Coverage includes asymmetric directed roads, existing-stop reuse, standalone-stop access, provisional-stop atomic commits, insertion and extension in both directions, shared-stop movement, explicit scheduled-service conversion, missing return paths, independent cost/carbon arithmetic, matching preview and commit results, undo/redo, JSON replay and invalid imported segment geometry. These are model checks; browser interaction verification is recorded separately.

## Browser verification

The production preview was checked at 1366×768. Connecting existing Maafannu and STELCO stops increased one-time investment from MVR 24.5 million to MVR 31.4 million, annual operations from MVR 6 million to MVR 7.17 million, and net annual carbon change from +125.8 to +153.7 tCO₂e. Access totals did not increase in this example. Undo restored the original results; redo reproduced the connection results.

In a separate Maafannu → STELCO connection, tapping a road added **Proposed stop 1** as the third stop. Apply committed the new stop and both service directions together. One undo restored the original cost and access results and removed the provisional asset. The confirmation toast appeared above the Undo control.

Dragging the selected Maafannu Bus Terminal snapped it to the coast road and rerouted all three connected patterns using proposed timing. One undo restored its original position and the MVR 24.5 million investment, MVR 6 million annual operations and +125.8 tCO₂e annual carbon change. A subsequent plain tap selected the stop without creating an action; Undo remained disabled.

A standalone stop in Hulhumalé added MVR 250,000 of investment without increasing access, operations or carbon. It was then connected to Synthetic Track. Moving the stop by choosing a road rerouted both directions and changed distance-based costs. Three undo steps restored the original proposal. Inserting existing Synthetic Track after R4 Amin Avenue Opp was also applied successfully. Cost and carbon remained **Unavailable** where published baseline operations were incomplete; undo restored the preceding results.

At 390×844 and 320×740, the connection builder expanded and collapsed, its contents scrolled internally, and search and Apply remained reachable without horizontal overflow. These recorded checks used browser viewport emulation; temporary screenshots are not retained.
