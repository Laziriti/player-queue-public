const plateSelector = '.vn-character-nameplate';
const geometrySelector = `.vn-side, .vn-character, .vn-row, .vn-orbit-stage, ${plateSelector}`;
const geometryProperties = new Set([
    'transform', 'translate', 'rotate', 'scale', 'width', 'max-width', 'height', 'max-height',
    'maxWidth', 'maxHeight', 'left', 'right', 'top', 'bottom', 'opacity',
]);

function plateBounds(plate, framed) {
    const rect = plate.getBoundingClientRect();
    if (!rect.width || !rect.height || Number(getComputedStyle(plate).opacity) === 0) return null;
    if (!framed) return rect;

    const frame = getComputedStyle(plate, '::before');
    const scaleX = rect.width / plate.offsetWidth, scaleY = rect.height / plate.offsetHeight;
    const halfWidth = (parseFloat(frame.width) || 0) * scaleX / 2;
    const halfHeight = (parseFloat(frame.height) || 0) * scaleY / 2;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2 + (parseFloat(frame.getPropertyValue('--np-offset-y')) || 0) * scaleY;
    return {
        left: Math.min(rect.left, cx - halfWidth), top: Math.min(rect.top, cy - halfHeight),
        right: Math.max(rect.right, cx + halfWidth), bottom: Math.max(rect.bottom, cy + halfHeight),
    };
}

function maskImage(container, plates) {
    const { left, top, width, height } = container.getBoundingClientRect();
    if (!width || !height || !plates.length) return '';
    const holes = plates.map(plate => {
        const x = Math.floor((plate.left - left) * 1000 / width) - 1;
        const y = Math.floor((plate.top - top) * 1000 / height) - 1;
        const right = Math.ceil((plate.right - left) * 1000 / width) + 1;
        const bottom = Math.ceil((plate.bottom - top) * 1000 / height) + 1;
        return `<rect x="${x}" y="${y}" width="${right - x}" height="${bottom - y}" fill="black"/>`;
    }).join('');
    const full = '<rect width="1000" height="1000" fill="white"';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"><mask id="plates">${full}/>${holes}</mask>${full} mask="url(#plates)"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Nameplates stay with their portraits for layout and transitions. Mask the foreground canvas over them. */
export function observeParticleNameplates(overlay, back, upper) {
    const containers = [back, upper].filter(Boolean);
    const abort = new AbortController();
    const { signal } = abort;
    const masks = new Map();
    const moving = new Set();
    let frame = null;
    let plates = [];
    const isGeometry = element => element === overlay || element.matches?.(geometrySelector);
    const schedule = () => { frame ??= requestAnimationFrame(sync); };

    function sync() {
        frame = null;
        const front = overlay.classList.contains('vn-particles-fg') ? back : upper;
        const framed = document.body.classList.contains('vn-nameplate-has-image');
        const bounds = front?.clientWidth ? plates.map(plate => plateBounds(plate, framed)).filter(Boolean) : [];
        for (const container of containers) {
            const mask = container === front ? maskImage(container, bounds) : '';
            if (masks.get(container) === mask) continue;
            masks.set(container, mask);
            container.style.maskImage = mask;
        }
        for (const animation of moving) {
            if (animation.playState !== 'running' && !animation.pending) moving.delete(animation);
        }
        if (front?.clientWidth && moving.size) schedule();
    }

    function watchMotion(element) {
        for (const animation of element.getAnimations()) {
            const movesPlate = animation.transitionProperty
                ? geometryProperties.has(animation.transitionProperty)
                : animation.effect.getKeyframes().some(key => Object.keys(key).some(prop => geometryProperties.has(prop)));
            if (movesPlate) moving.add(animation);
        }
        schedule();
    }

    const resize = new ResizeObserver(schedule);
    function watchPlates() {
        resize.disconnect();
        plates = [...overlay.querySelectorAll(plateSelector)];
        for (const element of [...containers, ...plates, ...overlay.querySelectorAll('.vn-side')]) resize.observe(element);
        schedule();
    }

    const mutations = new MutationObserver(records => {
        if (records.some(({ type, target, addedNodes, removedNodes }) => type === 'childList'
            && (isGeometry(target) || [...addedNodes, ...removedNodes].some(node => isGeometry(node) || node.querySelector?.(plateSelector))))) {
            watchPlates();
        } else if (records.some(({ target }) => isGeometry(target) || target === document.body)) schedule();
    });
    mutations.observe(overlay, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    mutations.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    for (const type of ['transitionrun', 'animationstart', 'transitionend', 'animationend', 'transitioncancel', 'animationcancel']) {
        overlay.addEventListener(type, ({ target }) => {
            if (isGeometry(target)) watchMotion(target);
        }, { signal });
    }
    watchPlates();
    for (const element of [overlay, ...overlay.querySelectorAll(geometrySelector)]) watchMotion(element);

    return {
        disconnect() {
            abort.abort();
            mutations.disconnect();
            resize.disconnect();
            cancelAnimationFrame(frame);
            for (const container of containers) container.style.removeProperty('mask-image');
        }
    };
}
