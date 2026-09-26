# The Century Engine

A mobile-first browser game about **historical accumulation** inside a gigantic rotating
cylindrical space habitat. You mostly watch; occasionally you intervene. Every major event
leaves a permanent physical mark, and by the late game the habitat is an archaeological
record of everything that happened to it.

**No build step, no backend.** Open `index.html` over any static server (ES modules need
`http://`, not `file://`):

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

A service worker caches the app so it keeps working offline after the first load.

## What you can do

| | |
|---|---|
| **Watch** | Run centuries at 1×/3×/10×/30×. Pause any time (space). |
| **Inspect** | Tap districts, buildings, conduits, tunnels, factions, events. Every structure exposes a dated causal lineage ("Built in Year 84 after the Third Water Crisis…"). |
| **Scrub** | Drag the timeline. The habitat itself changes: buildings appear, borders move, names change, scars open and heal. |
| **Archaeology** | Toggle the overlay: modern structures go translucent, ghosts of converted buildings show through, derelicts are ringed in gold, former boundaries appear dashed and coloured by age, former names appear. |
| **Fork** | Pick any past year and create an alternate branch. Branches share a seed and diverge through your decisions. |
| **Compare** | Side-by-side of any two branches at the same year: population, government, technology, ecology, districts, crises, names. |
| **Intervene** | Rare prompts: rationing, emergency works, admitting migrants, recognizing or suppressing factions, abandoning a breached district, funding research, trade, redistribution, expansion priorities. Each has consequences, not bonuses. |
| **Persist** | Autosave to `localStorage`; Save / Load / New / Export JSON / Import JSON / Snapshot PNG in the menu. |

## How it works

```
js/
  rng.js            deterministic seeded RNG (sfc32)
  names.js          procedural naming
  sim/
    defs.js         structure & faction definitions
    gen.js          world generation from seed (geometry, ecology, districts, factions, founding infra)
    sim.js          the yearly step: supply, population, migration, ecology, hull, factions,
                    crises, politics, autonomous building, technology, projects, migration
                    waves, religion, faction lifecycle, generations, interventions
    history.js      compact per-year snapshots for scrubbing
    branches.js     timeline branches; deterministic replay from (seed, decisions)
  render/
    renderer.js     canvas cutaway of the habitat (pure presentation)
  ui/
    panels.js       bottom-sheet content: lineage, districts, factions, events, compare, menu
  main.js           app shell: loop, touch input, scrubber, sheet, persistence
```

Simulation and rendering never share code paths: the renderer reads a world plus a
per-year snapshot and draws it. Structures carry dated *layers* (built → damaged →
repaired → abandoned → converted → consecrated…), so any year can be drawn without
re-simulating, and the archaeology overlay is just drawing earlier layers under later ones.

Saves contain only the seed, the branch tree and the decisions taken (a few KB); history is
replayed deterministically on load, so exported worlds are reproducible.

## Systems

Population · food · water · energy · housing · industry (a budget the government spends) ·
trade · health · education · internal migration and external waves · infrastructure aging
and failure · hull integrity and pressure failures · soil ecology and blight · technology
transitions (recycling, hydroponics, hull weave, fusion, maglev, biofilters, arcologies) ·
culture and migrant communities · factions with ideology, constituencies, territory,
institutions, allies, rivals and grievances · district wealth and inequality · sentiment,
protests, revolts, district splits along barricade lines, revolutions · emergent factions
(rationing boards that outlive the shortage, faith movements that consecrate dead
infrastructure, separatists, migrant associations) · generational cohorts that remember,
retell, forget and reinterpret.

## 3D presentation

WebGL2 browsers use the vendored **Three.js 0.169.0** cutaway renderer;
unsupported browsers retain the original 2D canvas renderer. There is **no build
step or runtime CDN dependency**. `vendor/three.module.js` and
`vendor/OrbitControls.js` are unmodified files from the `three@0.169.0` npm package;
the upstream MIT license is in `vendor/LICENSE`. The import map is relative to
`index.html`, including when served under the GitHub Pages repository path.

Drag to orbit, pinch/wheel to zoom, and tap to inspect. Fit resets the view;
portrait puts the cylinder upright. Layer colours match the 2D renderer.
Archaeology exposes translucent buildings, wireframes of earlier incarnations,
and dashed historical boundaries. PNG exports include the district labels.
Citizens, protesters, service vehicles and migration ships are **illustrative
render-only units**, deterministically generated from the selected year, not
additional simulation agents. Unit sheets explicitly identify this distinction.
Reduced-motion preferences stop sprite and end-cap animation.

The service worker caches both renderers and vendored modules for offline use
after the first successful online load. An existing tab may need a reload after
its service worker updates.

### Browser regression checks

The application itself needs no npm install. For development tests only:

```sh
npm ci
npx playwright install --with-deps chromium
python3 -m http.server 8000 --bind 0.0.0.0
# in another terminal:
npm test
# optionally test the deployment:
URL=https://westkitty.github.io/century_engine/ npm test
```

`CHROMIUM_PATH` can select an existing Chromium executable. Tests cover WebGL
startup, all six layers, rendering purity, PNG export, 100 years of history,
Archaeology, rewind, phone-sized unit taps, offline reload, and forced 2D fallback.
Browser viewport tests do not establish performance on physical mobile hardware.
