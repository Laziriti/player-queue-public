# Atmosphere System & VNTransitions

## VNAtmosphere (atmosphere/index.js)

Public façade. Holds four subsystems: `_particles` (ParticleSystem), `_visualFX` (VisualFXSystem), `_parallax` (ParallaxSystem), `_camera` (VNCameraSystem).

Particle type and visual effect are **independent axes** — a scene can have any particle type combined with any visual effect (or just one, or neither). The legacy combined "effect" (e.g. `divine`, `glass_shatter`) still exists only as a convenience **preset** that sets both axes at once; it is not stored as scene state.

`init(overlayEl, particle, visual, particleIntensity)` — delegates directly, no preset lookup:
- `_particles.fill(container, particle, particleIntensity)` on `.vn-particles`
- `_visualFX.apply(overlayEl, visual)`
- `_camera.setEnabled(cameraEnabled)` — reads `cameraEnabled` setting
- `_parallax.start(overlayEl, { enabled, depth, kenBurns })` — reads parallax + kenBurns settings

### Lite mode

Client setting `liteMode` (default off) for weak machines. It changes only what *this* client draws; scene state (`particleEffect`, `visualEffect`, what the GM picks, what is broadcast) is untouched, so toggling it never desyncs anybody. In `init()`: no `_particles.fill()`, `_visualFX.apply(overlayEl, 'none')`, camera disabled, and `_parallax.start()` is **not called at all** (parallax is a permanent `requestAnimationFrame` loop; `enabled:false` would only make it idle, not stop it). `_reapplyCameraDof()` also stays off. CSS side: `VNSceneHTML.scene()` puts `.vn-lite` on `#vn-scene-overlay`, and the "Лёгкий режим" block at the end of `visual-novel-scene.css` removes every `backdrop-filter` (panels get a denser background instead), hides decorative layers (`.vn-ambient-light`, `.vn-ground-fog`, `.vn-particles*`, `.vn-character-glow`, `.vn-fx-*`) and drops the filter shadow on the active speaker. The setting's `onChange` calls `VisualNovelScene.applyLiteMode()`, which toggles the class, re-inits the atmosphere and re-targets the camera, so it applies to an open scene immediately. A new effect added to the atmosphere must either go through `init()` or check `liteMode` itself.

`destroy()` — clears particles, removes FX classes, stops parallax mouse listener, resets camera. Must be called before `init()` when switching either axis.

`onSpeakerChange(charEl)` — delegates to `_camera.onSpeakerChange(charEl)`. Called from `VisualNovelScene.setActiveSpeaker()` / `setExclusiveSpeaker()`.

`resetZoom()` — delegates to `_parallax.resetZoom()`, called after background transitions.

Static fields mirror config exports for external access:
- Particle axis: `VNAtmosphere.PARTICLE_TYPES`, `PARTICLE_GROUPS`, `PARTICLE_LABELS`, `PARTICLE_ICONS` (from `config/particle-types.js`)
- Visual axis: `VNAtmosphere.VISUAL_TYPES`, `VISUAL_GROUPS`, `VISUAL_LABELS`, `VISUAL_ICONS` (from `config/visual-types.js`)
- Legacy combined presets: `VNAtmosphere.EFFECTS`, `EFFECT_GROUPS`, `EFFECT_LABELS`, `EFFECT_ICONS`, `PRESETS` (from `config/effects.js`) — `PRESETS[id]` is `{ particles, visual }`, used by the dialog's preset strip and by migration/backward-compat code.

## State shape

`VNSceneState` stores `particleEffect` and `visualEffect` as independent string fields (defaults `'particles'` and `'none'`). The old single `atmosphereEffect` field is gone from new state; `VNSceneState.fromPayload()` still accepts a legacy `atmosphereEffect` payload and derives both new fields from `PRESETS[atmosphereEffect]` for backward compat (world-setting/`activeScene` restore path, which bypasses `vn-migrations.js`). `vn-migrations.js` has a dedicated migration step that converts persisted `VNPresets` the same way.

## Independent UI — dialog tab and runtime toolbar

**Dialog:** `VNEffectsManager` (`scripts/visual-dialog/vn-effects-manager.js`) generates and wires the "Effects" tab in the scene dialog (`vn-dialog-builder.js`). It renders:
- A preset strip (`.vn-effects-presets-row`) — one button per legacy `EFFECT_GROUPS` entry, clicking sets both hidden inputs (`#particle-effect`, `#visual-effect`) at once.
- Two independent icon-grid pickers (`.vn-effects-inline-grid`, reusing the `.vn-atmo-item`/`.vn-atmo-group-header` tile styles from the runtime toolbar), one for `PARTICLE_GROUPS`, one for `VISUAL_GROUPS`.
- The relocated particle-layer switch (`#particles-layer`) and `particle-intensity` slider (previously in the Background tab).

Selecting a particle/visual tile directly deselects any active preset unless it happens to still match one (`_syncPresetHighlight`); selecting a preset re-syncs both grids.

**Runtime toolbar:** `vn-scene-html.js` renders two independent `.vn-atmo-wrap` picker widgets (cycle button + `.vn-atmo-item` grid), one bound to `particleEffect` one to `visualEffect`, each with its own socket action (`setParticleEffect` / `setVisualEffect` in `vn-socket-handler.js`).

## VNCameraSystem (atmosphere/systems/camera.js)

Pure state machine — no RAF loop of its own. Called from `ParallaxSystem._tick()`.

- `onSpeakerChange(charEl|null)` — reads `getBoundingClientRect()` of the character element to compute normalized offset from screen center. Sets target dx/dy/scale for LERP.
- `tick()` — advances current values toward targets with `LERP_FACTOR = 0.018` (slower than parallax 0.03 for cinematic feel).
- `getOffset()` → `{ dx, dy, scale }` — composed into the parallax transform.
- `MAX_SHIFT = 8` px, `SPEAKER_SCALE_BONUS = 0.015`.

The camera is null-safe: `ParallaxSystem` uses optional chaining (`this._camera?.tick()`) and a fallback (`?? { dx: 0, dy: 0, scale: 1.0 }`). If camera is removed, parallax continues to work unchanged.

## ParallaxSystem — Ken Burns drift

In addition to mouse-follow parallax and slow zoom, ParallaxSystem supports a directional drift:
- `setOptions({ kenBurns: { enabled, direction } })` — direction: `'none'`, `'random'`, `'left'`, `'right'`
- Drift accumulates in `_kbOffsetX/Y` per tick, clamped to `KB_MAX (0.25) * maxShift`
- Reset on `resetZoom()` (called on background change)

## Particle layer mode

`state.particlesLayer: 'back' | 'front' | 'mix'` — GM-controlled, synced via socket (`setParticlesLayer`). Legacy boolean `particlesForeground` is still read (`resolveParticlesLayer()` in `vn-state.js`: `true` → `'front'`), so no preset migration is needed.

- `back` — all particles in `.vn-particles` (z-index 3, behind characters).
- `front` — same container, but `#vn-scene-overlay.vn-particles-fg` raises it to z-index 101. Pure CSS toggle, no re-fill.
- `mix` — the overlay has a second container `.vn-particles.vn-particles-upper` (z-index 101, always present, empty unless mix). `ParticleSystem.fill(container, type, intensity, upper)` builds every particle as usual and randomly (50/50) appends it to either container via `ParticleSink`. Ghosts: mist stays behind, souls are split between two `.vn-particle-ghost-souls` wrappers. Entering/leaving `mix` calls `_reinitAtmosphere()` (particles are regenerated); `back`↔`front` does not.

UI: toolbar button `.vn-particles-fg-btn` cycles back → front → mix (icon/title update via `_applyParticlesLayerUI()`); dialog Effects tab has a 3-button switch (`#particles-layer` hidden input, `.vn-particles-layer-opt`).

## Ghost particles — offset-path souls

Ghosts are the only particle type that bypasses the factory pattern. `fill()` detects `particleType === 'ghosts'` and calls `_fillGhosts(container, intensity)` directly.

**DOM structure generated inside `.vn-particles`:**
```
.vn-particle-ghost-mist         (opacity 0.34, filter: blur(24px))
  .vn-particle-ghost-vapor ×8   (--n: 0–7; contains 2 <i> each)

.vn-particle-ghost-souls        (wrapper — needed so :nth-child counts only souls)
  .vn-particle-ghost-soul ×42   (--n: 0–41)
    <i> ×13                     (tail segments, :nth-of-type sets --t: 13→1)
    <b.vn-particle-ghost-head>  (head, --t: 0 from CSS default)
```

**How the animation works:** All 14 inner elements per soul share the same `offset-path: var(--path)` and travel the curve from `offset-distance: 0%` to `100%`. `offset-rotate: auto` tilts each element to the curve tangent — the entire tail bends with the path. Staggered `animation-delay: calc(var(--phase) + var(--t) * 0.073s)` places each segment 0.073 s behind the previous one, creating a tapering tail that naturally follows the curve.

**CSS custom properties cascade chain:**
- `.vn-particles` defines `--ghost-path-a/b/c/d` (4 SVG bezier paths)
- `.vn-particle-ghost-soul` selects `--path: var(--ghost-path-a)` (overridden by `:nth-child(4n+2/3/4)` rules)
- `--duration` and `--phase` are computed via CSS `calc()` from `--n` (set inline per soul)
- `--t` is set by CSS `:nth-of-type` rules on `<i>` elements; controls height (`36px - --t * 2.15px`) and alpha

**Depth/brightness:** Three `:nth-child(3n/5n/7n)` rules vary `--size` (0.72 / 1.24 / 1.58) and `--brightness` (0.45 / 0.92 / 1.0).

**Count:** `PARTICLE_CONFIGS.ghosts.count = 42` (souls, not individual elements; each soul = 14 DOM nodes). Hard cap at 84 souls.

If `PARTICLE_CONFIGS.ghosts.images` is set, the head (`<b>`) gets a raster sprite instead of the CSS gradient — see "Image-based particles" below. Because the sprite is drawn head-up but `offset-rotate: auto` only aligns the box to the (near-horizontal) path tangent, the head element gets an extra `transform: rotate(90deg) scale(var(--size))` baked into its inline style to face the direction of travel. The 13 tail `<i>` segments are NOT image-able — they need to visibly taper/stretch along the curve, which a static sprite can't do — so they stay CSS gradients regardless of `images`.

## Image-based particles

Any entry in `config/particles.js` (`PARTICLE_CONFIGS`) can carry an optional `images: string[]` — one or more paths under `modules/player-queue/assets/effects/particles/<type>/`. When present, `ParticleSystem` picks one at random per particle instance (`_imageOverrideCss()`) and overrides `background`/`border`/`border-radius`/`box-shadow`/`clip-path`/`filter` inline, replacing the CSS-drawn shape while leaving the existing `animation-name` keyframes (translate/rotate/scale/opacity via `--drift`/`--drift-y`/`--rotation`) untouched — motion is unchanged, only the static shape/color is swapped for a sprite.

This only works cleanly for particles whose keyframes animate `transform`/`opacity` only (true for all standard types) — those are compositor-only properties, so swapping the shape for an image is free performance-wise and actually cheaper than the original once `box-shadow`/`filter: blur()`/`clip-path` are stripped.

**What doesn't work:** amorphous/shape-shifting effects — `shadow_wisps` (tried, reverted: a static sprite reads as a flat sticker instead of billowing smoke) and the ghost tail segments (same reason). Doing these properly would need an animated multi-frame sprite or several independently-drifting semi-transparent layers, not a single static image swap.

**Currently image-based:** `ash`, `sakura`, `apocalypse_debris`, `blood_motes`, `glass_dust`, `void_shards`, `confetti` (non-streamer pieces only — `streamer` variant stays CSS, no art for it yet), `feathers`, `page_scraps`, `balloons`, `comets`, `shooting_stars`, and the `ghosts` head (see above). Assets live in `assets/effects/particles/<type_folder>/`, resized to ≤128px on the longer side (transparent-background PNG/WebP, source art not tracked in git history beyond the final resized file).

`feathers` and `page_scraps` each pull from two asset folders into one `images` array (black + white feathers; page fragments + parchment scraps) — same particle type, mixed sprite pool, no special-casing needed since the factory just picks one at random per instance.

### Particle variants (narrowing a mixed sprite pool)

Some particle types (`feathers`, `page_scraps`) mix two sprite sub-pools into one `images` array. Rather than adding separate particle types for "black feathers only" / "white feathers only", a **variant** can be selected to narrow the pool — encoded as a compound string in the *existing* `particleEffect` state field: `"feathers"` (default, mixed) vs `"feathers:black"` / `"feathers:white"`. No new state field, socket action, or `PARTICLE_TYPES` entry is needed.

- **`config/particle-types.js`** — `PARTICLE_VARIANTS: { [baseType]: [{ id, label }, ...] }`, always including an `id: 'all'` entry (no suffix). Only types with a `PARTICLE_VARIANTS` entry show the variant picker.
- **`config/particles.js`** — a `variants: { [variantId]: { images } }` map on the base type's `PARTICLE_CONFIGS` entry. The plain `images` array stays the combined/default pool.
- **`ParticleSystem.fill()`** splits `particleType` on `:` — the base type drives all existing lookups/special-casing (ghosts, rain/confetti factories, `PARTICLE_CONFIGS` key), and if a variant is present and `config.variants[variant]` exists, its `images` overrides the base config's `images` before generation.
- Every other `particleEffect` read-site that compares against/indexes `PARTICLE_TYPES`/`PARTICLE_GROUPS`/`PARTICLE_LABELS`/`PARTICLE_ICONS` (base-type keyed) must first strip the suffix (`value.split(':')[0]`); the full compound string is what's persisted in state, sent over the socket (`setParticleEffect`), and passed into `fill()`.
- Legacy `PRESETS[id].particles` values are always bare types, so a compound value simply never matches a preset — selecting a variant correctly de-highlights the preset strip without extra code.

**UI — tile-attached expanding list:** both the dialog's Effects tab (`VNEffectsManager`) and the runtime toolbar (`vn-scene-html.js`) wrap any particle tile that has variants in a `.vn-atmo-item-group[data-variant-base="TYPE"]` element containing the `.vn-atmo-item` button plus a sibling `.vn-variant-list` checklist (rendered `hidden`). `.vn-atmo-item-group` is `display: contents` by default — it generates no box, so the button behaves as a normal single grid cell — and switches to `display: flex; flex-direction: column` (via `.vn-variant-open`) when expanded, stacking the button and its variant list vertically *within that same grid cell/column* (no `grid-column: 1/-1` — the list stays the width of its own column, not the full grid). Because a `display:flex` grid item's automatic min-width otherwise resolves to its content's min-content size, `.vn-atmo-item-group.vn-variant-open`/`.vn-variant-list`/`.vn-variant-option` all set `min-width: 0` and `.vn-variant-option span` gets the same `overflow:hidden; text-overflow:ellipsis; white-space:nowrap` truncation as `.vn-atmo-item span` — without this, a long variant label would inflate the grid item's min-content size and force the whole `1fr 1fr` track wider, skewing the entire tile list. This keeps the reveal anchored to the exact tile clicked while still avoiding `position:absolute`: `.vn-atmosphere-picker` (toolbar) and `.vn-effects-grid-col` (dialog) both have `overflow:hidden` on the outer wrapper, but the inner `.vn-atmosphere-picker-grid`/`.vn-effects-inline-grid` scrolls its own overflow (`overflow-y:auto`), so growing a cell's height never gets clipped.

Both grids' width (`.vn-atmosphere-picker`, `.vn-effects-grid-col`) is sized a bit larger than the base `.vn-atmo-item`/`.vn-variant-option` tile design otherwise needs, to leave headroom for variant labels/tags.

The runtime toolbar's click handlers for these tiles (`.vn-atmo-item[data-particle]`, `.vn-variant-option`, `.vn-atmo-item[data-visual]`) are bound via `$(document).on(...)` jQuery delegation while a scene is active (`activateSceneListeners()` → `_setupGMListeners()`), and are scoped with an `#vn-scene-overlay ` selector prefix. This scoping is required, not cosmetic: the dialog's Effects tab renders the exact same class names, so an unscoped delegated selector would also match clicks inside the separate dialog window whenever a scene happens to be active at the same time (the toolbar's listeners only exist in the DOM while a scene is running) — causing the dialog's own click handler and the toolbar's global handler to both fire for one click, double-toggling/mis-applying state and making the dialog's variant list appear to never open.

Interaction: clicking a variant-bearing tile only opens or closes its own variant list (toggling `.vn-variant-open`, closing any other open group first) — it never applies/selects anything by itself, so the base type is never silently committed to `'all'`. Only clicking a `.vn-variant-option` inside the open list actually writes the compound string into the persisted input/state, updates the active tile/option highlighting, and closes the group (and, in the toolbar, the whole atmosphere picker dropdown). A small `.vn-atmo-item-variant-tag` badge on the collapsed tile shows the active non-`'all'` variant's label (e.g. "Чёрные"), and a `.vn-atmo-item-caret` chevron (rotated 180° when open) hints that the tile is expandable. Both UI layers keep local `_setVariantTag`/`_openVariantGroup`/`_closeVariantGroup`/`_toggleVariantGroup` helpers and a `_syncParticleVariantUI`-style method that re-syncs every group's active option/tag from the current compound value and closes all groups (used after state changes, preset selection, or restoring an existing scene) — the dialog's version is driven through the existing `_applyAxisValue(root, 'particle', value)` entry point so preset/restore code paths need no separate variant-specific call. Shared CSS lives in `visual-novel-scene.css` alongside `.vn-atmo-item`/`.vn-atmo-group-header`, reusing the same active-state color language (`rgba(136,192,208,...)` / `var(--vn-accent)`).

`comets` and `shooting_stars` are two separate particle types (not one combined type) that both stream diagonally across the whole screen, fast. Each uses the standard `images`-array path — no special factory needed — but their `style(size)` functions compute `--rotation` from the *same* randomized `--drift`/`--drift-y` via `Math.atan2(dy, dx) * 180 / Math.PI`, instead of picking a separate hand-tuned rotation range. This guarantees the sprite's tilt always exactly matches its travel direction, since both are derived from one dx/dy pair — no risk of the rotation and the translate direction drifting out of sync. Comets fly down-left, shooting stars fly down-right (opposite baked-in trail sprites: `comet_with_trail_to_right_*` vs `star_with_trail_to_left_*`), both using large fixed-px `--drift`/`--drift-y` (roughly 900-1500px / 650-1050px) rather than the `110vh`-style viewport units used elsewhere — px keeps the rotation angle exact regardless of aspect ratio, and the large magnitude plus a short ~1.2-2.2s duration is what makes them read as fast streaks instead of a short, slow drift. Both classes (`.vn-particle-comet`, `.vn-particle-shooting-star`) share one keyframe, `vnFallingStarStreak`.

To add images to a new/existing type: drop 1+ files in `assets/effects/particles/<folder>/`, add an `images` array to its `PARTICLE_CONFIGS` entry (see `PARTICLES_PATH` const at the top of `config/particles.js`), and bump `sizeMin`/`sizeRange` if the original values were tuned for a tiny CSS blob — sprites usually need to render bigger to actually read.

## Config files

- **`config/particle-types.js`** — the particle axis. `PARTICLE_GROUPS` (grouped by category, `.types` array), `PARTICLE_TYPES` (flat list, 25 entries), `PARTICLE_LABELS`, `PARTICLE_ICONS`.
- **`config/visual-types.js`** — the visual axis. `VISUAL_GROUPS` (`.types` array), `VISUAL_TYPES` (flat list, 24 entries), `VISUAL_LABELS`, `VISUAL_ICONS`.
- **`config/effects.js`** — legacy combined presets only, used for the dialog's quick-preset strip and backward-compat migration. `EFFECT_GROUPS` (grouped, `.effects` array — note the different property name from the two files above), `EFFECTS` (flat list, 30 entries), `EFFECT_LABELS`, `EFFECT_ICONS`, and `PRESETS` mapping each legacy ID to `{ particles, visual }`. Some legacy presets are particle-only (`visual: 'none'`) or visual-only (`particles: 'none'`) — this is intentional and preserved as-is, not force-paired.
- **`config/particles.js`** — per-particle-type DOM/shape configs consumed by `ParticleSystem`.

To add a new particle type: add the ID to `PARTICLE_TYPES`/the relevant `PARTICLE_GROUPS` entry, add `PARTICLE_LABELS`/`PARTICLE_ICONS` entries, and handle it in `particle-system.js`. To add a new visual effect: same pattern in `visual-types.js` + `visual-fx.js`. To add a new legacy combined preset (rarely needed — most new work should just combine existing particle/visual types via the dialog's independent pickers): add the ID to `EFFECTS`/`EFFECT_GROUPS`, plus `EFFECT_LABELS`, `EFFECT_ICONS`, `PRESETS`.

## VNTransitions

Static class. All methods return Promises.

**Character transitions:**
- `enterCharacter(charEl, type='auto')` — adds `vn-entering vn-entering-{type}`, removes after duration. `'auto'` resolves to `'left'` or `'right'` based on `.vn-left-side` / `.vn-right-side` parent class. Enter types: `left, right, dramatic, shadow, rise`.
- `exitCharacter(charEl)` — adds `vn-exiting`, resolves after 650 ms.

**Background transitions:**
- `switchBackground(overlayEl, newImageUrl, type='dissolve', duration?)` — creates a second `.vn-bg-layer` with class `vn-bg-transition-{type}`, waits for `animationend` or timeout, then removes old layer. Types: `dissolve, zoom, blur, flash, black, sweep`.
