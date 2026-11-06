// ============================================================
// vn-preset-link.js — the preset a running scene was opened from (plain presets) + the name field of the GM bar
// ============================================================

import { VNPresets } from './vn-state.js';
import { escapeHtml } from './vn-id-utils.js';

const loc = (key) => game.i18n.localize(key);

/**
 * GM-side link between the live scene and the plain preset it was launched from (or saved as). While linked, the bar over
 * the scene shows the preset name (editable) and a save button that writes the live scene back into that preset.
 * Composite presets have their own controller (VNSequence); both share the name field below.
 */
export class VNPresetLink {
    constructor(scene) {
        /** @type {import('./visual-novel-scene.js').VisualNovelScene} */
        this._scene = scene;
        this._preset = null;
    }

    get active() { return !!this._preset; }

    snapshot() { return this._preset ? { presetId: this._preset.id } : null; }

    // ══════════════════════════════════════════════════════════
    // Shared name field (also used by the composite preset bar)
    // ══════════════════════════════════════════════════════════

    /**
     * `owner` (a VNPresetLink or VNSequence) provides: nameValue(), namePlaceholder() (optional), nameTitleKey,
     * nameOptional (an empty name is allowed), async renameTo(name).
     */
    static nameHtml(owner, icon, extra = '') {
        return `<div class="vn-seq-head">
            <i class="fas ${icon} vn-seq-head-icon"></i>
            <input type="text" class="vn-seq-name" maxlength="80" spellcheck="false" value="${escapeHtml(owner.nameValue())}" placeholder="${escapeHtml(owner.namePlaceholder?.() ?? '')}" title="${loc(owner.nameTitleKey)}">
            ${extra}
        </div>`;
    }

    static syncName(bar, owner) {
        const input = bar?.querySelector('.vn-seq-name');
        if (!input) return;
        input.placeholder = owner.namePlaceholder?.() ?? '';
        if (document.activeElement !== input) input.value = owner.nameValue();
    }

    /**
     * Enter / losing focus applies the name, Escape puts the old one back. The handlers sit on the input itself:
     * the scene closes on a document-level Escape, which must not see the key pressed here.
     */
    static wireName(bar, owner) {
        const input = bar?.querySelector('.vn-seq-name');
        if (!input) return;
        input.addEventListener('change', async () => {
            const name = input.value.trim().slice(0, 80);
            if (name === owner.nameValue() || (!name && !owner.nameOptional)) { input.value = owner.nameValue(); return; }
            await owner.renameTo(name);
            VNPresetLink.syncName(bar, owner);
        });
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            else if (e.key === 'Escape') { input.value = owner.nameValue(); input.blur(); }
        });
    }

    // Name field owner interface (the plain preset's name)
    get nameTitleKey() { return 'vn.presetLink.nameTitle'; }
    get nameOptional() { return false; }
    nameValue() { return this._preset?.name ?? ''; }

    async renameTo(name) {
        const id = this._preset?.id;
        const sorted = await VNPresets.rename(id, name);
        const renamed = sorted?.find(p => p.id === id);
        if (renamed) this.adopt(renamed);
    }

    // ══════════════════════════════════════════════════════════
    // Lifecycle
    // ══════════════════════════════════════════════════════════

    /** Called right after the scene was created from `preset`, or after a new preset was saved from the live scene. */
    start(preset) {
        if (!game.user.isGM || !preset || VNPresets.isSequence(preset) || !this._scene.state.isActive) return;
        this._preset = preset;
        this._mountBar();
        this._scene._persistState();
    }

    async restore(snap) {
        if (!game.user.isGM || !snap?.presetId || !this._scene.state.isActive) return;
        const preset = await VNPresets.load(snap.presetId);
        if (!preset || VNPresets.isSequence(preset)) return;
        this._preset = preset;
        this._mountBar();
    }

    stop() {
        this._preset = null;
        this._bar()?.remove();
    }

    adopt(preset) {
        this._preset = preset;
        this._syncBar();
    }

    /** Writes the live scene into the linked preset (name, tags, folder and scene pin stay). */
    async save() {
        if (!this.active) return;
        const id = this._preset.id;
        const sorted = await VNPresets.update(id, this._scene.state);
        const saved = sorted?.find(p => p.id === id);
        if (!saved) {
            ui.notifications.warn(loc('vn.presetLink.gone'));
            this.stop();
            this._scene._persistStateDebounced();
            return;
        }
        this._preset = saved;
        this._syncBar();
        ui.notifications.info(game.i18n.format('vn.presetLink.saved', { name: saved.name }));
    }

    // ══════════════════════════════════════════════════════════
    // Bar (GM only, same place and look as the composite preset bar)
    // ══════════════════════════════════════════════════════════

    _bar() { return this._scene.$overlay?.[0]?.querySelector('.vn-seq-bar--single') ?? null; }

    _mountBar() {
        const overlay = this._scene.$overlay?.[0];
        if (!overlay || !this.active) return;
        overlay.querySelector('.vn-seq-bar--single')?.remove();
        const save = `<button type="button" class="vn-seq-btn vn-preset-link-save" title="${loc('vn.presetLink.save')}"><i class="fas fa-floppy-disk"></i></button>`;
        overlay.insertAdjacentHTML('beforeend', `<div class="vn-seq-bar vn-seq-bar--single">${VNPresetLink.nameHtml(this, 'fa-bookmark', save)}</div>`);
        VNPresetLink.wireName(this._bar(), this);
    }

    _syncBar() {
        VNPresetLink.syncName(this._bar(), this);
    }

    attachListeners(ns) {
        $(document).on(`click${ns}`, '.vn-preset-link-save', (e) => {
            e.stopPropagation();
            this.save();
        });
    }
}
