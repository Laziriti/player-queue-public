/** Drops leading emoji from a label: effect names carry one, and the pickers already show a Font Awesome icon next to them. */
export function stripEmoji(text) {
    return String(text ?? '').replace(/^(?:\p{Extended_Pictographic}|️|‍|\s)+/u, '');
}

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
