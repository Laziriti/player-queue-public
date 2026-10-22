// ============================================================
// vn-sequence.js — runtime of a composite preset (sequence of scene steps)
// ============================================================

import { VNPresets } from './vn-state.js';
import { VNPreloader } from './vn-preload.js';
import { escapeHtml } from './vn-id-utils.js';

const loc = (key) => game.i18n.localize(key);

/**
 * GM-side controller that walks a running scene through the steps of a sequence preset.
 * A step switch is a regular `updateSceneLayout()` call, so transitions, socket sync and persistence
 * are the same as for a manual scene edit. Players only ever see the result (including the caption).
 */
export class VNSequence {
    constructor(scene) {
        /** @type {import('./visual-novel-scene.js').VisualNovelScene} */
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
    static STAGE_FIELDS = ['leftIds', 'centerIds', 'rightIds', 'portraitImages', 'portraitNames', 'portraitScales', 'flipped', 'visibility', 'charFx'];

    static hasActors(step) {
        return ['leftIds', 'centerIds', 'rightIds'].some(key => step?.[key]?.length);
    }

    static sameCast(a, b) {
        return ['leftIds', 'centerIds', 'rightIds'].every(key => JSON.stringify(a?.[key] ?? []) === JSON.stringify(b?.[key] ?? []));
    }

    static clearStage(step) {
        for (const key of VNSequence.STAGE_FIELDS) step[key] = key.endsWith('Ids') ? [] : {};
        return step;
    }

    /**
     * The step as it is actually shown. A step with `inheritActors` and no actors of its own takes the whole stage
     * (cast, positions, scales, flips, visibility) from the previous step, which may itself be inheriting.
     */
    static resolveStep(steps, index) {
        const step = steps[index];
        if (!step?.inheritActors || VNSequence.hasActors(step) || index <= 0) return step;
        const source = VNSequence.resolveStep(steps, index - 1);
        if (!VNSequence.hasActors(source)) return step;
        const merged = { ...step };
        for (const key of VNSequence.STAGE_FIELDS) merged[key] = foundry.utils.deepClone(source[key]);
        return merged;
    }

    /** Music a step inherits when its own `musicUuid` is empty: the last explicit track before it. */
    static inheritedMusic(steps, index) {
        for (let i = index - 1; i >= 0; i--) if (steps[i]?.musicUuid) return steps[i].musicUuid;
        return null;
    }

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
        const preset = await VNPresets.load(snap.presetId);
        if (!VNPresets.isSequence(preset) || !preset.steps?.length || !this._scene.state.isActive) return;
        this._preset = preset;
        this._index = Math.min(Math.max(snap.index ?? 0, 0), preset.steps.length - 1);
        this._autoplay = snap.autoplay !== false;
        this._mountBar();
        this._armTimer();
        this.preload();
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

    /**
     * Warms the cache with the backgrounds and portraits of every step, nearest first, on every client
     * (the GM preloads locally and sends the same ordered list to the others). Per-sequence option `preload`.
     */
    preload() {
        if (!this.active || this._preset.preload === false) return;
        const urls = VNPreloader.stepUrls(this.steps.map((_, i) => VNSequence.resolveStep(this.steps, i)), this._index);
        if (!urls.length) return;
        VNPreloader.enqueue(urls);
        if (!this._scene._gmOnly) this._scene.emitSocketEvent('preload', { urls });
    }

    // ══════════════════════════════════════════════════════════
    // Navigation
    // ══════════════════════════════════════════════════════════

    async go(index) {
        if (!this.active || !game.user.isGM) return;
        const target = Math.min(Math.max(index, 0), this.steps.length - 1);
        if (target === this._index) return;
        this._index = target;
        this._closePicker();

        const scene = this._scene;
        const step = VNSequence.resolveStep(this.steps, target);
        // A step without `charFx` (saved before portrait effects existed) must not inherit the previous step's effects
        const payload = { ...step, charFx: step.charFx ?? {} };
        if (!payload.musicUuid) delete payload.musicUuid; // empty = leave whatever is playing
        payload.transition = {
            type: step.transition || this._preset.transition || 'dissolve',
            speed: this._preset.transitionSpeed || 'normal',
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
            autoAdvance: previous.autoAdvance,
            transition: previous.transition,
            inheritActors: previous.inheritActors,
            thumbnailData: previous.background === state.background ? previous.thumbnailData : undefined,
        });
        step.id = previous.id;
        // Still the inherited cast? Then keep inheriting instead of freezing a copy of it into this step
        if (previous.inheritActors && !VNSequence.hasActors(previous)
            && VNSequence.sameCast(step, VNSequence.resolveStep(this.steps, index))) {
            VNSequence.clearStage(step);
        }
        if (state.musicUuid === VNSequence.inheritedMusic(this.steps, index)) step.musicUuid = null;

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
        this._syncBar();
    }

    _syncBar() {
        const bar = this._bar();
        if (!bar || !this.active) return;
        const last = this.steps.length - 1;
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

    /** One button per step (thumbnail, one-line title, characters); shared by the in-scene picker and the launch chooser. */
    static rowsHtml(allSteps, activeIndex = -1) {
        return allSteps.map((_, i) => {
            const step = VNSequence.resolveStep(allSteps, i);
            const ids = [...(step.leftIds ?? []), ...(step.centerIds ?? []), ...(step.rightIds ?? [])];
            const names = ids.map(id => step.portraitNames?.[id]).filter(Boolean).join(', ');
            const caption = (step.caption || '').trim();
            // One line each, cut with an ellipsis; the full text is in the tooltip
            const label = caption.split('\n')[0] || names || game.i18n.format('vn.sequence.stepTitle', { n: i + 1 });
            const sub = caption ? names : '';
            const thumb = step.thumbnailData || (step.background && step.background !== 'none' ? step.background : null);
            const tooltip = escapeHtml([caption, names].filter(Boolean).join('\n') || label);
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
        return new Promise(resolve => {
            let chosen = null;
            const dialog = new foundry.applications.api.DialogV2({
                window: { title: game.i18n.format('vn.sequence.startTitle', { name: preset.name }), icon: 'fas fa-film' },
                classes: ['vn-confirm-dialog'],
                position: { width: 480 },
                content: `<p class="vn-seq-start-hint">${loc('vn.sequence.startHint')}</p><div class="vn-seq-start">${VNSequence.rowsHtml(preset.steps ?? [])}</div>`,
                buttons: [{ action: 'cancel', label: loc('vn.dialog.btnCancel'), icon: 'fas fa-times' }],
                rejectClose: false,
            });
            dialog.addEventListener('render', () => {
                const rows = dialog.element.querySelectorAll('.vn-seq-pick');
                rows.forEach(row => row.addEventListener('click', () => { chosen = Number(row.dataset.index); dialog.close(); }));
                rows[0]?.focus();
            });
            dialog.addEventListener('close', () => resolve(chosen), { once: true });
            dialog.render({ force: true });
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
