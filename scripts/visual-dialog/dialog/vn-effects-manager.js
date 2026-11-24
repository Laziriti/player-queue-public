// ============================================================
// vn-effects-manager.js — вкладка "Эффекты": независимые пикеры
// частиц и визуальных эффектов
// ============================================================

import { normalizeParticleEffect } from '../visual-effects/atmosphere/config/particle-types.js';
import { normalizeVisualEffect } from '../visual-effects/atmosphere/config/visual-types.js';
import { escapeHtml } from '../../utils/text.js';
import { effectPickerLabel, renderEffectTiles, setVariantGroupOpen, syncEffectVariants,
    toggleVariantGroup } from '../effect-controls/vn-effect-picker.js';
import { withParticleMotion } from '../visual-effects/atmosphere/config/particle-effect-settings.js';
import { renderParticleEffectSettings, syncParticleEffectSettings } from '../effect-controls/vn-particle-effect-settings-ui.js';
import { PARTICLE_SETTINGS_DEFAULTS, VISUAL_SETTINGS_DEFAULTS, resolveParticlesLayer, resolveVisualAngle } from '../scene/vn-scene-contract.js';
import { renderParticleSettings, readParticleSettings, syncParticleSettings, updateParticleRange,
    particleSettingPatch } from '../effect-controls/vn-particle-settings-ui.js';
import { renderVisualSettings, readVisualSettings, syncVisualSettings, syncVisualControlVisibility, syncVisualSettingsScope, updateVisualRange, visualTintColorPatch }
        from '../effect-controls/vn-visual-settings-ui.js';

export class VNEffectsManager {
    /** Public form interface; callers do not coordinate picker internals or hidden inputs. */
    setAxis(root, axis, value) {
        this._applyAxisValue(root, axis, axis === 'particle' ? normalizeParticleEffect(value) : normalizeVisualEffect(value));
    }

    applyState(root, state) {
        const settings = root.querySelector('.vn-particle-effect-settings-data');
        if (settings) settings.value = JSON.stringify(state.particleEffectSettings ?? {});
        this.setAxis(root, 'particle', state.particleEffect ?? 'none');
        this.setAxis(root, 'visual', state.visualEffect ?? 'none');
        syncVisualSettings(root, state);
        syncParticleSettings(root, { ...state, particlesLayer: resolveParticlesLayer(state) });
    }

    readState(root) {
        return {
            particleEffect: root.querySelector('#particle-effect')?.value || 'particles',
            particleEffectSettings: this._readParticleEffectSettings(root),
            visualEffect: root.querySelector('#visual-effect')?.value || 'none',
            ...readVisualSettings(root),
            ...readParticleSettings(root),
        };
    }

    _readParticleEffectSettings(root) {
        return JSON.parse(root.querySelector('.vn-particle-effect-settings-data')?.value || '{}');
    }

    _updateCurrent(root) {
        for (const axis of ['particle', 'visual']) {
            const el = root.querySelector(`.vn-effects-current[data-axis="${axis}"]`);
            if (el) el.textContent = effectPickerLabel(axis, root.querySelector(`#${axis}-effect`)?.value);
        }
    }

    _applySearch(root, query) {
        const q = query.trim().toLowerCase();
        root.querySelectorAll('.vn-effects-inline-grid').forEach(grid => {
            let header = null, shown = 0;
            const flush = () => { if (header) header.style.display = shown ? '' : 'none'; };
            for (const el of grid.children) {
                if (el.classList.contains('vn-atmo-group-header')) {
                    flush();
                    header = el; shown = 0;
                    continue;
                }
                const btn = el.matches('.vn-atmo-item') ? el : el.querySelector('.vn-atmo-item');
                const hit = !q || (btn?.title || '').toLowerCase().includes(q)
                    || (el.dataset.variantAxis === 'particle'
                        && [...el.querySelectorAll('.vn-variant-option')].some(option => option.textContent.toLowerCase().includes(q)));
                el.style.display = hit ? '' : 'none';
                if (hit) shown++;
            }
            flush();
        });
    }

    generateTab(particle = 'particles', currentVisual = 'none', settings = { particleDepth: 'soft' }) {
        currentVisual = normalizeVisualEffect(currentVisual);
        const currentParticle = normalizeParticleEffect(particle);
        const particleGrid = renderEffectTiles('particle', currentParticle);
        const visualGrid = renderEffectTiles('visual', currentVisual);

        return `<div class="vn-effects-tab">
            <input type="hidden" id="particle-effect" value="${currentParticle}">
            <input type="hidden" class="vn-particle-effect-settings-data" value="${escapeHtml(JSON.stringify(settings.particleEffectSettings ?? {}))}">
            <input type="hidden" id="visual-effect" value="${currentVisual}">

            <div class="vn-effects-controls-row">
                <div class="vn-effects-search">
                    <i class="fas fa-magnifying-glass"></i>
                    <input type="text" class="vn-effects-search-input" placeholder="${game.i18n.localize('vn.atmosphere.searchPlaceholder')}" autocomplete="off" spellcheck="false">
                </div>
            </div>

            <div class="vn-effects-grids">
                <div class="vn-effects-grid-col">
                    <div class="vn-effects-grid-title"><i class="fas fa-star"></i> ${game.i18n.localize('vn.atmosphere.particlesHeader')}<span class="vn-effects-current" data-axis="particle">${escapeHtml(effectPickerLabel('particle', currentParticle))}</span></div>
                    ${renderParticleEffectSettings(currentParticle, settings.particleEffectSettings)}
                    <details class="vn-effects-settings vn-effects-particle-settings">
                        <summary><i class="fas fa-sliders" aria-hidden="true"></i> ${game.i18n.localize('vn.bg.particleSettings')}</summary>
                        ${renderParticleSettings(settings)}
                    </details>
                    <div class="vn-effects-inline-grid" data-axis="particle">${particleGrid}</div>
                </div>
                <div class="vn-effects-grid-col">
                    <div class="vn-effects-grid-title"><i class="fas fa-wand-sparkles"></i> ${game.i18n.localize('vn.atmosphere.visualHeader')}<span class="vn-effects-current" data-axis="visual">${escapeHtml(effectPickerLabel('visual', currentVisual))}</span></div>
                    <details class="vn-effects-settings vn-effects-visual-settings">
                        <summary><i class="fas fa-sliders" aria-hidden="true"></i> ${game.i18n.localize('vn.bg.visualSettings')}</summary>
                        ${renderVisualSettings({ ...settings, visualEffect: currentVisual })}
                    </details>
                    <div class="vn-effects-inline-grid" data-axis="visual">${visualGrid}</div>
                </div>
            </div>
        </div>`;
    }

    attachListeners(root) {
        if (!root || root._vnEffectsDelegated) return;
        root._vnEffectsDelegated = true;

        root.addEventListener('click', (e) => {
            if (e.target.closest('.vn-visual-angle-reset')) {
                this.setAngle(root, 0);
                return;
            }
            if (e.target.closest('.vn-visual-settings-reset')) {
                syncVisualSettings(root, { ...VISUAL_SETTINGS_DEFAULTS, visualEffect: root.querySelector('#visual-effect')?.value });
                return;
            }
            if (e.target.closest('.vn-particle-settings-reset')) {
                syncParticleSettings(root, PARTICLE_SETTINGS_DEFAULTS);
                return;
            }
            const particleChoice = e.target.closest('button[data-particle-setting]');
            if (particleChoice) {
                syncParticleSettings(root, { ...readParticleSettings(root), ...particleSettingPatch(particleChoice) });
                return;
            }

            const variantOption = e.target.closest('.vn-variant-option');
            if (variantOption) {
                const group = variantOption.closest('.vn-atmo-item-group');
                const base = group?.dataset.variantBase;
                const variant = variantOption.dataset.variant;
                if (base && variant) {
                    this._applyAxisValue(root, group.dataset.variantAxis || 'particle', variant === 'all' ? base : `${base}:${variant}`);
                }
                return;
            }

            const axisItem = e.target.closest('.vn-effects-inline-grid[data-axis] .vn-atmo-item');
            if (axisItem) {
                const grid = axisItem.closest('.vn-effects-inline-grid');
                const { axis } = grid.dataset;
                const group = axisItem.closest('.vn-atmo-item-group');

                if (group) {
                    // A first click on an inactive type selects it (base variant) and opens the variant list; later clicks only fold/unfold it
                    const base = group.dataset.variantBase;
                    const current = root.querySelector(`#${axis}-effect`)?.value.split(':')[0];
                    if (current !== base) {
                        this._applyAxisValue(root, axis, base);
                        setVariantGroupOpen(group, true);
                        return;
                    }
                    toggleVariantGroup(group, grid);
                    return;
                }

                this._applyAxisValue(root, axis, axisItem.dataset[axis]);
            }
        });

        // Registered after the handler above, so it sees the already updated hidden inputs
        root.addEventListener('click', () => this._updateCurrent(root));

        root.addEventListener('input', (e) => {
            if (e.target.matches('.vn-visual-angle, input[type="range"][data-visual-setting]')) {
                updateVisualRange(e.target);
            }
            if (e.target.classList.contains('vn-effects-search-input')) this._applySearch(root, e.target.value);
            if (e.target.matches('input[type="range"][data-particle-setting]')) updateParticleRange(e.target);
        });
        root.addEventListener('change', e => {
            if (e.target.matches('.vn-visual-settings-switch input')) {
                syncVisualSettingsScope(root, root.querySelector('#visual-effect')?.value);
            }
            if (e.target.matches('[data-particle-motion]')) {
                const field = root.querySelector('.vn-particle-effect-settings-data');
                const effect = root.querySelector('#particle-effect')?.value;
                field.value = JSON.stringify(withParticleMotion(this._readParticleEffectSettings(root), effect, e.target.value));
            }
            if (e.target.matches('input[data-particle-setting="particleTintColor"]')) {
                syncParticleSettings(root, { ...readParticleSettings(root), ...particleSettingPatch(e.target) });
            }
            if (e.target.matches('.vn-visual-tint-color')) {
                syncVisualSettings(root, { ...readVisualSettings(root), ...visualTintColorPatch(e.target),
                    visualEffect: root.querySelector('#visual-effect')?.value });
            }
        });
    }

    setAngle(root, angle) {
        const input = root.querySelector('.vn-visual-angle');
        if (!input) return;
        input.value = resolveVisualAngle(angle);
        updateVisualRange(input);
    }

    _applyAxisValue(root, axis, value) {
        const input = root.querySelector(`#${axis}-effect`);
        if (input) input.value = value;
        if (axis === 'visual') syncVisualControlVisibility(root, value);
        else syncParticleEffectSettings(root, value, this._readParticleEffectSettings(root));
        const [base, variant] = value.split(':');
        const grid = root.querySelector(`.vn-effects-inline-grid[data-axis="${axis}"]`);
        grid?.querySelectorAll('.vn-atmo-item').forEach(i =>
            i.classList.toggle('active', i.dataset[axis] === base));
        if (grid) syncEffectVariants(grid, axis, base, variant);
        this._updateCurrent(root);
    }
}
