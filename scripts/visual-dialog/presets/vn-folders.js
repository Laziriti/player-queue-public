// Folder repository; collection writes are coordinated by VNStore.
import { MODULE_ID, PRESETS_SETTING_KEY, FOLDERS_SETTING_KEY } from '../vn-constants.js';
import { VNStore } from './vn-store.js';

export class VNFolders {
    static SETTING_KEY = FOLDERS_SETTING_KEY;
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
        await VNStore.mutate(PRESETS_SETTING_KEY, draft => {
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

