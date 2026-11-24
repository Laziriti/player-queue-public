// Dragging and the saved position belong to the local overlay.
import { readLocalJSON, writeLocalJSON } from '../../utils/local-storage.js';
import { clamp } from '../../utils/math.js';

export class VNMinimizedOverlay {
    #listeners;
    #drag;

    constructor(positionKey) {
        this.positionKey = positionKey;
    }

    attach(overlay) {
        this.detach();
        const bar = overlay?.querySelector('.vn-maximized-bar');
        if (!bar) return;
        this.#listeners = new AbortController();
        bar.addEventListener('mousedown', event => this.#startDrag(overlay, event),
            { signal: this.#listeners.signal });
    }

    detach() {
        this.#listeners?.abort();
        this.#listeners = null;
        this.#endDrag();
    }

    setMinimized(overlay, minimized) {
        if (!overlay) return;
        overlay.classList.toggle('minimized', minimized);
        if (minimized) {
            const saved = readLocalJSON(this.positionKey);
            if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
                this.#position(overlay, saved.x, saved.y);
            }
            return;
        }
        this.#endDrag();
        for (const property of ['left', 'top', 'right', 'bottom']) overlay.style.removeProperty(property);
    }

    #startDrag(overlay, event) {
        if (event.button !== 0 || !overlay.classList.contains('minimized') || event.target.closest('button')) return;
        event.preventDefault();
        this.#endDrag();
        this.#drag = new AbortController();
        const { signal } = this.#drag;
        const { clientX, clientY } = event;
        const { left, top } = overlay.getBoundingClientRect();
        this.#position(overlay, left, top);
        document.addEventListener('mousemove', move => {
            this.#position(overlay, left + move.clientX - clientX, top + move.clientY - clientY);
        }, { signal });
        document.addEventListener('mouseup', () => {
            const { left: x, top: y } = overlay.getBoundingClientRect();
            writeLocalJSON(this.positionKey, { x, y });
            this.#endDrag();
        }, { signal });
    }

    #endDrag() {
        this.#drag?.abort();
        this.#drag = null;
    }

    #position(overlay, x, y) {
        const left = clamp(x, 0, window.innerWidth - overlay.offsetWidth);
        const top = clamp(y, 0, window.innerHeight - overlay.offsetHeight);
        Object.assign(overlay.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    }
}
