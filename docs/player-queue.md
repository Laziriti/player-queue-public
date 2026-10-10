# System 1 — PlayerQueue

## Singleton lifecycle

`PlayerQueue.initialize()` is called in the `init` hook. It creates the module-private `playerQueueInstance`, then sets `window.PlayerQueue = PlayerQueue` (class) and `window.playerQueue = playerQueueInstance`. Always access the instance via `PlayerQueue.instance` (not the module-private variable).

## Module layout (`scripts/queue/`)

`PlayerQueue` is a thin coordinator and the public API; the work lives in focused classes it composes (`instance.model`, `.network`, `.sound`, `.dialog`, `.widget`):

| File | Class | Responsibility |
|------|-------|----------------|
| `queue-constants.js` | — | `PRIORITIES`, `VALID_PRIORITIES`, `FALLBACK_AVATAR`, cooldowns, `getPriorityData()`, `setting()`, `applyForcedTheme()`, `priorityTooltip()` |
| `queue-model.js` | `QueueModel` | State (`rev`, `nextOrder`, frozen sorted `entries`), `normalize()`, `adopt()`, draft helpers (`setPriority`, `remove`, `clear`) — no networking, no DOM |
| `queue-network.js` | `QueueNetwork` | GM-authority: `request()` (client), `handleRequest()` / `#mutate()` / `#persist()` (host), throttling; owns `QueueNetwork.socket` |
| `queue-sound.js` | `QueueSound` | Audio cache, `play()`, `playRemote()` (per-user cooldown) |
| `queue-dialog.js` | `QueueDialog` | Queue window, `HandlebarsApplicationMixin(ApplicationV2)` |
| `queue-widget.js` | `QueueWidget` | Floating draggable queue |

Rules of thumb: add state transformations to `QueueModel`, anything that talks to other clients to `QueueNetwork`, and keep `PlayerQueue` limited to wiring and the actions that the console API / UI call. `PlayerQueue.PRIORITIES`, `.getPriorityData`, `.setting`, `.FALLBACK_AVATAR`, `.socket` stay as static aliases because other files and the browser console use them.

In the `ready` hook, `PlayerQueue.instance.loadQueue()` reads the persisted `queueState` (every client, GM or not) and calls `updateDisplay()`.

## Priority system

Three priorities stored as numbers 0/1/2:

| Value | Label | Name (i18n key)              | Color   | Sound file   |
|-------|-------|------------------------------|---------|--------------|
| 0     | !     | `playerQueue.priority.low`   | #28a745 | request0.wav |
| 1     | !!    | `playerQueue.priority.medium`| #ffc107 | request1.wav |
| 2     | !!!   | `playerQueue.priority.high`  | #dc3545 | request2.wav |

`PRIORITIES[n].name` is an i18n key, not a display string. All display sites call `game.i18n.localize(pd.name)`.

Sort order: priority descending, then `order` ascending (`order` is a counter assigned by the host, so earlier arrival = higher position within the same priority). No client clock is involved in ordering.

## GM-authority model

The **active GM** (`game.users.activeGM`, the "host") is the only client that mutates the queue. Everyone else sends *requests* and receives the result through a world setting. This removes sender spoofing, clock-skew ordering bugs, and the old timer-based resync.

```
player ──request──▶ host (active GM) ──game.settings.set('queueState')──▶ onChange on every client
```

### State shape (`queueState`, world setting, `config: false`)

```js
{ rev: number, nextOrder: number, entries: [{ id, name, avatar, priority: 0|1|2, order, timestamp }], last: { type, ids, by } | null }
```

- `rev` increments on every committed mutation. A client ignores an `onChange` whose `rev` equals its own (the host's echo); the host also ignores echoes older than its own `rev`.
- `nextOrder` is the next value of the arrival counter; `normalizeState` keeps it above every stored `order`.
- `last` records what produced this rev (`join` / `change` / `leave` / `remove` / `announce` / `clear` / `resync`, affected user ids, acting user). It is how every client knows *why* an entry vanished when it fires the event hooks below.
- `timestamp` is `Date.now()` of the host at join/priority change, informational only (not used for sorting).
- `name`/`avatar` are re-read from live `game.users` on every client in `PlayerQueue._normalizeState()`, which also drops unknown users and invalid priorities.

### Persistence and late joiners

The state *is* the persistence: world settings are readable by all clients, so a player who loads or reconnects gets the current queue from `loadQueue()` — there is no `sync` message and no delay timers. **There is no auto-leave:** a disconnect or page reload never removes a player, so F5 keeps their place. Stale entries (a player who left for good) are removed by the GM (`remove` / `clear`). Entries of deleted users are still dropped by `normalize()`.

Floating widget position stored in `localStorage` under key `player-queue-position` as `{x, y}`.

### Requests (socketlib handler `playerQueueRequest`)

Requests are sent with `socket.executeAsUser('playerQueueRequest', activeGM.id, req)` — deliberately not `executeAsGM`, because socketlib runs `executeAsGM` *locally* on any GM, which would let two GMs act as hosts at once. If the caller is the host, `handleRequest()` runs directly. No active GM → the player gets the `playerQueue.notify.noGM` warning and nothing is queued.

The handler in `main.js` is a regular `function` and reads the trusted sender from `this.socketdata.userId` (server-supplied) and passes it to `PlayerQueue.handleRequest(req, sender)`. Never trust identity fields inside `req`. `handleRequest` returns `{ ok, reason? }` (`reason`: `no-gm`, `not-host`, `not-ready`, `invalid`, `forbidden`, `throttled`, `error`).

| Action   | Allowed for | Payload          | Effect                                                                 |
|----------|-------------|------------------|------------------------------------------------------------------------|
| `join`   | anyone      | `{ priority }`   | Adds the sender; if already queued, only a *higher* priority applies  |
| `change` | anyone      | `{ priority }`   | Changes the sender's priority; new `order` → end of the new group      |
| `leave`  | anyone      | `{}`             | Removes the sender                                                     |
| `remove` | GM          | `{ userId }`     | Removes that user                                                      |
| `announce` | GM        | `{ userId }`     | Removes that user, tagged `announce` so clients fire `playerQueueAnnounced`; returns `ok:false` if they were not queued |
| `clear`  | GM          | `{}`             | Empties the queue                                                      |
| `resync` | GM          | `{}`             | Re-commits the current state with `rev + 1` (macro `syncQueue()`)      |

Mutations run through `_mutate(fn)`: serialized on `_hostChain`, `fn` edits a cloned draft and returns `true` if something changed, then the host applies the new state locally (`_applyState`) and persists it (`_persist`).

### Announcing

`announcePlayerAndRemove(userId)` (GM): sends `announce`; on `ok`, if the world setting `announceInChat` is on, posts a chat card rendered from `templates/queue-announce.hbs` (portrait, name, "is speaking now", priority; styles `.pq-announce*`; message flag `flags.player-queue.announce`). The `playerQueueAnnounced` hook is also what makes the dialog scene react: `main.js` listens on the announcing GM's client only (`by === game.user.id`) and calls `VisualNovelScene.focusQueuedSpeaker(userId)` — if that user's character is on the scene it becomes the active speaker, other *players'* characters that were active are deactivated (NPCs untouched); if their character is not on the scene nothing changes.

### Sounds

Remote sounds are derived from state diffs in `_applyState()`: any entry (other than the local user) that is new or changed priority triggers `_playRemoteSound()`. The local user's own sound is played after their request returns `ok`.

### Anti-spam

Client: `join`/`changePriority` are throttled by `ACTION_COOLDOWN_MS` (700 ms). Host: `join`/`change` from the same sender closer than `MIN_REMOTE_INTERVAL_MS` (300 ms) are rejected (`throttled`). Remote sounds play at most once per `SOUND_COOLDOWN_MS` (1500 ms) per user.

### Joining twice

`joinQueueWithPriority(p)` (also used by `window.joinQueueLow/Medium/High`) for a player already in the queue behaves like `changePriority(p)`: a different `p` moves them (up or down — so an accidental "high" can be fixed with `joinQueueLow()`) and puts them last within the new priority group; the same `p` is a no-op and never costs them their place.

After every state change on a client, `updateDisplay()` re-renders the dialog (if open), updates the widget and fires `Hooks.callAll('playerQueueUpdated', queue)`.

**Event hooks** are derived in `PlayerQueue.applyState()` from the diff between two committed states (using `state.last` for the reason), so each fires exactly once on **every** client — not only the GM's. Payloads are objects:

| Hook | Payload |
|------|---------|
| `playerQueueJoined` | `{ entry, queue }` |
| `playerQueuePriorityChanged` | `{ entry, previousPriority, queue }` |
| `playerQueueLeft` | `{ entry, reason: 'left'\|'removed'\|'cleared', by, queue }` |
| `playerQueueAnnounced` | `{ entry, by, queue }` — `by` is the GM who announced; the entry is no longer in `queue` |

`entry` is the frozen entry as it was; `queue` is the new frozen snapshot. `playerQueueUpdated` (after every change, payload = `queue`) still fires first. A client that misses an intermediate `rev` only sees the diff of the last one.

**Hook payload is immutable.** `queue` (also `PlayerQueue.instance.queue`) is a sorted, deeply frozen snapshot that `QueueModel.adopt()` replaces on every change. Subscribers can keep it and compare by identity, but cannot mutate it (writes throw in strict mode). To change the queue, send a request through `PlayerQueue.instance` (`joinQueueWithPriority`, `removePlayerFromQueue`, …).

## UI components

**Queue window** (`QueueDialog`, `ApplicationV2` + Handlebars): opens via `toggleQueue()` / `openQueue()`; a single instance is reused (`id: player-queue-dialog`). Template: `templates/queue-window.hbs`, one root (`section.pq-win`) with three zones:
- **Header** (`.pq-head`): "players in queue" counter and a chip with the next speaker.
- **List** (`.pq-body` → `ol.pq-list`, the only scrolling zone): one `li.pq-row` per entry — position, portrait ringed in the priority color, name, priority name, "next" / "you" pills, the `request0..2.webp` flag. Own row: accent outline. First row: tinted background. The GM gets two real buttons per row — `announce` (announce (chat card + remove)) and `remove` (remove silently) — instead of the old hidden click / right-click. Empty queue shows an empty state.
- **Panel** (`footer.pq-panel`): not in the queue → "Raise your hand" with three big priority cards (`join`); in the queue → segmented priority switch (`change`, `aria-pressed`) plus "Leave" (`leave`). The GM also gets "Clear queue" (`clear`).

Data comes from `_prepareContext()`; every control is an ApplicationV2 `actions` entry (`data-action`, priority in `data-priority`, target in `data-user-id`). Any queue change re-renders the whole part (`scrollable: ['.pq-body']` keeps the scroll position); `_preRender`/`_onRender` remember the focused button and give focus back, so keyboard use isn't interrupted. The window is a container-query layout (`container-type: inline-size`): below 380 px the priority cards stack vertically and the row drops the flag.

**Themes.** The window has no colors of its own. Foundry puts `theme-dark` / `theme-light` on `<body>` (core setting *Color Scheme → Applications*, or the browser preference when left on default) and `body.theme-light .application` / `body.theme-dark .application` define the window variables. The CSS therefore uses only Foundry variables — `--color-text-primary`, `--color-text-secondary`, `--background` (inherited from the frame) — and builds translucent surfaces with `color-mix(in srgb, var(--color-text-primary) N%, transparent)`, which flips automatically between a light haze on dark and a dark haze on parchment. Priority colors (green / yellow / red) stay fixed; text on a filled yellow control is dark. The module setting `darkTheme` is a *force dark* override for this window: `applyThemeOverride()` toggles Foundry's own `themed theme-dark` classes on the window element (re-applied on every render and from `PlayerQueue.updateTheme()`). Do not add `!important` backgrounds back to `.pq-queue-window`.

**Floating queue widget** (`QueueWidget`, element `#floating-queue`): `update()` uses differential DOM updates — only adds/removes/reorders changed elements. Disappears when the queue is empty. Respects settings: `queueOrientation`, `queueSize`, `queueMaxItems`, `queuePosition`, `queueCompact`; the settings' `onChange` calls `widget.rebuild()`.

*Visual language (widget + dialog + VN overlay queue):*
- **Priority is never color-only.** Every portrait carries a `.priority-flag` image (`assets/request0..2.webp` = 1–3 exclamation marks, URL from `priorityIconUrl()`) centered on the circle's top-right rim, plus a `.queue-position` badge (the number) on the bottom-right rim. `.queue-player` must NOT clip (`overflow: visible`): only `img.queue-portrait` is rounded, otherwise the circle cuts the badges; `.queue-items` has padding so the scroll container doesn't cut them either. In the VN overlay the same cues are `.vn-queue-flag` and `.vn-queue-number`.
- **Next speaker.** The first entry gets `.is-next` (white ring + glow in its priority color; pulsing in the widget).
- **Animations** (all skipped under `prefers-reduced-motion`): new portraits get `.entering` (`fadeIn`, class removed on `animationend` so re-ordering never replays it); removed portraits are taken out of flow with `.leaving` (`queueLeave`) so the rest slide immediately; surviving portraits that moved are animated with a FLIP pass (`element.animate`, `FLIP_MS`). The dialog does not animate — it re-renders as a whole.
- **Compact mode** (`queueCompact`): `.queue-compact` button = users icon + count + the priority image of the first entry (the highest priority), border in its color; click opens the dialog. `update()` recreates the element when the mode differs from the setting.

*Input and accessibility:*
- Dragging uses **pointer events** with pointer capture (mouse, touch, pen); `.drag-handle` has `touch-action: none`. The handle is focusable (`role="button"`): arrow keys move the widget by 10 px (Shift: 50 px) and persist the position.
- Widget: `role="region"` labelled with the queue title, `.queue-items` is `role="group"`, each portrait is `role="button" tabindex="0"` with an `aria-label` from `queueItemLabel()` ("Name, position N, priority: X, next"). Enter/Space = click (open the dialog; GM: announce), Delete/Backspace = remove (GM, same as right click), arrows move focus.

**Queue during a dialog scene** (client setting `queueDuringScene`, for GM and players alike):
- `top` (default): while a scene is open on this client and not minimized, `widget.update()` removes `#floating-queue` (`#isMovedIntoScene()`), and the queue is drawn in the scene's top panel (`.vn-queue-display`, `VNSceneHTML.queueDisplay()`). Everybody sees the panel; only the GM gets clickable items (`.gm-clickable`: left click announces, right click removes).
- **Hand button.** Players (not the GM) always get the panel, even with an empty queue, with a round hand button (`.vn-queue-hand`, `aria-expanded`). Clicking it unfolds a picker under the panel (`VNSceneHTML.handControl()`): three round priority buttons with the `request0..2.webp` icons (`.vn-queue-pick`, the current one `.active`) and, if the hand is already raised, a "lower hand" button (`.vn-queue-lower`). A pick goes through `QueueBridge.joinWithPriority()` (joins, or changes priority if queued), lower through `QueueBridge.leaveQueue()`. The open state lives in `VisualNovelScene._handPickerOpen` (the panel is rebuilt on every queue change, so it must survive re-renders; `updateQueueDisplay()` also restores keyboard focus); it closes on pick, Escape (before Escape would close the scene), a mousedown outside `.vn-queue-hand-wrap`, and scene close. Handlers: `_setupHandListeners()`. The keybinding `raiseHand` (default `H`, rebindable in Foundry's controls, registered in `main.js`) is the quick path: raise with the lowest priority, or lower if raised (`PlayerQueue.toggleHand()`), only while a scene is open and not minimized on a player's client — otherwise it returns `false` and Foundry keeps the key.
- `keep`: the floating widget stays as it is, the scene panel is not drawn (`QueueBridge.queueInScene` is false).

The widget is re-evaluated through `QueueBridge.refreshFloating()` (→ `PlayerQueue.instance.updateFloatingQueue()`, an alias of `widget.update()`) at every moment the answer can change: scene created (end of `_doCreateScene`), minimized/maximized (`setMinimized`), closed (`closeScene`, 200 ms later), and when the setting changes. The scene panel itself is refreshed on every client by `updateQueueDisplay()` from the `playerQueueUpdated` hook (no socket event is involved; the old `updateQueue` message was removed). The same call also refreshes the queue marks on in-scene characters for everyone: a character whose player is queued gets a `.vn-queue-mark` image (the `request0..2.webp` exclamation badge, `VNSceneHTML.queueMark()`) in its top-right corner, bobbing (hidden for `.vn-character-hidden`). It is a separate element and puts **no filter on the portrait**, so it can't fight the atmosphere effects; `_updateCharacterBorders()` adds/removes/retargets it in place so the animation doesn't restart. The under-feet glow still takes the priority color.

**Listener scope.** The hand button's click handler (`SEL.QUEUE_HAND`) is registered in `activateSceneListeners()` for everybody; the GM-only queue-item handlers live in `_setupGMListeners()`. Anything a player must be able to click must not be registered there.

## Scene controls

Two scene-controls buttons are injected into `#scene-controls-layers` by `addQueueControl()` in `main.js`:
- **Очередь игроков** (`data-control="queue"`, `fa-users`) — all users; calls `PlayerQueue.instance.toggleQueue()`
- **Диалоговая сцена** (`data-control="vn-scene"`, `fa-theater-masks`) — GM only; calls `window.visualNovelScene.openSceneDialog()`

`addQueueControl()` is idempotent: it removes any existing button with the same `data-control` before adding, so re-calling never duplicates. It is wired to both the `renderSceneControls` hook and the `canvasReady` hook. A `MutationObserver` on `#scene-controls` (`_ensureControlObserver()`) re-fires `addQueueControl()` whenever the controls list is mutated by Foundry navigation, keeping buttons persistent across scene switches without a page reload.

## Sound test window

`SoundTestApp` (`scripts/sound-test.js`, settings menu): `HandlebarsApplicationMixin(ApplicationV2)` + `templates/sound-test.hbs`, three priority buttons (`data-action="play"`) and a status list. Like the queue window it uses only Foundry theme variables (`.pq-sound-test-win`) and honors `darkTheme` through `applyForcedTheme()`.

## Settings

| Key                    | Type    | Default        | Scope  | Notes                                          |
|------------------------|---------|----------------|--------|------------------------------------------------|
| queueState             | Object  | `{rev:0,nextOrder:1,entries:[]}` | world | Hidden; written only by the host GM, `onChange` drives all clients |
| queuePosition          | String  | 'bottom-right' | client | Clears localStorage on change                  |
| queueOrientation       | String  | 'vertical'     | client | 'vertical' or 'horizontal'                     |
| queueSize              | Number  | 50             | client | Portrait px size, 30–100                       |
| queueMaxItems          | Number  | 8              | client | Before scroll appears, 3–15                    |
| queueCompact           | Boolean | false          | client | Single count badge instead of portraits        |
| queueDuringScene       | String  | 'top'          | client | 'top' = queue moves into the dialog scene's top panel; 'keep' = floating widget stays |
| announceInChat         | Boolean | true           | world  | Post a chat card when the GM announces a player |
| enableSounds           | Boolean | true           | client |                                                |
| soundVolume            | Number  | 50             | client | 0–100 %                                        |
| soundOnlyForSelf       | Boolean | false          | client |                                                |
| enableLowPrioritySound | Boolean | true           | client |                                                |
| enableMediumPriority…  | Boolean | true           | client |                                                |
| enableHighPriority…    | Boolean | true           | client |                                                |
| darkTheme              | Boolean | false          | client | Toggles `.player-queue-dark-theme` on `<body>` and forces the queue window dark (otherwise it follows Foundry's color scheme) |

Sound files are cached in `_audioCache: Map` to avoid re-creating `Audio` objects.
