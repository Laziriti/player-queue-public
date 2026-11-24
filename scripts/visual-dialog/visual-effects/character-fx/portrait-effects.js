import { motionPadding, portraitPose } from './portrait-motion.js';
import { seededRandom } from '../../../utils/seeded-random.js';
import { MODULE_ID } from '../../vn-constants.js';
import { mediaExtension } from '../../media/vn-media-utils.js';

const portraits = new Map();
const MAX_BITMAP_PIXELS = 2048 * 2048;
const PHASE_SPREAD_SECONDS = 12;
let rendererRequest;
let rendererIdle;
let removals;
let reducedMotion;
let frame;
let randomizePhases;

export function ensurePortraitLayer(character) {
    let layer = character.querySelector(':scope > .vn-character-fx');
    if (layer) return layer;
    const img = character.querySelector(':scope > img.vn-character-img');
    if (!img) return null;
    layer = document.createElement('div');
    layer.className = 'vn-character-fx';
    img.before(layer);
    layer.append(img);
    return layer;
}

export function startPortraitMotion(character, type, duration) {
    // Hidden characters use the original silhouette (never a material texture).
    if (!character.isConnected || character.classList.contains('vn-character-hidden') || character.closest('.vn-lite')) return;
    const source = character.querySelector('img.vn-character-img');
    if (!source) return;
    // Keep the browser's own playback for frame-based formats.
    if (['gif', 'apng'].includes(mediaExtension(source.src)) || /^data:image\/(?:gif|apng)[;,]/i.test(source.src)) return;
    const layer = ensurePortraitLayer(character);
    if (!layer) return;
    if (!portraits.has(layer)) applyPortraitEffect(layer, source, null, null);
    const entry = portraits.get(layer);
    if (entry.status === 'failed') return;
    entry.transition = { type, duration, start: performance.now() };
    if (type !== 'exit') layer.dataset.portraitPending = '';
    entry.dirty = true;
    requestFrame();
}

export function stopPortraitMotion(character) {
    const layer = character.querySelector(':scope > .vn-character-fx');
    const entry = portraits.get(layer);
    if (!entry?.transition) return;
    delete entry.transition;
    delete layer.dataset.portraitPending;
    if (!entry.base) removePortrait(layer);
    else {
        entry.dirty = true;
        requestFrame();
    }
}

export function applyPortraitEffect(layer, img, base, variant) {
    const url = img.src;
    const previous = portraits.get(layer);
    if (previous?.url === url && previous.base === base && previous.variant === variant && previous.img === img) return;
    const character = layer.parentElement;
    const tokenId = character.dataset.tokenId;
    // Duplicate cast entries can share an image but have different token IDs.
    const phase = base && tokenId ? seededRandom(`portrait-timing|${tokenId}`)() * PHASE_SPREAD_SECONDS : 0;
    if (base) randomizePhases ??= game.settings.get(MODULE_ID, 'randomizePortraitFxPhase') ?? true;
    const entry = { layer, img, url, base, variant, character, overlay: character.closest('#vn-scene-overlay'),
        phase, transition: previous?.transition };
    portraits.set(layer, entry);
    if (previous) dispose(previous);
    if (entry.transition && entry.transition.type !== 'exit') layer.dataset.portraitPending = '';

    if (!removals) {
        removals = new MutationObserver(records => {
            if (!records.some(record => record.removedNodes.length)) return;
            for (const { layer, img } of portraits.values()) {
                if (!layer.isConnected || img.parentElement !== layer) removePortrait(layer);
            }
        });
        removals.observe(document.body, { childList: true, subtree: true });
        reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
        reducedMotion.addEventListener('change', invalidate);
        window.addEventListener('resize', invalidate);
    }
    entry.resize = new ResizeObserver(([{ contentRect }]) => {
        entry.width = contentRect.width;
        entry.height = contentRect.height;
        entry.dirty = true;
        requestFrame();
    });
    entry.resize.observe(img);
    entry.changes = new MutationObserver(() => {
        if (img.src !== url) applyPortraitEffect(layer, img, base, variant);
        else {
            if (character.classList.contains('vn-character-hidden')) entry.lastDraw = null;
            entry.dirty = true;
            requestFrame();
        }
    });
    // A staggered entrance can reveal a portrait through its inline visibility alone.
    entry.changes.observe(entry.character, { attributeFilter: base === 'living_engraving' ? ['class', 'style'] : ['class'] });
    entry.changes.observe(img, { attributeFilter: ['src'] });
    if (base === 'vhs' && entry.overlay) entry.changes.observe(entry.overlay, { attributeFilter: ['class'] });
}

export function clearPortraitEffect(layer) {
    if (portraits.get(layer)?.base) removePortrait(layer);
}

export function setPortraitFxPhaseRandomization(enabled) {
    randomizePhases = enabled;
    invalidate();
}

function removePortrait(layer) {
    const entry = portraits.get(layer);
    if (!entry) return;
    portraits.delete(layer);
    dispose(entry);
    releaseUnusedRenderer(entry.transition || !entry.base ? 250 : 0);
    if (portraits.size) return;
    removals.disconnect();
    removals = null;
    reducedMotion.removeEventListener('change', invalidate);
    window.removeEventListener('resize', invalidate);
    cancelAnimationFrame(frame);
    frame = null;
}

function dispose(entry) {
    entry.resize.disconnect();
    entry.changes.disconnect();
    clearDrawing(entry);
}

function clearDrawing(entry) {
    delete entry.layer.dataset.portraitPending;
    delete entry.layer.dataset.portraitReady;
    delete entry.layer.dataset.glassReady;
    entry.carrier?.remove();
    entry.effect?.destroy();
    entry.carrier = entry.canvas = entry.target = entry.effect = entry.renderer = null;
}

function getRenderer() {
    clearTimeout(rendererIdle);
    if (rendererRequest) return rendererRequest.promise;
    const request = rendererRequest = {};
    request.promise = import('./portrait-surface.js').then(({ PortraitRenderer }) =>
        PortraitRenderer.create(() => {
            if (rendererRequest !== request) return;
            console.error('VN: Pixi portrait WebGL context lost');
            for (const entry of portraits.values()) {
                if (entry.status !== 'loading' && entry.status !== 'ready') continue;
                clearDrawing(entry);
                entry.status = 'failed';
            }
            releaseRenderer();
        }));
    return request.promise;
}

function releaseRenderer() {
    clearTimeout(rendererIdle);
    const previous = rendererRequest;
    rendererRequest = null;
    previous?.promise.then(renderer => renderer.destroy(), () => {});
}

function isCurrent(entry) {
    return portraits.get(entry.layer) === entry && entry.layer.isConnected
        && entry.img.parentElement === entry.layer && entry.img.src === entry.url;
}

async function load(entry) {
    try {
        entry.status = 'loading';
        let image = entry.img;
        const imageUrl = new URL(entry.url);
        if ((imageUrl.protocol === 'https:' || imageUrl.protocol === 'http:') && imageUrl.origin !== location.origin && image.crossOrigin === null) {
            image = new Image();
            image.crossOrigin = 'anonymous';
            image.src = entry.url;
        }
        await image.decode();
        if (!isCurrent(entry)) return;
        const glass = entry.base === 'glass';
        const api = !entry.base ? await import('./portrait-surface.js')
            : glass ? await import('./glass-portrait-mesh.js') : await import('./portrait-mesh.js');
        if (!isCurrent(entry)) return;
        const renderer = await getRenderer();
        if (!isCurrent(entry) || entry.status !== 'loading') return;
        const carrier = document.createElement('div');
        carrier.className = 'vn-character-img vn-fx-portrait' + (glass ? ' vn-fx-glass-portrait' : '');
        if (!entry.base) carrier.classList.add('vn-fx-portrait-plain');
        carrier.setAttribute('aria-hidden', 'true');
        const canvas = document.createElement('canvas');
        const target = canvas.getContext('bitmaprenderer');
        if (!target) throw new Error('Bitmap renderer unavailable for portrait effects');
        carrier.append(canvas);
        entry.carrier = carrier;
        entry.canvas = canvas;
        entry.target = target;
        const { url, base, variant } = entry;
        if (!base) entry.effect = new api.PlainPortrait(image);
        else if (glass) entry.effect = new api.GlassPortraitMesh(image, variant ? `${url}|${variant}` : url, variant);
        else entry.effect = new api.PortraitMesh(image, url, base, variant);
        entry.renderer = renderer;
        entry.dirty = true;
        entry.status = 'ready';
        requestFrame();
    } catch (error) {
        if (isCurrent(entry)) fail(entry, error);
    }
}

function fail(entry, error) {
    console.error('VN: Pixi portrait rendering failed', error);
    entry.status = 'failed';
    clearDrawing(entry);
    releaseUnusedRenderer();
}

function releaseUnusedRenderer(delay = 0) {
    if ([...portraits.values()].some(e => e.status === 'loading' || e.status === 'ready')) return;
    // The outgoing cast may be removed a frame before the incoming cast starts.
    if (delay && rendererRequest) {
        clearTimeout(rendererIdle);
        rendererIdle = setTimeout(() => releaseUnusedRenderer(), delay);
    } else releaseRenderer();
}

function needsFrame(entry) {
    return entry.width && entry.height && !entry.character.classList.contains('vn-character-hidden')
        && (entry.status === undefined || (entry.status === 'ready'
            && (entry.base !== 'living_engraving' || entry.character.style.visibility !== 'hidden')
            && (entry.dirty || (entry.transition && !entry.transition.done)
                || (!reducedMotion.matches && entry.effect.animated !== false))));
}

function invalidate() {
    for (const entry of portraits.values()) entry.dirty = true;
    requestFrame();
}

function requestFrame() {
    if (frame != null || ![...portraits.values()].some(needsFrame)) return;
    frame = requestAnimationFrame(render);
}

function render(now) {
    frame = null;
    for (const entry of portraits.values()) {
        if (!isCurrent(entry) || !needsFrame(entry)) continue;
        if (entry.status === undefined) {
            void load(entry);
            continue;
        }
        try { draw(entry, now); }
        catch (error) { fail(entry, error); }
    }
    requestFrame();
}

function draw(entry, now) {
    const { effect, renderer, width, height, target, carrier, canvas, character } = entry;
    // Material effects with slow motion can reuse a bitmap between updates.
    const transition = entry.transition;
    if (!transition && !entry.dirty && now - entry.lastDraw < (effect.frameInterval ?? 0)) return;
    const active = character.classList.contains('active');
    const motion = !reducedMotion.matches;
    const entering = character.classList.contains('vn-entering');
    const transitioning = entering || character.classList.contains('vn-exiting');
    const lite = entry.overlay?.classList.contains('vn-lite') ?? false;
    const [padX, padY, padBottom = padY] = effect.padding(width, height);
    const surfaceWidth = Math.ceil(width + 2 * padX);
    const surfaceHeight = Math.ceil(height + padY + padBottom);
    const [motionX, motionY, motionBottom] = transition ? motionPadding(transition.type, surfaceWidth, surfaceHeight) : [0, 0, 0];
    const outputWidth = surfaceWidth + 2 * motionX;
    const outputHeight = surfaceHeight + motionY + motionBottom;
    // Tall padded effects can use a longer bitmap within the same pixel budget.
    const resolution = Math.min(devicePixelRatio, 2, renderer.maxBitmapEdge / Math.max(outputWidth, outputHeight),
        Math.sqrt(MAX_BITMAP_PIXELS / (outputWidth * outputHeight)));
    const resized = entry.drawnWidth !== width || entry.drawnHeight !== height || entry.resolution !== resolution
        || entry.padX !== padX || entry.padY !== padY || entry.padBottom !== padBottom;
    if (motion && entry.lastDraw != null) entry.seconds += Math.min(now - entry.lastDraw, 100) / 1000;
    entry.seconds ??= 0;
    entry.lastDraw = motion ? now : null;
    const seconds = motion ? entry.seconds + (randomizePhases ? entry.phase : 0) : 0;
    const repaint = effect.update({ seconds, motion, active, entering, transitioning, lite,
        width, height, padX, padY, now, viewportWidth: window.innerWidth, dirty: entry.dirty || resized });
    entry.dirty = false;
    if (!repaint && (!transition || transition.done)) return;
    if (resized) {
        entry.drawnWidth = width;
        entry.drawnHeight = height;
        entry.resolution = resolution;
        entry.padX = padX;
        entry.padY = padY;
        entry.padBottom = padBottom;
        effect.resize({ width, height, padX, padY, resolution,
            scaleX: Math.round(surfaceWidth * resolution) / surfaceWidth,
            scaleY: Math.round(surfaceHeight * resolution) / surfaceHeight });
    }
    let pose;
    if (transition) {
        const progress = Math.min(1, Math.max(0, (now - transition.start) / transition.duration));
        const flip = (character.style.getPropertyValue('--flip-x') || entry.img.style.getPropertyValue('--flip-x')) === '-1' ? -1 : 1;
        pose = { ...portraitPose(transition.type, progress, active, flip),
            padX: motionX, padY: motionY, padBottom: motionBottom, pivotX: padX + width / 2, pivotY: padY + height };
        transition.done = progress === 1;
    }
    const output = `${padX + motionX},${padY + motionY},${outputWidth},${outputHeight},${resolution}`;
    if (entry.output !== output) {
        entry.output = output;
        canvas.width = Math.round(outputWidth * resolution);
        canvas.height = Math.round(outputHeight * resolution);
        carrier.style.setProperty('--portrait-pad-x', `${padX + motionX}px`);
        carrier.style.setProperty('--portrait-pad-y', `${padY + motionY}px`);
        carrier.style.setProperty('--portrait-surface-w', `${outputWidth}px`);
        carrier.style.setProperty('--portrait-surface-h', `${outputHeight}px`);
    }
    renderer.draw(effect, target, surfaceWidth, surfaceHeight, resolution, resized, pose);
    carrier.toggleAttribute('data-portrait-motion', !!pose);
    delete entry.layer.dataset.portraitPending;
    if (!carrier.isConnected) {
        entry.layer.append(carrier);
        entry.layer.dataset.portraitReady = '';
        if (entry.base === 'glass') entry.layer.dataset.glassReady = '';
        // Align idle CSS motion on the bitmap with the original image.
        if (!entry.carrier.classList.contains('vn-fx-glass-portrait') || transitioning) {
            const original = entry.img.getAnimations();
            for (const animation of carrier.getAnimations()) {
                const source = original.find(a => a.animationName && a.animationName === animation.animationName);
                if (source?.startTime != null) animation.startTime = source.startTime;
            }
        }
    }
}
