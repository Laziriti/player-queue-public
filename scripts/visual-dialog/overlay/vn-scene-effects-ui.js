// GM effect pickers: controls, variant groups and synchronization with scene state.
import { VNAtmosphere } from '../visual-effects/atmosphere/index.js';
import { syncEffectVariants, toggleVariantGroup } from '../effect-controls/vn-effect-picker.js';
import { PARTICLE_SETTINGS_DEFAULTS, VISUAL_SETTINGS_DEFAULTS } from '../scene/vn-scene-contract.js';
import { particleSettingPatch, syncParticleSettings, updateParticleRange } from '../effect-controls/vn-particle-settings-ui.js';
import { syncVisualSettings, syncVisualControlVisibility, syncVisualSettingsScope, updateVisualRange, visualSettingPatch } from '../effect-controls/vn-visual-settings-ui.js';
import { VNOverlayPickers } from './vn-overlay-pickers.js';
import { withParticleMotion } from '../visual-effects/atmosphere/config/particle-effect-settings.js';
import { syncLiveParticleSettingsScope, syncParticleEffectSettings } from '../effect-controls/vn-particle-effect-settings-ui.js';

export class VNSceneEffectsUI {
    constructor(scene) {
        this._scene = scene;
        this._pickers = new VNOverlayPickers();
        this._namespace = null;
    }

    syncSettings() {
        const overlay = this._scene.$overlay?.[0];
        syncParticleSettings(overlay, this._scene.state);
        const { particleEffect, particleEffectSettings } = this._scene.state;
        syncParticleEffectSettings(overlay, particleEffect, particleEffectSettings);
        syncLiveParticleSettingsScope(overlay, particleEffect);
        syncVisualSettings(overlay, this._scene.state);
        const panel = overlay?.querySelector('.vn-fxset-picker');
        if (!panel) return;
        const overlayToggle = panel.querySelector('.vn-fxset-dimming');
        if (overlayToggle) overlayToggle.checked = this._scene.state.backgroundOverlay !== false;
        const vignetteToggle = panel.querySelector('.vn-fxset-vignette');
        if (vignetteToggle) vignetteToggle.checked = this._scene.state.vignette !== false;
        const fogToggle = panel.querySelector('.vn-fxset-fog');
        if (fogToggle) fogToggle.checked = this._scene.state.groundFog !== false;
    }

    syncButtons() {
        const overlay = this._scene.$overlay?.[0];
        if (!overlay) return;
        const [particleType, particleVariant = 'all'] = (this._scene.state.particleEffect || 'particles').split(':');
        const [visual, visualVariant = 'all'] = (this._scene.state.visualEffect || 'none').split(':');

        const particleBtn = overlay.querySelector('.vn-particle-cycle-btn');
        if (particleBtn) {
            particleBtn.querySelector('i').className = `fas ${VNAtmosphere.PARTICLE_ICONS[particleType]}`;
            particleBtn.title = game.i18n.format('vn.atmosphere.particleButtonTitle', { effect: game.i18n.localize(VNAtmosphere.PARTICLE_LABELS[particleType]) });
        }
        overlay.querySelectorAll('.vn-atmo-item[data-particle]').forEach(item =>
            item.classList.toggle('active', item.dataset.particle === particleType));
        syncEffectVariants(overlay, 'particle', particleType, particleVariant);

        const visualBtn = overlay.querySelector('.vn-visual-cycle-btn');
        if (visualBtn) {
            visualBtn.querySelector('i').className = `fas ${VNAtmosphere.VISUAL_ICONS[visual]}`;
            visualBtn.title = game.i18n.format('vn.atmosphere.visualButtonTitle', { effect: game.i18n.localize(VNAtmosphere.VISUAL_LABELS[visual]) });
        }
        overlay.querySelectorAll('.vn-atmo-item[data-visual]').forEach(item =>
            item.classList.toggle('active', item.dataset.visual === visual));
        syncEffectVariants(overlay, 'visual', visual, visualVariant);
        syncVisualControlVisibility(overlay, this._scene.state.visualEffect);
    }

    attachListeners(namespace) {
        this.detachListeners();
        const ns = this._namespace = namespace + 'Effects';
        for (const [selector, key, pickerSelector] of [
            ['.vn-particle-cycle-btn', 'particle', '.vn-atmosphere-picker'],
            ['.vn-visual-cycle-btn', 'visual', '.vn-atmosphere-picker'],
            ['.vn-fxset-btn', 'settings', '.vn-fxset-picker'],
        ]) {
            $(document).on(`click${ns}`, selector, e => {
                e.stopPropagation();
                const wrap = e.currentTarget.closest('.vn-atmo-wrap');
                const picker = wrap?.querySelector(pickerSelector);
                if (picker) this._pickers.toggle(wrap, picker, key);
            });
        }

        const applyParticleSetting = control => this._scene.setParticleSettings(particleSettingPatch(control));
        $(document).on(`change${ns}`, '#vn-scene-overlay .vn-particle-settings-switch input', e =>
            syncLiveParticleSettingsScope(e.currentTarget.closest('#vn-scene-overlay'), this._scene.state.particleEffect));
        $(document).on(`change${ns}`, '#vn-scene-overlay .vn-visual-settings-switch input', e =>
            syncVisualSettingsScope(e.currentTarget.closest('#vn-scene-overlay'), this._scene.state.visualEffect));
        $(document).on(`click${ns}`, '#vn-scene-overlay button[data-particle-setting]', e => applyParticleSetting(e.currentTarget));
        $(document).on(`input${ns}`, '#vn-scene-overlay input[type="range"][data-particle-setting]', e => {
            const control = e.currentTarget;
            updateParticleRange(control);
            if (control.dataset.particleSetting === 'particleWind') applyParticleSetting(control);
        });
        $(document).on(`change${ns}`, '#vn-scene-overlay input[data-particle-setting]', e => applyParticleSetting(e.currentTarget));
        $(document).on(`change${ns}`, '#vn-scene-overlay [data-particle-motion]', e => {
            const { particleEffect, particleEffectSettings } = this._scene.state;
            this._scene.setParticleSettings({
                particleEffectSettings: withParticleMotion(particleEffectSettings, particleEffect, e.currentTarget.value),
            });
        });
        $(document).on(`click${ns}`, '#vn-scene-overlay .vn-particle-settings-reset', () => {
            this._scene.setParticleSettings(PARTICLE_SETTINGS_DEFAULTS);
        });
        $(document).on(`input${ns}`, '#vn-scene-overlay .vn-visual-angle', (e) => this._scene.setVisualAngle(e.currentTarget.value, true));
        $(document).on(`click${ns}`, '#vn-scene-overlay .vn-visual-angle-reset', () => this._scene.setVisualAngle(0, true));
        $(document).on(`input${ns}`, '#vn-scene-overlay input[type="range"][data-visual-setting]', e =>
            updateVisualRange(e.currentTarget));
        $(document).on(`change${ns}`, '#vn-scene-overlay [data-visual-setting]', e =>
            this._scene.setVisualSettings(visualSettingPatch(e.currentTarget)));
        $(document).on(`click${ns}`, '#vn-scene-overlay .vn-visual-settings-reset', () =>
            this._scene.setVisualSettings(VISUAL_SETTINGS_DEFAULTS));
        $(document).on(`change${ns}`, '#vn-scene-overlay .vn-fxset-dimming', (e) => this._scene.setBackgroundOverlay(e.currentTarget.checked, true));
        $(document).on(`change${ns}`, '#vn-scene-overlay .vn-fxset-vignette', (e) => this._scene.setVignette(e.currentTarget.checked, true));
        $(document).on(`change${ns}`, '#vn-scene-overlay .vn-fxset-fog', (e) => this._scene.setGroundFog(e.currentTarget.checked, true));

        $(document).on(`click${ns}`, '#vn-scene-overlay .vn-atmo-item', e => {
            const tile = e.currentTarget;
            const group = tile.closest('.vn-atmo-item-group');
            if (group) {
                toggleVariantGroup(group, tile.closest('.vn-atmosphere-picker-grid'));
                return;
            }
            const { particle, visual } = tile.dataset;
            if (particle) this._scene.setParticleEffect(particle);
            else if (visual) this._scene.setVisualEffect(visual);
        });

        $(document).on(`click${ns}`, '#vn-scene-overlay .vn-variant-option', (e) => {
            e.stopPropagation();
            const group = e.currentTarget.closest('.vn-atmo-item-group');
            const base = group?.dataset.variantBase;
            const variant = e.currentTarget.dataset.variant;
            if (!base || !variant) return;
            const value = variant === 'all' ? base : `${base}:${variant}`;
            if (group.dataset.variantAxis === 'visual') this._scene.setVisualEffect(value);
            else this._scene.setParticleEffect(value);
        });

    }

    detachListeners() {
        if (this._namespace) $(document).off(this._namespace);
        this._namespace = null;
        this._pickers.clear();
    }
}
