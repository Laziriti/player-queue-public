// ============================================================
// vn-transitions.js — Character & Background transitions
// ============================================================

class VNTransitions {

    static ENTER_TYPES = ['left', 'right', 'dramatic', 'shadow', 'rise'];

    static BG_TYPES = ['dissolve', 'zoom', 'blur', 'flash', 'black', 'sweep'];

    static BG_DURATIONS = {
        dissolve: 1000, zoom: 1200, blur: 1400,
        flash: 1000, black: 1800, sweep: 1000
    };

    static ENTER_DURATIONS = {
        left: 800, right: 800, dramatic: 1200,
        shadow: 1000, rise: 1000
    };

    // ═══════════════════════════════════════════
    // Вход персонажа
    // ═══════════════════════════════════════════

    static enterCharacter(charEl, type = 'auto') {
        if (!charEl) return Promise.resolve();

        if (type === 'auto') {
            const side = charEl.closest('.vn-side');
            // ▼ ИСПРАВЛЕНО: было vn-side-left, стало vn-left-side
            if (side?.classList.contains('vn-left-side')) type = 'left';
            else if (side?.classList.contains('vn-right-side')) type = 'right';
            else type = 'left'; // center → left entrance
        }

        this._cleanAnimClasses(charEl);

        const img = charEl.querySelector('.vn-character-img');
        if (img) img.style.opacity = '0';

        charEl.classList.add('vn-entering', `vn-entering-${type}`);

        requestAnimationFrame(() => {
            if (img) img.style.opacity = '';
        });

        const duration = this.ENTER_DURATIONS[type] || 800;

        return new Promise(resolve => {
            setTimeout(() => {
                this._cleanAnimClasses(charEl);
                resolve();
            }, duration + 50);
        });
    }

    // ═══════════════════════════════════════════
    // Выход персонажа
    // ═══════════════════════════════════════════

    static exitCharacter(charEl) {
        if (!charEl) return Promise.resolve();

        this._cleanAnimClasses(charEl);
        charEl.classList.add('vn-exiting');

        return new Promise(resolve => {
            setTimeout(resolve, 650);
        });
    }

    // ═══════════════════════════════════════════
    // Смена фона
    // ═══════════════════════════════════════════

    static async switchBackground(overlayEl, newImageUrl, type = 'dissolve', duration = null) {
        if (!overlayEl || !newImageUrl) return;

        const oldBg = overlayEl.querySelector('.vn-bg-layer');
        if (!oldBg) return;

        duration = duration || this.BG_DURATIONS[type] || 1000;

        const currentTransform = oldBg.style.transform || '';

        const newBg = document.createElement('div');
        newBg.className = `vn-bg-layer vn-bg-transition-${type}`;
        newBg.style.backgroundImage = `url("${newImageUrl}")`;
        if (currentTransform) newBg.style.transform = currentTransform;
        newBg.style.animationDuration = `${duration}ms`;
        newBg.style.position = 'absolute';
        newBg.style.inset = '-15px';
        newBg.style.zIndex = '0';
        newBg.style.backgroundSize = 'cover';
        newBg.style.backgroundPosition = 'center';

        oldBg.insertAdjacentElement('afterend', newBg);

        return new Promise(resolve => {
            let resolved = false;

            const cleanup = () => {
                if (resolved) return;
                resolved = true;
                newBg.className = 'vn-bg-layer';
                newBg.style.animationDuration = '';
                if (oldBg.parentNode) oldBg.remove();
                resolve();
            };

            newBg.addEventListener('animationend', cleanup, { once: true });
            setTimeout(cleanup, duration + 200);
        });
    }

    // ═══════════════════════════════════════════
    // Утилиты
    // ═══════════════════════════════════════════

    static _cleanAnimClasses(el) {
        if (!el) return;
        el.classList.remove(
            'vn-entering', 'vn-exiting',
            'vn-entering-left', 'vn-entering-right',
            'vn-entering-dramatic', 'vn-entering-shadow',
            'vn-entering-rise'
        );
    }
}

export { VNTransitions };
