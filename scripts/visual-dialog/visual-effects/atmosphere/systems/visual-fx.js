// ============================================================
// systems/visual-fx.js — Визуальные пост-эффекты (overlay FX)
// ============================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

export class VisualFXSystem {
    constructor() {
        this._overlayEl = null;
        this._visual = 'none';
        this._flashInterval = null;
        this._glitchInterval = null;
        this._voidCrackInterval = null;
        this._crackTimeouts = [];
    }

    /**
     * Применить визуальный эффект к overlay
     * @param {HTMLElement} overlayEl — корневой overlay-элемент
     * @param {string} visual — тип визуального эффекта
     */
    apply(overlayEl, visual) {
        this._overlayEl = overlayEl;
        this._visual = visual;

        this.remove();

        if (visual === 'none') return;

        overlayEl.classList.add(`vn-vfx-${visual}`);
        this._ensureFXLayers(overlayEl);

        switch (visual) {
            case 'storm':
                this._startLightning(overlayEl);
                break;
            case 'eldritch':
                this._startGlitch(overlayEl, false);
                break;
            case 'corruption':
                this._startGlitch(overlayEl, true);
                break;
            case 'apocalypse':
                this._startLightning(overlayEl);
                this._startGlitch(overlayEl, false);
                break;
            case 'void_breach':
                this._startVoidBreach(overlayEl);
                break;
            case 'glass_shatter':
                this._startGlassShatter(overlayEl);
                break;
            case 'cosmic_horror':
                this._startCosmicPulse(overlayEl);
                break;
            case 'abyss':
                this._startAbyssPressure(overlayEl);
                break;
            case 'ghosts':
                this._startGhostHaunt(overlayEl);
                break;
        }
    }

    /**
     * Удалить все визуальные эффекты
     */
    remove() {
        this._stopTimers();

        if (!this._overlayEl) return;

        // Удалить VFX-классы с overlay
        [...this._overlayEl.classList]
            .filter(c => c.startsWith('vn-vfx-'))
            .forEach(c => this._overlayEl.classList.remove(c));

        // Убрать временные state-классы
        this._overlayEl.classList.remove(
            'vn-void-tear-active', 'vn-glitch-active',
            'vn-gravity-wave', 'vn-pressure-wave'
        );

        // Убрать animation-state классы с FX-слоёв
        const flashEl = this._overlayEl.querySelector('.vn-fx-flash');
        if (flashEl) flashEl.classList.remove('vn-ghost-presence');

        // Удалить динамически созданные crack-элементы
        this._overlayEl.querySelectorAll('.vn-fx-ray').forEach(el => el.remove());

        // Сбросить ВСЕ инлайновые стили FX-слоёв (они могут быть выставлены JS)
        ['vn-fx-tint', 'vn-fx-rays', 'vn-fx-edges', 'vn-fx-flash', 'vn-fx-scan'].forEach(cls => {
            const el = this._overlayEl.querySelector(`.${cls}`);
            if (el) el.style.cssText = '';
        });

        // Сбросить стили bg-layer
        const bgLayer = this._overlayEl.querySelector('.vn-bg-layer');
        if (bgLayer) {
            bgLayer.style.filter = '';
            bgLayer.style.animation = '';
        }
    }

    /**
     * Полная очистка (при destroy)
     */
    destroy() {
        this.remove();
        this._overlayEl = null;
        this._visual = 'none';
    }

    /**
     * Текущий визуальный эффект
     */
    get current() {
        return this._visual;
    }

    // ─── Private ─────────────────────────────────────────────

    _stopTimers() {
        if (this._flashInterval) {
            clearTimeout(this._flashInterval);
            clearInterval(this._flashInterval);
            this._flashInterval = null;
        }
        if (this._glitchInterval) {
            clearTimeout(this._glitchInterval);
            clearInterval(this._glitchInterval);
            this._glitchInterval = null;
        }
        if (this._voidCrackInterval) {
            clearInterval(this._voidCrackInterval);
            this._voidCrackInterval = null;
        }
        for (const t of this._crackTimeouts) clearTimeout(t);
        this._crackTimeouts = [];
    }

    _ensureFXLayers(overlayEl) {
        const bgLayer = overlayEl.querySelector('.vn-bg-layer');
        const insertRef = bgLayer?.nextSibling || null;

        const layers = ['vn-fx-tint', 'vn-fx-rays', 'vn-fx-edges', 'vn-fx-flash', 'vn-fx-scan'];

        for (const cls of layers) {
            if (!overlayEl.querySelector(`.${cls}`)) {
                const div = document.createElement('div');
                div.className = cls;
                insertRef
                    ? overlayEl.insertBefore(div, insertRef)
                    : overlayEl.prepend(div);
            }
        }
    }

    _startLightning(overlayEl) {
        const flash = overlayEl.querySelector('.vn-fx-flash');
        if (!flash) return;

        this._flashInterval = setInterval(() => {
            if (Math.random() >= 0.3) return;

            flash.classList.add('vn-lightning-active');
            this._crackTimeouts.push(
                setTimeout(() => flash.classList.remove('vn-lightning-active'), 150)
            );

            this._crackTimeouts.push(setTimeout(() => {
                if (Math.random() < 0.5) {
                    flash.classList.add('vn-lightning-active');
                    this._crackTimeouts.push(
                        setTimeout(() => flash.classList.remove('vn-lightning-active'), 100)
                    );
                }
            }, 300));
        }, 3000);
    }

    _startGlitch(overlayEl, intense) {
        const interval = intense ? 2000 : 5000;
        const chance = intense ? 0.5 : 0.2;
        const maxDuration = intense ? 400 : 200;

        this._glitchInterval = setInterval(() => {
            if (Math.random() >= chance) return;

            overlayEl.classList.add('vn-glitch-active');
            this._crackTimeouts.push(setTimeout(
                () => overlayEl.classList.remove('vn-glitch-active'),
                100 + Math.random() * maxDuration
            ));
        }, interval);
    }

    // ─── Void Breach ─────────────────────────────────────────

    _startVoidBreach(overlayEl) {
        let phase = 0;
        this._flashInterval = setInterval(() => {
            phase += 0.07;
            const tint = overlayEl.querySelector('.vn-fx-tint');
            if (tint) tint.style.opacity = (0.72 + Math.sin(phase) * 0.16).toFixed(3);
        }, 2000);

        // Each crack manages its own lifetime; interval spawns new ones
        this._voidCrackInterval = setInterval(() => {
            const active = overlayEl.querySelectorAll('.vn-void-crack-svg').length;
            if (active >= 14) return;
            const burst = active < 3 ? 3 : active < 7 ? 2 : 1;
            for (let i = 0; i < burst && (active + i) < 14; i++) {
                this._spawnVoidCrack(overlayEl, i * 250);
            }
        }, 1800);

        // Initial burst
        for (let i = 0; i < 6; i++) {
            const t = setTimeout(() => this._spawnVoidCrack(overlayEl), 400 + i * 450);
            this._crackTimeouts.push(t);
        }
    }

    _spawnVoidCrack(overlayEl, extraDelay = 0) {
        if (!overlayEl.isConnected) return;

        const W = overlayEl.offsetWidth || 1200;
        const H = overlayEl.offsetHeight || 700;

        // Size tier: small hairline / medium tear / large sweeping rift
        const roll = Math.random();
        let segCount, baseSegLen, strokeScale;
        if (roll < 0.20) {
            segCount    = 4 + Math.floor(Math.random() * 4);
            baseSegLen  = 50 + Math.random() * 40;
            strokeScale = 0.80;
        } else if (roll < 0.70) {
            segCount    = 6 + Math.floor(Math.random() * 6);
            baseSegLen  = 80 + Math.random() * 60;
            strokeScale = 1.40;
        } else {
            segCount    = 10 + Math.floor(Math.random() * 6);
            baseSegLen  = 130 + Math.random() * 100;
            strokeScale = 2.10;
        }

        const sx  = (0.08 + Math.random() * 0.84) * W;
        const sy  = (0.08 + Math.random() * 0.84) * H;
        let angle = Math.random() * 360;

        const pts = [{ x: sx, y: sy }];
        for (let i = 0; i < segCount; i++) {
            const len  = baseSegLen * (0.75 + Math.random() * 0.5);
            const rad  = angle * Math.PI / 180;
            const last = pts[pts.length - 1];
            pts.push({ x: last.x + Math.cos(rad) * len, y: last.y + Math.sin(rad) * len });
            angle += (Math.random() - 0.5) * 40;
        }

        const lifetime = 9000 + Math.random() * 7000;
        const svg      = this._buildCrackSVG(overlayEl, pts, strokeScale, extraDelay);
        this._addCrackTips(svg, pts, strokeScale, extraDelay, svg._spreadDur);

        const tClose = setTimeout(() => {
            if (svg.isConnected) this._closeCrackSVG(svg);
        }, extraDelay + lifetime);
        this._crackTimeouts.push(tClose);

        // Optional branch from midpoint
        if (segCount >= 4 && Math.random() > 0.5) {
            const midPt  = pts[Math.floor(pts.length / 2)];
            const bDelay = extraDelay + 200 + Math.floor(Math.random() * 200);
            this._spawnCrackBranch(overlayEl, midPt, angle, strokeScale * 0.55, bDelay, extraDelay + lifetime * 0.85);
        }
    }

    _spawnCrackBranch(overlayEl, startPt, parentAngle, strokeScale, delay, closeAt) {
        if (!overlayEl.isConnected) return;

        const segCount = 3 + Math.floor(Math.random() * 3);
        const baseLen  = 30 + Math.random() * 55;
        let angle = parentAngle + (Math.random() > 0.5 ? 38 : -38) + (Math.random() - 0.5) * 22;

        const pts = [{ x: startPt.x, y: startPt.y }];
        for (let i = 0; i < segCount; i++) {
            const len  = baseLen * (0.7 + Math.random() * 0.6);
            const rad  = angle * Math.PI / 180;
            const last = pts[pts.length - 1];
            pts.push({ x: last.x + Math.cos(rad) * len, y: last.y + Math.sin(rad) * len });
            angle += (Math.random() - 0.5) * 30;
        }

        const svg    = this._buildCrackSVG(overlayEl, pts, strokeScale, delay);
        this._addCrackTips(svg, pts, strokeScale, delay, svg._spreadDur);
        const tClose = setTimeout(() => {
            if (svg.isConnected) this._closeCrackSVG(svg);
        }, closeAt);
        this._crackTimeouts.push(tClose);
    }

    _buildCrackSVG(overlayEl, pts, strokeScale, delay) {
        const d  = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'vn-fx-ray vn-void-crack-svg');
        svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;';

        // glow: soft halo; edge: pink/purple outline; core: black void center
        // Core must be ~65% of edge width to be clearly visible
        const layers = [
            { stroke: 'rgba(90,  10, 215, 0.18)',  width: 20.0 * strokeScale,               linecap: 'round', linejoin: 'round' },
            { stroke: 'rgba(215, 178, 255, 0.85)', width: 5.5  * strokeScale,               linecap: 'butt',  linejoin: 'miter' },
            { stroke: 'rgba(2,   0,  12,  1)',      width: Math.max(2.2, 3.6 * strokeScale), linecap: 'butt',  linejoin: 'miter' },
        ];

        svg._crackAnims = [];
        overlayEl.appendChild(svg); // must be in DOM before getTotalLength()

        let spreadDur = 500;
        for (let li = 0; li < layers.length; li++) {
            const layer = layers[li];
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', layer.stroke);
            path.setAttribute('stroke-width', String(layer.width));
            path.setAttribute('stroke-linecap', layer.linecap);
            path.setAttribute('stroke-linejoin', layer.linejoin);
            if (layer.linejoin === 'miter') path.setAttribute('stroke-miterlimit', '10');
            svg.appendChild(path);

            const pathLen = path.getTotalLength();
            if (li === 0) spreadDur = Math.max(300, Math.min(900, pathLen * 1.15));
            path.style.strokeDasharray  = String(pathLen);
            path.style.strokeDashoffset = String(pathLen);

            const anim = path.animate(
                [{ strokeDashoffset: pathLen }, { strokeDashoffset: 0 }],
                { duration: spreadDur, delay, easing: 'cubic-bezier(0.04,0,0.18,1)', fill: 'forwards' }
            );
            svg._crackAnims.push({ path, pathLen, anim });
        }

        svg._spreadDur = spreadDur;
        return svg;
    }

    _addCrackTips(svg, pts, strokeScale, startDelay, spreadDur) {
        if (pts.length < 2) return;
        const hw  = 2.75 * strokeScale;               // edge half-width (= edge stroke / 2)
        const hwc = Math.max(1.1, 1.8 * strokeScale); // core half-width
        const tl  = 18   * strokeScale;               // spike length

        const addTip = (dirPt, anchorPt, delay) => {
            const dx = anchorPt.x - dirPt.x;
            const dy = anchorPt.y - dirPt.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / dist, uy = dy / dist;
            const px = -uy,        py = ux;

            const ax = anchorPt.x, ay = anchorPt.y;
            const tipX = ax + ux * tl, tipY = ay + uy * tl;

            for (const [half, fill] of [
                [hw,  'rgba(215, 178, 255, 0.85)'],
                [hwc, 'rgba(2,   0,  12,  1)'],
            ]) {
                const poly = document.createElementNS(SVG_NS, 'polygon');
                poly.setAttribute('points',
                    `${(ax + px * half).toFixed(1)},${(ay + py * half).toFixed(1)} ` +
                    `${(ax - px * half).toFixed(1)},${(ay - py * half).toFixed(1)} ` +
                    `${tipX.toFixed(1)},${tipY.toFixed(1)}`
                );
                poly.setAttribute('fill', fill);
                poly.style.opacity = '0';
                svg.appendChild(poly);

                const t = setTimeout(() => {
                    if (!svg.isConnected) return;
                    poly.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 60, fill: 'forwards' });
                }, delay);
                this._crackTimeouts.push(t);
            }
        };

        // Start tip: appears shortly after crack begins drawing
        addTip(pts[1], pts[0], startDelay + 80);
        // End tip: appears when crack finishes drawing
        addTip(pts[pts.length - 2], pts[pts.length - 1], startDelay + spreadDur + 30);
    }

    _closeCrackSVG(svg) {
        if (!svg.isConnected) return;

        const closeDur = 1200 + Math.random() * 600;
        let lastAnim   = null;

        for (const { path, pathLen, anim } of (svg._crackAnims || [])) {
            try { anim.commitStyles(); } catch (_) {}
            anim.cancel();
            const close = path.animate(
                [{ strokeDashoffset: 0 }, { strokeDashoffset: pathLen }],
                { duration: closeDur, easing: 'cubic-bezier(0.25,0,0.80,0.90)', fill: 'forwards' }
            );
            lastAnim = close;
        }

        // Fade out while retracting
        svg.animate(
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: closeDur * 0.85, delay: closeDur * 0.15, easing: 'ease-in', fill: 'forwards' }
        );

        if (lastAnim) lastAnim.addEventListener('finish', () => svg.remove());
    }

    // ─── Glass Shatter ───────────────────────────────────────

    _startGlassShatter(overlayEl) {
        const bgLayer  = overlayEl.querySelector('.vn-bg-layer');
        let bgImage = 'none';
        if (bgLayer) {
            bgImage = bgLayer.style.backgroundImage
                || window.getComputedStyle(bgLayer).backgroundImage
                || 'none';
        }

        const container = document.createElement('div');
        container.className = 'vn-fx-ray vn-glass-container';
        overlayEl.appendChild(container);

        const W = overlayEl.offsetWidth  || 1200;
        const H = overlayEl.offsetHeight || 700;
        this._generateGlassShards(container, bgImage, W, H);
    }

    _generateGlassShards(container, bgImage, W, H) {
        const cx   = W * (0.46 + Math.random() * 0.08);
        const cy   = H * (0.46 + Math.random() * 0.08);
        const N    = 10 + Math.floor(Math.random() * 3);
        const diag = Math.sqrt(W * W + H * H);
        const Nf   = N * 2;

        const ringR = [
            diag * (0.13 + Math.random() * 0.04),
            diag * (0.28 + Math.random() * 0.06),
            diag * (0.50 + Math.random() * 0.08),
            diag * 1.05,
        ];

        // Each ring boundary has its own independent angles — inner/outer edges of
        // each shard are NOT on the same radii, giving truly irregular quadrilaterals
        const mkAng = (count, jitter) =>
            Array.from({ length: count }, (_, i) =>
                (2 * Math.PI * i / count) + (Math.random() - 0.5) * (2 * Math.PI / count) * jitter
            ).sort((a, b) => a - b);

        const bHole = mkAng(Nf, 0.55);
        const bR0   = mkAng(Nf, 0.55);
        const bR1   = mkAng(Nf, 0.50);
        const bR2   = mkAng(N,  0.45);
        const bR3   = mkAng(N,  0.40);

        const onRing = (ang, rIdx, ai) => {
            const a = ang[((ai % ang.length) + ang.length) % ang.length];
            return { x: cx + Math.cos(a) * ringR[rIdx], y: cy + Math.sin(a) * ringR[rIdx] };
        };

        // Hole polygon using bHole angles
        const holeBaseR = diag * (0.04 + Math.random() * 0.02);
        const holePts   = bHole.map(a => {
            const r = holeBaseR * (0.55 + Math.random() * 0.9);
            return {
                x: cx + Math.cos(a + (Math.random() - 0.5) * 0.25) * r,
                y: cy + Math.sin(a + (Math.random() - 0.5) * 0.25) * r,
            };
        });

        // Helper: emit shard, randomly splitting quads diagonally for inner rings
        const emit = (pts, depth, canSplit = false) => {
            if (canSplit && Math.random() < 0.38) {
                const [p0, p1, p2, p3] = pts;
                if (Math.random() < 0.5) {
                    this._makeGlassShard(container, [p0, p1, p2], bgImage, depth, cx, cy);
                    this._makeGlassShard(container, [p0, p2, p3], bgImage, depth, cx, cy);
                } else {
                    this._makeGlassShard(container, [p0, p1, p3], bgImage, depth, cx, cy);
                    this._makeGlassShard(container, [p1, p2, p3], bgImage, depth, cx, cy);
                }
            } else {
                this._makeGlassShard(container, pts, bgImage, depth, cx, cy);
            }
        };

        // Inner ring (hole → bR0): angles differ → irregular quads, 38% split
        for (let i = 0; i < Nf; i++) {
            emit([
                holePts[i], holePts[(i + 1) % Nf],
                onRing(bR0, 0, (i + 1) % Nf), onRing(bR0, 0, i),
            ], 0.10, true);
        }

        // Second ring (bR0 → bR1): same approach
        for (let i = 0; i < Nf; i++) {
            emit([
                onRing(bR0, 0, i), onRing(bR0, 0, (i + 1) % Nf),
                onRing(bR1, 1, (i + 1) % Nf), onRing(bR1, 1, i),
            ], 0.35, true);
        }

        // Transition ring (bR1 → bR2): bridge fine→coarse, each coarse shard spans 2 fine points
        for (let i = 0; i < N; i++) {
            emit([
                onRing(bR1, 1, 2 * i), onRing(bR1, 1, (2 * i + 2) % Nf),
                onRing(bR2, 2, (i + 1) % N), onRing(bR2, 2, i),
            ], 0.65);
        }

        // Outer ring (bR2 → bR3)
        for (let i = 0; i < N; i++) {
            emit([
                onRing(bR2, 2, i), onRing(bR2, 2, (i + 1) % N),
                onRing(bR3, 3, (i + 1) % N), onRing(bR3, 3, i),
            ], 0.90);
        }
    }

    // Shrinks each polygon vertex toward its centroid by `px` pixels
    _insetPolygon(points, px) {
        const n   = points.length;
        const gcx = points.reduce((s, p) => s + p.x, 0) / n;
        const gcy = points.reduce((s, p) => s + p.y, 0) / n;
        return points.map(p => {
            const dx = p.x - gcx, dy = p.y - gcy;
            const d  = Math.sqrt(dx * dx + dy * dy);
            if (d < px) return { x: gcx, y: gcy };
            return { x: gcx + dx * (d - px) / d, y: gcy + dy * (d - px) / d };
        });
    }

    _makeGlassShard(container, points, bgImage, depthFactor = 0.5, impactX = 0, impactY = 0) {
        // Explicit gap between shards: inset each polygon toward its centroid
        const insetPx = 5 + depthFactor * 8;
        const inset   = this._insetPolygon(points, insetPx);
        const clip    = `polygon(${inset.map(p => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(', ')})`;

        // Per-shard light direction: glint angle depends on shard position vs impact
        const scx        = inset.reduce((s, p) => s + p.x, 0) / inset.length;
        const scy        = inset.reduce((s, p) => s + p.y, 0) / inset.length;
        const shineAngle = ((Math.atan2(scy - impactY, scx - impactX) * 180 / Math.PI) - 50 + 360) % 360;

        // Outer shards tilt and wobble more than inner ones
        const amp = 0.4 + depthFactor * 2.0;
        const rx  = (Math.random() - 0.5) * 22 * amp;
        const ry  = (Math.random() - 0.5) * 22 * amp;
        const rz  = (Math.random() - 0.5) * 6  * amp;
        const tz  = (Math.random() - 0.5) * 18 * amp;
        const drx = (Math.random() - 0.5) * 6  * amp;
        const dry = (Math.random() - 0.5) * 6  * amp;
        const drz = (Math.random() - 0.5) * 2.5 * amp;
        const dtz = (Math.random() - 0.5) * 8  * amp;

        const dur   = 8000 + Math.random() * 10000;
        const delay = -(Math.random() * 18000);

        const t0 = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) translateZ(${tz.toFixed(2)}px)`;
        const t1 = `perspective(900px) rotateX(${(rx+drx).toFixed(2)}deg) rotateY(${(ry+dry).toFixed(2)}deg) rotateZ(${(rz+drz).toFixed(2)}deg) translateZ(${(tz+dtz).toFixed(2)}px)`;

        const div = document.createElement('div');
        div.className = 'vn-glass-shard';
        div.style.clipPath = clip;
        div.style.setProperty('--shard-shine', `${shineAngle.toFixed(0)}deg`);
        if (bgImage !== 'none') div.style.backgroundImage = bgImage;

        container.appendChild(div);

        div.animate(
            [{ transform: t0 }, { transform: t1 }, { transform: t0 }],
            { duration: dur, delay, iterations: Infinity, easing: 'ease-in-out' }
        );
    }

    // ─── Cosmic Horror ───────────────────────────────────────

    _startCosmicPulse(overlayEl) {
        let cosmicPhase = 0;
        const tint = overlayEl.querySelector('.vn-fx-tint');

        this._flashInterval = setInterval(() => {
            if (!tint) return;
            cosmicPhase += 0.08;
            tint.style.opacity = (0.6 + Math.sin(cosmicPhase) * 0.2).toFixed(3);
        }, 1500);

        this._glitchInterval = setInterval(() => {
            if (Math.random() >= 0.4) return;
            overlayEl.classList.add('vn-gravity-wave');
            this._crackTimeouts.push(
                setTimeout(() => overlayEl.classList.remove('vn-gravity-wave'), 3000)
            );
        }, 10000);
    }

    // ─── Ghosts ──────────────────────────────────────────────

    _startGhostHaunt(overlayEl) {
        const flash = overlayEl.querySelector('.vn-fx-flash');
        if (!flash) return;

        const scheduleHaunt = () => {
            this._flashInterval = setTimeout(() => {
                if (!flash.classList.contains('vn-ghost-presence')) {
                    const x = 12 + Math.random() * 76;
                    const y =  8 + Math.random() * 62;
                    flash.style.setProperty('--ghost-x', `${x.toFixed(1)}%`);
                    flash.style.setProperty('--ghost-y', `${y.toFixed(1)}%`);
                    flash.classList.add('vn-ghost-presence');
                    // Remove after animation completes (animation is 8s)
                    this._crackTimeouts.push(
                        setTimeout(() => flash.classList.remove('vn-ghost-presence'), 8500)
                    );
                }
                scheduleHaunt();
            }, 7000 + Math.random() * 9000);
        };
        scheduleHaunt();
    }

    // ─── Abyss ───────────────────────────────────────────────

    _startAbyssPressure(overlayEl) {
        const flash = overlayEl.querySelector('.vn-fx-flash');

        const schedulePressure = () => {
            this._flashInterval = setTimeout(() => {
                overlayEl.classList.add('vn-pressure-wave');
                this._crackTimeouts.push(
                    setTimeout(() => overlayEl.classList.remove('vn-pressure-wave'), 2500)
                );
                schedulePressure();
            }, 6000 + Math.random() * 4000);
        };
        schedulePressure();

        const scheduleBiolum = () => {
            this._glitchInterval = setTimeout(() => {
                if (Math.random() < 0.4 && flash) {
                    const x = 15 + Math.random() * 70;
                    const y = 20 + Math.random() * 60;
                    flash.style.setProperty('--biolum-x', `${x}%`);
                    flash.style.setProperty('--biolum-y', `${y}%`);
                    flash.style.setProperty('--biolum-hue', `${160 + Math.random() * 40}`);
                    flash.classList.add('vn-biolum-flash');
                    this._crackTimeouts.push(
                        setTimeout(() => flash.classList.remove('vn-biolum-flash'), 2000 + Math.random() * 1500)
                    );
                }
                scheduleBiolum();
            }, 5000 + Math.random() * 3000);
        };
        scheduleBiolum();
    }
}
