# Map badges and generated card artwork

The atlas uses two complementary graphic families: compact cartographic badges on the map, and larger generated illustrations in intervention cards and supporting panels. Map badges are code-native SVGs in `src/lib/components/planning/graphics/mapSymbols.ts`; they no longer load the isometric miniatures. The illustrations were created with the built-in image_gen tool on 2026-10-10. They represent generic asset categories, do not depict actual Maldives buildings, and do not establish a need for a new hospital.

## Map symbol system

Each map badge has an off-white circular background, a fine border, a restrained grounding shadow, and a category glyph. Category colors identify existing assets:

| Category                    | Color            | Glyph                            |
| --------------------------- | ---------------- | -------------------------------- |
| Bus and bus stop            | Teal `#1c7c86`   | Bus front                        |
| Hospital and clinic         | Rose `#a45067`   | Medical cross / stethoscope      |
| School                      | Violet `#7862a0` | Graduation cap                   |
| Ferry, terminal and vessels | Blue `#426f9e`   | Ferry, anchor or boat silhouette |
| Airport                     | Slate `#596d87`  | Airplane                         |

State takes precedence over category color. Proposed investments and placement previews use amber `#a86313`, a pale amber background, a dashed outline and a plus badge. A proposed relocation uses violet `#7960ab` with an arrow badge. Paused assets use gray `#7c8d91`, a pause badge and a dimmed glyph. These cues retain the difference between built infrastructure and scenario changes without relying on color alone. The planning model can propose bus service and stops, but cannot propose hospital construction; the proposed-hospital symbol is available without inserting fictional hospitals into the baseline.

`mapSprites.ts` rasterizes each SVG onto an 80 px canvas and registers it with MapLibre at a pixel ratio of 2. Sprite IDs retain the category name and the existing `-proposed`, `-draft`, `-moved` and `-paused` suffixes so map picking and stop editing keep their identities.

The visual hierarchy is controlled by zoom and collisions. Baseline stops remain small dots in the overview; bus badges appear from zoom 14 and grow from about 23 to 27 px in visible diameter. Facilities grow from about 21 to 30 px. Existing badges respect symbol collisions; the underlying stop dots remain available when a badge is suppressed. Proposed and moved stop badges remain visible, grow from about 24 to 32 px, and may overlap so scenario changes can be found. Placement previews, selection handles and drag overlays have priority above ordinary markers. Sea and air context badges stay upright and compact, rather than rotating their whole background by vessel heading.

Visual QA on 2026-10-10 covered desktop overview, neighborhood stops, hospital and clinic details, proposed-stop selection, and the 390 px phone overview. The saved scenario was not edited. Svelte check, lint and production build passed, along with the 13 existing map-editing tests. Temporary screenshots are not retained; the original illustrations below remain available for regeneration.

## Generated illustrations

Runtime assets are stored in `static/graphics/generated/`: `bus-stop.webp`, `bus-stop-proposed.webp`, `hospital.webp`, `hospital-proposed.webp`, `school.webp`, `clinic.webp`, `bus.webp`, and `ferry.webp`. The eight transparent, 256 px lossless WebPs total 426,438 bytes (about 426 KB), 96% smaller than the generated originals. Original PNGs are preserved locally in the ignored `artifacts/graphics/generated/` archive and at the tool's original Codex generated-images location.

Existing stop and hospital illustrations use teal art; proposed and placement-preview variants use amber art. Supporting panels identify investment status with text; `TransportGraphic` supplies accessible state labels and dims paused artwork with grayscale. The amber hospital illustration remains available to the graphics system without implying a current construction proposal.

`getTransportAssetUrl(kind, size, state)` selects card and panel art, honors SvelteKit asset paths, and keeps SVG fallbacks. `TransportGraphic` retains meaningful accessible labels and SVG fallback on load failure. These illustration assets are independent of the compact map badges.

Repackage from archived sources with `node scripts/prepare-map-graphics.mjs`. The script uses an installed Sharp package (project or bundled workspace runtime); `MAP_GRAPHICS_NODE_MODULES` can point at an existing dependency directory. It preserves alpha, verifies dimensions, and copies source PNGs to the archive before removing their served high-resolution copies.

## Final prompt set

### bus_stop

Create a single premium isometric bus-stop map icon for a Maldives transport planning game. One recognisable bus shelter only: a slim turquoise roof with a warm white frame, a simple bench, a small upright blue bus-stop sign with a clean bus silhouette, and a tiny paved base. Sophisticated architectural miniature illustration, polished satin materials, restrained depth, crisp silhouette, beautifully composed, no cartoon face, no text, no letters, no landscape, no people, no bus vehicle, no extra objects. View from a consistent 30 degree isometric angle, icon centered and occupying 85% of a square canvas. White and light stone structure, deep teal roof and ocean-blue accent, tiny warm amber accent. Lighting from upper left, very subtle contact shadow contained on the base. Transparent background; edges clean and suitable for a small map marker and a larger intervention card. Readable at 48 pixels. No circle, badge, border, or surrounding pin shape.

### hospital

Create a single premium isometric hospital map icon for the same transport planning atlas as an elegant teal bus shelter. A compact three-storey modern hospital architectural miniature: warm white facade, turquoise glazed window bands and teal roof detail, clear large medical plus sign on the front and roof. One hospital building only, simple tiny paved base, visible welcoming entrance. Sophisticated satin materials, tasteful architectural model, restrained depth and strong crisp silhouette. No readable text, no letters, no people, no vehicles, no surrounding city, no trees, no landscape, no extra floating symbols. View from a consistent 30 degree isometric angle, lighting upper left. Centered, occupying 85% of a square canvas, transparent background, clean edges, subtle contact shadow confined to base. Main colors white, light stone, deep teal and ocean blue, with a very small warm amber entry accent. Must be recognizable at 48 pixels and beautiful as a larger intervention illustration. No badge, border, circle, or map pin. This represents a generic healthcare asset category, not any specific real hospital.

### school

Create a single premium isometric school map icon, matching an elegant white-and-teal hospital and bus shelter in a transport policy planning atlas. One compact two-storey school architectural miniature: warm white walls, ocean-blue window bands, a restrained amber roof with one small teal entrance canopy, and a clear abstract open-book emblem on the front. Simple tiny paved base, strong recognizable academic building silhouette. Sophisticated architectural miniature illustration, satin materials, tasteful subtle depth, polished crisp edges. No text, no readable letters, no people, no vehicles, no landscape, no surrounding city, no extra floating objects. 30 degree isometric view, lighting upper left. Centered, occupies 85% of square canvas. Transparent background. Subtle contact shadow confined to base. Visually readable at 48 pixels, attractive as a larger card illustration. No pin, badge, border or surrounding circle. Represents a generic school category rather than a particular real building.

### bus_stop_proposed

Create a matching proposed-investment variant of this exact isometric bus shelter icon. Preserve the composition, shape, clean transparent background, white structure, paving and light direction. Change all teal/turquoise roof and glazing accents and the blue bus-stop sign background into a cohesive warm amber and burnt orange palette. Keep the white bus symbol and white structural parts. The proposed version must feel like the same asset category but clearly warmer in color, with a beautiful refined architectural miniature finish. Do not add any words, badges, circles or map pins. Transparent background.

### hospital_proposed

Create a matching proposed-investment variant of this exact isometric hospital icon. Preserve the architectural shape, composition, white facade, clear medical plus symbols, paving, light direction and clean transparent background. Change all teal/turquoise/blue roof, canopy, medical cross and glazing accents into a cohesive warm amber and burnt orange palette, while keeping white medical plus symbols on the roof white and walls white. The proposed hospital should be clearly warmer in color but retain the same refined architectural miniature style. Do not add text, badges, circles or map pins. Transparent background.

### clinic

Create a single premium isometric clinic map icon for a Maldives transport policy atlas. A compact one-storey neighborhood clinic architectural miniature, warm white facade, turquoise roof, ocean-blue glazed front windows, a single large teal medical plus on a white upright sign integrated into the entrance. Clear small healthcare silhouette, distinct from a large hospital. Tiny paved base, no landscape. Sophisticated satin materials, crisp architectural model, 30 degree isometric angle, lighting upper left, minimal subtle shadow on base. Centered occupying 85% square canvas. Transparent background. No text, people, vehicles, surrounding city, floating badges, circle, border or pin. Recognizable at 48 pixels. Generic facility category, not a specific real building. Match a polished white-and-teal hospital and bus-shelter miniature.

### bus

Create a single premium isometric public bus icon for a Maldives transport policy planning atlas, matching polished white-and-teal architectural miniature icons. A modern single-deck city bus, white upper body, deep teal lower body, turquoise roof, ocean-blue glass windows, simple dark tires, a tiny warm amber trim. Clear bus silhouette, elegant realistic miniature with satin materials and restrained depth. 30 degree isometric view showing front and one long side, light from upper left. Centered and occupies 85% square canvas. Transparent background, only subtle grounding shadow. No text, readable letters or route numbers, no people, road, buildings, scenery, circles, badges, map pins or border. Readable at 48 pixels and beautiful as a larger intervention illustration.

### ferry

Create a single premium isometric passenger ferry icon for a Maldives transport policy planning atlas, matching polished white-and-teal architectural miniatures. One compact modern inter-island passenger ferry, white hull and white single-deck cabin, deep teal roof, ocean-blue windows, restrained turquoise stripe and tiny amber detail. Strong simple boat silhouette with pointed bow and visible passenger cabin, satin materials, sophisticated realistic miniature. View from a consistent 30 degree isometric angle, lighting upper left. Centered occupies 85% of square canvas. Transparent background. No water or waves, no landscape, people, text, numbers, flags, circles, badges, border or map pin. Distinguishable from a bus and recognizable at 48 pixels. Generic category, not a specific vessel.

Proposed variants used the corresponding existing PNG as an edit target. All results were requested with a transparent background. No CLI/API fallback was used.
