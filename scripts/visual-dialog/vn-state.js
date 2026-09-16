// ============================================================
// vn-state.js — VNSceneState + VNPresets classes
// ============================================================

import { parseActorId } from './vn-id-utils.js';
import { applyMigrations } from './vn-migrations.js';

export const MODULE_ID = 'player-queue';

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
        this.atmosphereEffect = 'particles';
        this.particlesForeground = false;
        this.speakers = Object.fromEntries(VNSceneState.POSITIONS.map(p => [p, null]));
        this.flipped = {};
        this.visibility = {};
        this.musicUuid = null;
        this.soundCues = [];
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
            atmosphereEffect: this.atmosphereEffect,
            particlesForeground: this.particlesForeground,
            speakers: { ...this.speakers },
            flipped: { ...this.flipped },
            visibility: { ...this.visibility },
            musicUuid: this.musicUuid,
            soundCues: [...(this.soundCues || [])],
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
        this.atmosphereEffect = p.atmosphereEffect ?? 'particles';
        this.particlesForeground = p.particlesForeground ?? false;
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
        this.musicUuid = p.musicUuid ?? null;
        this.soundCues = [...(p.soundCues ?? [])];
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

class VNPresets {
    static SETTING_KEY = 'vnPresets';

    static register() {
        try {
            game.settings.register(MODULE_ID, this.SETTING_KEY, {
                name: 'VN Scene Presets', scope: 'world', config: false, type: Object, default: {},
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
        try {
            const raw = game.settings.get(MODULE_ID, this.SETTING_KEY) || {};
            if (this._migrated) { this._cache = raw; return raw; }
            const needsMigration = Object.values(raw).some(v => !v.id);
            if (!needsMigration) { this._migrated = true; this._cache = raw; return raw; }
            const migrated = {};
            for (const [key, val] of Object.entries(raw)) {
                if (val.id) { migrated[val.id] = val; continue; }
                const id = foundry.utils.randomID();
                const ts = val.savedAt || Date.now();
                migrated[id] = { ...val, id, name: key, createdAt: ts, updatedAt: ts };
            }
            this._migrationPromise = game.settings.set(MODULE_ID, this.SETTING_KEY, migrated)
                .then(() => { this._migrated = true; this._cache = migrated; return migrated; })
                .catch(() => ({}))
                .finally(() => { this._migrationPromise = null; });
            return this._migrationPromise;
        } catch { return {}; }
    }

    static async getSorted() {
        const presets = await this.getAll();
        return Object.values(presets).sort((a, b) =>
            (b.createdAt || b.savedAt || 0) - (a.createdAt || a.savedAt || 0));
    }

    static async save(name, sceneState, attachScene = true) {
        const presets = await this.getAll();
        const id = foundry.utils.randomID();
        const now = Date.now();
        let thumbnailData = null;
        if (sceneState.background && sceneState.background !== 'none') {
            try { thumbnailData = await this._makeThumbnail(sceneState.background); } catch {}
        }
        presets[id] = {
            ...sceneState.toPayload(),
            id,
            name,
            version: game.modules.get(MODULE_ID)?.version ?? '0.0.0',
            createdAt: now,
            updatedAt: now,
            sceneId: attachScene ? (canvas?.scene?.id ?? null) : null,
            sceneName: attachScene ? (canvas?.scene?.name ?? null) : null,
            ...(thumbnailData ? { thumbnailData } : {}),
        };
        await game.settings.set(MODULE_ID, this.SETTING_KEY, presets);
    }

    static async setScene(id, sceneId, sceneName) {
        const presets = await this.getAll();
        if (!presets[id]) return null;
        presets[id] = { ...presets[id], sceneId: sceneId ?? null, sceneName: sceneName ?? null, updatedAt: Date.now() };
        await game.settings.set(MODULE_ID, this.SETTING_KEY, presets);
        return this._sortedFrom(presets);
    }

    static async deleteGroup(groupKey) {
        const presets = await this.getAll();
        for (const id of Object.keys(presets)) {
            if ((presets[id].sceneName || '') === (groupKey || '')) delete presets[id];
        }
        await game.settings.set(MODULE_ID, this.SETTING_KEY, presets);
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
        const dir = `worlds/${game.world.id}/player-queue-thumbnails`;
        const FPImpl = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
        try { await FPImpl.createDirectory('data', dir, {}); } catch {}
        const result = await FPImpl.upload('data', dir, file, {}, { notify: false });
        if (!result?.path) throw new Error('upload returned no path');
        return result.path;
    }

    static async load(id) {
        return (await this.getAll())[id] ?? null;
    }

    static _sortedFrom(presets) {
        return Object.values(presets).sort((a, b) => (b.createdAt || b.savedAt || 0) - (a.createdAt || a.savedAt || 0));
    }

    static async rename(id, newName) {
        const presets = await this.getAll();
        if (!presets[id]) return null;
        presets[id] = { ...presets[id], name: newName, updatedAt: Date.now() };
        await game.settings.set(MODULE_ID, this.SETTING_KEY, presets);
        return this._sortedFrom(presets);
    }

    static async setTags(id, tags) {
        const presets = await this.getAll();
        if (!presets[id]) return null;
        presets[id] = { ...presets[id], tags: tags.map(t => t.trim()).filter(Boolean), updatedAt: Date.now() };
        await game.settings.set(MODULE_ID, this.SETTING_KEY, presets);
        return this._sortedFrom(presets);
    }

    static async update(id, sceneState) {
        const presets = await this.getAll();
        if (!presets[id]) return null;
        const { id: pid, name, createdAt, sceneId, sceneName, thumbnailData: oldThumb } = presets[id];
        let thumbnailData = oldThumb ?? null;
        if (sceneState.background && sceneState.background !== 'none') {
            try { thumbnailData = await this._makeThumbnail(sceneState.background); } catch {}
        }
        presets[id] = { ...sceneState.toPayload(), id: pid, name, version: game.modules.get(MODULE_ID)?.version ?? '0.0.0', createdAt, updatedAt: Date.now(), sceneId, sceneName, ...(thumbnailData ? { thumbnailData } : {}) };
        await game.settings.set(MODULE_ID, this.SETTING_KEY, presets);
        return this._sortedFrom(presets);
    }

    // Re-run all generation logic on existing preset data (thumbnail, portrait images/names).
    // Never changes user-set values: actor IDs, background, effects, scene association, name.
    static async regenerate(ids = null) {
        const presets = await this.getAll();
        const keys = ids ? ids.filter(id => presets[id]) : Object.keys(presets);
        const currentVersion = game.modules.get(MODULE_ID)?.version ?? '0.0.0';
        let count = 0;
        for (const id of keys) {
            const p = applyMigrations(presets[id]);

            // Regenerate thumbnail from background
            let thumbnailData = p.thumbnailData ?? null;
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

            presets[id] = { ...p, thumbnailData, portraitImages, portraitNames, version: currentVersion, updatedAt: Date.now() };
            count++;
        }
        await game.settings.set(MODULE_ID, this.SETTING_KEY, presets);
        return count;
    }

    static async replaceAll(presets) {
        const store = {};
        for (const p of presets) {
            const id = p.id || foundry.utils.randomID();
            store[id] = applyMigrations({ ...p, id });
        }
        await game.settings.set(MODULE_ID, this.SETTING_KEY, store);
        this._cache = null;
    }

    static async delete(id) {
        const presets = await this.getAll();
        const name = presets[id]?.name || id;
        delete presets[id];
        await game.settings.set(MODULE_ID, this.SETTING_KEY, presets);
    }
}

export { VNSceneState, VNPresets };
