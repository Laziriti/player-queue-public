// ============================================================
// vn-sequence-editor.js — step editor for composite presets (Presets tab detail panel)
// ============================================================

import { VNSceneState, VNPresets } from '../vn-state.js';
import { VNSequence } from '../vn-sequence.js';
import { VNTransitions } from '../visual-effects/vn-transitions.js';
import { buildActorPipsHtml, escapeHtml } from '../vn-id-utils.js';

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

const stepIds = (step) => [...(step.leftIds ?? []), ...(step.centerIds ?? []), ...(step.rightIds ?? [])];

/**
 * Renders the step list inside the preset detail panel and edits it.
 * Steps are embedded copies of scene payloads: a cell is filled by dragging a preset in, by capturing the dialog form
 * or the running scene, and an existing cell is edited by loading it into the dialog form and saving the form back.
 */
export class VNSequenceEditor {
    constructor(manager) {
        /** @type {import('./vn-presets-manager.js').VNPresetsManager} */
        this._manager = manager;
        this._loadedStepId = null;
        this._dropIndex = null;
        this._openSettings = new Set();
    }

    get _hooks() { return this._manager._hooks ?? {}; }

    // ══════════════════════════════════════════════════════════
    // Rendering
    // ══════════════════════════════════════════════════════════

    optionsHtml(preset) {
        const options = (values, current, prefix) => values
            .map(v => `<option value="${v}"${v === current ? ' selected' : ''}>${loc(prefix + v)}</option>`).join('');
        return `<hr class="vn-panel-section-divider">
            <div class="vn-panel-section">
                <label class="vn-panel-label">${loc('vn.sequence.optionsLabel')}</label>
                <div class="vn-seqed-field-row">
                    <label class="vn-seqed-field">
                        <span>${loc('vn.sequence.transition')}</span>
                        <select data-seqopt="transition">${options(VNTransitions.TRANSITION_TYPES, preset.transition || 'dissolve', 'vn.sequence.transitions.')}</select>
                    </label>
                    <label class="vn-seqed-field">
                        <span>${loc('vn.sequence.speedLabel')}</span>
                        <select data-seqopt="transitionSpeed">${options(Object.keys(VNTransitions.SPEEDS), preset.transitionSpeed || 'normal', 'vn.sequence.speeds.')}</select>
                    </label>
                    <label class="vn-seqed-check vn-seqed-check--row" title="${loc('vn.sequence.preloadHint')}">
                        <input type="checkbox" data-seqopt="preload"${preset.preload === false ? '' : ' checked'}> ${loc('vn.sequence.preload')}
                    </label>
                </div>
            </div>`;
    }

    stepsHtml(preset) {
        const steps = preset.steps ?? [];
        const liveOk = !!this._hooks.getLiveState?.();
        return `<div class="vn-panel-section vn-seqed">
                <label class="vn-panel-label">${loc('vn.sequence.stepsLabel')} <span class="vn-badge">${steps.length}</span></label>
                <div class="vn-seqed-add">
                    <button type="button" class="vn-btn vn-btn-sm vn-btn-accent" data-seqed="add-form" title="${loc('vn.sequence.addFromFormTitle')}"><i class="fas fa-plus"></i> ${loc('vn.sequence.addFromForm')}</button>
                    <button type="button" class="vn-btn vn-btn-sm" data-seqed="add-live" title="${loc(liveOk ? 'vn.sequence.addLiveTitle' : 'vn.sequence.noLiveScene')}"${liveOk ? '' : ' disabled'}><i class="fas fa-plus"></i> ${loc('vn.sequence.addLive')}</button>
                </div>
                <div class="vn-seqed-steps">
                    ${steps.map((step, i) => this._stepHtml(step, i, VNSequence.resolveStep(steps, i))).join('')}
                    <div class="vn-seqed-drop-hint"><i class="fas fa-arrow-down-long"></i> ${loc('vn.sequence.dropHint')}</div>
                </div>
            </div>`;
    }

    _titleOf(step, index) {
        return (step.title || '').trim() || this._autoTitleOf(step, index);
    }

    /** The title a step gets without a name of its own: first caption line, else the characters, else "Step N". */
    _autoTitleOf(step, index) {
        const caption = (step.caption || '').trim();
        if (caption) return caption.split('\n')[0];
        const names = stepIds(step).map(id => step.portraitNames?.[id]).filter(Boolean);
        return names.length ? names.join(', ') : fmt('vn.sequence.stepTitle', { n: index + 1 });
    }

    _metaHtml(step) {
        const count = stepIds(step).length;
        const parts = [];
        if (count) parts.push(`<span title="${loc('vn.sequence.metaCharacters')}"><i class="fas fa-users"></i> ${count}</span>`);
        if (step.musicUuid) parts.push(`<span title="${loc('vn.sequence.metaMusic')}"><i class="fas fa-music"></i></span>`);
        if ((step.caption || '').trim()) parts.push(`<span title="${loc('vn.sequence.metaCaption')}"><i class="fas fa-closed-captioning"></i></span>`);
        if (Number(step.autoAdvance) > 0) parts.push(`<span title="${loc('vn.sequence.metaAutoAdvance')}"><i class="fas fa-clock"></i> ${Number(step.autoAdvance)}${loc('vn.sequence.secShort')}</span>`);
        return parts.join('');
    }

    /** `shown` is the step as it is displayed (cast inherited from the previous step, if enabled); `step` is the stored one. */
    _stepHtml(step, index, shown = step) {
        const thumb = step.thumbnailData || (step.background && step.background !== 'none' ? step.background : null);
        const thumbHtml = thumb
            ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async" draggable="false">`
            : '<div class="vn-seqed-thumb-empty"><i class="fas fa-image"></i></div>';
        const pips = buildActorPipsHtml(stepIds(shown), shown.portraitImages ?? {}, shown.portraitNames ?? {}, 3);
        const btn = (action, icon, key, extra = '') =>
            `<button type="button" class="vn-btn vn-btn-xs ${extra}" data-step-action="${action}" title="${loc(key)}"><i class="fas ${icon}"></i></button>`;
        const open = this._openSettings.has(step.id);

        return `<div class="vn-seqed-step${step.id === this._loadedStepId ? ' --loaded' : ''}" data-step-id="${step.id}">
            <div class="vn-seqed-step-main" draggable="true">
                <span class="vn-seqed-step-n">${index + 1}</span>
                <div class="vn-seqed-thumb">${thumbHtml}${pips}</div>
                <div class="vn-seqed-step-info">
                    <div class="vn-seqed-step-title">${escapeHtml(this._titleOf(shown, index))}</div>
                    <div class="vn-seqed-step-meta">${this._metaHtml(shown)}</div>
                </div>
                <div class="vn-seqed-step-actions">
                    ${btn('play', 'fa-play', 'vn.sequence.stepPlay', 'vn-btn-accent')}
                    ${btn('load', 'fa-pen-to-square', 'vn.sequence.stepLoad')}
                    ${btn('save', 'fa-floppy-disk', 'vn.sequence.stepSave')}
                    ${btn('settings', 'fa-sliders', 'vn.sequence.stepSettings')}
                    ${btn('duplicate', 'fa-clone', 'vn.sequence.stepDuplicate')}
                    ${btn('delete', 'fa-trash', 'vn.sequence.stepDelete', 'vn-btn-danger')}
                </div>
            </div>
            <div class="vn-seqed-settings"${open ? '' : ' hidden'}>${this._settingsHtml(step, index, shown)}</div>
        </div>`;
    }

    _settingsHtml(step, index, shown = step) {
        const transitionOptions = ['', ...VNTransitions.TRANSITION_TYPES]
            .map(v => `<option value="${v}"${v === (step.transition || '') ? ' selected' : ''}>${loc(v ? `vn.sequence.transitions.${v}` : 'vn.sequence.transitionDefault')}</option>`)
            .join('');
        return `<label class="vn-seqed-field">
                <span>${loc('vn.sequence.stepName')}</span>
                <input type="text" maxlength="80" data-field="title" value="${escapeHtml(step.title || '')}" placeholder="${escapeHtml(this._autoTitleOf(shown, index))}" title="${loc('vn.sequence.stepNameHint')}">
            </label>
            <label class="vn-seqed-field">
                <span>${loc('vn.sequence.caption')}</span>
                <textarea rows="2" maxlength="500" data-field="caption" placeholder="${loc('vn.sequence.captionPlaceholder')}">${escapeHtml(step.caption || '')}</textarea>
            </label>
            <div class="vn-seqed-field-row">
                <label class="vn-seqed-field">
                    <span>${loc('vn.sequence.autoAdvance')}</span>
                    <input type="number" min="0" max="3600" step="1" data-field="autoAdvance" value="${Number(step.autoAdvance) || 0}" title="${loc('vn.sequence.autoAdvanceHint')}">
                </label>
                <label class="vn-seqed-field">
                    <span>${loc('vn.sequence.transitionIn')}</span>
                    <select data-field="transition" title="${loc('vn.sequence.transitionInHint')}">${transitionOptions}</select>
                </label>
            </div>
            ${index > 0 ? `<label class="vn-seqed-check" title="${loc('vn.sequence.inheritActorsHint')}">
                <input type="checkbox" data-field="inheritActors"${step.inheritActors ? ' checked' : ''}> ${loc('vn.sequence.inheritActors')}
            </label>` : ''}
            <p class="vn-seqed-hint"><i class="fas fa-music"></i> ${loc('vn.sequence.musicHint')}</p>`;
    }

    // ══════════════════════════════════════════════════════════
    // Listeners
    // ══════════════════════════════════════════════════════════

    attach(panel, root) {
        if (panel._seqEditorAttached) return;
        panel._seqEditorAttached = true;

        panel.addEventListener('click', (e) => this._onClick(e, panel, root));
        panel.addEventListener('change', (e) => this._onChange(e, panel, root));
        panel.addEventListener('keydown', (e) => {
            // Enter in a settings input would submit the surrounding DialogV2 form
            if (e.key === 'Enter' && e.target.matches?.('input[data-field]')) { e.preventDefault(); e.target.blur(); }
        });

        panel.addEventListener('dragstart', (e) => {
            const row = e.target.matches?.('.vn-seqed-step-main') ? e.target : null;
            const cell = row?.closest('.vn-seqed-step');
            if (!cell) return;
            e.dataTransfer.setData('text/plain', `step:${cell.dataset.stepId}`);
            e.dataTransfer.effectAllowed = 'move';
            cell.classList.add('--dragging');
        });
        panel.addEventListener('dragend', () => {
            panel.querySelectorAll('.vn-seqed-step.--dragging').forEach(el => el.classList.remove('--dragging'));
            this._clearDrop(panel);
        });
        // The whole steps section is the drop target; the insertion point comes from the pointer's Y position
        panel.addEventListener('dragover', (e) => {
            if (!e.target.closest?.('.vn-seqed')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this._markDrop(panel.querySelector('.vn-seqed-steps'), e.clientY);
        });
        panel.addEventListener('dragleave', (e) => {
            if (!panel.querySelector('.vn-seqed')?.contains(e.relatedTarget)) this._clearDrop(panel);
        });
        panel.addEventListener('drop', (e) => this._onDrop(e, panel, root));
    }

    _markDrop(list, clientY) {
        const cells = [...list.querySelectorAll('.vn-seqed-step')];
        cells.forEach(c => c.classList.remove('--drop-before', '--drop-after'));
        list.classList.toggle('--drop-empty', !cells.length);
        let index = cells.length;
        for (let i = 0; i < cells.length; i++) {
            const rect = cells[i].getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) { index = i; break; }
        }
        this._dropIndex = index;
        if (!cells.length) return;
        if (index < cells.length) cells[index].classList.add('--drop-before');
        else cells[cells.length - 1].classList.add('--drop-after');
    }

    _clearDrop(panel) {
        this._dropIndex = null;
        panel.querySelectorAll('.vn-seqed-step').forEach(c => c.classList.remove('--drop-before', '--drop-after'));
        panel.querySelector('.vn-seqed-steps')?.classList.remove('--drop-empty');
    }

    // ══════════════════════════════════════════════════════════
    // Data helpers
    // ══════════════════════════════════════════════════════════

    async _load(panel) {
        const preset = await VNPresets.load(panel.dataset.presetId);
        return VNPresets.isSequence(preset) ? preset : null;
    }

    /** A step whose music equals what it would inherit anyway stores "nothing", so it keeps following the sequence. */
    _normalizeMusic(step, steps, index) {
        if (step.musicUuid && step.musicUuid === VNSequence.inheritedMusic(steps, index)) step.musicUuid = null;
    }

    async _commit(root, panel, presetId, steps) {
        const scroller = () => panel.querySelector('.vn-panel-body');
        const top = scroller()?.scrollTop ?? 0;
        const saved = await VNPresets.setSteps(presetId, steps);
        if (!saved) return;
        this._hooks.onSequenceChanged?.(saved);
        await this._manager.refresh(root);
        const body = scroller();
        if (body) body.scrollTop = top;
    }

    /**
     * Writes the dialog form into steps[index]. The form has no speaker / caption / timer fields, so those are kept
     * from the old step (the speaker only if that character is still on stage).
     */
    async _writeFormToStep(root, panel, preset, steps, index) {
        const step = steps[index];
        const payload = this._hooks.gatherState(root).toPayload();
        const speakers = Object.fromEntries(VNSceneState.POSITIONS.map(pos => {
            const old = step.speakers?.[pos] ?? null;
            return [pos, old && payload[`${pos}Ids`].includes(old) ? old : null];
        }));
        const updated = await VNPresets.makeStep({
            ...payload, speakers,
            caption: step.caption, autoAdvance: step.autoAdvance, transition: step.transition,
            inheritActors: step.inheritActors, title: step.title,
            thumbnailData: payload.background === step.background ? step.thumbnailData : undefined,
        });
        updated.id = step.id;
        // A step that inherits the previous cast keeps doing so unless the cast was actually changed in the form
        if (step.inheritActors && !VNSequence.hasActors(step)
            && VNSequence.sameCast(updated, VNSequence.resolveStep(steps, index))) {
            VNSequence.clearStage(updated);
        }
        steps[index] = updated;
        this._normalizeMusic(updated, steps, index);
        this._loadedStepId = updated.id;
        await this._commit(root, panel, preset.id, steps);
    }

    /** "Save to step" of the edit banner: the step being edited is replaced by the current form. */
    async saveFormToStep(root, edit) {
        const preset = await VNPresets.load(edit?.presetId);
        if (!VNPresets.isSequence(preset)) return false;
        const steps = [...(preset.steps ?? [])];
        const index = steps.findIndex(step => step.id === edit.stepId);
        const panel = root.querySelector('.vn-preset-detail-panel');
        if (index < 0 || !panel) return false;
        await this._writeFormToStep(root, panel, preset, steps, index);
        ui.notifications.info(fmt('vn.sequence.stepUpdated', { n: index + 1 }));
        return true;
    }

    // ══════════════════════════════════════════════════════════
    // Actions
    // ══════════════════════════════════════════════════════════

    async _onClick(e, panel, root) {
        const addBtn = e.target.closest('[data-seqed]');
        const stepBtn = e.target.closest('[data-step-action]');
        if (!addBtn && !stepBtn) return;
        e.preventDefault();

        const preset = await this._load(panel);
        if (!preset) return;
        const steps = [...(preset.steps ?? [])];

        if (addBtn) {
            let source;
            if (addBtn.dataset.seqed === 'add-form') {
                source = this._hooks.gatherState(root).toPayload();
            } else {
                const live = this._hooks.getLiveState?.();
                if (!live) { ui.notifications.warn(loc('vn.sequence.noLiveScene')); return; }
                source = live.toPayload();
            }
            const step = await VNPresets.makeStep(source);
            this._normalizeMusic(step, steps, steps.length);
            steps.push(step);
            await this._commit(root, panel, preset.id, steps);
            return;
        }

        const cell = stepBtn.closest('.vn-seqed-step');
        const index = steps.findIndex(s => s.id === cell?.dataset.stepId);
        if (index < 0) return;
        const step = steps[index];

        switch (stepBtn.dataset.stepAction) {
            case 'play':
                await this._hooks.launchScene(preset, index);
                break;
            case 'settings': {
                const box = cell.querySelector('.vn-seqed-settings');
                box.hidden = !box.hidden;
                if (box.hidden) this._openSettings.delete(step.id);
                else this._openSettings.add(step.id);
                break;
            }
            case 'load': {
                this._loadedStepId = step.id;
                this._hooks.beginStepEdit(root, { preset, step: VNSequence.resolveStep(steps, index), stepId: step.id, index });
                this._manager._renderPresetPanel(root, preset);
                break;
            }
            case 'save': {
                const confirmed = await this._manager._confirmDialog(
                    loc('vn.sequence.overwriteTitle'),
                    `<p>${fmt('vn.sequence.overwriteConfirm', { n: index + 1 })}</p>`,
                    loc('vn.dialog.btnUpdate'), 'fas fa-floppy-disk'
                );
                if (!confirmed) return;
                await this._writeFormToStep(root, panel, preset, steps, index);
                ui.notifications.info(fmt('vn.sequence.stepUpdated', { n: index + 1 }));
                break;
            }
            case 'duplicate': {
                const copy = foundry.utils.deepClone(step);
                copy.id = foundry.utils.randomID();
                steps.splice(index + 1, 0, copy);
                await this._commit(root, panel, preset.id, steps);
                break;
            }
            case 'delete': {
                const confirmed = await this._manager._confirmDialog(
                    loc('vn.sequence.deleteTitle'),
                    `<p>${fmt('vn.sequence.deleteConfirm', { n: index + 1 })}</p>`,
                    loc('vn.dialog.btnDelete'), 'fas fa-trash'
                );
                if (!confirmed) return;
                steps.splice(index, 1);
                this._openSettings.delete(step.id);
                if (this._loadedStepId === step.id) this._loadedStepId = null;
                await this._commit(root, panel, preset.id, steps);
                break;
            }
        }
    }

    /** Caption / timer / transition edits are saved in place without re-rendering, so typing focus is not lost. */
    async _onChange(e, panel, root) {
        const option = e.target.closest?.('[data-seqopt]');
        if (option) {
            const value = option.type === 'checkbox' ? option.checked : option.value;
            const saved = await VNPresets.setSequenceOptions(panel.dataset.presetId, { [option.dataset.seqopt]: value });
            if (saved) this._hooks.onSequenceChanged?.(saved);
            return;
        }

        const field = e.target.closest?.('[data-field]');
        const cell = field?.closest('.vn-seqed-step');
        if (!field || !cell) return;

        const preset = await this._load(panel);
        if (!preset) return;
        const steps = [...(preset.steps ?? [])];
        const index = steps.findIndex(s => s.id === cell.dataset.stepId);
        if (index < 0) return;
        const step = { ...steps[index] };

        switch (field.dataset.field) {
            case 'title': {
                const title = field.value.replace(/\s+/g, ' ').trim().slice(0, 80);
                if (title) step.title = title;
                else delete step.title;
                field.value = title;
                break;
            }
            case 'caption':
                step.caption = field.value.replace(/\r/g, '').trim().slice(0, 500);
                break;
            case 'autoAdvance':
                step.autoAdvance = Math.min(Math.max(Math.round(Number(field.value) || 0), 0), 3600);
                field.value = step.autoAdvance;
                break;
            case 'transition':
                if (field.value && VNTransitions.TRANSITION_TYPES.includes(field.value)) step.transition = field.value;
                else delete step.transition;
                break;
            case 'inheritActors':
                // The cast shown for this step (and the ones after it) changes, so the whole list is redrawn
                if (field.checked) step.inheritActors = true;
                else delete step.inheritActors;
                steps[index] = step;
                await this._commit(root, panel, preset.id, steps);
                return;
            default:
                return;
        }
        steps[index] = step;
        const saved = await VNPresets.setSteps(preset.id, steps);
        if (!saved) return;
        this._hooks.onSequenceChanged?.(saved);
        cell.querySelector('.vn-seqed-step-title').textContent = this._titleOf(step, index);
        cell.querySelector('.vn-seqed-step-meta').innerHTML = this._metaHtml(step);
    }

    async _onDrop(e, panel, root) {
        if (!e.target.closest?.('.vn-seqed')) return;
        e.preventDefault();
        e.stopPropagation();
        const at = this._dropIndex;
        this._clearDrop(panel);

        const raw = e.dataTransfer.getData('text/plain') ?? '';
        const preset = await this._load(panel);
        if (!preset) return;
        const steps = [...(preset.steps ?? [])];
        let target = Math.min(at ?? steps.length, steps.length);

        if (raw.startsWith('preset:')) {
            const source = await VNPresets.load(raw.slice(7));
            if (!source) return;
            if (VNPresets.isSequence(source)) { ui.notifications.warn(loc('vn.sequence.nestedWarn')); return; }
            steps.splice(target, 0, await VNPresets.makeStep(source));
        } else if (raw.startsWith('step:')) {
            const from = steps.findIndex(s => s.id === raw.slice(5));
            if (from < 0) return;
            const [moved] = steps.splice(from, 1);
            if (from < target) target--;
            if (from === target) return;
            steps.splice(target, 0, moved);
        } else {
            return;
        }
        await this._commit(root, panel, preset.id, steps);
    }
}
