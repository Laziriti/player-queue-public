// ============================================================
// vn-migrations.js — versioned preset migrations
// ============================================================

import { PRESETS } from './visual-effects/atmosphere/config/effects.js';

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
    },
    {
        version: '14.9.0',
        migrate(preset) {
            if ('folderId' in preset) return preset;
            return { ...preset, folderId: null };
        }
    },
    {
        version: '14.9.1',
        migrate(preset) {
            if ('particleIntensity' in preset) return preset;
            return { ...preset, particleIntensity: 1 };
        }
    },
    {
        version: '14.10.0',
        migrate(preset) {
            if ('particleEffect' in preset || 'visualEffect' in preset) return preset;
            const legacyPreset = PRESETS[preset.atmosphereEffect] ?? PRESETS.none;
            const result = { ...preset, particleEffect: legacyPreset.particles, visualEffect: legacyPreset.visual };
            delete result.atmosphereEffect;
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
