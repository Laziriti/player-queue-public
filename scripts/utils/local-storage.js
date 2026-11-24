export function readLocalJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); }
    catch { return null; }
}

export function writeLocalJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* Local UI preferences are optional. */ }
}
