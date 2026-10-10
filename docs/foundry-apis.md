# FoundryVTT APIs in Use

- **ApplicationV2 / DialogV2** (`foundry.applications.api`) — all UI windows; no legacy `Application` class
- **socketlib** — `socket.executeForEveryone('vnScene', …)` for VN scene only
- **game.socket** — raw socket for PlayerQueue (`module.player-queue` channel)
- **game.settings** — world-scoped for shared state; client-scoped for per-user prefs
- **FilePicker.browse** — runtime enumeration of background assets
- **Hooks**: `init`, `socketlib.ready`, `ready`, `renderSceneControls`, `canvasReady`, `playerQueueUpdated`, `playerQueueJoined`, `playerQueuePriorityChanged`, `playerQueueLeft`, `playerQueueAnnounced` (custom, fired by PlayerQueue on every client — see docs/player-queue.md); `game.keybindings.register` (`raiseHand`)
- **ChatMessage.create** — used by `announcePlayerAndRemove()` to post a chat announcement

`ui.notifications` is intentionally **not used** anywhere in this module — toast popups are visible to all players and clutter the screen. Silent failures or UI-driven feedback only.

## Hook: socketlib.ready timing

`VisualNovelScene._pendingSocket` is a static staging field. The socket is registered in `socketlib.ready` and stashed there; `initSocket()` consumes it in the `ready` hook when the VN instance is created. This avoids any timing dependency between the two hooks.
