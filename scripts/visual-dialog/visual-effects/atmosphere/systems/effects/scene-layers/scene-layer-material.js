const paintProperties = ['background-image', 'background-color', 'background-position', 'background-size',
    'background-repeat', 'background-origin', 'background-clip', 'background-blend-mode', 'border-radius',
    'box-shadow', 'color', 'font', 'letter-spacing', 'text-align', 'text-shadow', 'white-space'];

export const sourcePaintClass = 'vn-fx-sample-paint';
export function readSourcePaint(overlay, read) {
    if (overlay.classList.contains(sourcePaintClass)) return read();
    overlay.classList.add(sourcePaintClass);
    try { return read(); }
    finally { overlay.classList.remove(sourcePaintClass); }
}

const xml = value => value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
})[char]);

// Only authored scene-layer paints go into the texture. Scene art and video have their own upload path.
export async function bakeSceneMaterial(width, height, paint, label, resolution, padding = 0) {
    const w = Math.ceil((width + 2 * padding) * resolution);
    const h = Math.ceil((height + 2 * padding) * resolution);
    const declarations = Object.entries(paint).map(([key, value]) => `${key}:${value}`).join(';');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${width + 2 * padding} ${height + 2 * padding}">
        <foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"
        style="position:absolute;left:${padding}px;top:${padding}px;width:${width}px;height:${height}px;${xml(declarations)}">${xml(label)}</div></foreignObject></svg>`;
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    return image;
}

function splitImages(css) {
    // The commas in gradients, colors and data URLs are part of the image.
    const images = [];
    let depth = 0, quote = '', start = 0;
    for (let i = 0; i < css.length; i++) {
        const char = css[i];
        if (char === '\\') { i++; continue; }
        if (quote) { if (char === quote) quote = ''; }
        else if (char === '"' || char === "'") quote = char;
        else if (char === '(') depth++;
        else if (char === ')') depth--;
        else if (char === ',' && !depth) { images.push(css.slice(start, i).trim()); start = i + 1; }
    }
    images.push(css.slice(start).trim());
    return images;
}

const movingPaints = new Set(['vnHoloGrid', 'vnEtherealGrid', 'vnVhsTrackNoise', 'vnEtherealEdges', 'vnCosmicRippleExpand']);
const length = (value = '0', space) => parseFloat(value) * (value.endsWith('%') ? space / 100 : 1);
const component = (css, index) => {
    const values = css.split(/,\s*/);
    return values[index % values.length];
};

function motionMaterials(style, width, height, track) {
    const frames = track.effect.getKeyframes();
    const ripple = track.animationName === 'vnCosmicRippleExpand';
    const sizes = style.backgroundSize.split(', ');
    return splitImages(style.backgroundImage).flatMap((image, index) => {
        if (image === 'none') return [];
        const [w, h = w] = sizes[index % sizes.length].split(' ');
        const tileWidth = w === 'auto' ? width : length(w, width);
        const tileHeight = h === 'auto' ? height : length(h, height);
        const keys = frames.map(frame => {
            let x, y;
            if (ripple) {
                // The rings have pixel-sized stops. A larger CSS background moves their centre without scaling the rings.
                const [w, h] = frame.backgroundSize.split(' ');
                x = (length(w, width) - width) * 0.5;
                y = (length(h, height) - height) * 0.35;
            } else {
                const [px, py] = frame.backgroundPosition
                    ? component(frame.backgroundPosition, index).split(' ')
                    : [component(frame.backgroundPositionX, index), component(frame.backgroundPositionY, index)];
                x = length(px, width - tileWidth);
                y = length(py, height - tileHeight);
            }
            return { x, y, offset: frame.computedOffset, easing: frame.easing };
        });
        const maxX = Math.max(...keys.map(key => key.x)), maxY = Math.max(...keys.map(key => key.y));
        return [{
            width: width + maxX - Math.min(...keys.map(key => key.x)),
            height: height + maxY - Math.min(...keys.map(key => key.y)),
            paint: {
                'background-image': image,
                'background-size': ripple ? `${2 * width}px ${2 * height}px` : `${tileWidth}px ${tileHeight}px`,
                'background-position': ripple ? '0 0' : `${maxX}px ${maxY}px`
            },
            frames: keys.map(({ x, y, offset, easing }) => ({ translate: `${x - maxX}px ${y - maxY}px`, offset, easing }))
        }];
    });
}

export function sceneMaterial(element, style, width, height) {
    const labelStyle = style.getPropertyValue('--vn-fx-text');
    const label = labelStyle ? getComputedStyle(element, '::before').content.slice(1, -1) : '';
    const paint = Object.fromEntries(paintProperties.map(key => [key, style.getPropertyValue(key)]));
    if (label) paint['white-space'] = 'nowrap';
    paint['background-image'] = paint['background-image'].replace(/(-?[\d.]+)(vw|vh)\b/g, (_all, number, unit) =>
        `${Number(number) * (unit === 'vw' ? window.innerWidth : window.innerHeight) / 100}px`);
    if (paint['background-image'] === 'none' && paint['background-color'] === 'rgba(0, 0, 0, 0)'
        && paint['box-shadow'] === 'none' && !label) return null;
    const track = style.animationName.split(', ').some(name => movingPaints.has(name))
        ? element.getAnimations().find(animation => movingPaints.has(animation.animationName)) : undefined;
    const patterns = track ? motionMaterials(style, width, height, track) : [];
    if (patterns.length) {
        paint['background-image'] = 'none';
        paint['background-position'] = '0% 0%';
        paint['background-size'] = 'auto';
    }
    const padding = label ? 12 : 0;
    return { definition: { width, height, label, paint, patterns, padding }, track };
}
