// ============================================================
// vn-adventure-io.js — Export/Import presets to/from adventure modules
// ============================================================

const MODULE_ID = 'player-queue';
const PRESETS_FILE = 'vn-presets.json';
const INTEGRATION_SUBPATH = 'integrations/player-queue';

export class VNAdventureIO {

    // Write selected presets to modules/<moduleId>/integrations/player-queue/vn-presets.json
    static async exportToModule(presets, moduleId) {
        const base = `modules/${moduleId}`;
        // Ensure nested dirs exist (createDirectory is idempotent — throws if already exists, that's fine)
        try { await FilePicker.createDirectory('data', `${base}/integrations`); } catch {}
        try { await FilePicker.createDirectory('data', `${base}/${INTEGRATION_SUBPATH}`); } catch {}

        const payload = JSON.stringify({ version: 1, presets }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const file = new File([blob], PRESETS_FILE, { type: 'application/json' });
        await FilePicker.upload('data', `${base}/${INTEGRATION_SUBPATH}`, file, {});
    }

    // Find all active modules that declared a vn-presets file in their flags
    static scanModules() {
        const found = [];
        for (const m of game.modules.values()) {
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
            const sample = [...game.modules.values()].slice(0, 5)
                .map(m => ({ id: m.id, flags: m.flags }));
            console.log('[player-queue] scanModules: no adventure modules found. ' +
                'Check that module.json is saved and Foundry server restarted. ' +
                'Active module flags sample:', sample);
        }
        return found;
    }

    // Fetch and parse presets JSON from a module path
    static async fetchPresets(moduleId, presetsFile = `${INTEGRATION_SUBPATH}/${PRESETS_FILE}`) {
        try {
            const resp = await fetch(`modules/${moduleId}/${presetsFile}`, { cache: 'no-cache' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            if (Array.isArray(data.presets)) return data.presets;
            if (data.presets && typeof data.presets === 'object') return Object.values(data.presets);
            return [];
        } catch (err) {
            ui.notifications.error(`Ошибка загрузки пресетов из ${moduleId}: ${err.message}`);
            return [];
        }
    }

    // Merge imported presets into game.settings
    // overwrite=false: skip duplicates; overwrite=true: replace existing by id
    static async mergeImport(presets, overwrite = false) {
        const { VNPresets } = await import('./vn-state.js');
        const existing = await VNPresets.getAll();
        let added = 0;
        for (const p of presets) {
            const id = p.id || foundry.utils.randomID();
            if (!existing[id] || overwrite) { existing[id] = { ...p, id }; added++; }
        }
        await game.settings.set(MODULE_ID, VNPresets.SETTING_KEY, existing);
        return added;
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
        const payload = JSON.stringify({ version: 1, presets }, null, 2);
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
