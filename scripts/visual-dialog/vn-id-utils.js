// ============================================================
// vn-id-utils.js — shared ID parsing for actor-/# conventions
// ============================================================

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
