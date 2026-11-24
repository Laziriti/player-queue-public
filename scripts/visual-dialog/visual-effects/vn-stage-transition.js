function styleOverrides() {
    const saved = [];
    return {
        set(el, key, value) {
            saved.push([el, key, el.style.getPropertyValue(key), el.style.getPropertyPriority(key)]);
            el.style.setProperty(key, value);
        },
        restore() {
            for (const [el, key, value, priority] of saved) {
                if (value) el.style.setProperty(key, value, priority);
                else el.style.removeProperty(key);
            }
        }
    };
}

// Whole-stage motion. Browser snapshots include videos, canvas particles and portrait effects.
// The live DOM stays under the same overlay, so existing effect selectors and event handlers keep working.
export class VNStageTransition {
    static _active = new WeakMap();
    static STAGE = '.vn-bg-layer, .vn-background-overlay, .vn-bo-leaving, .vn-side, .vn-caption, .vn-vignette, .vn-ambient-light, .vn-particles, .vn-ground-fog, .vn-pixi-background, [class^="vn-fx-"]';

    static cancel(overlay) { this._active.get(overlay)?.cancel(); }

    static async run(overlay, timing, swap) {
        if (!overlay?.isConnected) return;
        this.cancel(overlay);
        if (overlay.classList.contains('minimized') || !document.startViewTransition) return swap();

        const stage = document.createElement('div');
        stage.className = 'vn-orbit-stage';
        const children = [...overlay.children].filter(el => el.matches(this.STAGE));
        overlay.prepend(stage);
        stage.append(...children);

        const html = document.documentElement;
        const { set, restore } = styleOverrides();
        let cancelled = false, cleaned = false, transition;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            stage.replaceWith(...stage.childNodes);
            restore();
            html.classList.remove('vn-orbit-active');
            if (this._active.get(overlay) === session) this._active.delete(overlay);
        };
        const session = { cancel: () => {
            cancelled = true;
            transition?.skipTransition();
            cleanup();
        } };
        this._active.set(overlay, session);
        const update = async () => {
            // Minimizing skips the animation but still applies the current update.
            // The layout's revision guard discards a superseded or closed scene.
            if (overlay.isConnected) {
                await swap();
                if (!cancelled) stage.append(...[...overlay.children].filter(el => el !== stage && el.matches(this.STAGE)));
            }
        };

        try {
            set(html, 'view-transition-name', 'none');
            set(html, '--vn-orbit-ms', `${timing.bg}ms`);
            set(html, '--vn-orbit-direction', String(-timing.direction));
            set(stage, 'view-transition-name', 'vn-orbit-stage');
            // Give the controls their own snapshots above the moving stage.
            [...overlay.children].filter(el => el !== stage && !el.hidden).forEach((el, i) =>
                set(el, 'view-transition-name', `vn-orbit-ui-${i}`));
            html.classList.add('vn-orbit-active');
            transition = document.startViewTransition(update);
            transition.ready.catch(error => { if (!cancelled) console.warn('VN: Stage transition skipped:', error.message); });
            await transition.updateCallbackDone;
            await transition.finished;
        } finally {
            cleanup();
        }
    }

    /** The browser holds the outgoing frame while the live stage moves to the destination. */
    static async teleport(overlay, canvas, swap, signal, animate) {
        const html = document.documentElement;
        const { set, restore } = styleOverrides();
        const animation = new AbortController();
        let transition, cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            animation.abort();
            transition?.skipTransition();
            canvas.remove();
            restore();
            html.classList.remove('vn-teleport-capture');
            overlay.classList.remove('vn-teleporting');
        };
        signal.addEventListener('abort', cleanup, { once: true });
        try {
            set(html, 'view-transition-name', 'none');
            set(html, '--vn-teleport-background-out', '1');
            set(html, '--vn-teleport-cast-out', '1');
            set(html, '--vn-teleport-cast-in', '0');
            set(html, '--vn-teleport-warp', '0');
            set(overlay, 'view-transition-name', 'vn-teleport-scene');
            [...overlay.children].forEach((el, i) => {
                if (el.matches('.vn-side, .vn-caption')) {
                    set(el, 'view-transition-name', `vn-teleport-cast-${i}`);
                    set(el, 'view-transition-class', 'vn-teleport-cast');
                } else if (el !== canvas && !el.matches(this.STAGE)) {
                    set(el, 'view-transition-name', `vn-teleport-ui-${i}`);
                }
            });
            html.classList.add('vn-teleport-capture');
            transition = document.startViewTransition(async () => {
                if (signal.aborted || !overlay.isConnected) return;
                await swap();
                if (signal.aborted) return;
                overlay.querySelector('.vn-caption')?.classList.remove('vn-caption--in');
                set(canvas, 'view-transition-name', 'vn-teleport-warp');
                canvas.style.visibility = '';
            });
            try {
                await transition.ready;
            } catch {
                // A skipped capture still commits the destination. Preserve any error from the update itself.
                await transition.updateCallbackDone;
                return;
            }
            if (signal.aborted) return;
            transition.finished.then(cleanup, cleanup);
            overlay.classList.add('vn-teleporting');
            await animate(html.style, animation.signal);
        } finally {
            signal.removeEventListener('abort', cleanup);
            cleanup();
        }
    }
}
