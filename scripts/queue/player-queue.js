// ============================================================
// player-queue.js — PlayerQueue: coordinator and public API of the queue
//
//   queue-model.js    QueueModel    state (rev / nextOrder / frozen entries) and pure transformations
//   queue-network.js  QueueNetwork  GM-authority requests, host-side handling, persistence
//   queue-sound.js    QueueSound    priority sounds
//   queue-dialog.js   QueueDialog   queue window (ApplicationV2)
//   queue-widget.js   QueueWidget   floating draggable queue
// ============================================================

import {
    MODULE_ID, FALLBACK_AVATAR, PRIORITIES, VALID_PRIORITIES, getPriorityData, priorityIconUrl, setting
} from './queue-constants.js';
import { QueueModel } from './queue-model.js';
import { QueueNetwork } from './queue-network.js';
import { QueueSound } from './queue-sound.js';
import { QueueDialog } from './queue-dialog.js';
import { QueueWidget } from './queue-widget.js';

let playerQueueInstance = null;

class PlayerQueue {
    static ID = MODULE_ID;
    static PRIORITIES = PRIORITIES;
    static VALID_PRIORITIES = VALID_PRIORITIES;
    static FALLBACK_AVATAR = FALLBACK_AVATAR;
    static getPriorityData = getPriorityData;
    static priorityIconUrl = priorityIconUrl;
    static setting = setting;

    /** socketlib module socket (assigned in main.js on `socketlib.ready`). */
    static get socket() { return QueueNetwork.socket; }
    static set socket(value) { QueueNetwork.socket = value; }

    constructor() {
        this.isLoaded = false;
        this.model = new QueueModel();
        this.network = new QueueNetwork(this);
        this.sound = new QueueSound();
        this.dialog = null;
        this.widget = new QueueWidget(this);
    }

    static initialize() {
        playerQueueInstance = new PlayerQueue();
        window.PlayerQueue = PlayerQueue;
        window.playerQueue = playerQueueInstance;
        return playerQueueInstance;
    }

    static get instance() {
        return playerQueueInstance;
    }

    // ── State access ──

    /** Sorted, frozen snapshot. Replaced on every change — safe to keep or pass to hooks, impossible to mutate. */
    get queue() { return this.model.entries; }

    get rev() { return this.model.rev; }

    get isOpen() { return !!this.dialog?.rendered; }

    isInQueue(userId) {
        return this.model.has(userId);
    }

    // ── Loading and applying state ──

    async loadQueue() {
        if (this.isLoaded) return;

        try {
            this.model.adopt(QueueModel.normalize(setting('queueState')));
        } catch (error) {
            console.error('Error loading queue:', error);
        }

        this.isLoaded = true;
        this.updateDisplay();
    }

    /** Applies a new state on any client; sounds for other people's actions come from the diff with the old queue. */
    applyState(state) {
        const prevEntries = this.model.entries;
        const prev = this.model.priorities();
        this.model.adopt(state);

        for (const e of this.model.entries) {
            if (e.id === game.user.id) continue;
            if (prev.get(e.id) !== e.priority) this.sound.playRemote(e.id, e.priority);
        }

        this.updateDisplay();
        this.#fireEventHooks(prevEntries);
    }

    /**
     * Fine-grained hooks, derived from the diff between two committed states, so they fire exactly once on every
     * client. `last` (written by the host) says why an entry disappeared: left / removed / cleared / announced.
     */
    #fireEventHooks(prevEntries) {
        const { entries: next, last } = this.model;
        const queue = this.queue;
        const nextById = new Map(next.map(e => [e.id, e]));
        const prevById = new Map(prevEntries.map(e => [e.id, e]));

        for (const entry of next) {
            const before = prevById.get(entry.id);
            if (!before) Hooks.callAll('playerQueueJoined', { entry, queue });
            else if (before.priority !== entry.priority) {
                Hooks.callAll('playerQueuePriorityChanged', { entry, previousPriority: before.priority, queue });
            }
        }

        for (const entry of prevEntries) {
            if (nextById.has(entry.id)) continue;
            const by = last?.by ?? '';
            if (last?.type === 'announce') {
                Hooks.callAll('playerQueueAnnounced', { entry, by, queue });
                continue;
            }
            const reason = last?.type === 'leave' ? 'left' : last?.type === 'clear' ? 'cleared' : 'removed';
            Hooks.callAll('playerQueueLeft', { entry, reason, by, queue });
        }
    }

    /** onChange of the world setting `queueState` — the only channel through which state reaches other clients. */
    onStateSetting(raw) {
        if (!this.isLoaded) return;

        const state = QueueModel.normalize(raw);
        if (state.rev === this.model.rev) return;
        if (state.rev < this.model.rev && this.network.isHost) return;

        this.applyState(state);
    }

    // ── Theme and sound ──

    updateTheme(isDark) {
        document.body.classList.toggle('player-queue-dark-theme', isDark);
        this.dialog?.applyThemeOverride();
    }

    playPrioritySound(priority, isOwnAction = false) {
        this.sound.play(priority, isOwnAction);
    }

    // ── Queue window ──

    async toggleQueue() {
        if (this.isOpen) {
            await this.dialog.close();
            return;
        }
        await this.openQueue();
    }

    async openQueue() {
        this.dialog ??= new QueueDialog(this);
        await this.dialog.render({ force: true });
    }

    // ── Actions (every mutation is a request to the host GM) ──

    async joinQueueWithPriority(priority) {
        if (!VALID_PRIORITIES.has(priority)) return;

        // Уже в очереди — меняем приоритет в любую сторону (случайный «красный» можно тут же исправить макросом)
        if (this.model.has(game.user.id)) {
            await this.changePriority(priority);
            return;
        }

        if (this.network.isLocallyThrottled()) return;

        const result = await this.network.request('join', { priority });
        if (result.ok) this.playPrioritySound(priority, true);
    }

    async changePriority(priority) {
        if (!VALID_PRIORITIES.has(priority)) return;

        const player = this.model.get(game.user.id);
        if (!player || player.priority === priority) return;
        if (this.network.isLocallyThrottled()) return;

        const result = await this.network.request('change', { priority });
        if (result.ok) this.playPrioritySound(priority, true);
    }

    /** Raise the hand (lowest priority) or lower it if already raised — the one-button flow for the scene panel / hotkey. */
    async toggleHand() {
        if (this.isInQueue(game.user.id)) await this.leaveQueue();
        else await this.joinQueueWithPriority(PRIORITIES.LOW.value);
    }

    async leaveQueue() {
        if (!this.isInQueue(game.user.id)) return;
        await this.network.request('leave');
    }

    async clearQueue() {
        if (!game.user.isGM) return;
        await this.network.request('clear');
    }

    async announcePlayerAndRemove(userId) {
        if (!game.user.isGM) return;
        const player = this.model.get(userId);
        if (!player) return;

        const result = await this.network.request('announce', { userId });
        if (result.ok && setting('announceInChat')) await this.#postAnnounceCard(player);
    }

    async #postAnnounceCard(player) {
        const pd = getPriorityData(player.priority);
        const content = await foundry.applications.handlebars.renderTemplate(
            `modules/${MODULE_ID}/templates/queue-announce.hbs`,
            {
                name: player.name,
                avatar: player.avatar,
                fallbackAvatar: FALLBACK_AVATAR,
                color: pd.color,
                icon: priorityIconUrl(player.priority),
                priorityName: `${game.i18n.localize(pd.name)} ${game.i18n.localize('playerQueue.priority.suffix')}`,
                text: game.i18n.localize('playerQueue.chat.speakingNow')
            }
        );

        await ChatMessage.create({
            user: game.user.id,
            speaker: { alias: game.i18n.localize('playerQueue.chat.systemAlias') },
            content,
            flags: { [MODULE_ID]: { announce: { userId: player.id, priority: player.priority } } }
        });
    }

    async removePlayerFromQueue(userId) {
        if (!game.user.isGM) return;
        if (!this.isInQueue(userId)) return;
        await this.network.request('remove', { userId });
    }

    async requestSync() {
        if (!game.user.isGM) return;
        await this.network.request('resync');
    }

    // ── Display ──

    updateDisplay() {
        if (this.isOpen) this.dialog.render();
        this.widget.update();
        Hooks.callAll('playerQueueUpdated', this.queue);
    }

    updateFloatingQueue() {
        this.widget.update();
    }
}

export { PlayerQueue };
