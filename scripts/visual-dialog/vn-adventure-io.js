// ============================================================
// vn-adventure-io.js — Export/Import presets to/from adventure modules
// ============================================================

import { MODULE_ID, VNFolders } from './vn-state.js';
import { applyMigrations } from './vn-migrations.js';
const PRESETS_FILE = 'vn-presets.json';
const INTEGRATION_SUBPATH = 'integrations/player-queue';

export class VNAdventureIO {

    // Write selected presets to modules/<moduleId>/integrations/player-queue/vn-presets.json
    static async exportToModule(presets, moduleId) {
        const base = `modules/${moduleId}`;
        // Ensure nested dirs exist (createDirectory is idempotent — throws if already exists, that's fine)
        try { await FilePicker.createDirectory('data', `${base}/integrations`); } catch {}
        try { await FilePicker.createDirectory('data', `${base}/${INTEGRATION_SUBPATH}`); } catch {}

        const folders = Object.values(VNFolders.getAll());
        const payload = JSON.stringify({ version: 2, presets, folders }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const file = new File([blob], PRESETS_FILE, { type: 'application/json' });
        await FilePicker.upload('data', `${base}/${INTEGRATION_SUBPATH}`, file, {});
    }

    // Find all active modules that declared a vn-presets file in their flags
    static scanModules() {
        const found = [];
        const activeModules = [...game.modules.values()].filter(m => m.active);
        for (const m of activeModules) {
            const pqFlags = m.flags?.['player-queue'];
            if (pqFlags?.vnPresetsFile) {
                found.push({
                    id: m.id,
                    title: m.title,
                    presetsFile: pqFlags.vnPresetsFile,
                    nameplate: pqFlags.nameplateImage ?? null,
                    backgroundFolder: pqFlags.backgroundFolder ?? null,
                });
            }
        }
        if (!found.length) {
            // Debug: print first few active modules so GM can verify flag path in browser console
            const sample = activeModules.slice(0, 5)
                .map(m => ({ id: m.id, flags: m.flags }));
            console.log('[player-queue] scanModules: no adventure modules found. ' +
                'Check that module.json is saved and Foundry server restarted. ' +
                'Active module flags sample:', sample);
        }
        return found;
    }

    // Fetch and parse presets JSON from a module path
    // Returns { presets: [], folders: [] }
    static async fetchPresets(moduleId, presetsFile = `${INTEGRATION_SUBPATH}/${PRESETS_FILE}`) {
        try {
            const resp = await fetch(`modules/${moduleId}/${presetsFile}`, { cache: 'no-cache' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const presets = Array.isArray(data.presets) ? data.presets
                : (data.presets && typeof data.presets === 'object' ? Object.values(data.presets) : []);
            const folders = Array.isArray(data.folders) ? data.folders : [];
            return { presets, folders };
        } catch (err) {
            ui.notifications.error(game.i18n.format('vn.io.loadError', { moduleId, msg: err.message }));
            return { presets: [], folders: [] };
        }
    }

    // Merge imported presets into game.settings
    // overwrite=false: skip duplicates; overwrite=true: replace existing by id
    // folderOpts: null = keep folderIds as-is; { importFolders: true, folders: [] } = recreate structure;
    //             { importFolders: false } = set all folderIds to null
    static async mergeImport(presets, overwrite = false, folderOpts = null) {
        const { VNPresets } = await import('./vn-state.js');
        const existing = await VNPresets.getAll();

        let folderIdMap = new Map();
        if (folderOpts?.importFolders && folderOpts.folders?.length) {
            folderIdMap = await VNAdventureIO._importFolders(folderOpts.folders);
        }

        let added = 0;
        for (const p of presets) {
            const id = p.id || foundry.utils.randomID();
            if (!existing[id] || overwrite) {
                let migrated = applyMigrations({ ...p, id });
                if (folderOpts === null) {
                    // keep folderId as-is
                } else if (!folderOpts.importFolders) {
                    migrated = { ...migrated, folderId: null };
                } else if (migrated.folderId) {
                    migrated = { ...migrated, folderId: folderIdMap.get(migrated.folderId) ?? null };
                }
                existing[id] = migrated;
                added++;
            }
        }
        await game.settings.set(MODULE_ID, VNPresets.SETTING_KEY, existing);
        VNPresets.invalidateCache();
        return added;
    }

    // Create/map folders from an imported folders array; returns Map<incomingId, localId>
    static async _importFolders(folders) {
        const { VNFolders: Folders } = await import('./vn-state.js');
        const existing = Folders.getAll();
        const idMap = new Map();

        // Topological sort: parents before children
        const sorted = [];
        const remaining = [...folders];
        while (remaining.length) {
            const before = remaining.length;
            for (let i = remaining.length - 1; i >= 0; i--) {
                const f = remaining[i];
                if (!f.parentId || idMap.has(f.parentId) || existing[f.parentId]) {
                    sorted.push(f);
                    remaining.splice(i, 1);
                }
            }
            if (remaining.length === before) { sorted.push(...remaining); break; }
        }

        for (const f of sorted) {
            if (existing[f.id]) {
                idMap.set(f.id, f.id);
            } else {
                const mappedParent = f.parentId ? (idMap.get(f.parentId) ?? null) : null;
                const newFolder = await Folders.create(f.name, mappedParent);
                idMap.set(f.id, newFolder.id);
            }
        }
        return idMap;
    }

    // Split presets into fresh (new) and dupes (id already in world)
    static async classifyImport(presets) {
        const { VNPresets } = await import('./vn-state.js');
        const existing = await VNPresets.getAll();
        const fresh = presets.filter(p => !existing[p.id]);
        const dupes = presets.filter(p =>  existing[p.id]);
        return { fresh, dupes };
    }

    // Download presets as a JSON file to the user's downloads folder
    static exportToFile(presets) {
        const filename = `vn-presets-${new Date().toISOString().slice(0, 10)}.json`;
        const folders = Object.values(VNFolders.getAll());
        const payload = JSON.stringify({ version: 2, presets, folders }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        // bubbles:false prevents Foundry's global click handlers from intercepting
        a.dispatchEvent(new MouseEvent('click', { bubbles: false, cancelable: true }));
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // JSON snippet to paste into the adventure module's module.json
    // opts: { nameplate?: string, backgroundFolder?: string }
    static moduleJsonSnippet(opts = {}) {
        const lines = [`    "vnPresetsFile": "${INTEGRATION_SUBPATH}/${PRESETS_FILE}"`];
        if (opts.nameplate) lines.push(`    "nameplateImage": "${opts.nameplate}"`);
        if (opts.backgroundFolder) lines.push(`    "backgroundFolder": "${opts.backgroundFolder}"`);
        return `"flags": {\n  "player-queue": {\n${lines.join(',\n')}\n  }\n}`;
    }
}
