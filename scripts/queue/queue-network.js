// ============================================================
// queue-network.js — QueueNetwork: GM-authority transport and host-side request handling
//
// The active GM ("host") is the only client that mutates the queue. Other clients send requests
// and get the result back through the world setting `queueState` (onChange).
// ============================================================

import { MODULE_ID, ACTION_COOLDOWN_MS, MIN_REMOTE_INTERVAL_MS, VALID_PRIORITIES } from './queue-constants.js';
import { QueueModel } from './queue-model.js';

const DEBUG = false;
function log(...args) {
    if (DEBUG) console.log('[PlayerQueue]', ...args);
}

class QueueNetwork {
    /** socketlib module socket; assigned from main.js on `socketlib.ready`. */
    static socket = null;

    #controller;
    #chain = Promise.resolve();
    #lastLocalActionAt = 0;
    #lastRemoteActionAt = new Map();

    constructor(controller) {
        this.#controller = controller;
    }

    get isHost() {
        return !!game.users.activeGM?.isSelf;
    }

    // ── Client side ──

    /** Client-side cooldown for join / change-priority clicks. */
    isLocallyThrottled() {
        const now = Date.now();
        if (now - this.#lastLocalActionAt < ACTION_COOLDOWN_MS) return true;
        this.#lastLocalActionAt = now;
        return false;
    }

    /** Sends a request to the host (or handles it directly when this client is the host). */
    async request(action, payload = {}) {
        const host = game.users.activeGM;
        if (!host) {
            ui.notifications.warn(game.i18n.localize('playerQueue.notify.noGM'));
            return { ok: false, reason: 'no-gm' };
        }

        const req = { ...payload, action };
        try {
            if (host.isSelf) return await this.handleRequest(req, game.user.id);
            // executeAsUser, not executeAsGM: socketlib runs executeAsGM locally on ANY GM,
            // which would let two GMs act as hosts at once.
            if (!QueueNetwork.socket) throw new Error('socket is not ready');
            return await QueueNetwork.socket.executeAsUser('playerQueueRequest', host.id, req);
        } catch (error) {
            console.error('[PlayerQueue] request failed:', action, error);
            ui.notifications.warn(game.i18n.localize('playerQueue.notify.requestFailed'));
            return { ok: false, reason: 'error' };
        }
    }

    // ── Host side ──

    // `sender` comes from socketlib (this.socketdata.userId), never from the payload — it cannot be forged
    async handleRequest(req, sender) {
        if (!this.isHost) return { ok: false, reason: 'not-host' };
        if (!this.#controller.isLoaded) return { ok: false, reason: 'not-ready' };

        const user = game.users.get(sender);
        if (!user || !req || typeof req !== 'object') return { ok: false, reason: 'invalid' };

        log('request:', req, 'from', sender);

        switch (req.action) {
            case 'join':
            case 'change': {
                const priority = Number(req.priority);
                if (!VALID_PRIORITIES.has(priority)) return { ok: false, reason: 'invalid' };
                if (this.#isRemotelyThrottled(sender)) return { ok: false, reason: 'throttled' };
                await this.#mutate(d => QueueModel.setPriority(d, user, priority, req.action === 'join'),
                    { type: req.action, ids: [sender], by: sender });
                return { ok: true };
            }

            case 'leave':
                await this.#mutate(d => QueueModel.remove(d, [sender]), { type: 'leave', ids: [sender], by: sender });
                return { ok: true };

            case 'remove':
            case 'announce': {
                if (!user.isGM) return { ok: false, reason: 'forbidden' };
                const targetId = String(req.userId);
                const changed = await this.#mutate(d => QueueModel.remove(d, [targetId]),
                    { type: req.action, ids: [targetId], by: sender });
                return { ok: changed };
            }

            case 'clear':
                if (!user.isGM) return { ok: false, reason: 'forbidden' };
                await this.#mutate(QueueModel.clear, { type: 'clear', ids: [], by: sender });
                return { ok: true };

            case 'resync':
                if (!user.isGM) return { ok: false, reason: 'forbidden' };
                await this.#mutate(() => true, { type: 'resync', ids: [], by: sender });
                return { ok: true };

            default:
                return { ok: false, reason: 'invalid' };
        }
    }

    #isRemotelyThrottled(sender) {
        const now = Date.now();
        if (now - (this.#lastRemoteActionAt.get(sender) ?? 0) < MIN_REMOTE_INTERVAL_MS) return true;
        this.#lastRemoteActionAt.set(sender, now);
        return false;
    }

    /** Mutations run strictly one after another; `fn` edits a cloned draft and returns true if anything changed. */
    #mutate(fn, last = null) {
        const { model } = this.#controller;

        const run = async () => {
            const draft = model.createDraft();
            if (!fn(draft)) return false;

            const state = model.nextState(draft, last);
            this.#controller.applyState(state);
            await this.#persist(state);
            return true;
        };

        const result = this.#chain.then(run);
        this.#chain = result.catch(() => {});
        return result;
    }

    async #persist(state) {
        try {
            await game.settings.set(MODULE_ID, 'queueState', structuredClone(state));
        } catch (error) {
            console.error('[PlayerQueue] Error saving queue state:', error);
        }
    }
}

export { QueueNetwork };
