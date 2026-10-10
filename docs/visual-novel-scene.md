# System 2 — VisualNovelScene

## Singleton lifecycle

`new VisualNovelScene()` is called in the `ready` hook. The constructor creates all subsystem instances but does not touch the DOM. `initialize()` registers settings, registers VNPresets, loads backgrounds, and loads favorite actors. `initSocket(socket)` is called separately after `socketlib.ready` has fired. The instance is assigned to `window.visualNovelScene`.

If the GM was active before a page reload, `restoreStateIfNeeded()` reads `game.settings` key `activeScene` and calls `createScene()` again.

## Scene music

Two instance fields manage playback:
- `_sceneMusicUuid: string | null` — UUID of the currently playing scene track (null = nothing playing)
- `_pausedSounds: null | Array<{playlistId, soundId}>` — `null` = music never started this session; array (empty or with entries) = music is active

Key methods:
- `startSceneMusic(uuid)` — on first call only, pauses all currently-playing `PlaylistSound`s with position saved via `sound.update({ playing: false, pausedTime: currentTime })`; then sets `sound.repeat = true` and calls `playlist.playSound(sound)`
- `stopSceneMusic(resumePaused)` — stops scene track; if `resumePaused = true`, calls `playlist.playSound(s)` for every saved entry (Foundry resumes from `pausedTime`), then clears `_pausedSounds`
- `_handleMusicTransition(newUuid)` — calls `stopSceneMusic(newUuid === null)`, then `startSceneMusic(newUuid)` if non-null

Music logic runs only when `emit && game.user.isGM`. On `closeScene` with `emit = true`, `stopSceneMusic(true)` resumes previously paused sounds. After a page reload, `restoreStateIfNeeded()` sets `emit = false`, so `_pausedSounds` stays `null` and no music side-effects occur.

## GM-only mode

`VisualNovelScene` has an instance field `_gmOnly: boolean` (default `false`). When `true`:
- `_doCreateScene()` and `updateSceneLayout()` skip the socket broadcast — players receive nothing
- `_updateGmOnlyUI()` shows the `.vn-broadcast-button` (pulsing green button in the GM toolbar) and adds `.vn-gm-only` CSS class to the overlay (`#vn-scene-overlay::before` shows a "👁 Только ГМ" badge)

`broadcastToPlayers()` (GM only, called by `.vn-broadcast-button` click):
1. Sets `_gmOnly = false`
2. Emits `open` socket event with current state payload
3. Calls `startSceneMusic` if music was set
4. Calls `_updateGmOnlyUI()` to hide the broadcast button

The toggle is exposed as `#vn-gm-only-toggle` checkbox in the dialog tabs row (`VNDialogBuilder`). `_handleSubmit()` reads it and passes `gmOnly` to `createScene`/`updateSceneLayout`.

## Atmosphere pickers

Particle type and visual effect are independent — the toolbar has **two** separate pickers, each wrapped in its own `.vn-atmo-wrap` (see [atmosphere-system.md](atmosphere-system.md) for the underlying axis split). Each wrap contains a cycle button and a `.vn-atmosphere-picker` popup (hidden by default, grid of `.vn-atmo-item` grouped by category). Clicking a wrap's button toggles its picker; clicking an item calls `setParticleEffect(particle)` or `setVisualEffect(visual)` and closes that picker. An outside click (capture-phase document listener) closes any open picker. Escape closes an open picker first; if none is open, closes the scene.

`_updateAtmosphereButton()` (in `visual-novel-scene.js`) updates both pickers' button icon/title and the `.active` class on their grid items.

## Delegation map

| Concern              | Delegated to          | Instance field    |
|----------------------|-----------------------|-------------------|
| DialogV2 scene UI    | VNDialogBuilder       | `_dialogBuilder`  |
| Socket send/receive  | VNSocketHandler       | `_socketHandler`  |
| Background gallery   | VNBackgroundManager   | `_bgManager`      |
| Effects tab UI       | VNEffectsManager      | `_effectsManager` |
| Atmosphere FX        | VNAtmosphere          | `_atmosphere`     |
| Overlay HTML gen     | VNSceneHTML           | `_html`           |
| Embedded chat        | VNChatPanel           | `_chatPanel`      |

## State (VNSceneState)

All runtime scene state lives in a `VNSceneState` instance at `this.state`:

```
active: boolean
minimized: boolean
leftIds / centerIds / rightIds: string[]   — token IDs or 'actor-{id}'
presetActors: string[]                — actor-{id} IDs saved as "Scene Participants" cast list; always persisted in presets; independent of canvas tokens
background: string | null
backgroundOverlay: boolean
portraitScale: number (0.5–2.0, default 1.0)
particleEffect: string (particle type ID, default 'particles')
visualEffect: string (visual effect ID, default 'none')
particlesLayer: 'back' | 'front' | 'mix' (default 'back') — particles behind / above / randomly split around characters (legacy `particlesForeground` boolean is still read)
speakers: { left, center, right }   — active speaker tokenId per position
flipped: { [tokenId]: boolean }
visibility: { [tokenId]: 'hidden' | 'name-hidden' }  — sparse; omitted = visible
musicUuid: string | null              — 'Playlist.ID.PlaylistSound.ID' UUID of scene music
portraitImages: { [tokenId]: string } — override portrait image URL per token
portraitNames: { [tokenId]: string }  — override display name per token
portraitScales: { [tokenId]: number } — per-token scale multiplier
```

`POSITIONS` static field (`['left', 'center', 'right']`) is used throughout the codebase instead of hardcoding position strings.

`SCALE_LIMITS` static field (`{ MIN: 0.5, MAX: 2.0 }`) — `fromPayload()` clamps `portraitScale` to this range on deserialization.

`toPayload()` / `fromPayload()` serialize/deserialize for settings persistence and socket transmission. `toggleSpeaker(tokenId, position)` returns true if activated, false if deactivated.

`fromPayload()` handles backward compat: if `p.visibility` exists, uses it directly; else if `p.hidden` exists (old format), converts `{ id: true }` → `{ id: 'hidden' }`; else sets `visibility = {}`. Similarly, if `p.particleEffect`/`p.visualEffect` are absent but a legacy `p.atmosphereEffect` is present, both new fields are derived from `PRESETS[p.atmosphereEffect]` (see [atmosphere-system.md](atmosphere-system.md#state-shape)). This path is used by the `activeScene` world-setting restore flow, which bypasses `vn-migrations.js`.

**Three-state visibility** — `VisualNovelScene.VISIBILITY_CYCLE = ['visible', 'hidden', 'name-hidden']`. Right-click on a character in the overlay cycles through the states. `applyVisibility(tokenId, visibility, emit)` stores in `state.visibility`, applies CSS classes, emits `setVisibility` socket event. CSS classes: `vn-character-hidden` (silhouette + "???"), `vn-character-name-hidden` (portrait visible, nameplate italic/dim + "???").

## Token ID format

Characters can be on-canvas tokens or actor-references. `resolveTokens(ids)` maps both:
- `'actor-{actorId}'` → resolves via `game.actors.get(id.slice(6))`
- plain ID → resolves via `canvas.tokens.get(id)`

The `actor-` prefix is used when a character is dragged from the Actors journal (not currently placed on the scene).

## Overlay DOM structure

```html
<div id="vn-scene-overlay">
  <div class="vn-bg-layer"></div>          <!-- background image/video -->
  <div class="vn-background-overlay"></div> <!-- darkening overlay (optional) -->
  <!-- FX layers: vn-fx-tint, vn-fx-rays, vn-fx-edges, vn-fx-scan, vn-fx-flash -->
  <!-- Atmosphere layers: vn-vignette, vn-ambient-light, vn-particles, vn-ground-fog -->
  <div class="vn-size-controls">…</div>     <!-- GM only -->
  <div class="vn-queue-display">…</div>
  <div class="vn-side vn-left-side">…</div>
  <div class="vn-side vn-center-side">…</div>
  <div class="vn-side vn-right-side">…</div>
  <div class="vn-toolbar">               <!-- GM: 6+ buttons; player: close only -->
    <!-- two independent atmosphere pickers, each wrapped: -->
    <div class="vn-atmo-wrap">
      <button class="vn-particle-cycle-btn">…</button>
      <div class="vn-atmosphere-picker" hidden>…</div>  <!-- popup grid, particle types -->
    </div>
    <div class="vn-atmo-wrap">
      <button class="vn-visual-cycle-btn">…</button>
      <div class="vn-atmosphere-picker" hidden>…</div>  <!-- popup grid, visual effects -->
    </div>
    <button class="vn-broadcast-button" style="display:none">…</button>  <!-- GM-only; shown when _gmOnly=true -->
  </div>
  <!-- .vn-gm-only class on #vn-scene-overlay adds a "👁 Только ГМ" badge via ::before pseudo-element -->
  <div class="vn-maximized-bar">…</div>
</div>
```

## Multi-row layout

Each position supports up to 3 rows × 3 characters = 9 characters. `_computeRowLayout(count, position)` distributes characters across rows. Row CSS:

- Front row (closest): plain `.vn-character` inside `.vn-front-row`
- Back row (75% scale): `.vn-back-row`
- Deeper back rows (60% scale): `.vn-back-row.vn-row-depth-2`
- Active speaker in back row: `.vn-row-promoted` (z-index fix)

## Portrait sizing

Base size: `max(140px, 14.5vw)` (no upper cap — intentional for proportional scaling across all monitor sizes). CSS variable `--portrait-scale` (set on `:root`) multiplies this. Flip state uses `--flip-x: -1 | 1` CSS variable on the `.vn-character-img`. Middle-click on a character (GM only) toggles flip.

`.vn-character` has `transform-origin: bottom center` so scale() grows upward, keeping the portrait anchored to the viewport bottom edge and preventing the nameplate from going off-screen at large scales.

## VN socket protocol (socketlib)

All VN traffic uses `socket.executeForEveryone('vnScene', { action, payload, sender })`. Schema validation and dispatch live in `VNSocketHandler.SCHEMA`.

| Action               | GM only | Required payload fields                            |
|----------------------|---------|----------------------------------------------------|
| open                 | yes     | leftIds, centerIds, rightIds; optional: musicUuid  |
| close                | yes     | —                                                  |
| setSpeaker           | yes     | tokenId                                            |
| updateScene          | yes     | leftIds, centerIds, rightIds; optional: musicUuid  |
| minimize             | yes     | —                                                  |
| maximize             | yes     | —                                                  |
| flipPortrait         | yes     | tokenId                                            |
| setPortraitScale     | yes     | scale                                              |
| setBackgroundOverlay | yes     | enabled                                            |
| setAtmosphereEffect  | yes     | effect                                             |
| setVisibility        | yes     | tokenId, visibility ('visible'\|'hidden'\|'name-hidden') |
| setCharacterScale    | yes     | tokenId, scale                                     |
| setExclusiveSpeaker  | yes     | tokenId                                            |

Incoming events from self (`data.sender === game.user.id`) are silently dropped.

## Settings

| Key              | Type    | Scope  | Notes                                           |
|------------------|---------|--------|-------------------------------------------------|
| activeScene      | Object  | world  | Serialized VNSceneState for reload recovery     |
| favoriteActors   | Array   | world  | Array of actor IDs                              |
| vnPresets        | Object  | world  | Map of UUID → preset object, registered by VNPresets.register() |
| backgroundFolder | String  | world  | Hidden (`config: false`); custom image folder path; empty = use module default |
| nameplateImage   | String  | world  | Path to nameplate frame image; empty = default rounded style |
| liteMode         | Boolean | client | Lite mode for weak machines — see [atmosphere-system.md](atmosphere-system.md#lite-mode) |
| parallaxEnabled  | Boolean | client | Enable/disable parallax mouse-driven bg shift   |
| parallaxDepth    | Number  | client | Parallax intensity 0–100 (mapped to `_maxShift`) |

## VNPresets

Static class. Presets stored in `game.settings` key `vnPresets` (world scope, `config: false`). Each preset is keyed by a random UUID (`foundry.utils.randomID()`).

Preset object shape:
```
{ id, name, version, createdAt, updatedAt, sceneId, sceneName, thumbnailData?, ...toPayload() fields }
```

`version` — module version string at save/update/regenerate time (e.g. `'14.2.2'`). Absent on presets created before versioning was added (treated as `'0.0.0'` by migration logic).

`toPayload()` includes `musicUuid` and `visibility`, so presets automatically save and restore scene music and character visibility.

`thumbnailData` — optional base64 JPEG string (data URL), generated at save time via `_makeThumbnail`. 160×100px, quality 0.8. Only present when the preset has a background. Used by Adventure IO cards instead of loading the full-resolution source image.

API:
- `getAll()` — returns the raw id-keyed object; transparently migrates old name-keyed presets on first call (adds `id`, converts `savedAt` → `createdAt`/`updatedAt`). Result is cached in `_cache` after migration; subsequent calls return the cached reference. All write methods (`save`, `delete`, `rename`, `update`, ...) mutate the same object in-place, keeping the cache current. `replaceAll()` builds a new object and nulls `_cache`. `invalidateCache()` clears it explicitly when needed.
- `getSorted()` — returns array sorted by `createdAt` descending
- `save(name, sceneState)` — always creates a new preset (same name does NOT overwrite); captures `canvas?.scene?.id` and `canvas?.scene?.name`; runs `_makeThumbnail(background)` and stores result as `thumbnailData`; stamps `version`
- `update(id, sceneState)` — overwrites payload fields, preserves `id/name/createdAt/sceneId/sceneName`; stamps `version`
- `regenerate(ids?)` — calls `applyMigrations(preset)` on each entry before refreshing thumbnail/portraits, then stamps `version: currentVersion`; this is the only place migrations permanently write to settings
- `load(id)` — returns preset by UUID or `null`
- `delete(id)` — removes by UUID
- `_makeThumbnail(src, w=160, h=100)` — draws image on an offscreen `<canvas>`, returns `toDataURL('image/jpeg', 0.8)` data URL; cover-crops to fit exact dimensions

`sceneId`/`sceneName` record which Foundry scene the preset was saved on; used by the scene-filter toggle in the Presets tab.

## VNBackgroundManager

Manages the background gallery dialog and DOM application.

- `load(path?)` — calls `FilePicker.browse('data', path)` to enumerate subfolders and media files
- `navigate(path, isBack)` — push/pop navigation stack, re-loads current path. `gotoDepth(i)` (breadcrumb jump) and `gotoPath(path)` (search-result folder) rebuild the stack; folders/files are naturally sorted in `_fetchFolder`
- `resetPath()` — resets `currentPath` to `VNBackgroundManager.getCustomFolder()` if set, otherwise to `modules/<moduleId>/assets/scenes`; clears navigation stack and the remembered folder
- **Remembered folder** — `navigate()` stores `currentPath` in `localStorage['player-queue.bg-last-folder']` (removed when back at the root). `restoreLastPath()` (called by `VNDialogBuilder._show` instead of `resetPath()` + `load()`) rebuilds the back-stack from the saved path if it still lies under the current root and loads; any failure falls back to the root
- **Locate** — clicking the current-bg bar (`.vn-bg-current-main.vn-locatable`) calls `locateCurrent(root)`, which jumps to the folder containing the checked background. `_canLocate(bg)` = path is below the gallery root (`_relativeSegments`); otherwise the bar is not clickable. If the folder no longer contains the file, a warning is shown and navigation is left unchanged
- **Selection model** — the selected bg is always exactly one checked `input[name=background]`: a gallery card, or the hidden `.vn-bg-holder` radio when the file is not in the folder being shown. `addDynamicOption(root,path,label)` selects a visible card or falls back to the holder; `_keepSelection` restores a valid selection after any gallery re-render; `_syncSelectionUI` updates `.selected`, the compact current-bg bar (`.vn-bg-current`, with clear button; click = locate) and 
- `applyBackground($overlay, background, showOverlay)` — sets `.vn-bg-layer` background-image or creates a `<video>` element for video files; manages `.vn-background-overlay` presence. Skips re-setting `backgroundImage` if the same URL is already applied (prevents unnecessary reloads on `updateScene` calls that don't change the background)
- `switchWithTransition($overlay, newBg, showOverlay, atmosphere)` — animated dissolve via `VNTransitions.switchBackground()`; calls `atmosphere.resetZoom()` after
- `generateSelector(currentBg, currentOverlay)` / `generateGalleryContent()` — HTML generation for the dialog; selector has a `.vn-folder-row` (root folder name, "Выбрать папку", optional reset, search box, size slider), a breadcrumbs row, the compact current-bg bar and the gallery (max-height 600px). Atmosphere/particle/visual controls are **not** part of this manager — they moved to `VNEffectsManager` (see below and [atmosphere-system.md](atmosphere-system.md))
- **Breadcrumbs** (`.vn-bg-crumbs`) — root → … → current folder from `navigation` + `currentPath`; clicking a crumb calls `gotoDepth`. **Search** (`.vn-bg-search-input`, debounced) — `_ensureIndex()` crawls the whole root once (BFS, 6 folders in parallel, cap 3000 folders; reset on dialog open / root change); `_runSearch` matches all whitespace tokens against relative path + name and renders up to 240 cards (folders first; folder card action `goto`). `refreshGallery(root, selectedBg?)` returns to folder view and clears the search; Esc in the search box also clears it
- `attachListeners(root)` — delegated, idempotent; wires click/hover/input/keydown for gallery items, folder nav, breadcrumbs, current-bg bar, search, "use current scene bg" button, custom path input, and folder picker/reset/locate buttons
- `_openFolderPicker(root)` — opens `new FilePicker({ type: 'folder', ... })` pointed at the current folder; on selection: saves path via `saveCustomFolder`, calls `resetPath()` + `load()`, then `_rebuildSelector(root)`
- `_rebuildSelector(root)` — replaces `.vn-bg-section` `outerHTML` with fresh `generateSelector()` output and re-calls `attachListeners` (preserves current bg/overlay values)

## VNEffectsManager

Manages the dialog's "Effects" tab (`scripts/visual-dialog/vn-effects-manager.js`). Renders and wires three independent pieces:
- **Preset strip** (`.vn-effects-presets-row`) — one tile per legacy `EFFECT_GROUPS` entry (from `config/effects.js`); clicking sets both `#particle-effect` and `#visual-effect` hidden inputs from `PRESETS[id]` and highlights both grids to match.
- **Two icon-grid pickers** (`.vn-effects-inline-grid[data-axis="particle"|"visual"]`) — reuse the `.vn-atmo-item`/`.vn-atmo-group-header` tile styling from the runtime toolbar picker. Selecting a tile updates the corresponding hidden input and re-evaluates whether any preset still matches (`_syncPresetHighlight`).
- The relocated particle-layer switch (`#particles-layer`) and `particle-intensity` slider (previously rendered by `VNBackgroundManager`).

`generateTab(currentParticle, currentVisual, currentParticlesFg, currentParticleIntensity)` returns the tab HTML; `attachListeners(root)` wires clicks (delegated, idempotent via `root._vnEffectsDelegated`). `vn-dialog-builder.js` reads `#particle-effect`/`#visual-effect` the same way it reads any other hidden input — in `_handleSubmit`, `_setDefaults`, `applyPreset`, and `_gatherDialogState`.

Static helpers:
- `getCustomFolder()` — `game.settings.get('player-queue', 'backgroundFolder')` wrapped in try/catch; returns `''` on error
- `saveCustomFolder(path)` — `game.settings.set(...)`, async, errors silently

Supported image extensions: `jpg, jpeg, png, webp, gif`. Video: `mp4, webm, ogg, mov`.

## VNDialogBuilder

Owns both dialog types and all their interactions.

**Scene dialog** (open/edit): `DialogV2`, 1050×840, six tabs (Characters, Background, Effects, Music, Presets, Приключения). The tabs row also contains a **"Только ГМ" toggle** (`#vn-gm-only-toggle`, `<label class="vn-gm-only-toggle">`), pushed to the right via `margin-left: auto`. When checked, the created/updated scene sets `_gmOnly = true` on `VisualNovelScene` and skips socket broadcasting — players do not see it. Character tab uses drag-and-drop between available tokens, three position drop zones, and an actor favorites sidebar. Middle-click/right-click in dialog sets/removes favorites. `applyPreset(root, preset)` populates the dialog from a saved preset. `_moveTokensToPositions()` repositions token elements when opening in edit mode.

**"Участники сцены" section** (Characters tab) — permanent collapsible zone between "Доступные на сцене" and the position grid. Contains `<div class="vn-scene-participants" id="scene-participants">`. Actors dragged here are saved in `preset.presetActors` / `state.presetActors`. They are always available when loading or launching a preset, regardless of the current Foundry canvas. When `applyPreset` runs, actors are created in `#available-tokens` first, `_moveTokensToPositions` fills position slots, then participants are repopulated from `#available-tokens` (NOT via `_findTokenElement` to avoid pulling actors out of position slots). When `editSceneDialog` opens for an active scene, `_generateContent` pre-populates `#scene-participants` from `scene.state.presetActors` inline in the HTML. **Critical**: `_doCreateScene` must pass `presetActors: payload.presetActors || []` in its `fromPayload` call — if omitted, `scene.state.presetActors` stays `[]` and the section appears empty when the edit dialog is opened after a launch. **Critical**: preset save handlers must update `scene.state.presetActors = [...gatheredState.presetActors]` when `scene.state.isActive` — otherwise reopening the dialog resets participants to the stale state value.

Presets tab in folder mode remembers the last open folder (`VNPresetsManager.currentFolderId` setter persists it in `localStorage['player-queue.vn-presets-folder']`; `generateTab` restores it if the folder still exists). Switching scenes↔folders no longer resets it.

Background tab includes a **music drop zone** — drag a `PlaylistSound` from Foundry's Playlists sidebar onto it to assign scene music. The selected track name is shown with a clear button. The UUID (`Playlist.ID.PlaylistSound.ID` format) is stored in a hidden `#vn-music-uuid` input and read in `_handleSubmit()`. Methods: `_resolveSoundFromUuid(uuid)`, `_generateMusicSection(musicUuid)`, `_setupMusicDrop(root)`, `_setMusicInDialog(root, musicUuid)`.

Presets tab has a search bar (filters by name), a scene-filter toggle (shows only presets saved on the current Foundry scene), and a **"Delete all" button** (trash icon, `vn-preset-clear-all`) with a confirmation dialog before wiping. Delete/confirm dialogs use `classes: ['vn-confirm-dialog']` → CSS `z-index: 10300 !important` to appear above the main window.

**Macro generation** — preset action button `macro` (`fa-code`). Opens a `vn-confirm-dialog` with a read-only monospace `<textarea>` containing two lines of macro code (`// preset name` + `await window.launchVNPreset("id")`). Clicking the textarea auto-selects all text. The Copy button (`vn-macro-copy-btn`) calls `navigator.clipboard.writeText()` and shows an `ui.notifications.info`. Listeners are attached after `dlg.render({ force: true }).then(...)` — the `render()` Promise resolves once the element is in the DOM. Global entry point: `window.launchVNPreset(presetId)` in `main.js` — loads the preset via `VNPresets.load(id)` then calls `scene.createScene(preset)`.

**AbortController cleanup** — `_show()` creates `this._dialogAbortCtrl = new AbortController()` and resets `this._dropZones`/`this._dragEls` WeakSets. Every `addEventListener` call in the dialog receives `{ signal: this._dialogAbortCtrl.signal }`. The controller is aborted in the dialog's `close` event, removing all listeners automatically. Drop zones and draggable elements are tracked in WeakSets to prevent double-attachment when `_setupDragAndDrop` is called multiple times (e.g. after `applyPreset` adds new actor tokens).

**Adventure IO tab** ("Приключения"): lets the GM export selected presets to an adventure module and import presets from one. View toggle: detailed (**poster-tile card**: 190px wide, `aspect-ratio: 8/5`, background image fills the entire card, actor pips overlaid top-left, preset name overlay at bottom, styled circle checkbox in top-right corner; the entire card element is a `<label>` wrapping the checkbox — clicking anywhere on the card toggles selection) or compact (`<label>` row: styled square checkbox + preset name + optional scene badge; clicking anywhere on the row toggles selection). Presets are grouped by `sceneName`. Each group header has a group checkbox (`.vn-io-group-cb`, custom-styled with `appearance: none`) that selects/deselects all presets in the group; it shows `indeterminate` state when the group is partially selected. State stored on the builder instance: `_ioViewMode`, `_ioFoundModules`, `_ioSelectedModuleId`, `_ioModulePresets`. Key methods: `_generateIOSection(sorted)`, `_buildModuleSelect()`, `_buildNameplateSelect()`, `_buildIOPresetGroups(presets, idPrefix, allChecked)`, `_buildIOCardDetailed(preset, idPrefix, checked)`, `_syncGroupCb(groupEl)`, `_syncAllGroupCbs(listEl)`, `_attachIOListeners(root)`, `_showExportInstructions(moduleId, opts)`. `_rebuildExportList(root)` refreshes the export list after view-mode toggle.

**Export footer** has three rows: module select (`#vn-io-module-id`), nameplate select (`#vn-io-nameplate`, built from `NAMEPLATE_CONFIGS`), and folder input (`#vn-io-export-folder`) with a picker button (`#vn-io-pick-folder-btn`). On export, the selected nameplate and folder are passed to `_showExportInstructions(moduleId, { nameplate, backgroundFolder })` which passes them to `VNAdventureIO.moduleJsonSnippet(opts)` — the snippet includes those keys if non-empty.

**Import module items**: `_renderModulesList` reads `nameplate` and `backgroundFolder` from the scanned module entry and renders `.vn-io-apply-nameplate` / `.vn-io-apply-folder` buttons inline. Clicking applies the value to world settings immediately; nameplate also calls `applyNameplateImage()` to update CSS variables live.

**IO event delegation** — `_attachIOListeners` sets `exportListEl._ioListenerSet = true` on the list container and attaches a single `change` listener that handles both `.vn-io-group-cb` (toggles all child `.vn-io-preset-cb`) and `.vn-io-preset-cb` (calls `_syncGroupCb` to update indeterminate state). Same pattern for the import list. The guard prevents double-registration across re-renders.

**Listener deduplication** — `_attachPresetControlListeners` guards with `root._presetControlsAttached`; `_attachPresetItemListeners` guards with `listEl._presetItemListenerAttached`. Both flags prevent duplicate handlers from accumulating when `_attachPresetListeners(root)` is called on each `_refreshPresetList` call. Without the guards, static controls (pin button, save button, etc.) would receive a new listener on every preset save, causing toggle operations to fire and immediately undo themselves.

**`content-visibility: auto`** on `.vn-io-scene-group` — browser skips render and image loading for off-screen groups in the scroll container. Thumbnail images inside collapsed groups are not loaded until scrolled into view.

**Import duplicates**: before importing, calls `VNAdventureIO.classifyImport(toImport)` → `{ fresh, dupes }`. If no dupes, imports directly with a success notification. If dupes exist, shows a 3-button `DialogV2` ("Только новые (N)" / "Перезаписать все (N)" / "Отмена") using the manual Promise + close-listener pattern (see VNAdventureIO). Actor pips are 20×20px overlapping circles in IO card view (`_buildIOCardDetailed`, max 4, inlined directly), 24×24px in Presets card view (`_buildPresetCardHtml`, max 5 via `_buildActorPips`). "+N" badge when more exist.

Export module select is built by `_buildModuleSelect()` — lists **all installed modules** (not filtered by `m.active`), excluding `player-queue` itself, sorted by title, with `(неактивен)` suffix for inactive ones. Nameplate select is built by `_buildNameplateSelect()` from `NAMEPLATE_CONFIGS` (imported from `settings.js`); defaults to current world nameplate setting.

Export instructions dialog (`_showExportInstructions(moduleId, opts?)`) uses `classes: ['vn-instructions-dialog']` + `z-index: 10300 !important` (same CSS rule as `vn-confirm-dialog`) and is a **manual `DialogV2`** (not `DialogV2.prompt`) so a `render` listener can attach the copy-to-clipboard button (`navigator.clipboard.writeText`). When `opts.nameplate` or `opts.backgroundFolder` are provided, the dialog shows a brief summary list and the copied snippet includes those keys.

`VNDialogBuilder._generatePresetsSection(sorted)` is **synchronous** — accepts the pre-fetched sorted array. `_show()` calls `VNPresets.getSorted()` once and passes the result to both generators.

**Character visibility toggle** — each token card in the scene dialog has a `.vn-token-hide-btn` button. Clicking cycles `visible → hidden → name-hidden → visible` (defined in module-level `VIS_CYCLE`). The button icon changes: `fa-eye` / `fa-eye-slash` / `fa-user-secret`. The card stores current state in `data-visibility` attribute. `_collectVisibilityData(root, allRaw, allDeduped)` reads non-visible entries and returns a sparse `{ [tokenId]: 'hidden' | 'name-hidden' }` map. `applyPreset` and `_setDefaults` support both new `preset.visibility` and legacy `preset.hidden` (for BC). The icon/title for each state comes from `VIS_ICON` / `VIS_TITLE` maps.

**Preset migration badge** — `_buildPresetListItemHtml` and `_buildPresetCardHtml` call `countPendingMigrations(preset)` from `vn-migrations.js`. When count > 0, renders a `.vn-preset-migration-badge` chip (gold, `fa-wrench` icon) alongside the version tag with a tooltip `"Ожидает N миграций — нажмите «Перегенерировать»"`.

**Preset version display** — `_buildPresetListItemHtml` renders `<span class="vn-preset-version">v{version}</span>` inside `.vn-preset-meta` if `p.version` is set. `_buildPresetCardHtml` renders `<div class="vn-preset-card-version">` with the version string and migration badge. Presets without `version` show nothing for the version tag but still show the migration badge if migrations are pending.

**Scale dialog**: `DialogV2`, 380×auto. Range slider + preset buttons (50/75/100/125/150/200%). Live preview via debounced `setPortraitScale(val, false)` (local only); "For all" button emits to all clients.

## VNAdventureIO

`scripts/visual-dialog/vn-adventure-io.js`. Static-only utility class for cross-module preset exchange.

| Method | Description |
|---|---|
| `exportToModule(presets, moduleId)` | Creates `integrations/` and `integrations/player-queue/` dirs via `FilePicker.createDirectory` (errors ignored — dirs may already exist), then uploads to `modules/<moduleId>/integrations/player-queue/vn-presets.json` |
| `scanModules()` | Iterates **active modules only** (`m.active` filter), returns modules where `m.flags['player-queue']?.vnPresetsFile` is set; also reads `nameplateImage` and `backgroundFolder` from the same flags block; logs debug sample of active modules when nothing found |
| `fetchPresets(moduleId, presetsFile?)` | `fetch()` with `cache: 'no-cache'`, parses `{ version, presets }` envelope, returns array |
| `classifyImport(presets)` | Splits incoming presets into `{ fresh, dupes }` — fresh = new IDs not yet in world, dupes = IDs that already exist |
| `mergeImport(presets, overwrite = false)` | Reads existing settings, writes presets by `id`; `overwrite=false` skips duplicates, `overwrite=true` replaces them; returns count written |
| `moduleJsonSnippet(opts?)` | Returns the `"flags"` JSON snippet; `opts` may include `nameplate` (string) and `backgroundFolder` (string); non-empty values add corresponding keys to the snippet |

**Convention:** adventure modules declare compatibility by adding to their `module.json`:
```json
"flags": {
  "player-queue": {
    "vnPresetsFile": "integrations/player-queue/vn-presets.json",
    "nameplateImage": "modules/my-module/assets/nameplate.webp",
    "backgroundFolder": "modules/my-module/assets/scenes"
  }
}
```
`scanModules()` detects the `vnPresetsFile` flag. `nameplateImage` and `backgroundFolder` are optional — when present, the import UI shows "Apply" buttons that write the values to world settings instantly. Any path value for `vnPresetsFile` is honoured; the default in `fetchPresets` matches the convention above. After editing `module.json` a **Foundry server restart** is required for `game.modules` to reflect the change.

Export format:
```json
{ "version": 1, "presets": [ { ...presetObject }, ... ] }
```

Duplicate handling on import: `classifyImport()` splits incoming presets into fresh vs dupes. When dupes exist, a 3-button dialog lets the GM choose "Only new", "Overwrite all", or "Cancel". `mergeImport(presets, overwrite)` handles both modes. Multi-button `DialogV2` pattern: `new DialogV2({..., submit: result => resolve(result)})` + `dlg.addEventListener('close', () => resolve('cancel'), { once: true })` — required because `DialogV2.confirm()` only does two buttons.

## VNMigrations

`scripts/visual-dialog/vn-migrations.js`. Versioned preset migration system.

`MIGRATIONS` — array of `{ version: string, migrate(preset): preset }` entries. Each entry declares the module version it targets and a pure function that transforms one preset object. Currently one migration:
- `14.2.2` — converts old `hidden: { id: true }` → `visibility: { id: 'hidden' }`; skips presets that already have `visibility` or have no `hidden`.

`applyMigrations(preset)` — iterates `MIGRATIONS`, applies those where `foundry.utils.isNewerVersion(m.version, presetVersion)`. Presets without `version` are treated as `'0.0.0'` (all migrations apply). Returns the transformed preset (does NOT write to settings — only `regenerate()` does that).

`countPendingMigrations(preset)` — returns how many migrations would apply to a given preset. Used by `VNDialogBuilder` to show a badge in the preset list/cards UI.

**Migration is explicit, not automatic.** `fromPayload` and `applyPreset` provide runtime backward compat (old `hidden` format works transparently at runtime). Migrations only permanently rewrite the stored format when the GM clicks "Regenerate". To add a new migration: append an entry to `MIGRATIONS` with a `version` string higher than the current module version, bump `module.json` version to match.

## QueueBridge

Stateless adapter used by `VisualNovelScene` to read PlayerQueue data without creating a hard import dependency. Has no imports — accesses `window.playerQueueInstance` and `window.PlayerQueue` at runtime.

`resolveActorPriority(actor, queueData)` — finds a queue entry where `game.users.get(p.id).character.id === actor.id`, returns priority color data or `null`. This drives the priority badge (`.vn-queue-mark`) and the colored glow on in-scene characters.

Falls back to `game.settings.get('player-queue', 'queueState').entries` if the instance is not available.

## VNSceneHTML

`scripts/visual-dialog/vn-scene-html.js`. Generates all overlay HTML. Constructed with `(scene, rowConfig)` reference.

Key methods:
- `scene(tokens)` — returns the full `#vn-scene-overlay` HTML string (bg layer, FX layers, sides with characters, toolbar, queue display, maximized bar)
- `sideCharacters(tokens, position, queueData)` — HTML for one side's character list (used by `_updateSide` for incremental DOM updates)
- `computeRowLayout(count, position)` — determines multi-row distribution and returns `{ useMultiRow, rows }`

Separated from `VisualNovelScene` to keep the main class focused on logic and state.

## VNChatPanel

`scripts/visual-dialog/vn-chat-panel.js`. Embeds the Foundry chat application element inside the VN overlay when the chat button is toggled.

Constructor takes a getter function `() => this.$overlay`. Public API:
- `toggle()` — open/close cycle; guards against re-entry with `_busy` flag
- `close()` — returns the chat element back to its original position in the sidebar DOM

### Chat element detection

`_getChatElement()` — tries `document.getElementById('chat')` first (v13), then falls back to `ui.chat?.element` (v14+).

`_chatHasComposer(el)` — checks for **actual input elements** inside the container, NOT for form containers:
- `#chat-message` — prose-mirror element id (v14)
- `prose-mirror.chat-input` — prose-mirror by element + class (v14 fallback)
- `textarea[name="message"]` — v13
- `#chat-form` — v13 form by id

**Do NOT add `form` or `.chat-form` to this list.** In Foundry v14 with "card notifications" mode (the default), a `<form class="chat-form" data-application-part="input">` element exists in the DOM even when the chat tab is NOT active — but it is completely empty. Using `form` or `.chat-form` as selectors causes a false positive: the check passes, the code skips the tab-switch logic, and the moved element has no actual chat input.

### Sidebar restoration — why it's deferred

`_openPanel()` may need to temporarily switch the sidebar to the chat tab and expand it (if the form would not be detected otherwise). When this happens (`sidebarWasTemporarilyChanged = true`), the sidebar state is saved and must be restored.

**The restore is deferred to `close()`**, not done immediately after moving the chat element. If `_restoreSidebarAfterChatInit()` is called while the chat element already lives in the VN panel (e.g. in a `finally` block inside `_openPanel`), Foundry v14 processes the tab change and re-renders the chat application — stripping child elements including the composer form from the element we just moved.

The pending restore is held in `this._pendingSidebarRestore` and flushed by `_flushSidebarRestore()`, which is called from:
- `close()` — normal path after returning chat element to sidebar
- `toggle()` early-return path — if `_openPanel` aborts without fully opening
- `toggle()` catch block — if `_openPanel` throws

### Foundry v14 DOM structure differences

| Chat notifications setting | Chat tab active | `#chat-message` inside `ui.chat.element` |
|---|---|---|
| Card notifications (default) | yes | yes — full form rendered |
| Card notifications (default) | no | no — `<form class="chat-form">` exists but empty |
| Dot notifications (legacy) | any | yes — `#chat-notifications` always holds the input |

With dot notifications, `#chat-notifications` (inside `ui.chat.element`) renders the chat log and `prose-mirror` input regardless of which sidebar tab is active, so the tab-switch path is never needed.

The panel is styled via `.vn-chat-panel` rules in `visual-novel-scene.css` (dark theme override for Foundry's chat UI).

## vn-id-utils

`scripts/visual-dialog/vn-id-utils.js`. Pure utility functions with no side effects:

- `stripDupSuffix(id)` — removes `-dup-N` suffixes from token IDs (used when tokens are duplicated)
- `parseActorId(id)` — extracts the actor ID from `'actor-{actorId}'` format; returns null for plain token IDs
- `parsePlaylistUuid(uuid)` — parses `'Playlist.ID.PlaylistSound.ID'` into `{ playlistId, soundId }`
