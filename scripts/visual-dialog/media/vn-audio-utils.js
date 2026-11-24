export function parsePlaylistUuid(uuid) {
    try {
        const parts = uuid.split('.');
        if (parts.length !== 4 || parts[0] !== 'Playlist' || parts[2] !== 'PlaylistSound') return null;
        const playlist = game.playlists.get(parts[1]);
        const sound = playlist?.sounds.get(parts[3]) ?? null;
        return sound ? { playlist, sound } : null;
    } catch { return null; }
}
