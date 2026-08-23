// ============================================================
// vn-migrations.js — versioned preset migrations
// ============================================================

export const MIGRATIONS = [
    {
        version: '14.2.2',
        migrate(preset) {
            if (preset.visibility || !preset.hidden) return preset;
            const visibility = {};
            for (const [id, val] of Object.entries(preset.hidden)) {
                if (val === true) visibility[id] = 'hidden';
            }
            const result = { ...preset, visibility };
            delete result.hidden;
            return result;
        }
    }
];

export function countPendingMigrations(preset) {
    const presetVersion = preset.version ?? '0.0.0';
    return MIGRATIONS.filter(m => foundry.utils.isNewerVersion(m.version, presetVersion)).length;
}

export function applyMigrations(preset) {
    const presetVersion = preset.version ?? '0.0.0';
    let result = { ...preset };
    for (const m of MIGRATIONS) {
        if (foundry.utils.isNewerVersion(m.version, presetVersion)) {
            result = m.migrate(result) ?? result;
        }
    }
    return result;
}
