// ============================================================
// vn-sequence.js — runtime of a composite preset (sequence of scene steps)
// ============================================================

import { promptDialog } from '../../utils/dialog.js';
import { SCENE_SOURCE } from './vn-scene-changes.js';
import { PARTICLE_SETTINGS_DEFAULTS, VISUAL_SETTINGS_DEFAULTS } from './vn-scene-contract.js';
import { STAGE_FIELDS, hasActors, sameCast, clearStage, resolveStep, inheritedMusic } from '../presets/vn-sequence-model.js';
import { VNPresets } from '../presets/vn-presets.js';
import { VNPreloader } from '../media/vn-preload.js';
import { escapeHtml } from '../../utils/text.js';
import { VNPresetLink } from '../overlay/vn-preset-link.js';
import { VNTransitions } from '../visual-effects/vn-transitions.js';
import { resolveCaptionStyle } from '../overlay/vn-caption.js';

const loc = (key) => game.i18n.localize(key);

/**
 * GM-side controller that walks a running scene through the steps of a sequence preset.
 * A step switch is a regular `updateSceneLayout()` call, so transitions, socket sync and persistence
 * are the same as for a manual scene edit. Players only ever see the result (including the caption).
 */
export class VNSequence {
    constructor(scene) {
        /** @type {import('../visual-novel-scene.js').VisualNovelScene} */
        this._scene = scene;
        this._preset = null;
        this._index = 0;
        this._autoplay = true;
        this._timer = null;
        this._pickerOutside = null;
    }

    get active() { return !!this._preset; }
    get steps() { return this._preset?.steps ?? []; }
    get index() { return this._index; }

    // Everything that describes who is on stage; copied together when a step inherits the cast of the previous one
    static STAGE_FIELDS = STAGE_FIELDS;

    // Compatibility aliases for integrations that used the runtime class as a data helper.
    static hasActors(step) { return hasActors(step); }
    static sameCast(a, b) { return sameCast(a, b); }
    static clearStage(step) { return clearStage(step); }
    static resolveStep(steps, index) { return resolveStep(steps, index); }
    static inheritedMusic(steps, index) { return inheritedMusic(steps, index); }

    snapshot() {
        return this._preset ? { presetId: this._preset.id, index: this._index, autoplay: this._autoplay } : null;
    }

    // ══════════════════════════════════════════════════════════
    // Lifecycle
    // ══════════════════════════════════════════════════════════

    /** Called right after the scene was created from `preset.steps[index]`. */
    start(preset, index = 0) {
        if (!game.user.isGM) return;
        this._preset = preset;
        this._index = Math.min(Math.max(index, 0), this.steps.length - 1);
        this._autoplay = true;
        this._mountBar();
        this._armTimer();
        this.preload();
        this._scene._persistState();
    }

    async restore(snap) {
        if (!game.user.isGM || !snap?.presetId) return;
        const lifetime = this._scene._sceneLifetime;
        const preset = await VNPresets.load(snap.presetId);
        if (lifetime !== this._scene._sceneLifetime || !this._scene.state.isActive
            || !VNPresets.isSequence(preset) || !preset.steps?.length) return;
        this._preset = preset;
        this._index = Math.min(Math.max(snap.index ?? 0, 0), preset.steps.length - 1);
        this._autoplay = snap.autoplay !== false;
        this._mountBar();
        this._armTimer();
        this.preload(SCENE_SOURCE.RESTORE);
    }

    stop() {
        this._clearTimer();
        this._closePicker();
        this._preset = null;
        this._index = 0;
        this._bar()?.remove();
    }

    /** The sequence was edited in the presets tab while it is running. */
    syncPreset(preset) {
        if (!this.active || preset?.id !== this._preset.id) return;
        if (!VNPresets.isSequence(preset) || !preset.steps?.length) { this.stop(); return; }
        this._preset = preset;
        this._index = Math.min(this._index, preset.steps.length - 1);
        this._mountBar();
        this._armTimer();
        this.preload();
    }

    // Name field of the bar: the title of the current step (empty = the automatic one, shown as the placeholder)
    get nameTitleKey() { return 'vn.sequence.barNameTitle'; }
    get nameOptional() { return true; }
    nameValue() { return this.steps[this._index]?.title ?? ''; }
    namePlaceholder() { return VNSequence.autoLabel(this.steps, this._index); }

    async renameTo(title) {
        const index = this._index;
        const steps = [...this.steps];
        const { title: _old, ...rest } = steps[index];
        steps[index] = title ? { ...rest, title } : rest;
        const saved = await VNPresets.setSteps(this._preset.id, steps);
        if (!saved) return;
        this._preset = saved;
        this._syncBar();
    }

    /**
     * Warms the cache with the backgrounds and portraits of every step, nearest first, on every client
     * (the GM preloads locally and sends the same ordered list to the others). Per-sequence option `preload`.
     */
    preload(source = true) {
        if (!this.active || this._preset.preload === false) return;
        const urls = VNPreloader.stepUrls(this.steps.map((_, i) => resolveStep(this.steps, i)), this._index);
        if (!urls.length) return;
        VNPreloader.enqueue(urls);
        if (!this._scene._gmOnly) this._scene.emitSocketEvent('preload', { urls }, source);
    }

    // ══════════════════════════════════════════════════════════
    // Navigation
    // ══════════════════════════════════════════════════════════

    async go(index) {
        if (!this.active || !game.user.isGM) return;
        const target = Math.min(Math.max(index, 0), this.steps.length - 1);
        if (target === this._index) return;
        const direction = target > this._index ? 1 : -1;
        this._index = target;
        this._closePicker();

        const scene = this._scene;
        const step = resolveStep(this.steps, target);
        // Legacy steps use defaults rather than inheriting the previous step's portrait effects or entrances.
        const payload = {
            ...step,
            ...Object.fromEntries(Object.entries(VISUAL_SETTINGS_DEFAULTS).map(([key, value]) => [key, step[key] ?? value])),
            captionStyle: resolveCaptionStyle(this._preset.captionStyle, step.captionStyle),
            charFx: step.charFx ?? {},
            initialEntrance: VNTransitions.resolveEntrance(step.initialEntrance),
            characterEntrance: VNTransitions.resolveEntrance(step.characterEntrance),
            particleScale: step.particleScale ?? PARTICLE_SETTINGS_DEFAULTS.particleScale,
            particleOpacity: step.particleOpacity ?? PARTICLE_SETTINGS_DEFAULTS.particleOpacity,
            particleSolidTexture: step.particleSolidTexture ?? PARTICLE_SETTINGS_DEFAULTS.particleSolidTexture,
            particleTempo: step.particleTempo ?? PARTICLE_SETTINGS_DEFAULTS.particleTempo,
            particleEffectSettings: step.particleEffectSettings ?? {},
            particleTintColor: step.particleTintColor ?? PARTICLE_SETTINGS_DEFAULTS.particleTintColor,
            particleTintStrength: step.particleTintStrength ?? PARTICLE_SETTINGS_DEFAULTS.particleTintStrength,
        };
        if (!payload.musicUuid) delete payload.musicUuid; // empty = leave whatever is playing
        payload.transition = {
            type: step.transition || this._preset.transition || 'dissolve',
            speed: this._preset.transitionSpeed || 'normal',
            direction,
        };
        scene.updateSceneLayout(payload, true);
        if (step.portraitScale != null && step.portraitScale !== scene.state.portraitScale) {
            scene.setPortraitScale(step.portraitScale, true);
        }
        this._armTimer();
    }

    next() { return this.go(this._index + 1); }
    prev() { return this.go(this._index - 1); }

    /** Overwrites the current step with the live scene (this is also how a step's speaker is set). */
    async saveLiveToStep() {
        if (!this.active) return;
        const index = this._index;
        const previous = this.steps[index];
        const state = this._scene.state;
        const step = await VNPresets.makeStep({
            ...state.toPayload(),
            // The runtime carries resolved styles; keep the authored inheritance when capturing it.
            captionStyle: previous.captionStyle ?? {},
            autoAdvance: previous.autoAdvance,
            transition: previous.transition,
            inheritActors: previous.inheritActors,
            title: previous.title,
            thumbnailData: previous.background === state.background ? previous.thumbnailData : undefined,
        });
        step.id = previous.id;
        // Still the inherited cast? Then keep inheriting instead of freezing a copy of it into this step
        if (previous.inheritActors && !hasActors(previous)
            && sameCast(step, resolveStep(this.steps, index))) {
            clearStage(step);
        }
        if (state.musicUuid === inheritedMusic(this.steps, index)) step.musicUuid = null;

        const steps = [...this.steps];
        steps[index] = step;
        const saved = await VNPresets.setSteps(this._preset.id, steps);
        if (!saved) return;
        this._preset = saved;
        this._syncBar();
        ui.notifications.info(game.i18n.format('vn.sequence.stepSaved', { n: index + 1 }));
    }

    toggleAutoplay() {
        this._autoplay = !this._autoplay;
        this._armTimer();
        this._scene._persistStateDebounced();
    }

    // ══════════════════════════════════════════════════════════
    // Auto-advance timer
    // ══════════════════════════════════════════════════════════

    _clearTimer() {
        if (this._timer !== null) clearTimeout(this._timer);
        this._timer = null;
    }

    _armTimer() {
        this._clearTimer();
        const seconds = Number(this.steps[this._index]?.autoAdvance) || 0;
        const hasNext = this._index < this.steps.length - 1;
        if (this._autoplay && seconds > 0 && hasNext) {
            this._timer = setTimeout(() => { this._timer = null; this.next(); }, seconds * 1000);
        }
        this._syncBar();
    }

    // ══════════════════════════════════════════════════════════
    // Control bar (GM only)
    // ══════════════════════════════════════════════════════════

    _bar() { return this._scene.$overlay?.[0]?.querySelector('.vn-seq-bar') ?? null; }

    _barHtml() {
        const btn = (cls, icon, key) => `<button type="button" class="vn-seq-btn ${cls}" title="${loc(key)}"><i class="fas ${icon}"></i></button>`;
        const hasAuto = this.steps.some(s => Number(s.autoAdvance) > 0);
        return `<div class="vn-seq-bar">
            ${VNPresetLink.nameHtml(this, 'fa-film')}
            <div class="vn-seq-row">
                ${btn('vn-seq-first', 'fa-backward-step', 'vn.sequence.first')}
                ${btn('vn-seq-prev', 'fa-chevron-left', 'vn.sequence.prev')}
                <button type="button" class="vn-seq-counter" title="${escapeHtml(this._preset.name)}"></button>
                ${btn('vn-seq-next', 'fa-chevron-right', 'vn.sequence.next')}
                ${btn('vn-seq-last', 'fa-forward-step', 'vn.sequence.last')}
                <span class="vn-seq-sep"></span>
                ${hasAuto ? btn('vn-seq-autoplay', 'fa-pause', 'vn.sequence.autoplayOn') : ''}
                ${btn('vn-seq-save', 'fa-floppy-disk', 'vn.sequence.saveStep')}
            </div>
            <div class="vn-seq-progress" hidden><span></span></div>
            <div class="vn-seq-picker" hidden></div>
        </div>`;
    }

    _mountBar() {
        const overlay = this._scene.$overlay?.[0];
        if (!overlay || !this.active) return;
        overlay.querySelector('.vn-seq-bar')?.remove();
        overlay.insertAdjacentHTML('beforeend', this._barHtml());
        VNPresetLink.wireName(this._bar(), this);
        this._syncBar();
    }

    _syncBar() {
        const bar = this._bar();
        if (!bar || !this.active) return;
        const last = this.steps.length - 1;
        VNPresetLink.syncName(bar, this);
        bar.querySelector('.vn-seq-counter').title = this._preset.name;
        bar.querySelector('.vn-seq-counter').textContent = `${this._index + 1} / ${this.steps.length}`;
        bar.querySelector('.vn-seq-first').disabled = bar.querySelector('.vn-seq-prev').disabled = this._index <= 0;
        bar.querySelector('.vn-seq-next').disabled = bar.querySelector('.vn-seq-last').disabled = this._index >= last;

        const auto = bar.querySelector('.vn-seq-autoplay');
        if (auto) {
            auto.classList.toggle('active', this._autoplay);
            auto.title = loc(this._autoplay ? 'vn.sequence.autoplayOn' : 'vn.sequence.autoplayOff');
            auto.firstElementChild.className = `fas ${this._autoplay ? 'fa-pause' : 'fa-play'}`;
        }

        const progress = bar.querySelector('.vn-seq-progress');
        const fill = progress.firstElementChild;
        progress.hidden = this._timer === null;
        fill.style.animation = 'none';
        if (this._timer !== null) {
            void fill.offsetWidth; // restart the CSS animation for the new step
            fill.style.animation = `vn-seq-progress ${Number(this.steps[this._index].autoAdvance)}s linear forwards`;
        }
    }

    /** Automatic step name: first caption line, else the characters, else "Step N". */
    static autoLabel(allSteps, index) {
        const step = resolveStep(allSteps, index);
        const names = [...(step.leftIds ?? []), ...(step.centerIds ?? []), ...(step.rightIds ?? [])]
            .map(id => step.portraitNames?.[id]).filter(Boolean).join(', ');
        return (step.caption || '').trim().split('\n')[0] || names || game.i18n.format('vn.sequence.stepTitle', { n: index + 1 });
    }

    /** One button per step (thumbnail, one-line title, characters); shared by the in-scene picker and the launch chooser. */
    static rowsHtml(allSteps, activeIndex = -1) {
        return allSteps.map((_, i) => {
            const step = resolveStep(allSteps, i);
            const ids = [...(step.leftIds ?? []), ...(step.centerIds ?? []), ...(step.rightIds ?? [])];
            const names = ids.map(id => step.portraitNames?.[id]).filter(Boolean).join(', ');
            const caption = (step.caption || '').trim();
            const title = (step.title || '').trim();
            // One line each, cut with an ellipsis; the full text is in the tooltip. A GM-given title wins over the
            // automatic one (first caption line, else the characters, else "Step N"), which then moves to the subtitle
            const auto = VNSequence.autoLabel(allSteps, i);
            const label = title || auto;
            const sub = title ? (caption.split('\n')[0] || names) : (caption ? names : '');
            const thumb = step.thumbnailData || (step.background && step.background !== 'none' ? step.background : null);
            const tooltip = escapeHtml([title, caption, names].filter(Boolean).join('\n') || label);
            return `<button type="button" class="vn-seq-pick${i === activeIndex ? ' active' : ''}" data-index="${i}" title="${tooltip}">
                <span class="vn-seq-pick-n">${i + 1}</span>
                <span class="vn-seq-pick-thumb">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" draggable="false">` : '<i class="fas fa-image"></i>'}</span>
                <span class="vn-seq-pick-text">
                    <span class="vn-seq-pick-label">${escapeHtml(label)}</span>
                    ${sub ? `<span class="vn-seq-pick-sub">${escapeHtml(sub)}</span>` : ''}
                </span>
            </button>`;
        }).join('');
    }

    _pickerHtml() {
        return `<div class="vn-seq-picker-header"><i class="fas fa-film"></i> ${escapeHtml(this._preset.name)}</div>${VNSequence.rowsHtml(this.steps, this._index)}`;
    }

    /** "Which step to start from?" — resolves to a step index, or null if the GM cancelled. */
    static promptStart(preset) {
        let chosen = null;
        return promptDialog({
            window: { title: game.i18n.format('vn.sequence.startTitle', { name: preset.name }), icon: 'fas fa-film' },
            classes: ['vn-confirm-dialog'],
            position: { width: 480 },
            content: `<p class="vn-seq-start-hint">${loc('vn.sequence.startHint')}</p><div class="vn-seq-start">${VNSequence.rowsHtml(preset.steps ?? [])}</div>`,
            buttons: [{ action: 'cancel', label: loc('vn.dialog.btnCancel'), icon: 'fas fa-times' }],
        }, {
            onClose: () => chosen,
            onSubmit: () => null,
            onRender: dialog => {
                const rows = dialog.element.querySelectorAll('.vn-seq-pick');
                rows.forEach(row => row.addEventListener('click', () => { chosen = Number(row.dataset.index); dialog.close(); }));
                rows[0]?.focus();
            },
        });
    }

    _togglePicker() {
        const bar = this._bar();
        const picker = bar?.querySelector('.vn-seq-picker');
        if (!picker) return;
        if (!picker.hidden) { this._closePicker(); return; }
        picker.innerHTML = this._pickerHtml();
        picker.hidden = false;
        picker.querySelector('.vn-seq-pick.active')?.scrollIntoView({ block: 'nearest' });
        this._pickerOutside = (ev) => { if (!bar.contains(ev.target)) this._closePicker(); };
        setTimeout(() => { if (this._pickerOutside) document.addEventListener('click', this._pickerOutside, true); }, 0);
    }

    _closePicker() {
        if (this._pickerOutside) document.removeEventListener('click', this._pickerOutside, true);
        this._pickerOutside = null;
        const picker = this._bar()?.querySelector('.vn-seq-picker');
        if (picker) picker.hidden = true;
    }

    // ══════════════════════════════════════════════════════════
    // Listeners (registered from VisualNovelScene._setupGMListeners, namespaced for _cleanupListeners)
    // ══════════════════════════════════════════════════════════

    attachListeners(ns) {
        const on = (selector, fn) => $(document).on(`click${ns}`, selector, (e) => {
            e.stopPropagation();
            if (!e.currentTarget.disabled) fn(e);
        });
        on('.vn-seq-first', () => this.go(0));
        on('.vn-seq-prev', () => this.prev());
        on('.vn-seq-next', () => this.next());
        on('.vn-seq-last', () => this.go(this.steps.length - 1));
        on('.vn-seq-counter', () => this._togglePicker());
        on('.vn-seq-autoplay', () => this.toggleAutoplay());
        on('.vn-seq-save', () => this.saveLiveToStep());
        on('.vn-seq-picker .vn-seq-pick', (e) => this.go(Number(e.currentTarget.dataset.index)));

        // Document-level (bubble) so Foundry's window-level keybindings (arrows move tokens) never see these keys
        $(document).on(`keydown${ns}`, (e) => {
            if (!this.active || this._scene.state.minimized) return;
            if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
            if (e.target.closest?.('input, textarea, select, [contenteditable], .application')) return;
            const dir = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 }[e.key];
            if (!dir) return;
            e.preventDefault();
            e.stopPropagation();
            this.go(this._index + dir);
        });
    }
}
