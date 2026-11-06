// ============================================================
// vn-adventure-io.js — Export/Import presets to/from adventure modules
// ============================================================

import { MODULE_ID, VNFolders } from './vn-state.js';
import { applyMigrations } from './vn-migrations.js';
const PRESETS_FILE = 'vn-presets.json';
const INTEGRATION_SUBPATH = 'integrations/player-queue';

export class VNAdventureIO {

    static sameSetName(a, b) {
        return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
    }

    // Any supported file shape -> [{ name, implicit, presets, folders }].
    // v3 { sets: [...] } is the native shape; v1/v2 { presets, folders } (and a bare array) is one set called `fallbackName`.
    // implicit = the name was not written in the file (it is `fallbackName` or derived from it), so it says nothing about the content.
    static normalizeSets(data, fallbackName = '') {
        const asList = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
        if (Array.isArray(data?.sets)) {
            return data.sets
                .filter(set => set && typeof set === 'object')
                .map((set, i) => {
                    const written = String(set.name ?? '').trim();
                    return {
                        name: written || (i === 0 ? fallbackName : `${fallbackName} ${i + 1}`),
                        implicit: !written,
                        presets: asList(set.presets),
                        folders: Array.isArray(set.folders) ? set.folders : [],
                    };
                });
        }
        return [{
            name: fallbackName,
            implicit: true,
            presets: Array.isArray(data) ? data : asList(data?.presets),
            folders: Array.isArray(data?.folders) ? data.folders : [],
        }];
    }

    // Adds `tags` to a preset (existing tags stay, comparison is case-insensitive)
    static withTags(preset, tags) {
        const have = Array.isArray(preset.tags) ? preset.tags : [];
        const seen = new Set(have.map(t => String(t).trim().toLowerCase()));
        // A comma would split the tag in the list (data-tags is comma-joined); the length matches what a person can type by hand
        const added = tags.map(t => String(t).replace(/[,\s]+/g, ' ').trim().slice(0, 48)).filter(t => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
        return added.length ? { ...preset, tags: [...have, ...added] } : preset;
    }

    // Sets stored in modules/<moduleId>/<file>. A missing file is an empty list; with strict=true any other failure throws
    // (an export must never overwrite a file it could not read), otherwise it is swallowed (used only to show hints).
    static async readSets(moduleId, file = `${INTEGRATION_SUBPATH}/${PRESETS_FILE}`, { strict = false } = {}) {
        try {
            const resp = await fetch(`modules/${moduleId}/${file}`, { cache: 'no-cache' });
            if (resp.status === 404) return [];
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return VNAdventureIO.normalizeSets(await resp.json(), game.i18n.localize('vn.io.defaultSetName'));
        } catch (err) {
            if (strict) throw err;
            return [];
        }
    }

    // Write the presets as the set `setName` of modules/<moduleId>/integrations/player-queue/vn-presets.json.
    // The other sets in the file are kept; a set with the same name (case-insensitive) is replaced in place.
    // Returns { created, sets } — created=false means an existing set was updated.
    static async exportToModule(presets, moduleId, setName) {
        const name = String(setName ?? '').trim().slice(0, 80) || game.i18n.localize('vn.io.defaultSetName');
        const base = `modules/${moduleId}`;
        const sets = await VNAdventureIO.readSets(moduleId, `${INTEGRATION_SUBPATH}/${PRESETS_FILE}`, { strict: true });

        const folders = Object.values(VNFolders.getAll());
        const at = sets.findIndex(s => VNAdventureIO.sameSetName(s.name, name));
        // An update keeps the stored spelling of the name
        const set = { name: at >= 0 ? sets[at].name : name, presets, folders };
        if (at >= 0) sets[at] = set; else sets.push(set);

        // Ensure nested dirs exist (createDirectory is idempotent — throws if already exists, that's fine)
        try { await FilePicker.createDirectory('data', `${base}/integrations`); } catch {}
        try { await FilePicker.createDirectory('data', `${base}/${INTEGRATION_SUBPATH}`); } catch {}

        const payload = JSON.stringify({ version: 3, sets }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const file = new File([blob], PRESETS_FILE, { type: 'application/json' });
        await FilePicker.upload('data', `${base}/${INTEGRATION_SUBPATH}`, file, {});
        return { created: at < 0, sets };
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

    // Fetch the sets of an adventure module; shows an error notification when the file cannot be read
    static async fetchSets(moduleId, presetsFile = `${INTEGRATION_SUBPATH}/${PRESETS_FILE}`) {
        try {
            const sets = await VNAdventureIO.readSets(moduleId, presetsFile, { strict: true });
            if (!sets.length) throw new Error('HTTP 404');
            return sets;
        } catch (err) {
            ui.notifications.error(game.i18n.format('vn.io.loadError', { moduleId, msg: err.message }));
            return [];
        }
    }

    // ── Built-in library ──────────────────────────────────────
    // modules/player-queue/library/index.json lists adventures kept inside this module: { "adventures": [ { id, title, author,
    // description, file, setName, nameplateImage, backgroundFolder } ] } (the last two are optional, as in a module's flags). Entries sharing one `id` (the adventure module id) are one adventure with several
    // collections; each `file` is an export file in the same sets format as an adventure module's vn-presets.json.

    static LIBRARY_PATH = `modules/${MODULE_ID}/library`;

    /** 'active' | 'inactive' (installed, switched off) | 'missing' */
    static moduleStatus(id) {
        const mod = game.modules.get(id);
        return !mod ? 'missing' : mod.active ? 'active' : 'inactive';
    }

    // Reads the index and groups it by module id (case-insensitive). A missing index is an empty library.
    static async readLibrary() {
        const resp = await fetch(`${VNAdventureIO.LIBRARY_PATH}/index.json`, { cache: 'no-cache' });
        if (resp.status === 404) return [];
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const list = Array.isArray(data) ? data : data?.adventures;
        const text = v => String(v ?? '').trim();
        // `file` stays inside library/: no absolute paths, no "..", no schemes
        const safeFile = f => f && !/^([a-z][a-z0-9+.-]*:|[\\/])/i.test(f) && !f.split(/[\\/]/).includes('..');

        const groups = new Map();
        for (const raw of Array.isArray(list) ? list : []) {
            const entry = { id: text(raw?.id), title: text(raw?.title), author: text(raw?.author), description: text(raw?.description), file: text(raw?.file), setName: text(raw?.setName), nameplate: text(raw?.nameplateImage), backgroundFolder: text(raw?.backgroundFolder) };
            if (!entry.id || !safeFile(entry.file)) continue;
            const key = entry.id.toLowerCase();
            const group = groups.get(key) ?? { id: entry.id, title: '', author: '', description: '', nameplate: '', backgroundFolder: '', entries: [] };
            group.title ||= entry.title;
            group.author ||= entry.author;
            group.description ||= entry.description;
            group.nameplate ||= entry.nameplate;
            group.backgroundFolder ||= entry.backgroundFolder;
            group.entries.push(entry);
            groups.set(key, group);
        }
        return [...groups.values()].map(group => ({ ...group, title: group.title || game.modules.get(group.id)?.title || group.id }));
    }

    // Reads every collection file of a library adventure into one list of sets (same shape as fetchSets).
    // `setName` of an entry names the file's set when the file holds exactly one. Equal set names get " (2)", " (3)"…
    static async fetchLibrarySets(adventure) {
        try {
            const fallback = game.i18n.localize('vn.io.defaultSetName');
            const sets = [];
            for (const entry of adventure.entries) {
                const resp = await fetch(`${VNAdventureIO.LIBRARY_PATH}/${entry.file}`, { cache: 'no-cache' });
                if (!resp.ok) throw new Error(`${entry.file}: HTTP ${resp.status}`);
                const part = VNAdventureIO.normalizeSets(await resp.json(), entry.setName || fallback);
                if (entry.setName && part.length === 1) { part[0].name = entry.setName; part[0].implicit = false; }
                for (const set of part) {
                    const base = set.name;
                    for (let n = 2; sets.some(s => VNAdventureIO.sameSetName(s.name, set.name)); n++) set.name = `${base} (${n})`;
                    sets.push(set);
                }
            }
            if (!sets.length) throw new Error('empty');
            return sets;
        } catch (err) {
            ui.notifications.error(game.i18n.format('vn.io.loadError', { moduleId: adventure.id, msg: err.message }));
            return [];
        }
    }

    // Merge imported presets into game.settings
    // overwrite=false: skip duplicates; overwrite=true: replace existing by id
    // folderOpts: null = keep folderIds as-is; { importFolders: true, folders: [] } = recreate structure;
    //             { importFolders: false } = set all folderIds to null
    // tags: strings added to every imported preset (e.g. module and set names)
    static async mergeImport(presets, overwrite = false, folderOpts = null, { replace = false, tags = [] } = {}) {
        const { VNPresets } = await import('./vn-state.js');

        let folderIdMap = new Map();
        if (folderOpts?.importFolders && folderOpts.folders?.length) {
            folderIdMap = await VNAdventureIO._importFolders(folderOpts.folders);
        }

        // folderOpts === null: keep folderIds as they are
        const moveToFolder = folderOpts === null ? null : (p) => {
            if (!folderOpts.importFolders) return { ...p, folderId: null };
            if (p.folderId) return { ...p, folderId: folderIdMap.get(p.folderId) ?? null };
            return p;
        };
        const transform = (moveToFolder || tags.length)
            ? (p) => VNAdventureIO.withTags(moveToFolder ? moveToFolder(p) : p, tags)
            : null;
        return VNPresets.importMany(presets, { overwrite, replace, transform });
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
