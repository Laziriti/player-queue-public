// ============================================================
// queue-model.js — QueueModel: queue state (rev / nextOrder / entries) and its pure transformations
// ============================================================

import { FALLBACK_AVATAR, VALID_PRIORITIES } from './queue-constants.js';

const byPriorityThenOrder = (a, b) => b.priority - a.priority || a.order - b.order;

class QueueModel {
    rev = 0;
    nextOrder = 1;

    /** Sorted, deeply frozen snapshot. Replaced (never mutated) on every adopt(), so it is safe to hand out. */
    entries = Object.freeze([]);

    /** What produced the current rev: `{ type, ids, by }`. Lets every client tell "announced" from "left" in hooks. */
    last = null;

    /** Raw persisted/received state -> validated state; name/avatar are re-read from live game.users. */
    static normalize(raw) {
        const rawEntries = Array.isArray(raw?.entries) ? raw.entries : [];

        const entries = [];
        for (const e of rawEntries) {
            const user = game.users.get(e?.id);
            const priority = Number(e?.priority);
            if (!user || !VALID_PRIORITIES.has(priority)) continue;
            entries.push({
                id: user.id,
                name: user.name,
                avatar: user.avatar || FALLBACK_AVATAR,
                priority,
                order: Number(e.order) || 0,
                timestamp: Number(e.timestamp) || 0
            });
        }

        const maxOrder = entries.reduce((m, e) => Math.max(m, e.order), 0);
        return {
            rev: Number(raw?.rev) || 0,
            nextOrder: Math.max(Number(raw?.nextOrder) || 1, maxOrder + 1),
            entries,
            last: QueueModel.normalizeLast(raw?.last)
        };
    }

    static normalizeLast(raw) {
        if (!raw || typeof raw.type !== 'string') return null;
        return {
            type: raw.type,
            ids: Array.isArray(raw.ids) ? raw.ids.map(String) : [],
            by: String(raw.by ?? '')
        };
    }

    adopt(state) {
        this.rev = state.rev;
        this.nextOrder = state.nextOrder;
        this.last = state.last ?? null;
        this.entries = Object.freeze(
            state.entries.map(e => Object.freeze({ ...e })).sort(byPriorityThenOrder)
        );
    }

    has(userId) {
        return this.entries.some(e => e.id === userId);
    }

    get(userId) {
        return this.entries.find(e => e.id === userId);
    }

    priorities() {
        return new Map(this.entries.map(e => [e.id, e.priority]));
    }

    // ── Drafts: host-side mutations work on a clone and commit it as rev + 1 ──

    createDraft() {
        return { entries: structuredClone(this.entries), nextOrder: this.nextOrder };
    }

    nextState(draft, last = null) {
        return { rev: this.rev + 1, nextOrder: draft.nextOrder, entries: draft.entries, last };
    }

    /**
     * Adds the user (only when `isJoin`), or changes their priority in either direction; a new `order` puts them
     * last in the new group. The same priority is a no-op, so a repeated click never costs the user their place.
     * Returns true if changed.
     */
    static setPriority(draft, user, priority, isJoin) {
        const entry = draft.entries.find(e => e.id === user.id);

        if (!entry) {
            if (!isJoin) return false;
            draft.entries.push({
                id: user.id,
                name: user.name,
                avatar: user.avatar || FALLBACK_AVATAR,
                priority,
                order: draft.nextOrder++,
                timestamp: Date.now()
            });
            return true;
        }

        if (entry.priority === priority) return false;

        entry.priority = priority;
        entry.order = draft.nextOrder++;
        entry.timestamp = Date.now();
        return true;
    }

    static remove(draft, ids) {
        const before = draft.entries.length;
        draft.entries = draft.entries.filter(e => !ids.includes(e.id));
        return draft.entries.length !== before;
    }

    static clear(draft) {
        if (!draft.entries.length) return false;
        draft.entries = [];
        return true;
    }
}

export { QueueModel };
