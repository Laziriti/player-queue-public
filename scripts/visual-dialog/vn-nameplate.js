// ============================================================
// vn-nameplate.js — name plates of the VN overlay: frame images (world setting nameplateImage) and fitting names into them
// ============================================================

// Per-image display parameters. Add an entry for each new nameplate image; without one the defaults below apply.
// The frame's aspect ratio is read from the image itself (applyNameplateImage), never configured.
// textWidth: fixed width of the text element in px (the plate is always this wide) — ~90% of the frame's dark inner panel
//            (the inner panel is ~80–86% of the image width; frame width = textWidth + 2 × paddingX ≈ 380px)
// paddingX:  how far the frame extends beyond the text element on each side (px)
// offsetY:   vertical shift of the frame from the text centre in px (positive = frame shifts down); the inner panel is
//            usually a little below the image centre, so this is a small negative number
// fontSize:  text font size (any CSS value)
const NAMEPLATE_CONFIGS = {
    'modules/player-queue/assets/dialog name labels/name_label_drakkenheim.webp': {
        label:     'Drakkenheim',
        textWidth: 290,
        paddingX:  45,
        offsetY:   -2,
        fontSize:  '1.2em',
    },
    'modules/player-queue/assets/dialog name labels/name_label_dark_fantasy.webp': {
        label:     'Dark Fantasy',
        textWidth: 290,
        paddingX:  45,
        offsetY:   -2,
        fontSize:  '1.2em',
    },
    'modules/player-queue/assets/dialog name labels/name_label_knight.webp': {
        label:     'Knight',
        textWidth: 270,
        paddingX:  55,
        offsetY:   -2,
        fontSize:  '1.2em',
    },
    'modules/player-queue/assets/dialog name labels/name_label_strahd.webp': {
        label:     'Curse of Strahd',
        textWidth: 294,
        paddingX:  43,
        offsetY:   0,
        fontSize:  '1.2em',
    },
};

// Fonts of the name on the plate (world setting nameplateFont). Files and @font-face: assets/fonts/, styles/visual-dialog/vn-nameplate-fonts.css
// (every font is SIL OFL, has Cyrillic + Latin; the CSS family is "PQ <label>"). Add a font: files + @font-face + an entry here.
// weight: the one weight that is shipped (the plate uses it for both active and inactive names, no synthetic bold)
// scale:  font-size multiplier — typefaces differ in x-height, so the same 1.2em looks tiny in one and huge in another
// spacing: letter-spacing
const NAMEPLATE_FONTS = {
    cormorant:        { label: 'Cormorant',        generic: 'serif',      weight: 700, scale: 1.25, spacing: '0.8px' },
    forum:            { label: 'Forum',            generic: 'serif',      weight: 400, scale: 1.1,  spacing: '1px' },
    philosopher:      { label: 'Philosopher',      generic: 'sans-serif', weight: 700, scale: 1.05, spacing: '0.6px' },
    alice:            { label: 'Alice',            generic: 'serif',      weight: 400, scale: 1.1,  spacing: '0.6px' },
    kurale:           { label: 'Kurale',           generic: 'serif',      weight: 400, scale: 1.05, spacing: '0.6px' },
    ruslan_display:   { label: 'Ruslan Display',   generic: 'serif',      weight: 400, scale: 1.1,  spacing: '0.8px' },
    yeseva_one:       { label: 'Yeseva One',       generic: 'serif',      weight: 400, scale: 1,    spacing: '0.6px' },
    playfair_display: { label: 'Playfair Display', generic: 'serif',      weight: 700, scale: 1,    spacing: '0.4px' },
    marck_script:     { label: 'Marck Script',     generic: 'cursive',    weight: 400, scale: 1.15, spacing: '0.5px' },
    lobster:          { label: 'Lobster',          generic: 'cursive',    weight: 400, scale: 1.05, spacing: '0.5px' },
    caveat:           { label: 'Caveat',           generic: 'cursive',    weight: 700, scale: 1.35, spacing: '0.5px' },
    amatic_sc:        { label: 'Amatic SC',        generic: 'cursive',    weight: 700, scale: 1.5,  spacing: '1px' },
    oswald:           { label: 'Oswald',           generic: 'sans-serif', weight: 600, scale: 1,    spacing: '1px' },
    exo_2:            { label: 'Exo 2',            generic: 'sans-serif', weight: 600, scale: 1,    spacing: '0.8px' },
    jura:             { label: 'Jura',             generic: 'sans-serif', weight: 700, scale: 1.05, spacing: '0.8px' },
    russo_one:        { label: 'Russo One',        generic: 'sans-serif', weight: 400, scale: 0.95, spacing: '0.6px' },
    press_start_2p:   { label: 'Press Start 2P',   generic: 'monospace',  weight: 400, scale: 0.6,  spacing: '0' },
};

const DEFAULT_RATIO = 3;
const FIT_MIN = 0.75;
let applyToken = 0;

function escapeCSSUrl(url) {
    return url.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]/g, '');
}

/** Shrinks the font of one plate (--np-fit, down to FIT_MIN) until the name fits its width; what still does not fit gets an ellipsis. */
function fitNameplate(el) {
    // Without this the font-size would transition and scrollWidth would be measured at the start value
    el.style.transition = 'none';
    el.style.removeProperty('--np-fit');
    let fit = 1;
    for (let i = 0; i < 4 && el.scrollWidth > el.clientWidth && fit > FIT_MIN; i++) {
        fit = Math.max(FIT_MIN, fit * (el.clientWidth / el.scrollWidth) * 0.98);
        el.style.setProperty('--np-fit', fit.toFixed(3));
    }
    el.style.removeProperty('transition');
}

function fitNameplates(root = document) {
    root.querySelectorAll('.vn-nameplate-text').forEach(fitNameplate);
}

function applyNameplateImage(path) {
    const token = ++applyToken;
    const root = document.documentElement;
    const PROPS = ['--vn-nameplate-image', '--vn-nameplate-ratio', '--np-text-width', '--np-padding-x', '--np-offset-y', '--np-font-size'];
    const plain = () => {
        PROPS.forEach(p => root.style.removeProperty(p));
        document.body.classList.remove('vn-nameplate-has-image');
        fitNameplates();
    };

    document.body.classList.remove('vn-nameplate-hidden');
    if (path === '__hidden__') {
        plain();
        document.body.classList.add('vn-nameplate-hidden');
    } else if (path) {
        // CSS url() in a stylesheet resolves relative to the .css file — prepend / to make absolute
        const url = /^https?:\/\/|^\//.test(path) ? path : '/' + path;
        const normPath = p => decodeURIComponent(p).replace(/^\//, '').replace(/\\/g, '/');
        const cfg = NAMEPLATE_CONFIGS[path] || NAMEPLATE_CONFIGS[normPath(path)] || {};
        // The frame is shown only once its proportions are known, otherwise it would flash stretched
        const probe = new Image();
        probe.onload = () => {
            if (token !== applyToken) return;
            const ratio = probe.naturalWidth && probe.naturalHeight ? probe.naturalWidth / probe.naturalHeight : DEFAULT_RATIO;
            root.style.setProperty('--vn-nameplate-image', `url("${escapeCSSUrl(url)}")`);
            root.style.setProperty('--vn-nameplate-ratio', ratio);
            root.style.setProperty('--np-text-width', `${cfg.textWidth ?? 290}px`);
            root.style.setProperty('--np-padding-x', `${cfg.paddingX ?? 0}px`);
            root.style.setProperty('--np-offset-y', `${cfg.offsetY ?? 0}px`);
            root.style.setProperty('--np-font-size', cfg.fontSize ?? '0.9em');
            document.body.classList.add('vn-nameplate-has-image');
            fitNameplates();
        };
        probe.onerror = () => { if (token === applyToken) plain(); };
        probe.src = url;
    } else {
        plain();
    }
}

/** CSS font-family value of a registry font (for the plate itself and for previews in the settings). */
function nameplateFontFamily(key) {
    const cfg = NAMEPLATE_FONTS[key];
    return cfg ? `"PQ ${cfg.label}", ${cfg.generic}` : '';
}

/** Sets the font of every name plate. Unknown key / empty = the theme's own font. */
function applyNameplateFont(key) {
    const root = document.documentElement;
    const cfg = NAMEPLATE_FONTS[key];
    const PROPS = ['--np-font-family', '--np-font-weight', '--np-font-scale', '--np-letter-spacing'];
    if (!cfg) {
        PROPS.forEach(p => root.style.removeProperty(p));
        document.body.classList.remove('vn-nameplate-font');
        fitNameplates();
        return;
    }
    const family = nameplateFontFamily(key);
    root.style.setProperty('--np-font-family', family);
    root.style.setProperty('--np-font-weight', cfg.weight);
    root.style.setProperty('--np-font-scale', cfg.scale);
    root.style.setProperty('--np-letter-spacing', cfg.spacing);
    document.body.classList.add('vn-nameplate-font');
    fitNameplates();
    // Name widths are those of the fallback font until the file arrives: fit again then. The sample covers both subsets (latin, cyrillic).
    document.fonts?.load(`${cfg.weight} 1em ${family}`, 'AaЯя')
        .then(() => { if (document.body.classList.contains('vn-nameplate-font')) fitNameplates(); })
        .catch(() => {});
}

export { NAMEPLATE_CONFIGS, NAMEPLATE_FONTS, applyNameplateImage, applyNameplateFont, nameplateFontFamily, fitNameplate, fitNameplates };
