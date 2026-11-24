import { parseActorId } from '../scene/vn-id-utils.js';

/** One ordered snapshot of on-stage cards. Counts span all zones, so copies keep their #N identity. */
export function collectCharacterForm(root, { backgroundOnly = false } = {}) {
    const counts = new Map();
    const records = [];
    const ids = { left: [], center: [], right: [] };
    const portraitImages = {}, portraitNames = {}, visibility = {}, charFx = {};
    const canvasToActorId = new Map();
    const cards = root.querySelectorAll('#left-tokens .vn-token-option, #center-tokens .vn-token-option, #right-tokens .vn-token-option');
    for (const element of cards) {
        const rawId = element.dataset.actorId ? `actor-${element.dataset.actorId}` : element.dataset.tokenId;
        if (!rawId) continue;
        const occurrence = counts.get(rawId) ?? 0;
        counts.set(rawId, occurrence + 1);
        const instanceId = occurrence === 0 ? rawId : `${rawId}#${occurrence}`;
        const position = element.closest('.vn-token-selector').dataset.position;
        records.push({ element, rawId, instanceId, position });
        const tokenId = element.dataset.tokenId;
        if (tokenId && !parseActorId(tokenId)) canvasToActorId.set(tokenId, instanceId);
        if (backgroundOnly) continue;
        ids[position].push(instanceId);
        const src = element.querySelector('.vn-token-preview img')?.getAttribute('src');
        const name = element.querySelector('.vn-token-name')?.textContent?.trim();
        if (src) portraitImages[instanceId] = src;
        if (name) portraitNames[instanceId] = name;
        const vis = element.dataset.visibility ?? 'visible';
        if (vis !== 'visible') visibility[instanceId] = vis;
        const fx = element.dataset.charFx;
        if (fx && fx !== 'none') charFx[instanceId] = fx;
    }

    // Preserve legacy canvas-token aliases and their precedence over canonical transform keys.
    const remap = values => {
        if (!values || !Object.keys(values).length) return values;
        const mapped = {};
        for (const [key, value] of Object.entries(values)) {
            const id = canvasToActorId.get(key) ?? key;
            if (canvasToActorId.has(key) || mapped[id] === undefined) mapped[id] = value;
        }
        return mapped;
    };
    return { records, ids, portraitImages, portraitNames, visibility, charFx, remap };
}
