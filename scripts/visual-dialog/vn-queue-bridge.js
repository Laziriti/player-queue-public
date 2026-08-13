// ============================================================
// vn-queue-bridge.js — QueueBridge class
// ============================================================

class QueueBridge {
    static get instance() {
        return window.playerQueueInstance ?? window.PlayerQueue?.instance ?? null;
    }

    static get available() { return !!this.instance; }

    static getQueue() {
        return this.instance?.queue ?? this._getFromSettings();
    }

    static _getFromSettings() {
        try { return game.settings.get('player-queue', 'queueData') || []; }
        catch { return []; }
    }

    static PRIORITY_FALLBACK = {
        0: { value: 0, label: '!',   name: 'Низкий',  color: '#28a745' },
        1: { value: 1, label: '!!',  name: 'Средний', color: '#ffc107' },
        2: { value: 2, label: '!!!', name: 'Высокий', color: '#dc3545' },
    };

    static getPriorityData(priority) {
        if (typeof window.PlayerQueue?.getPriorityData === 'function') {
            return window.PlayerQueue.getPriorityData(priority);
        }
        return this.PRIORITY_FALLBACK[priority] ?? this.PRIORITY_FALLBACK[0];
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
