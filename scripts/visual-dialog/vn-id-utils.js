// ============================================================
// vn-id-utils.js — shared ID parsing for actor-/# conventions
// ============================================================

export const FALLBACK_AVATAR = 'icons/svg/mystery-man.svg';

export function stripDupSuffix(id) {
    const h = id.indexOf('#');
    return h === -1 ? id : id.slice(0, h);
}

export function parseActorId(tokenId) {
    return tokenId.startsWith('actor-') ? tokenId.slice(6) : null;
}

export function toActorTokenId(actorId) {
    return `actor-${actorId}`;
}

export function parsePlaylistUuid(uuid) {
    try {
        const parts = uuid.split('.');
        if (parts.length !== 4 || parts[0] !== 'Playlist' || parts[2] !== 'PlaylistSound') return null;
        const playlist = game.playlists.get(parts[1]);
        const sound = playlist?.sounds.get(parts[3]) ?? null;
        return sound ? { playlist, sound } : null;
    } catch { return null; }
}

export function resolveActorImg(id, portraitImages = {}) {
    try {
        const aid = parseActorId(id);
        if (aid) {
            const a = game.actors.get(aid);
            if (a) return a.img || a.prototypeToken?.texture?.src || FALLBACK_AVATAR;
            return portraitImages[id] || FALLBACK_AVATAR;
        }
        const t = canvas.tokens?.get(id);
        return t?.actor?.img || portraitImages[id] || FALLBACK_AVATAR;
    } catch { return portraitImages[id] || FALLBACK_AVATAR; }
}

// Groups presets by sceneName, sorted alphabetically with the "no scene" group last.
// Shared by VNPresetsManager and VNAdventureIOManager, whose scene-group rendering differs
// but whose grouping/sorting logic must not.
export function groupPresetsByScene(presets) {
    const groups = new Map();
    for (const p of presets) {
        const key = p.sceneName || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
    }
    const sortedKeys = [...groups.keys()].sort((a, b) => {
        if (!a) return 1;
        if (!b) return -1;
        return a.localeCompare(b);
    });
    return sortedKeys.map(key => ({ key, presets: groups.get(key) }));
}

// Renders the actor-avatar "pips" row (+N more) shown on poster-style preset cards.
// Emits the canonical .vn-preset-card-pip* classes — shared by the Presets and Adventure IO
// tabs' card views, which both mount inside a .vn-preset-card-poster container.
export function buildActorPipsHtml(ids, portraitImages = {}, portraitNames = {}, maxVisible = 4) {
    if (!ids.length) return '';
    const pips = ids.slice(0, maxVisible).map(id => {
        const src = resolveActorImg(id, portraitImages);
        const name = portraitNames[id] || '';
        return `<img class="vn-preset-card-pip" src="${src}" loading="lazy" decoding="async" alt="${name}" title="${name}">`;
    }).join('');
    const more = ids.length > maxVisible
        ? `<span class="vn-preset-card-pip vn-preset-card-pip--more">+${ids.length - maxVisible}</span>`
        : '';
    return `<div class="vn-preset-card-pips">${pips}${more}</div>`;
}
