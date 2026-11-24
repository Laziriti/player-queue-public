/** Keep malformed percent escapes usable as literal filenames. */
export function decodePath(value) {
    const path = String(value ?? '');
    try { return decodeURIComponent(path); } catch { return path; }
}

/** A comparable Foundry Data-relative asset path; not a URL resolver. */
export function normalizeAssetPath(value) {
    return decodePath(value).replace(/^\//, '').replace(/\\/g, '/');
}

export function cssUrl(path) {
    const escaped = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return 'url("' + escaped + '")';
}
