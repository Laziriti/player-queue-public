// ============================================================
// vn-state.js — VNSceneState + VNPresets classes
// ============================================================

import { parseActorId } from './vn-id-utils.js';

const MODULE_ID = 'player-queue';

class VNSceneState {
    static POSITIONS = ['left', 'center', 'right'];

    constructor() { this.reset(); }

    reset() {
        this.active = false;
        this.minimized = false;
        this.leftIds = [];
        this.centerIds = [];
        this.rightIds = [];
        this.background = null;
        this.backgroundOverlay = true;
        this.portraitScale = 1.0;
        this.atmosphereEffect = 'particles';
        this.speakers = Object.fromEntries(VNSceneState.POSITIONS.map(p => [p, null]));
        this.flipped = {};
        this.hidden = {};
        this.musicUuid = null;
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
            background: this.background,
            backgroundOverlay: this.backgroundOverlay,
            portraitScale: this.portraitScale,
            atmosphereEffect: this.atmosphereEffect,
            flipped: { ...this.flipped },
            hidden: { ...this.hidden },
            musicUuid: this.musicUuid,
            portraitImages: { ...this.portraitImages },
            portraitNames: { ...this.portraitNames },
            portraitScales: { ...this.portraitScales },
        };
    }

    fromPayload(p) {
        this.leftIds = [...(p.leftIds ?? [])];
        this.centerIds = [...(p.centerIds ?? [])];
        this.rightIds = [...(p.rightIds ?? [])];
        this.background = p.background ?? null;
        this.backgroundOverlay = p.backgroundOverlay ?? true;
        this.portraitScale = p.portraitScale ?? 1.0;
        this.atmosphereEffect = p.atmosphereEffect ?? 'particles';
        this.flipped = { ...(p.flipped ?? {}) };
        this.hidden = { ...(p.hidden ?? {}) };
        this.musicUuid = p.musicUuid ?? null;
        this.portraitImages = { ...(p.portraitImages ?? {}) };
        this.portraitNames = { ...(p.portraitNames ?? {}) };
        this.portraitScales = { ...(p.portraitScales ?? {}) };
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

    static async getAll() {
        try {
            const raw = game.settings.get(MODULE_ID, this.SETTING_KEY) || {};
            if (this._migrated) return raw;
            const needsMigration = Object.values(raw).some(v => !v.id);
            if (!needsMigration) { this._migrated = true; return raw; }
            const migrated = {};
            for (const [key, val] of Object.entries(raw)) {
                if (val.id) { migrated[val.id] = val; continue; }
                const id = foundry.utils.randomID();
                const ts = val.savedAt || Date.now();
                migrated[id] = { ...val, id, name: key, createdAt: ts, updatedAt: ts };
            }
            await game.settings.set(MODULE_ID, this.SETTING_KEY, migrated);
            this._migrated = true;
            return migrated;
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

    static _makeThumbnail(src, w = 160, h = 100) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const cvs = document.createElement('canvas');
                    cvs.width = w; cvs.height = h;
                    const ctx = cvs.getContext('2d');
                    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
                    const sw = img.naturalWidth * scale, sh = img.naturalHeight * scale;
                    ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
                    resolve(cvs.toDataURL('image/jpeg', 0.8));
                } catch (e) { reject(e); }
            };
            img.onerror = reject;
            img.src = src;
        });
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

    static async update(id, sceneState) {
        const presets = await this.getAll();
        if (!presets[id]) return null;
        const { id: pid, name, createdAt, sceneId, sceneName } = presets[id];
        presets[id] = { ...sceneState.toPayload(), id: pid, name, createdAt, updatedAt: Date.now(), sceneId, sceneName };
        await game.settings.set(MODULE_ID, this.SETTING_KEY, presets);
        return this._sortedFrom(presets);
    }

    // Re-run all generation logic on existing preset data (thumbnail, portrait images/names).
    // Never changes user-set values: actor IDs, background, effects, scene association, name.
    static async regenerate(ids = null) {
        const presets = await this.getAll();
        const keys = ids ? ids.filter(id => presets[id]) : Object.keys(presets);
        let count = 0;
        for (const id of keys) {
            const p = presets[id];

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

            presets[id] = { ...p, thumbnailData, portraitImages, portraitNames, updatedAt: Date.now() };
            count++;
        }
        await game.settings.set(MODULE_ID, this.SETTING_KEY, presets);
        return count;
    }

    static async replaceAll(presets) {
        const store = {};
        for (const p of presets) {
            const id = p.id || foundry.utils.randomID();
            store[id] = { ...p, id };
        }
        await game.settings.set(MODULE_ID, this.SETTING_KEY, store);
    }

    static async delete(id) {
        const presets = await this.getAll();
        const name = presets[id]?.name || id;
        delete presets[id];
        await game.settings.set(MODULE_ID, this.SETTING_KEY, presets);
    }
}

export { VNSceneState, VNPresets, MODULE_ID };
