// Preset repository and sequence editing operations.
import { isCaptionStyle } from '../overlay/vn-caption.js';
import { MODULE_ID, PRESETS_SETTING_KEY } from '../vn-constants.js';
import { VNStore } from './vn-store.js';
import { VNSceneState } from '../scene/vn-scene-state.js';
import { VNPresetMedia } from './vn-preset-media.js';
import { presetScenes, presetSceneNames } from './vn-preset-utils.js';
import { applyMigrations } from './vn-migrations.js';
import { isValidImportedPreset } from './vn-import-validation.js';
import { TRANSITION_TYPES, TRANSITION_SPEEDS } from '../visual-effects/vn-transition-config.js';

export class VNPresets {
    static SETTING_KEY = PRESETS_SETTING_KEY;

    static register() {
        try {
            game.settings.register(MODULE_ID, this.SETTING_KEY, {
                name: 'VN Scene Presets', scope: 'world', config: false, type: Object, default: {},
                onChange: VNStore.changed('presets', () => this.invalidateCache()),
            });
        } catch { /* already registered */ }
    }

    static _migrated = false;
    static _cache = null;
    static _migrationPromise = null;

    static invalidateCache() { this._cache = null; }

    static async getAll() {
        if (this._cache !== null) return this._cache;
        if (this._migrationPromise) return this._migrationPromise;
        let raw;
        try { raw = game.settings.get(MODULE_ID, this.SETTING_KEY) || {}; } catch { return {}; }
        if (this._migrated || !Object.values(raw).some(v => !v.id)) {
            this._migrated = true;
            this._cache = raw;
            return raw;
        }
        if (!game.user.isGM) return raw;

        // Legacy format: presets keyed by name. Converted once, against whatever is stored when the write happens
        this._migrationPromise = VNStore.mutate(this.SETTING_KEY, draft => {
            if (!Object.values(draft).some(v => !v.id)) return VNStore.SKIP;
            const migrated = {};
            for (const [key, val] of Object.entries(draft)) {
                if (val.id) { migrated[val.id] = val; continue; }
                const id = foundry.utils.randomID();
                const ts = val.savedAt || Date.now();
                migrated[id] = { ...val, id, name: key, createdAt: ts, updatedAt: ts };
            }
            for (const key of Object.keys(draft)) delete draft[key];
            Object.assign(draft, migrated);
        }).then(({ draft }) => { this._migrated = true; this._cache = draft; return draft; })
            .catch(() => raw)
            .finally(() => { this._migrationPromise = null; });
        return this._migrationPromise;
    }

    static async getSorted() {
        const presets = await this.getAll();
        return Object.values(presets).sort((a, b) =>
            (b.createdAt || b.savedAt || 0) - (a.createdAt || a.savedAt || 0));
    }

    /** The scene the GM is on, as a link list for a new preset (empty when not pinning or no scene is open) */
    static _currentSceneList(attach = true) {
        const scene = canvas?.scene;
        return attach && scene ? [{ id: scene.id, name: scene.name }] : [];
    }

    static _modVersion() { return game.modules.get(MODULE_ID)?.version ?? '0.0.0'; }

    static async save(name, sceneState, attachScene = true, opts = {}) {
        const id = foundry.utils.randomID();
        const now = Date.now();
        let thumbnailData = null;
        if (sceneState.background && sceneState.background !== 'none') {
            try { thumbnailData = await this._makeThumbnail(sceneState.background); } catch {}
        }
        const entry = {
            ...sceneState.toPayload(),
            id,
            name,
            version: this._modVersion(),
            createdAt: now,
            updatedAt: now,
            scenes: this._currentSceneList(attachScene),
            folderId: opts.folderId ?? null,
            ...(thumbnailData ? { thumbnailData } : {}),
        };
        await VNStore.mutate(this.SETTING_KEY, draft => { draft[id] = entry; });
        return entry;
    }

    // ── Sequences (composite presets) ──────────────────────────
    // A sequence is a regular preset with `type: 'sequence'` and `steps[]` (embedded scene payload copies).
    // Step 0 is mirrored into the top-level scene fields so every list/card/IO view keeps working unchanged;
    // launching always reads `steps`, never the mirror.

    static isSequence(p) { return p?.type === 'sequence'; }

    static _applyCover(p) {
        const first = p.steps?.[0] ?? {};
        p.background = first.background ?? null;
        p.thumbnailData = first.thumbnailData ?? null;
        p.leftIds = [...(first.leftIds ?? [])];
        p.centerIds = [...(first.centerIds ?? [])];
        p.rightIds = [...(first.rightIds ?? [])];
        p.portraitImages = { ...(first.portraitImages ?? {}) };
        p.portraitNames = { ...(first.portraitNames ?? {}) };
    }

    /** Builds a step from any scene-shaped source (preset, live state payload, another step), normalizing legacy formats. */
    static async makeStep(source, { generateThumbnail = true } = {}) {
        const state = new VNSceneState();
        state.fromPayload(source);
        const payload = state.toPayload();
        let thumbnailData = source.thumbnailData ?? null;
        if (generateThumbnail && !thumbnailData && payload.background && payload.background !== 'none') {
            try { thumbnailData = await this._makeThumbnail(payload.background); } catch {}
        }
        return {
            ...payload,
            id: foundry.utils.randomID(),
            autoAdvance: Math.max(0, Number(source.autoAdvance) || 0),
            ...(typeof source.transition === 'string' && source.transition ? { transition: source.transition } : {}),
            ...(source.inheritActors === true ? { inheritActors: true } : {}),
            // Named by the GM; `title`, not `name`, because a preset passed as `source` already has a `name`
            ...(typeof source.title === 'string' && source.title.trim() ? { title: source.title.trim().slice(0, 80) } : {}),
            ...(thumbnailData ? { thumbnailData } : {}),
        };
    }

    static SEQUENCE_OPTIONS = {
        captionStyle: isCaptionStyle,
        transition: v => TRANSITION_TYPES.includes(v),
        transitionSpeed: v => v in TRANSITION_SPEEDS,
        preload: v => typeof v === 'boolean',
    };

    /** Sequence-wide display options: `transition`, `transitionSpeed`, `preload`. Unknown keys / invalid values are ignored. */
    static async setSequenceOptions(id, patch) {
        const clean = Object.fromEntries(Object.entries(patch).filter(([key, value]) => this.SEQUENCE_OPTIONS[key]?.(value)));
        const { result } = await VNStore.mutate(this.SETTING_KEY, draft => {
            if (!this.isSequence(draft[id])) return VNStore.SKIP;
            draft[id] = { ...draft[id], ...clean, updatedAt: Date.now() };
            return draft[id];
        });
        return result;
    }

    static async createSequence(name, attachScene = true, opts = {}) {
        const id = foundry.utils.randomID();
        const now = Date.now();
        const p = {
            id, name, type: 'sequence', steps: opts.steps ?? [],
            version: this._modVersion(),
            createdAt: now, updatedAt: now,
            scenes: this._currentSceneList(attachScene),
            folderId: opts.folderId ?? null,
        };
        this._applyCover(p);
        await VNStore.mutate(this.SETTING_KEY, draft => { draft[id] = p; });
        return p;
    }

    static async setSteps(id, steps) {
        const { result } = await VNStore.mutate(this.SETTING_KEY, draft => {
            if (!this.isSequence(draft[id])) return VNStore.SKIP;
            const p = { ...draft[id], steps, version: this._modVersion(), updatedAt: Date.now() };
            this._applyCover(p);
            draft[id] = p;
            return p;
        });
        return result;
    }

    /** Edits one preset and returns the re-sorted list (null if the preset is gone). */
    static async _patch(id, fn) {
        const { result } = await VNStore.mutate(this.SETTING_KEY, draft => {
            if (!draft[id]) return VNStore.SKIP;
            if (fn(draft[id], draft) === VNStore.SKIP) return VNStore.SKIP;
            return this._sortedFrom(draft);
        });
        return result;
    }

    /** Replaces the scenes a preset is linked to ([{ id, name }]); the pre-14.15.0 single pair is dropped. */
    static setScenes(id, scenes) {
        const clean = scenes.filter(s => s && (s.id || s.name)).map(s => ({ id: s.id ?? null, name: String(s.name ?? '') }));
        return this._patch(id, p => {
            delete p.sceneId;
            delete p.sceneName;
            Object.assign(p, { scenes: clean, updatedAt: Date.now() });
        });
    }

    /**
     * Deletes a scene group of the list. A preset linked to other scenes as well is not deleted: it only loses this scene.
     * Returns { deleted, unlinked }.
     */
    static async deleteGroup(groupKey) {
        const key = groupKey || '';
        const { result } = await VNStore.mutate(this.SETTING_KEY, draft => {
            const out = { deleted: 0, unlinked: 0 };
            for (const id of Object.keys(draft)) {
                const names = presetSceneNames(draft[id]);
                if (key ? !names.includes(key) : names.length) continue;
                if (names.length > 1) {
                    const rest = presetScenes(draft[id]).filter(s => String(s.name ?? '').trim() !== key);
                    delete draft[id].sceneId;
                    delete draft[id].sceneName;
                    Object.assign(draft[id], { scenes: rest, updatedAt: Date.now() });
                    out.unlinked++;
                } else {
                    delete draft[id];
                    out.deleted++;
                }
            }
            return out;
        });
        return result ?? { deleted: 0, unlinked: 0 };
    }

    /** Wipes every preset in one write. */
    static async clearAll() {
        await VNStore.mutate(this.SETTING_KEY, draft => { for (const id of Object.keys(draft)) delete draft[id]; });
    }

    // Compatibility aliases; media work belongs to VNPresetMedia.
    static _makeThumbnail(src, w = 240, h = 150) { return VNPresetMedia.makeThumbnail(src, w, h); }
    static thumbnailDir() { return VNPresetMedia.thumbnailDir(); }
    static _makeIcon(src, size = 128) { return VNPresetMedia.makeIcon(src, size); }

    static async load(id) {
        return (await this.getAll())[id] ?? null;
    }

    static _sortedFrom(presets) {
        return Object.values(presets).sort((a, b) => (b.createdAt || b.savedAt || 0) - (a.createdAt || a.savedAt || 0));
    }

    static rename(id, newName) {
        return this._patch(id, p => Object.assign(p, { name: newName, updatedAt: Date.now() }));
    }

    static setTags(id, tags) {
        const clean = tags.map(t => t.trim()).filter(Boolean);
        return this._patch(id, p => Object.assign(p, { tags: clean, updatedAt: Date.now() }));
    }

    /** A full copy of a preset (composite ones too) under `name`; it gets a new id, new step ids and fresh timestamps, and stays in the same folder. */
    static async duplicate(id, name) {
        const { result } = await VNStore.mutate(this.SETTING_KEY, draft => {
            const src = draft[id];
            if (!src) return VNStore.SKIP;
            const now = Date.now();
            const copy = { ...structuredClone(src), id: foundry.utils.randomID(), name, createdAt: now, updatedAt: now };
            delete copy.savedAt;
            if (Array.isArray(copy.steps)) for (const step of copy.steps) step.id = foundry.utils.randomID();
            draft[copy.id] = copy;
            return copy;
        });
        return result;
    }

    static setFolder(id, folderId) {
        return this._patch(id, p => Object.assign(p, { folderId: folderId || null, updatedAt: Date.now() }));
    }

    static async update(id, sceneState) {
        const current = (await this.getAll())[id];
        if (!current || this.isSequence(current)) return null;
        let newThumb = null;
        if (sceneState.background && sceneState.background !== 'none') {
            try { newThumb = await this._makeThumbnail(sceneState.background); } catch {}
        }
        const payload = sceneState.toPayload();
        return this._patch(id, (_, draft) => {
            if (this.isSequence(draft[id])) return VNStore.SKIP;
            const { id: pid, name, createdAt, thumbnailData: oldThumb, folderId, tags } = draft[id];
            const scenes = presetScenes(draft[id]);
            const thumbnailData = newThumb ?? oldThumb ?? null;
            draft[id] = {
                ...payload, id: pid, name, version: this._modVersion(), createdAt, updatedAt: Date.now(),
                scenes, folderId: folderId ?? null,
                ...(tags ? { tags } : {}),
                ...(thumbnailData ? { thumbnailData } : {}),
            };
        });
    }

    // Re-run all generation logic on existing preset data (thumbnail, portrait images/names).
    // Never changes user-set values: actor IDs, background, effects, scene association, name.
    // The slow part (thumbnail uploads) works on a snapshot; the result is then applied to whatever is stored at that
    // moment, so edits made meanwhile (renames, tags, folders, another GM) are not rolled back.
    static async regenerate(ids = null) {
        const snapshot = await this.getAll();
        const keys = ids ? ids.filter(id => snapshot[id]) : Object.keys(snapshot);
        const patches = new Map();
        for (const id of keys) {
            const entry = applyMigrations(snapshot[id]);
            const own = await this._regenerateEntry(entry);
            const steps = new Map();
            if (this.isSequence(entry)) {
                for (const step of entry.steps ?? []) steps.set(step.id, await this._regenerateEntry(step));
            }
            patches.set(id, { own, steps });
        }

        const currentVersion = this._modVersion();
        const { result } = await VNStore.mutate(this.SETTING_KEY, draft => {
            let count = 0;
            for (const [id, { own, steps }] of patches) {
                if (!draft[id]) continue;
                let entry = this._applyRegenerated(applyMigrations(draft[id]), own);
                if (this.isSequence(entry)) {
                    entry = {
                        ...entry,
                        steps: (entry.steps ?? []).map(step => steps.has(step.id) ? this._applyRegenerated(step, steps.get(step.id)) : step),
                    };
                    this._applyCover(entry);
                }
                draft[id] = { ...entry, version: currentVersion, updatedAt: Date.now() };
                count++;
            }
            return count;
        });
        return result ?? 0;
    }

    // Works on anything scene-shaped: a preset or a sequence step. Returns only what regeneration may change.
    static _regenerateEntry(p) {
        return VNPresetMedia.regenerateEntry(p, src => this._makeThumbnail(src));
    }

    /** Lays regenerated values over the current entry; a thumbnail made for an old background is dropped. */
    static _applyRegenerated(current, regen) {
        const out = {
            ...current,
            portraitImages: { ...(current.portraitImages || {}), ...regen.portraitImages },
            portraitNames: { ...(current.portraitNames || {}), ...regen.portraitNames },
        };
        if (regen.thumbnailData && (current.background ?? null) === regen.background) out.thumbnailData = regen.thumbnailData;
        return out;
    }

    static async delete(id) {
        await VNStore.mutate(this.SETTING_KEY, draft => {
            if (!draft[id]) return VNStore.SKIP;
            delete draft[id];
        });
    }

    // ── Import ─────────────────────────────────────────────────

    static MAX_IMPORT_PRESETS = 5000;

    /** Rejects malformed scene/sequence data and gives each preset a safe string id. */
    static sanitizeImport(entries) {
        const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
        const list = Array.isArray(entries) ? entries.slice(0, this.MAX_IMPORT_PRESETS) : [];
        const out = [];
        for (const p of list) {
            if (!isValidImportedPreset(p)) continue;
            const ok = typeof p.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(p.id) && !FORBIDDEN.has(p.id);
            const name = typeof p.name === 'string' && p.name.trim() ? p.name : 'Preset';
            out.push({ ...p, id: ok ? p.id : foundry.utils.randomID(), name });
        }
        return out;
    }

    /**
     * Adds imported presets in one write. `replace` clears the library inside that same write, and only after the
     * incoming data has been validated, so a bad file can never leave the library empty.
     * `transform(p)` adjusts each entry (folder mapping); migrations always run.
     */
    static async importMany(entries, { overwrite = false, replace = false, transform = null } = {}) {
        const clean = this.sanitizeImport(entries);
        if (replace && !clean.length) throw new Error('no valid presets in the data');
        const { result } = await VNStore.mutate(this.SETTING_KEY, draft => {
            if (replace) for (const key of Object.keys(draft)) delete draft[key];
            let added = 0;
            for (const p of clean) {
                if (draft[p.id] && !overwrite) continue;
                const migrated = applyMigrations(p);
                draft[p.id] = transform ? transform(migrated) : migrated;
                added++;
            }
            return added;
        });
        return result ?? 0;
    }
}

