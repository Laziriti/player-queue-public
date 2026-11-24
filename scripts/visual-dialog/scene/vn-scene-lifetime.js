// Deferred work belongs to one overlay, never to whichever overlay happens to be current later.
export class VNSceneLifetime {
    constructor(overlay) {
        this.overlay = overlay;
        this.active = true;
        this._tasks = new Map();
    }

    timeout(fn, ms, onCancel = () => {}) {
        if (!this.active) return;
        const id = setTimeout(() => {
            this._tasks.delete(id);
            if (this.active) fn();
        }, ms);
        this._tasks.set(id, onCancel);
        return id;
    }

    dispose() {
        this.active = false;
        for (const [id, onCancel] of this._tasks) {
            clearTimeout(id);
            onCancel();
        }
        this._tasks.clear();
    }
}
