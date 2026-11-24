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
