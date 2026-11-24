// Owns outside-click handlers and deferred registration for overlay dropdowns.
export class VNOverlayPickers {
    constructor() {
        this._entries = new Map();
    }

    toggle(wrap, picker, key, onOpen = null) {
        const open = picker.hidden;
        this._remove(key);
        picker.hidden = !open;
        if (!open) return;
        onOpen?.();
        const listener = event => {
            if (wrap.contains(event.target)) return;
            picker.hidden = true;
            this._remove(key);
        };
        const timer = setTimeout(() => document.addEventListener('click', listener, true), 0);
        this._entries.set(key, { listener, timer });
    }

    _remove(key) {
        const entry = this._entries.get(key);
        if (!entry) return;
        clearTimeout(entry.timer);
        document.removeEventListener('click', entry.listener, true);
        this._entries.delete(key);
    }

    clear() {
        for (const key of this._entries.keys()) this._remove(key);
    }
}
