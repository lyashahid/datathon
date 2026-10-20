# Scenario presentation

Open **Map & planning**, then choose **Scenario** beside Directions. **Shift+S** starts the same presentation while the map is open.

Use the subtle **right arrow**, **Right arrow key**, **Page Down**, or **Space** to advance. Use the **left arrow**, **Left arrow key**, or **Page Up** to return. **R** replays a step. **Escape**, the close button, or the final arrow exits. The presentation advances only when the presenter chooses. Travel steps follow the vehicle. The **To Hulhumalé** and **To the airport** journey clocks remain visible throughout the presentation and pause during explanatory steps. The first accumulates the ferry and flight portions; the second accumulates the walk and airport bus portions.

The eleven steps show Laamu Hithadhoo’s access index, the native ferry inspector, the ferry crossing to Kadhdhoo, Kadhdhoo’s access and airport details, the native flight inspector, the flight, northern Hulhumalé transport access, modeled population, the first walk, the direct airport bus, and a proposed closer stop with a return feeder. There is no separate Malé step. The final step includes **Before** and **Closer stop** controls. The island steps reuse the app’s island access overview. The ferry and flight inspectors use larger presentation typography. The flight marker uses the transparent generated PNG at `static/images/scenario-airplane.png`. Presentation data and proposed operations are kept separate from the saved planning draft.

The presentation fills the map workspace and hides its normal navigation until exit. Both clocks stay visible, with the current journey emphasized. Island details foreground access, transport, and residents; **Services, demographics & data** opens the remaining native overview. Travel scenes establish the connection before following the vehicle, then hold at arrival. Panning the map pauses the vehicle and clock; replay restarts the scene. Motion respects the reduced-motion setting.

The final comparison starts on **Before**, with identical neighborhood framing for both choices. **Closer stop** reveals the proposed connection and evaluated local access changes. Its large before/after values describe the **walk to a stop**, separately from the airport journey clock. Map focus and presentation styling are scoped to scenario mode; exiting restores normal navigation and the prior planning context.

Map startup prewarms profiles, connectivity, baseline data, and available access layers for Hithadhoo, Kadhdhoo, Hulhumalé, and Malé. The presentation shares those active requests and keeps completed results for five minutes. Closing a presentation detaches its updates while prewarming continues. A failed section has a shorter fifteen-second retry cache, and available sections still appear immediately.

## Evidence used

- The presentation shows a **schematic direct crossing from Hithadhoo to Kadhdhoo’s airport coast**, ending at `[73.5169, 1.8588]`. Its approximately **35-minute** estimate scales the retained 35-minute Hithadhoo–Fonadhoo sailing by distance (15.439 km direct versus 15.221 km in the source), rounded to the nearest five minutes. The native inspector separately retains Z4R17’s source corridor and six weekly sailings; those records do not establish a direct airport ferry service or a berth at Kadhdhoo.
- The KDO–MLE route uses the existing published Maldivian connection and schematic geometry. The [Six Senses Laamu transfer information brochure (2022)](https://www.trauminselreisen.de/fileadmin/user_upload/Six_Senses_Laamu_-_Transfer_Information_Brochure_2022.pdf) describes MLE–KDO as approximately **50 minutes**; the presentation reuses that duration as an estimate in the reverse direction. The retained air record establishes a bidirectional connection, not a dated KDO–MLE timetable. The combined approximately **1 hour 25 minutes** counts ferry and flight travel only, excluding ferry waits, the coast-to-terminal transfer, check-in, flight waits, and onward travel from the airport to Hulhumalé. The animation is not a recorded flight track or a confirmed flight departure.
- The airport itinerary uses the retained **10 October 2026** bus service and a **15:20** departure from the modeled origin, boarding direct **R9** at Hiya Flats Stop 2 at **16:05** and arriving at VIA Domestic Terminal at **16:11**. Its approximately **51-minute** clock includes the calculated initial walk, wait, bus ride, and terminal walk. The MACL-to-airport display reverses the retained airport-side return corridor because the outbound source shape detours through Malé; this short display section is schematic because directional road access is incomplete. The other walk and bus geometry comes from the retained itinerary. The displayed route remains on Hulhumalé and the airport island and does not cross into Malé. The app does not infer a Phase 3 administrative boundary from the origin point.
- Access colors measure modeled walks to public transport. The population layer shows residents allocated by the existing model; it does not measure live bus occupancy, crowding, or traffic.
- Kadhdhoo has airport and geography records but no resident allocation or resident access coverage layer in the retained model. Its native access index is 11.1/100 with limited evidence; the transport component is 33.3/100 from two mapped bus stops. Its unknown resident coverage must not be interpreted as zero residents or zero travel time.
- The closer-stop demonstration evaluates an added stop plus road-routed outbound and return feeder services every ten minutes, using the existing planning model. The before/after values measure the walk to a boarding point, and the resident gain uses a ten-minute access target. These are distinct from total airport journey time.

Sections load independently. If a source, timetable, route, or evaluation cannot be confirmed, the presentation keeps the available sections and labels the missing result. Rain, traffic delays, and clinical travel requirements are not modeled.

## Generated airplane asset

The project asset `static/images/scenario-airplane.png` was created with the built-in image generation tool. The original transparent PNG is preserved in the project; the map decodes it into a smaller GPU texture for display. The marker is an illustration rather than an identified aircraft assignment.

The full generation prompt and saved asset details are recorded in [Airplane asset](scenario-airplane-asset.md).

## Browser verification

With the frontend and backend running, execute:

```powershell
$env:MOBILITY_QA_URL = 'http://localhost:5173'
node scripts/verify-scenario-presentation.mjs
```

The Playwright Chromium harness verifies the eleven steps with reduced motion, then checks real vehicle motion, timer accumulation, pausing by panning, replay, and exit. It covers hidden workspace chrome, visible journey clocks and their active state, readable route metrics, keyboard access to secondary island details, recovery after tab visibility changes, unchanged comparison framing, restoration of the saved planning draft, and delayed ferry timing updates. Desktop, tablet, and phone screenshots and `verification.json` are written to `artifacts/qa/scenario-presentation/`. A failed or slow check also captures a diagnostic screenshot.
