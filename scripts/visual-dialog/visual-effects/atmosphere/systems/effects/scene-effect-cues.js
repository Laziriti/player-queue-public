import { TimedEffect } from './timed-effect.js';

// Timed accents applied to the scene layers by effects and variants.
export class SceneEffectCues extends TimedEffect {
    start(overlay, type, variant) {
        this.overlay = overlay;
        switch (type) {
            case 'storm': this._startLightning(overlay, variant); break;
            case 'vhs': this._startGlitch(overlay, variant === 'chewed'); break;
            case 'eldritch':
            case 'hologram': this._startGlitch(overlay, false); break;
            case 'corruption': this._startGlitch(overlay, true); break;
            case 'apocalypse':
                this._startLightning(overlay);
                this._startGlitch(overlay, false);
                break;
            case 'cosmic_horror': this._startCosmicPulse(overlay); break;
            case 'abyss': this._startAbyssPressure(overlay); break;
            case 'ghosts': this._startGhostHaunt(overlay); break;
        }
    }

    stop() {
        super.stop();
        const overlay = this.overlay;
        this.overlay = null;
        if (!overlay) return;
        overlay.classList.remove('vn-glitch-active', 'vn-gravity-wave', 'vn-pressure-wave');
        overlay.querySelector('.vn-fx-tint')?.style.removeProperty('opacity');
        const flash = overlay.querySelector('.vn-fx-flash');
        flash?.classList.remove('vn-ghost-presence', 'vn-lightning-active', 'vn-biolum-flash');
        for (const property of ['--bolt-x', '--bolt-y', '--ghost-x', '--ghost-y', '--biolum-x', '--biolum-y', '--biolum-hue']) {
            flash?.style.removeProperty(property);
        }
    }

    // Distant lightning paints a broad glow; regular storms can flash twice.
    _startLightning(overlayEl, variant = 'all') {
        const flash = overlayEl.querySelector('.vn-fx-flash');
        if (!flash) return;

        if (variant === 'distant') {
            this.interval(() => {
                if (Math.random() >= 0.4) return;
                flash.style.setProperty('--bolt-x', `${(8 + Math.random() * 84).toFixed(0)}%`);
                flash.style.setProperty('--bolt-y', `${(6 + Math.random() * 22).toFixed(0)}%`);
                flash.classList.add('vn-lightning-active');
                this.timeout(() => flash.classList.remove('vn-lightning-active'), 1000);
            }, 3500);
            return;
        }

        const chance = variant === 'gale' ? 0.18 : 0.3;
        this.interval(() => {
            if (Math.random() >= chance) return;

            flash.classList.add('vn-lightning-active');
            this.timeout(() => flash.classList.remove('vn-lightning-active'), 150);

            this.timeout(() => {
                if (Math.random() < 0.5) {
                    flash.classList.add('vn-lightning-active');
                    this.timeout(() => flash.classList.remove('vn-lightning-active'), 100);
                }
            }, 300);
        }, 3000);
    }

    _startGlitch(overlayEl, intense) {
        const interval = intense ? 2000 : 5000;
        const chance = intense ? 0.5 : 0.2;
        const maxDuration = intense ? 400 : 200;

        this.interval(() => {
            if (Math.random() >= chance) return;

            overlayEl.classList.add('vn-glitch-active');
            this.timeout(
                () => overlayEl.classList.remove('vn-glitch-active'),
                100 + Math.random() * maxDuration
            );
        }, interval);
    }

    _startCosmicPulse(overlayEl) {
        let cosmicPhase = 0;
        const tint = overlayEl.querySelector('.vn-fx-tint');

        this.interval(() => {
            if (!tint) return;
            cosmicPhase += 0.08;
            tint.style.opacity = (0.6 + Math.sin(cosmicPhase) * 0.2).toFixed(3);
        }, 1500);

        this.interval(() => {
            if (Math.random() >= 0.4) return;
            overlayEl.classList.add('vn-gravity-wave');
            this.timeout(() => overlayEl.classList.remove('vn-gravity-wave'), 3000);
        }, 10000);
    }

    _startGhostHaunt(overlayEl) {
        const flash = overlayEl.querySelector('.vn-fx-flash');
        if (!flash) return;

        const scheduleHaunt = () => {
            this.timeout(() => {
                if (!flash.classList.contains('vn-ghost-presence')) {
                    const x = 12 + Math.random() * 76;
                    const y =  8 + Math.random() * 62;
                    flash.style.setProperty('--ghost-x', `${x.toFixed(1)}%`);
                    flash.style.setProperty('--ghost-y', `${y.toFixed(1)}%`);
                    flash.classList.add('vn-ghost-presence');
                    // Remove after animation completes (animation is 8s)
                    this.timeout(() => flash.classList.remove('vn-ghost-presence'), 8500);
                }
                scheduleHaunt();
            }, 7000 + Math.random() * 9000);
        };
        scheduleHaunt();
    }

    _startAbyssPressure(overlayEl) {
        const flash = overlayEl.querySelector('.vn-fx-flash');

        const schedulePressure = () => {
            this.timeout(() => {
                overlayEl.classList.add('vn-pressure-wave');
                this.timeout(() => overlayEl.classList.remove('vn-pressure-wave'), 2500);
                schedulePressure();
            }, 6000 + Math.random() * 4000);
        };
        schedulePressure();

        const scheduleBiolum = () => {
            this.timeout(() => {
                if (Math.random() < 0.4 && flash) {
                    const x = 15 + Math.random() * 70;
                    const y = 20 + Math.random() * 60;
                    flash.style.setProperty('--biolum-x', `${x}%`);
                    flash.style.setProperty('--biolum-y', `${y}%`);
                    flash.style.setProperty('--biolum-hue', `${160 + Math.random() * 40}`);
                    flash.classList.add('vn-biolum-flash');
                    this.timeout(() => flash.classList.remove('vn-biolum-flash'), 2000 + Math.random() * 1500);
                }
                scheduleBiolum();
            }, 5000 + Math.random() * 3000);
        };
        scheduleBiolum();
    }
}
