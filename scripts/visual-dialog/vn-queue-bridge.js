// ============================================================
// vn-queue-bridge.js — QueueBridge class
// ============================================================

import { PlayerQueue } from '../queue/player-queue.js';

class QueueBridge {
    static get instance() {
        return PlayerQueue.instance;
    }

    static get available() { return !!PlayerQueue.instance; }

    static getQueue() {
        return PlayerQueue.instance?.queue ?? this._getFromSettings();
    }

    static _getFromSettings() {
        try { return game.settings.get('player-queue', 'queueData') || []; }
        catch { return []; }
    }

    static getPriorityData(priority) {
        return PlayerQueue.getPriorityData(priority);
    }

    static buildActorIndex(queueData) {
        const map = new Map();
        if (!queueData?.length) return map;
        for (const p of queueData) {
            const actorId = game.users.get(p.id)?.character?.id;
            if (actorId) map.set(actorId, p);
        }
        return map;
    }

    static resolveActorPriority(actor, queueDataOrIndex) {
        if (!this.available || !actor) return null;
        let entry;
        if (queueDataOrIndex instanceof Map) {
            entry = queueDataOrIndex.get(actor.id);
        } else {
            if (!queueDataOrIndex?.length) return null;
            entry = queueDataOrIndex.find(p => game.users.get(p.id)?.character?.id === actor.id);
        }
        if (!entry) return null;
        return { ...this.getPriorityData(entry.priority), priority: entry.priority };
    }

    static announceAndRemove(userId) { this.instance?.announcePlayerAndRemove?.(userId); }
    static removeFromQueue(userId) { this.instance?.removePlayerFromQueue?.(userId); }
}

export { QueueBridge };
