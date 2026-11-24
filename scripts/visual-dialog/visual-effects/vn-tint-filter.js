const LUMA = [0.2126, 0.7152, 0.0722];

// Blend the scene layers with a tint scaled by luminance. Leave alpha untouched.
export function sceneTintFilter(color, strength) {
    if (!strength) return '';
    const amount = strength / 100;
    const matrix = [1, 3, 5].flatMap((offset, channel) => {
        const component = parseInt(color.slice(offset, offset + 2), 16) / 255;
        return [...LUMA.map((weight, i) => amount * weight * component + (i === channel ? 1 - amount : 0)), 0, 0];
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="tint" color-interpolation-filters="sRGB"><feColorMatrix values="${matrix.join(' ')} 0 0 0 1 0"/></filter></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}#tint")`;
}
