# CSS Architecture

## Custom properties

- `--pq-*` — PlayerQueue widget (in `styles.css`)
- `--vn-*` — VN scene (in `visual-novel-scene.css`)
- `--portrait-scale` — set on `:root`; multiplies base portrait size
- `--char-scale` — per-character scale multiplier; set inline on `.vn-character` from `portraitScales` state
- `--flip-x` — `1` or `-1` on `.vn-character-img` for horizontal flip
- `--queue-color` — set inline on `.vn-character` when character is in queue; drives glow color
- `--vn-nameplate-image` — `url(...)` for the nameplate frame image; set on `:root` by `applyNameplateImage()`
- `--vn-nameplate-ratio` — width/height aspect ratio of the frame image
- `--np-text-width` — fixed width of the text element in px (= nameplate display width, always this size)
- `--np-offset-y` — vertical shift of frame image from text center in px (positive = image down)
- `--np-font-size` — text font size

## Dark theme

`.player-queue-dark-theme` on `<body>` (toggled by `updateTheme()`). Controlled by `darkTheme` client setting.

## Nameplate image system

Per-nameplate parameters live in `NAMEPLATE_CONFIGS` in `settings.js`. Each entry maps a file path to `{ label, ratio, textWidth, offsetY, fontSize }`. `applyNameplateImage(path)` reads this config and sets five CSS variables on `:root`, then adds class `vn-nameplate-has-image` to `<body>`.

The frame image lives in `::before` on `.vn-character-nameplate` (the wrapper), not on the text element. The wrapper auto-sizes to its flex child (the text), so `width: 100%` on `::before` tracks the text width. `aspect-ratio: --vn-nameplate-ratio` preserves proportions — no distortion. The text element has a fixed `width: --np-text-width` regardless of name length, so every nameplate renders at the same size. The text element uses `overflow: hidden; text-overflow: ellipsis` to clip names that would exceed that width.

The settings dropdown auto-populates via a `renderSettingsConfig` hook that calls `FilePicker.browse()` each time the settings dialog opens — no code changes needed when adding new nameplate images to the assets folder.

When `path` has no leading `/` or `http`, `applyNameplateImage` prepends `/` to prevent the CSS `url()` from being resolved relative to the stylesheet file location (which is `styles/visual-novel-scene.css`, not the server root).

The path is passed through `escapeCSSUrl(url)` (defined in `settings.js`) before insertion into `url("...")`. It escapes `\` → `\\`, `"` → `\"`, and strips newlines — prevents CSS injection if the path contains special characters.

**Nameplates are not themed by visual effects.** `vn-fx-theming.css` has no `.vn-vfx-*` rules for `.vn-nameplate-text` (no per-effect colors, no flicker/glitch/pulse). The only nameplate animation is the generic `vnNameplateGlow` on the active speaker, with a fixed neutral glow colour (it does not use `--vn-accent-glow`). The speaking indicator and scene title are still themed per effect.

## Hidden character silhouette (`vn-character-hidden`)

The class `.vn-character-hidden` on `.vn-character` renders a black silhouette (image) and hides the glow. The CSS rule that enforces this **must use `#vn-scene-overlay`** as the leading selector:

```css
#vn-scene-overlay .vn-character.vn-character-hidden .vn-character-img {
    filter: brightness(0) !important;
    animation: none !important;
}
```

**Why the ID selector is required:** atmosphere effect rules in the `vn-fx-*.css` group files target active characters with selectors like `.vn-vfx-divine .vn-character.active .vn-character-img` (specificity 0-4-0) and the storm lightning rule reaches 0-5-0. When two `!important` declarations compete, higher specificity wins — so a class-only hidden rule (max 0-3-0) loses to every per-effect rule. `#vn-scene-overlay` adds 1-0-0 (ID), giving 1-2-0 which beats any class-only chain regardless of how many classes effects chain. Do **not** reduce this selector back to class-only.

## Z-index stacking (custom)

Foundry's default window z-index is too low and conflicts with other modules. The module forces higher values via CSS `!important` (Foundry uses inline styles, so `!important` wins):

- `.application:has(.vn-scene-dialog), .application:has(.vn-scale-dialog)` → `z-index: 10100 !important`
- `.application.vn-confirm-dialog` → `z-index: 10200 !important` (delete confirmation, must be above the scene dialog)

If adding new DialogV2 windows that must float above the scene dialog, use `classes: ['some-class']` and add an `!important` rule at or above 10100.

## em font-size compounding

`em` on `font-size` is relative to the **parent's computed size**, so containers with `font-size: Xem` and children with `font-size: Yem` compound: effective size = X × Y × base. To make an inner element use the container's size verbatim (not compound further), set `font-size: 1em` on it — it inherits the parent's computed value as-is.

Example: `.vn-panel-tags-chips { font-size: 0.85em }` + `.vn-panel-tags-chips .vn-tag-chip { font-size: 1em }`. The chip appears at 0.85× base. Without the override, `.vn-tag-chip { font-size: 0.65em }` would compound to 0.65 × 0.85 ≈ 0.55× base.

## Dialog-tab CSS split (mirrors JS managers)

`styles/visual-novel-scene.css` used to hold all VN CSS (overlay + every dialog tab) in one ~4200-line file. Per-tab rules now live in `styles/visual-dialog/dialog/vn-<tab>-manager.css`, one file per JS manager in `scripts/visual-dialog/dialog/` (background, effects, music, presets, adventure-io). All 5 are listed directly in `module.json`'s `"styles"` array (no `@import` — unlike `visual-effects/index.css`).

`visual-novel-scene.css` keeps: the VN overlay itself (characters, nameplate, speaking indicator, multi-row layout), DialogV2 chrome shared by every tab (`.vn-btn*`, `.vn-tabs`, `.vn-collapsible*`, dialog z-index tiers), the Characters/drag-drop tab (it has no manager — stays in the `VNDialogBuilder` orchestrator per design), the toggle-switch component (reused by Background/Effects/GM-only-toggle/Player Queue widget), Scale Dialog, scrollbars, and responsive overrides.

**When adding a rule for a specific tab, put it in that tab's `vn-*-manager.css`, not in the core file — and don't trust old section-comment headers as a boundary reference.** Before this split, two blocks were physically mislabeled (particle-intensity control sat under a "Background Section" comment but is Effects-only; the background gallery/thumbnail grid sat under an "Effects Tab" comment but is Background-only) — comments had drifted from actual usage. If unsure which tab owns a selector, grep the class name across `scripts/visual-dialog/dialog/*.js` rather than trusting a nearby comment.

`scripts/main.js`'s standalone `openScenePresets()` picker (unrelated to the dialog-builder tabs) reuses `.vn-preset-card*` classes for visual consistency — they live in `vn-presets-manager.css` since that's the primary owner. If you rename/remove those classes while editing the Presets tab, check `main.js` too.

## VN overlay CSS import order (index.css)

Order matters: base → effect groups → particles → characters → theming. Characters depend on effects (breathing animation uses effect-defined keyframes); theming depends on effects selectors.

The monolithic `vn-fx-effects.css` has been split into five group files loaded after base, in this order:

1. `vn-fx-magic.css` — divine, warm, cold, dream, sacred, ethereal + bloom (divine/sacred/ethereal) + grain overrides
2. `vn-fx-dark.css` — eldritch, dark, corruption, abyss, shadow_intrigue + grain overrides
3. `vn-fx-chaos.css` — fire, apocalypse, blood_moon, void_breach+crack, cosmic_horror, glass_shatter + bloom (fire) + grain overrides
4. `vn-fx-nature.css` — storm, underwater, moonlight, sandstorm + grain overrides
5. `vn-fx-special.css` — carnival, ghosts + grain overrides

Bloom and film-grain overrides live **inside their group file**, not in a shared utility file. If adding a new effect, put its bloom/grain overrides at the bottom of the same file.
