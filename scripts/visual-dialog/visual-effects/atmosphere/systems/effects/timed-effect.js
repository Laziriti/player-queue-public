// Shared timer ownership for procedural effects. DOM resources belong to the concrete effect.
export class TimedEffect {
    constructor() {
        this._timers = new Map();
    }

    timeout(fn, ms) {
        const id = setTimeout(() => {
            this._timers.delete(id);
            fn();
        }, ms);
        this._timers.set(id, clearTimeout);
        return id;
    }

    interval(fn, ms) {
        const id = setInterval(fn, ms);
        this._timers.set(id, clearInterval);
        return id;
    }

    clear(id) {
        this._timers.get(id)?.(id);
        this._timers.delete(id);
    }

    stop() {
        for (const id of this._timers.keys()) this.clear(id);
    }
}
