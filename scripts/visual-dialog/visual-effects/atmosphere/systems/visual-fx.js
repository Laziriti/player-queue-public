// Visual-effect facade: Pixi layers and procedural effects with their own lifecycles.
import { SceneEffectCues } from './effects/scene-effect-cues.js';
import { PixiCubesEffect } from './effects/cubes/cubes-pixi.js';
import { PixiKaleidoscopeEffect } from './effects/kaleidoscope-pixi.js';
import { PixiGlassEffect, PixiGlassBackgroundEffect } from './effects/glass/glass-pixi.js';
import { PixiEarthquakeEffect } from './effects/earthquake-pixi.js';
import { PixiVoidBreachEffect } from './effects/void-breach-pixi.js';
import { PixiVhsEffect } from './effects/vhs-pixi.js';
import { PixiDrunkEffect } from './effects/drunk-pixi.js';
import { PixiRainGlassEffect } from './effects/rain-glass-pixi.js';
import { PixiAdjustableLook, PixiCinematicLook } from './effects/cinematic-look-pixi.js';
import { PixiStainedGlassEffect } from './effects/stained-glass-pixi.js';
import { COLOR_GRADE_EFFECTS, PixiColorGradeEffect } from './effects/color-grade-pixi.js';
import { sceneTintFilter } from '../../vn-tint-filter.js';
import { CosmicEntity } from './effects/cosmic-entity.js';
import { VISUAL_EFFECT_SETTINGS } from '../config/visual-effect-settings.js';
import { normalizeVisualEffect, resolveVisualStyleEffect } from '../config/visual-types.js';

const FX_LAYERS = ['vn-fx-tint', 'vn-fx-rays', 'vn-fx-edges', 'vn-fx-flash', 'vn-fx-scan'];
const PAINT_LAYERS = [...FX_LAYERS, 'vn-fx-bloom', 'vn-vignette', 'vn-ground-fog', 'vn-ambient-light', 'vn-fx-grain'];
const STRENGTH_LAYERS = [...FX_LAYERS, 'vn-fx-bloom', 'vn-ambient-light', 'vn-fx-grain']
    .map(name => `.${name}`).join(', ');
const BACKGROUND_EFFECTS = new Map([
    ['flood', PixiAdjustableLook], ['eclipse:phase', PixiAdjustableLook],
    ['cubes', PixiCubesEffect], ['kaleidoscope', PixiKaleidoscopeEffect],
    ['vhs', PixiVhsEffect], ['drunk', PixiDrunkEffect],
    ['rain_glass', PixiRainGlassEffect], ['mirror_world', PixiCinematicLook], ['eclipse', PixiCinematicLook],
    ['paper_map', PixiCinematicLook], ['stained_glass', PixiStainedGlassEffect],
    ['glass_shatter:background', PixiGlassBackgroundEffect]
]);
const SCENE_EFFECTS = new Map([
    ['glass_shatter', PixiGlassEffect], ['earthquake', PixiEarthquakeEffect], ['void_breach', PixiVoidBreachEffect],
    ['cosmic_horror:eye', CosmicEntity],
]);
const COLOR_GRADES = new Set(COLOR_GRADE_EFFECTS);

export class VisualFXSystem {
    constructor() {
        this._cues = new SceneEffectCues();
        this._overlayEl = null;
        this._visual = 'none';
        this._effect = null;
        this._strengthAnimations = [];
    }

    /**
     * Применить визуальный эффект к overlay
     * @param {HTMLElement} overlayEl — корневой overlay-элемент
     * @param {string} visual — тип визуального эффекта, возможно с вариантом ("noir:blinds", см. VISUAL_VARIANTS)
     */
    apply(overlayEl, visual, settings = {}) {
        this._removeEffect();
        this._overlayEl = overlayEl;
        const normalized = normalizeVisualEffect(String(visual || 'none'));
        const styleEffect = resolveVisualStyleEffect(normalized);
        const [type, variant] = normalized.split(':');
        const [styleType, styleVariant] = styleEffect.split(':');
        const lite = overlayEl.classList.contains('vn-lite');
        this._visual = lite || type === 'none' ? 'none' : normalized;
        this._effectSettings = settings;
        this._syncForeground(settings);
        this._setSceneLayers(lite ? null : overlayEl);
        if (lite || type === 'none') return;

        overlayEl.classList.add(`vn-vfx-${type}`);
        if (variant && variant !== 'all') overlayEl.classList.add(`vn-vfx-${type}-${variant}`);
        overlayEl.classList.add(`vn-vfx-${styleType}`);
        if (styleVariant && styleVariant !== 'all') overlayEl.classList.add(`vn-vfx-${styleType}-${styleVariant}`);
        this._ensureFXLayers(overlayEl);

        this._syncMonochrome(settings);
        this._syncHologramScan(settings);
        this.setLayerAppearance(settings);
        this.setBackgroundEnabled(settings.visualBackground !== false);
        const Effect = SCENE_EFFECTS.get(styleEffect) ?? (BACKGROUND_EFFECTS.has(styleEffect) ? null : SCENE_EFFECTS.get(styleType));
        if (Effect) {
            this._effect = new Effect();
            this._effect.start(overlayEl, styleVariant, styleType, settings);
        }

        this._cues.start(overlayEl, styleType, styleVariant);
    }

    setEffectSettings(settings) {
        this._effectSettings = settings;
        this._syncForeground(settings);
        this._syncMonochrome(settings);
        this._syncHologramScan(settings);
        this._effect?.setSettings?.(settings);
        this._backgroundEffect?.setSettings?.(settings);
        this._grade?.setSettings(settings);
    }

    _syncForeground({ visualForeground = false } = {}) {
        const active = this._visual !== 'none' && !this._overlayEl?.classList.contains('vn-lite');
        this._overlayEl?.classList.toggle('vn-visual-fg', active && visualForeground === true);
    }

    _syncMonochrome({ monochromeAmount = 100 }) {
        if (this._visual !== 'monochrome') return;
        const style = this._overlayEl.style;
        if (monochromeAmount > 0) style.setProperty('--vn-monochrome-filter', `grayscale(${monochromeAmount}%)`);
        else style.removeProperty('--vn-monochrome-filter');
    }

    _syncHologramScan({ hologramScanColor = VISUAL_EFFECT_SETTINGS.hologramScanColor.initial }) {
        if (this._visual !== 'hologram') return;
        const { classList, style } = this._overlayEl;
        const custom = hologramScanColor !== VISUAL_EFFECT_SETTINGS.hologramScanColor.initial;
        classList.toggle('vn-vfx-hologram-custom-scan', custom);
        if (custom) style.setProperty('--vn-hologram-scan-color', hologramScanColor);
        else style.removeProperty('--vn-hologram-scan-color');
    }

    setLayerAppearance({ visualLayerStrength: strength = 100, visualTintColor: color = '#ffffff', visualTintStrength: amount = 0 }) {
        const overlay = this._overlayEl;
        if (!overlay || this._visual === 'none') return;
        overlay.style.setProperty('--vn-visual-layer-tint', sceneTintFilter(color, amount));
        if (strength === 100) {
            this._clearStrength();
            return;
        }
        overlay.style.setProperty('--vn-visual-layer-strength', strength / 100);
        // The parent owns animated filters and blend modes. Tint lives on the painted content.
        const filter = `opacity(${strength}%)`;
        const keys = [{ filter }, { filter }];
        if (this._strengthAnimations.length) {
            this._strengthAnimations.forEach(animation => animation.effect.setKeyframes(keys));
            return;
        }
        this._strengthAnimations = Array.from(overlay.querySelectorAll(STRENGTH_LAYERS), layer => {
            const effect = new KeyframeEffect(layer, keys, { duration: 1, fill: 'both', composite: 'add' });
            const animation = new Animation(effect, document.timeline);
            animation.currentTime = 0;
            return animation;
        });
    }

    setBackgroundEnabled(enabled) {
        const overlay = this._overlayEl;
        if (!overlay || this._visual === 'none') return;
        overlay.classList.toggle('vn-visual-plain-background', !enabled);
        if (!enabled) {
            this._stopBackgroundEffects();
            return;
        }
        const styleEffect = resolveVisualStyleEffect(this._visual);
        const [styleType, styleVariant] = styleEffect.split(':');
        if (!this._grade && (COLOR_GRADES.has(styleEffect) || COLOR_GRADES.has(styleType))) {
            this._grade = new PixiColorGradeEffect();
            this._grade.start(overlay, styleVariant, styleType, this._effectSettings);
        }
        const Effect = BACKGROUND_EFFECTS.get(styleEffect) ?? BACKGROUND_EFFECTS.get(styleType);
        if (Effect && !this._backgroundEffect) {
            this._backgroundEffect = new Effect();
            this._backgroundEffect.start(overlay, styleVariant, styleType, this._effectSettings);
        }
    }

    _clearStrength() {
        this._strengthAnimations.forEach(animation => animation.cancel());
        this._strengthAnimations = [];
        this._overlayEl?.style.removeProperty('--vn-visual-layer-strength');
    }

    _stopBackgroundEffects() {
        this._grade?.stop();
        this._grade = null;
        this._backgroundEffect?.stop();
        this._backgroundEffect = null;
    }

    /**
     * Удалить все визуальные эффекты
     */
    remove() {
        this._setSceneLayers(null);
        this._removeEffect();
    }

    _removeEffect() {
        this._effect?.stop();
        this._effect = null;
        this._stopBackgroundEffects();
        this._clearStrength();
        this._overlayEl?.style.removeProperty('--vn-visual-layer-tint');
        this._overlayEl?.style.removeProperty('--vn-monochrome-filter');
        this._overlayEl?.style.removeProperty('--vn-hologram-scan-color');
        this._overlayEl?.classList.remove('vn-visual-fg');
        this._cues.stop();

        if (!this._overlayEl) return;
        this._overlayEl.classList.remove('vn-visual-plain-background');
        for (const name of [...this._overlayEl.classList]) {
            if (name.startsWith('vn-vfx-')) this._overlayEl.classList.remove(name);
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

    _setSceneLayers(overlay) {
        if (overlay && this._scenePaint?.overlay === overlay) return;
        this._scenePaint?.renderer?.stop();
        this._scenePaint?.overlay.classList.remove('vn-fx-pixi');
        this._scenePaint = null;
        if (!overlay) return;

        overlay.classList.add('vn-fx-pixi');
        const paint = this._scenePaint = { overlay };
        void import('./effects/scene-layers/pixi-scene-layers.js').then(async ({ PixiSceneLayers }) => {
            if (this._scenePaint !== paint) return;
            paint.renderer = new PixiSceneLayers();
            await paint.renderer.start(overlay);
        }).catch(error => {
            if (this._scenePaint === paint) console.error('VN: Pixi scene layers failed to start', error);
        });
    }

    _ensureFXLayers(overlayEl) {
        const bgLayer = overlayEl.querySelector('.vn-bg-layer');
        const insertRef = bgLayer?.nextSibling || null;

        for (const cls of FX_LAYERS) {
            if (!overlayEl.querySelector(`.${cls}`)) {
                const div = document.createElement('div');
                div.className = cls;
                insertRef
                    ? overlayEl.insertBefore(div, insertRef)
                    : overlayEl.prepend(div);
            }
        }
        for (const cls of PAINT_LAYERS) {
            const layer = overlayEl.querySelector(`.${cls}`);
            if (!layer || layer.querySelector(':scope > .vn-fx-before')) continue;
            for (const part of ['before', 'after']) {
                const child = document.createElement('span');
                child.className = `vn-fx-${part}`;
                child.setAttribute('aria-hidden', 'true');
                layer.appendChild(child);
            }
        }
    }
}
