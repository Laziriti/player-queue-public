// ============================================================
// vn-state.js — VNSceneState + VNPresets classes
// ============================================================

import { parseActorId } from './vn-id-utils.js';
import { applyMigrations } from './vn-migrations.js';
import { PRESETS } from './visual-effects/atmosphere/config/effects.js';
import { VNTransitions } from './visual-effects/vn-transitions.js';
import { VNCharFx } from './visual-effects/character-fx/vn-character-fx.js';

export const MODULE_ID = 'player-queue';

export const PARTICLE_LAYERS = ['back', 'front', 'mix'];
export const PARTICLE_LAYER_ICONS = { back: 'fa-layer-group', front: 'fa-layer-group', mix: 'fa-shuffle' };

// Старые данные хранили булев particlesForeground вместо particlesLayer
export function resolveParticlesLayer(p) {
    if (PARTICLE_LAYERS.includes(p?.particlesLayer)) return p.particlesLayer;
    return p?.particlesForeground ? 'front' : 'back';
}

class VNSceneState {
    static POSITIONS = ['left', 'center', 'right'];
    static SCALE_LIMITS = { MIN: 0.5, MAX: 2.0 };
    static VISIBILITY_CYCLE = ['visible', 'hidden', 'name-hidden'];

    constructor() { this.reset(); }

    reset() {
        this.active = false;
        this.minimized = false;
        this.leftIds = [];
        this.centerIds = [];
        this.rightIds = [];
        this.presetActors = [];
        this.background = null;
        this.backgroundOverlay = true;
        this.portraitScale = 1.0;
        this.particleEffect = 'particles';
        this.visualEffect = 'none';
        this.particlesLayer = 'back';
        this.particleIntensity = 1;
        this.speakers = Object.fromEntries(VNSceneState.POSITIONS.map(p => [p, null]));
        this.flipped = {};
        this.visibility = {};
        this.charFx = {};
        this.musicUuid = null;
        this.soundCues = [];
        this.caption = '';
        this.portraitImages = {};
        this.portraitNames = {};
        this.portraitScales = {};
    }

    get isActive() { return this.active; }

    toPayload() {
        return {
            leftIds: [...this.leftIds],
            centerIds: [...this.centerIds],
            rightIds: [...this.rightIds],
            presetActors: [...this.presetActors],
            background: this.background,
            backgroundOverlay: this.backgroundOverlay,
            portraitScale: this.portraitScale,
            particleEffect: this.particleEffect,
            visualEffect: this.visualEffect,
            particlesLayer: this.particlesLayer,
            particleIntensity: this.particleIntensity,
            speakers: { ...this.speakers },
            flipped: { ...this.flipped },
            visibility: { ...this.visibility },
            charFx: { ...this.charFx },
            musicUuid: this.musicUuid,
            soundCues: [...(this.soundCues || [])],
            caption: this.caption || '',
            portraitImages: { ...this.portraitImages },
            portraitNames: { ...this.portraitNames },
            portraitScales: { ...this.portraitScales },
        };
    }

    fromPayload(p) {
        this.leftIds = [...(p.leftIds ?? [])];
        this.centerIds = [...(p.centerIds ?? [])];
        this.rightIds = [...(p.rightIds ?? [])];
        this.presetActors = Array.isArray(p.presetActors) ? [...p.presetActors] : [];
        this.background = p.background ?? null;
        this.backgroundOverlay = p.backgroundOverlay ?? true;
        const { MIN, MAX } = VNSceneState.SCALE_LIMITS;
        this.portraitScale = Math.min(Math.max(p.portraitScale ?? 1.0, MIN), MAX);
        if (p.particleEffect != null || p.visualEffect != null) {
            this.particleEffect = p.particleEffect ?? 'none';
            this.visualEffect = p.visualEffect ?? 'none';
        } else {
            // Обратная совместимость: старые данные хранили одну комбинацию atmosphereEffect
            const legacyPreset = PRESETS[p.atmosphereEffect] ?? PRESETS.none;
            this.particleEffect = legacyPreset.particles;
            this.visualEffect = legacyPreset.visual;
        }
        this.particlesLayer = resolveParticlesLayer(p);
        this.particleIntensity = Math.min(Math.max(Math.round(p.particleIntensity ?? 1), 1), 20);
        this.flipped = { ...(p.flipped ?? {}) };
        if (p.visibility) {
            this.visibility = { ...p.visibility };
        } else if (p.hidden) {
            this.visibility = {};
            for (const [id, val] of Object.entries(p.hidden)) {
                if (val === true) this.visibility[id] = 'hidden';
            }
        } else {
            this.visibility = {};
        }
        this.charFx = VNCharFx.normalize(p.charFx);
        this.musicUuid = p.musicUuid ?? null;
        this.soundCues = [...(p.soundCues ?? [])];
        this.caption = typeof p.caption === 'string' ? p.caption : '';
        this.portraitImages = { ...(p.portraitImages ?? {}) };
        this.portraitNames = { ...(p.portraitNames ?? {}) };
        this.portraitScales = { ...(p.portraitScales ?? {}) };
        for (const pos of VNSceneState.POSITIONS) {
            this.speakers[pos] = p.speakers?.[pos] ?? null;
        }
        this.active = true;
    }

    getAllTokenIds() {
        return VNSceneState.POSITIONS.flatMap(p => this[`${p}Ids`]);
    }

    hasToken(tokenId) {
        return VNSceneState.POSITIONS.some(p => this[`${p}Ids`].includes(tokenId));
    }

    getIdsForPosition(position) {
        return this[`${position}Ids`] ?? [];
    }

    toggleSpeaker(tokenId, position) {
        if (this.speakers[position] === tokenId) {
            this.speakers[position] = null;
            return false;
        }
        this.speakers[position] = tokenId;
        return true;
    }

    hasAnyTokens() {
        return VNSceneState.POSITIONS.some(p => this[`${p}Ids`].length > 0);
    }
}

/**
 * Read-modify-write for the world settings that hold a whole collection (presets, folders).
 * Every change starts from a fresh copy of what is stored right now (never from a cache that may be minutes old),
 * runs synchronously, and is written back at once: a second GM, or a second tab, cannot be overwritten by data that
 * this client read long ago. Changes made by this client are queued, so they never interleave with each other.
 */
class VNStore {
    static SKIP = Symbol('skip');
    static lastLocalWrite = 0;
    static _chains = new Map();

    /** `fn(draft)` edits the draft in place and returns a value for the caller, or VNStore.SKIP to write nothing. */
    static mutate(key, fn) {
        const prev = this._chains.get(key) ?? Promise.resolve();
        const run = prev.catch(() => {}).then(async () => {
            const draft = structuredClone(game.settings.get(MODULE_ID, key) || {});
            const result = fn(draft);
            if (result === this.SKIP) return { draft, result: null, skipped: true };
            this.lastLocalWrite = Date.now();
            await game.settings.set(MODULE_ID, key, draft);
            return { draft, result, skipped: false };
        });
        this._chains.set(key, run);
        return run;
    }

    /** onChange handler: drops the cache and tells open windows that data changed under them (`remote`: not our own write). */
    static changed(kind, onInvalidate) {
        return (value, options, userId) => {
            onInvalidate();
            const remote = typeof userId === 'string'
                ? userId !== game.user.id
                : Date.now() - this.lastLocalWrite > 1500;
            Hooks.callAll('vnStoreChanged', { kind, remote });
        };
    }
}

class VNPresets {
    static SETTING_KEY = 'vnPresets';

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
            sceneId: attachScene ? (canvas?.scene?.id ?? null) : null,
            sceneName: attachScene ? (canvas?.scene?.name ?? null) : null,
            folderId: opts.folderId ?? null,
            ...(thumbnailData ? { thumbnailData } : {}),
        };
        await VNStore.mutate(this.SETTING_KEY, draft => { draft[id] = entry; });
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
    static async makeStep(source) {
        const state = new VNSceneState();
        state.fromPayload(source);
        const payload = state.toPayload();
        let thumbnailData = source.thumbnailData ?? null;
        if (!thumbnailData && payload.background && payload.background !== 'none') {
            try { thumbnailData = await this._makeThumbnail(payload.background); } catch {}
        }
        return {
            ...payload,
            id: foundry.utils.randomID(),
            autoAdvance: Math.max(0, Number(source.autoAdvance) || 0),
            ...(typeof source.transition === 'string' && source.transition ? { transition: source.transition } : {}),
            ...(source.inheritActors === true ? { inheritActors: true } : {}),
            ...(thumbnailData ? { thumbnailData } : {}),
        };
    }

    static SEQUENCE_OPTIONS = {
        transition: v => VNTransitions.TRANSITION_TYPES.includes(v),
        transitionSpeed: v => v in VNTransitions.SPEEDS,
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
            id, name, type: 'sequence', steps: [],
            version: this._modVersion(),
            createdAt: now, updatedAt: now,
            sceneId: attachScene ? (canvas?.scene?.id ?? null) : null,
            sceneName: attachScene ? (canvas?.scene?.name ?? null) : null,
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

    static setScene(id, sceneId, sceneName) {
        return this._patch(id, p => Object.assign(p, { sceneId: sceneId ?? null, sceneName: sceneName ?? null, updatedAt: Date.now() }));
    }

    static async deleteGroup(groupKey) {
        await VNStore.mutate(this.SETTING_KEY, draft => {
            for (const id of Object.keys(draft)) {
                if ((draft[id].sceneName || '') === (groupKey || '')) delete draft[id];
            }
        });
    }

    /** Wipes every preset in one write. */
    static async clearAll() {
        await VNStore.mutate(this.SETTING_KEY, draft => { for (const id of Object.keys(draft)) delete draft[id]; });
    }

    static _srcThumbName(src) {
        let h = 0;
        for (let i = 0; i < src.length; i++) h = (Math.imul(31, h) + src.charCodeAt(i)) | 0;
        const base = src.split('/').pop().replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
        return `${base}_${Math.abs(h).toString(36)}.webp`;
    }

    static async _makeThumbnail(src, w = 240, h = 150) {
        const ext = src.split('.').pop().split('?')[0].toLowerCase();
        const isVideo = ['mp4', 'webm', 'ogg', 'mov'].includes(ext);

        const cvs = isVideo
            ? await new Promise((resolve, reject) => {
                const video = document.createElement('video');
                video.crossOrigin = 'anonymous';
                video.muted = true;
                video.playsInline = true;
                video.preload = 'metadata';
                const capture = () => {
                    try {
                        if (!video.videoWidth || !video.videoHeight) return reject(new Error('no video dimensions'));
                        const c = document.createElement('canvas');
                        c.width = w; c.height = h;
                        const ctx = c.getContext('2d');
                        const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
                        const sw = video.videoWidth * scale, sh = video.videoHeight * scale;
                        ctx.drawImage(video, (w - sw) / 2, (h - sh) / 2, sw, sh);
                        video.src = '';
                        resolve(c);
                    } catch (e) { reject(e); }
                };
                video.addEventListener('seeked', capture, { once: true });
                video.addEventListener('loadedmetadata', () => {
                    video.currentTime = Math.min(0.5, (video.duration || 1) * 0.25);
                }, { once: true });
                video.addEventListener('error', reject, { once: true });
                video.src = src;
            })
            : await new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    try {
                        const c = document.createElement('canvas');
                        c.width = w; c.height = h;
                        const ctx = c.getContext('2d');
                        const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
                        const sw = img.naturalWidth * scale, sh = img.naturalHeight * scale;
                        ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
                        resolve(c);
                    } catch (e) { reject(e); }
                };
                img.onerror = reject;
                img.src = src;
            });

        const blob = await new Promise((resolve, reject) =>
            cvs.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/webp', 0.82)
        );
        const file = new File([blob], this._srcThumbName(src), { type: 'image/webp' });
        const dir = this.thumbnailDir();
        const FPImpl = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
        await this._ensureDir(FPImpl, dir);
        const result = await FPImpl.upload('data', dir, file, {}, { notify: false });
        if (!result?.path) throw new Error('upload returned no path');
        return result.path;
    }

    /** Where thumbnails are written: the `thumbnailFolder` setting (any folder in Data, e.g. inside a module) or a per-world default. */
    static thumbnailDir() {
        let custom = '';
        try { custom = String(game.settings.get(MODULE_ID, 'thumbnailFolder') || ''); } catch {}
        try { custom = decodeURIComponent(custom); } catch {}
        custom = custom.trim().replace(/^\/+|\/+$/g, '');
        return custom || `worlds/${game.world.id}/player-queue-thumbnails`;
    }

    static _ensuredDirs = new Set();

    /** Creates every missing segment of `dir` (a picked or typed path may be several levels deep); remembered per session. */
    static async _ensureDir(FPImpl, dir) {
        if (this._ensuredDirs.has(dir)) return;
        let cur = '';
        for (const seg of dir.split('/').filter(Boolean)) {
            cur = cur ? `${cur}/${seg}` : seg;
            try { await FPImpl.createDirectory('data', cur, {}); } catch { /* exists */ }
        }
        this._ensuredDirs.add(dir);
    }

    static async _makeIcon(src, size = 128) {
        const iconName = this._srcThumbName(src);
        const dir = `worlds/${game.world.id}/player-queue-macro-icons`;
        const FPImpl = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;

        try {
            const browsed = await FPImpl.browse('data', dir);
            const iconPath = `${dir}/${iconName}`;
            if ((browsed.files || []).includes(iconPath)) return iconPath;
        } catch { /* dir doesn't exist yet */ }

        const ext = src.split('.').pop().split('?')[0].toLowerCase();
        const isVideo = ['mp4', 'webm', 'ogg', 'mov'].includes(ext);
        const w = size, h = size;

        const cvs = isVideo
            ? await new Promise((resolve, reject) => {
                const video = document.createElement('video');
                video.crossOrigin = 'anonymous'; video.muted = true;
                video.playsInline = true; video.preload = 'metadata';
                const capture = () => {
                    try {
                        if (!video.videoWidth || !video.videoHeight) return reject(new Error('no video dimensions'));
                        const c = document.createElement('canvas');
                        c.width = w; c.height = h;
                        const ctx = c.getContext('2d');
                        const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
                        const sw = video.videoWidth * scale, sh = video.videoHeight * scale;
                        ctx.drawImage(video, (w - sw) / 2, (h - sh) / 2, sw, sh);
                        video.src = ''; resolve(c);
                    } catch (e) { reject(e); }
                };
                video.addEventListener('seeked', capture, { once: true });
                video.addEventListener('loadedmetadata', () => {
                    video.currentTime = Math.min(0.5, (video.duration || 1) * 0.25);
                }, { once: true });
                video.addEventListener('error', reject, { once: true });
                video.src = src;
            })
            : await new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    try {
                        const c = document.createElement('canvas');
                        c.width = w; c.height = h;
                        const ctx = c.getContext('2d');
                        const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
                        const sw = img.naturalWidth * scale, sh = img.naturalHeight * scale;
                        ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
                        resolve(c);
                    } catch (e) { reject(e); }
                };
                img.onerror = reject;
                img.src = src;
            });

        const blob = await new Promise((resolve, reject) =>
            cvs.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/webp', 0.82)
        );
        const file = new File([blob], iconName, { type: 'image/webp' });
        try { await FPImpl.createDirectory('data', dir, {}); } catch {}
        const result = await FPImpl.upload('data', dir, file, {}, { notify: false });
        if (!result?.path) throw new Error('icon upload returned no path');
        return result.path;
    }

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
            const { id: pid, name, createdAt, sceneId, sceneName, thumbnailData: oldThumb, folderId, tags } = draft[id];
            const thumbnailData = newThumb ?? oldThumb ?? null;
            draft[id] = {
                ...payload, id: pid, name, version: this._modVersion(), createdAt, updatedAt: Date.now(),
                sceneId, sceneName, folderId: folderId ?? null,
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
    static async _regenerateEntry(p) {
        let thumbnailData = null;
        if (p.background && p.background !== 'none') {
            try { thumbnailData = await this._makeThumbnail(p.background); } catch {}
        }

        // Refresh portrait images/names from current game state (preserves old data as fallback)
        const portraitImages = { ...(p.portraitImages || {}) };
        const portraitNames  = { ...(p.portraitNames  || {}) };
        const allIds = [...(p.leftIds || []), ...(p.centerIds || []), ...(p.rightIds || [])];
        for (const tokenId of allIds) {
            const aid = parseActorId(tokenId);
            if (aid) {
                const actor = game.actors?.get(aid);
                if (actor) {
                    portraitImages[tokenId] = actor.img || actor.prototypeToken?.texture?.src || portraitImages[tokenId] || '';
                    portraitNames[tokenId]  = actor.name;
                }
            } else {
                const token = canvas?.tokens?.get(tokenId);
                if (token) {
                    portraitImages[tokenId] = token.actor?.img || token.document?.texture?.src || portraitImages[tokenId] || '';
                    portraitNames[tokenId]  = token.name || portraitNames[tokenId] || '';
                }
            }
        }

        return { background: p.background ?? null, thumbnailData, portraitImages, portraitNames };
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

    /** Keeps only plain objects, gives each a safe string id (a hostile id such as "__proto__" would hit the prototype). */
    static sanitizeImport(entries) {
        const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
        const list = Array.isArray(entries) ? entries.slice(0, this.MAX_IMPORT_PRESETS) : [];
        const out = [];
        for (const p of list) {
            if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
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

class VNFolders {
    static SETTING_KEY = 'vnFolders';
    static _cache = null;

    static register() {
        for (const [key, cfg] of [
            [this.SETTING_KEY,     { name: 'VN Scene Folders',    scope: 'world',  config: false, type: Object, default: {},
                onChange: VNStore.changed('folders', () => this.invalidateCache()) }],
            ['vnFolderFavorites',  { name: 'VN Folder Favorites', scope: 'client', config: false, type: Object, default: [] }],
            ['vnPresetsGroupMode', { name: 'VN Presets Group Mode', scope: 'client', config: false, type: String, default: 'scenes' }],
            ['vnPresetsViewMode',  { name: 'VN Presets View Mode',  scope: 'client', config: false, type: String, default: 'list'   }],
        ]) {
            try { game.settings.register(MODULE_ID, key, cfg); } catch {}
        }
    }

    static invalidateCache() { this._cache = null; }

    static getAll() {
        if (this._cache !== null) return this._cache;
        try { this._cache = game.settings.get(MODULE_ID, this.SETTING_KEY) || {}; } catch { this._cache = {}; }
        return this._cache;
    }

    static get(id) { return this.getAll()[id] ?? null; }

    static getChildren(parentId) {
        const pid = parentId || null;
        return Object.values(this.getAll()).filter(f => (f.parentId || null) === pid);
    }

    static getPath(folderId) {
        if (!folderId) return [];
        const folders = this.getAll();
        const path = [];
        const seen = new Set();
        let current = folders[folderId];
        while (current && !seen.has(current.id)) {
            seen.add(current.id);
            path.unshift(current);
            current = current.parentId ? folders[current.parentId] : null;
        }
        return path;
    }

    static async create(name, parentId = null) {
        const id = foundry.utils.randomID();
        const now = Date.now();
        const folder = { id, name, parentId: parentId || null, createdAt: now, updatedAt: now };
        await VNStore.mutate(this.SETTING_KEY, draft => { draft[id] = folder; });
        return folder;
    }

    static async rename(id, name) {
        await VNStore.mutate(this.SETTING_KEY, draft => {
            if (!draft[id]) return VNStore.SKIP;
            draft[id] = { ...draft[id], name, updatedAt: Date.now() };
        });
    }

    static async delete(id) {
        const { result: parentId, skipped } = await VNStore.mutate(this.SETTING_KEY, draft => {
            if (!draft[id]) return VNStore.SKIP;
            const parent = draft[id].parentId || null;
            // Subfolders move up to the parent
            for (const f of Object.values(draft)) {
                if ((f.parentId || null) === id) draft[f.id] = { ...f, parentId: parent, updatedAt: Date.now() };
            }
            delete draft[id];
            return parent;
        });
        if (skipped) return;

        // Presets inside move up to the parent too
        await VNStore.mutate(VNPresets.SETTING_KEY, draft => {
            let changed = false;
            for (const p of Object.values(draft)) {
                if ((p.folderId || null) === id) {
                    draft[p.id] = { ...p, folderId: parentId, updatedAt: Date.now() };
                    changed = true;
                }
            }
            return changed ? undefined : VNStore.SKIP;
        });

        const favs = this.getFavorites();
        const idx = favs.indexOf(id);
        if (idx >= 0) {
            favs.splice(idx, 1);
            try { await game.settings.set(MODULE_ID, 'vnFolderFavorites', favs); } catch {}
        }
    }

    static async move(id, newParentId) {
        await VNStore.mutate(this.SETTING_KEY, draft => {
            if (!draft[id]) return VNStore.SKIP;
            // Prevent circular references
            if (newParentId && (newParentId === id || this._isDescendant(draft, newParentId, id))) return VNStore.SKIP;
            draft[id] = { ...draft[id], parentId: newParentId || null, updatedAt: Date.now() };
        });
    }

    /** Is `ancestorId` somewhere above `targetId` in `folders`? */
    static _isDescendant(folders, targetId, ancestorId) {
        const seen = new Set();
        let current = folders[targetId];
        while (current && !seen.has(current.id)) {
            seen.add(current.id);
            if ((current.parentId || null) === ancestorId) return true;
            current = current.parentId ? folders[current.parentId] : null;
        }
        return false;
    }

    static getFavorites() {
        try { return [...(game.settings.get(MODULE_ID, 'vnFolderFavorites') || [])]; } catch { return []; }
    }

    static async toggleFavorite(id) {
        const favs = this.getFavorites();
        const idx = favs.indexOf(id);
        if (idx >= 0) favs.splice(idx, 1);
        else favs.push(id);
        try { await game.settings.set(MODULE_ID, 'vnFolderFavorites', favs); } catch {}
        return idx < 0;
    }
}

export { VNSceneState, VNPresets, VNFolders, VNStore };
