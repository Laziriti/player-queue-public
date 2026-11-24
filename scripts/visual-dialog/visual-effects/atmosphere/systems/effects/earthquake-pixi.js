import { TimedEffect } from './timed-effect.js';
import { cubicBezier } from '../../../easing.js';

const QUAKE_JOLT_MS = 1330;

function quakeDebris(W, H, duration, amount) {
    const sources = Array.from({ length: 2 + Math.floor(Math.random() * 2) }, () => (0.08 + Math.random() * 0.84) * W);
    const count = Math.max(4, Math.round((18 + Math.floor(Math.random() * 10)) * amount));
    return Array.from({ length: count }, (_, i) => {
        const dust = Math.random() < 0.55;
        const size = dust ? 2 + Math.random() * 3 : 5 + Math.random() * 9;
        const x = sources[i % sources.length] + (Math.random() + Math.random() - 1) * 90;
        let points;
        if (!dust) {
            const n = 5 + Math.floor(Math.random() * 3);
            points = Array.from({ length: n }, (_, k) => {
                const a = (k / n + (Math.random() - 0.5) * 0.3 / n) * Math.PI * 2;
                const r = 32 + Math.random() * 18;
                return [Math.round(50 + Math.cos(a) * r), Math.round(50 + Math.sin(a) * r)];
            });
        }
        const fall = H * (0.6 + Math.random() * 0.5);
        const fallMs = 650 * Math.sqrt(fall / 400) * (dust ? 1.35 : 1);
        const delay = Math.pow(Math.random(), 1.6) * Math.max(0, duration - 500);
        const spin = (Math.random() - 0.5) * (dust ? 0 : 720);
        const drift = (Math.random() - 0.5) * 50;
        return { x, size, dust, points, fall, fallMs, delay, spin, drift };
    });
}

function debrisImage({ dust, points }) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    if (dust) {
        ctx.filter = 'blur(1.5px)';
        ctx.fillStyle = 'rgba(190, 168, 135, 0.85)';
        ctx.arc(32, 32, 26, 0, 2 * Math.PI);
    } else {
        const light = ctx.createRadialGradient(22, 19, 0, 22, 19, 61);
        light.addColorStop(0, '#b09c80');
        light.addColorStop(0.55, '#76644e');
        light.addColorStop(1, '#463a2c');
        ctx.fillStyle = light;
        points.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x * 0.64, y * 0.64));
        ctx.closePath();
    }
    ctx.fill();
    return canvas;
}

const fallCurve = [0.55, 0.085, 0.68, 0.53];

export class PixiEarthquakeEffect extends TimedEffect {
    start(overlay, variant = 'all') {
        this.overlay = overlay;
        this.lifetime = new AbortController();
        this.debris = [];
        void this.#createSurface(overlay, variant, this.lifetime.signal);
    }

    async #createSurface(overlay, variant, signal) {
        let surface;
        try {
            const { PixiSceneSurface } = await import('./scene-layers/pixi-scene-surface.js');
            if (signal.aborted) return;
            surface = new PixiSceneSurface();
            if (await surface.mount(overlay, 'vn-quake-pixi', signal, () => {
                if (!signal.aborted) console.error('VN: Pixi earthquake WebGL context lost');
                this.stop();
            })) {
                this.surface = surface;
                this.#schedule(overlay, variant);
            }
        } catch (error) {
            if (!signal.aborted) {
                console.error('VN: Pixi earthquake debris failed', error);
                this.stop();
            }
        } finally {
            if (surface && surface !== this.surface) surface.destroy();
        }
    }

    #schedule(overlayEl, variant) {
        if (variant === 'constant') {
            overlayEl.classList.add('vn-quake-active');
            const rain = () => {
                this.timeout(() => {
                    this.#spawnDebris(overlayEl, 1500, 0.35);
                    rain();
                }, 1200 + Math.random() * 2300);
            };
            rain();
            return;
        }

        const later = (fn, ms) => this.timeout(fn, ms);
        // `restart`: сбросить анимацию, чтобы новый удар начался с рывка, а не продолжил предыдущий
        const jolt = (strength, restart) => {
            overlayEl.style.setProperty('--qs', strength.toFixed(2));
            overlayEl.classList.remove('vn-quake-soft');
            if (restart) {
                overlayEl.classList.remove('vn-quake-active');
                void overlayEl.offsetWidth;
            }
            overlayEl.classList.add('vn-quake-active');
        };

        // Событие случайного вида; следующее наступает после паузы, отсчитанной от конца этого, поэтому они не накладываются
        const schedule = delay => {
            this.timeout(() => {
                const roll = Math.random();
                let total;

                if (roll < 0.4) {
                    // Один толчок
                    jolt(0.7 + Math.random() * 0.7, false);
                    this.#spawnDebris(overlayEl, QUAKE_JOLT_MS, 0.5);
                    total = QUAKE_JOLT_MS;
                } else if (roll < 0.75) {
                    // Несколько ударов подряд, с короткими разрывами между ними
                    const hits = 2 + Math.floor(Math.random() * 3);
                    let at = 0;
                    for (let i = 0; i < hits; i++) {
                        const strength = 0.6 + Math.random() * 0.9;
                        later(() => { jolt(strength, true); this.#spawnDebris(overlayEl, QUAKE_JOLT_MS, 0.4); }, at);
                        at += i < hits - 1 ? 350 + Math.random() * 900 : QUAKE_JOLT_MS;
                    }
                    total = at;
                } else {
                    // Затяжное землетрясение: несколько циклов подряд, к концу слабеет
                    total = 3000 + Math.random() * 2500;
                    jolt(0.9 + Math.random() * 0.4, false);
                    later(() => overlayEl.classList.add('vn-quake-soft'), total - 700);
                    this.#spawnDebris(overlayEl, total, 1);
                }

                later(() => overlayEl.classList.remove('vn-quake-active', 'vn-quake-soft'), total);
                // Чаще короткая передышка, иногда долгое затишье
                schedule(total + (Math.random() < 0.35 ? 1200 + Math.random() * 1800 : 3500 + Math.random() * 7000));
            }, delay);
        };
        schedule(1500);
    }

    #spawnDebris(overlay, duration, amount) {
        const now = performance.now();
        const pieces = quakeDebris(overlay.clientWidth, overlay.clientHeight, duration, amount);
        for (const piece of pieces) {
            this.debris.push({ ...piece, start: now + piece.delay, image: debrisImage(piece) });
        }
        if (!this.frame) this.frame = requestAnimationFrame(this.#renderDebris);
    }

    #renderDebris = now => {
        const surface = this.surface;
        this.frame = 0;
        if (!surface) return;
        const dpr = window.devicePixelRatio;
        this.debris = this.debris.filter(piece => now < piece.start + piece.fallMs);
        surface.clearRect();
        for (const rock of this.debris) {
            if (now < rock.start) continue;
            const progress = cubicBezier(fallCurve, (now - rock.start) / rock.fallMs);
            const x = rock.x + rock.size / 2 + progress * rock.drift;
            const y = -rock.size / 2 - 4 + progress * rock.fall;
            surface.setTransform(dpr, 0, 0, dpr, x * dpr, y * dpr);
            surface.rotate(progress * rock.spin * Math.PI / 180);
            surface.globalAlpha = Math.min(1, (1 - progress) / 0.15);
            surface.drawImage(rock.image, -rock.size / 2, -rock.size / 2, rock.size, rock.size);
        }
        surface.present();
        if (this.debris.length) this.frame = requestAnimationFrame(this.#renderDebris);
        else surface.resetTextures();
    };

    #removeSurface() {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.surface?.destroy();
        this.surface = null;
        this.debris = [];
    }

    stop() {
        this.lifetime?.abort();
        this.#removeSurface();
        super.stop();
        this.overlay?.classList.remove('vn-quake-active', 'vn-quake-soft');
        this.overlay?.style.removeProperty('--qs');
        this.overlay = null;
    }
}
