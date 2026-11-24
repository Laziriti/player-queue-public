import { VNCharFx } from '../visual-effects/character-fx/vn-character-fx.js';
import { fitNameplate } from './vn-nameplate.js';

function applyVisibility(portrait, visibility = 'visible') {
    portrait.classList.toggle('vn-character-hidden', visibility === 'hidden');
    portrait.classList.toggle('vn-character-name-hidden', visibility === 'name-hidden');
    const known = visibility === 'visible';
    const name = portrait.dataset.name || '';
    const label = portrait.querySelector('.vn-nameplate-text');
    if (label) {
        label.textContent = known ? name : '???';
        fitNameplate(label);
    }
    if (known) portrait.title = name;
    else portrait.removeAttribute('title');
    const image = portrait.querySelector('.vn-character-img');
    if (image) image.alt = known ? name : '';
}

export class VNScenePortraits {
    constructor(state, getOverlay) {
        this.state = state;
        this.getOverlay = getOverlay;
    }

    applyTransforms() {
        document.documentElement.style.setProperty('--portrait-scale', this.state.portraitScale);
        for (const portrait of this.#portraits()) {
            const id = portrait.dataset.tokenId;
            // Keep the outgoing actor's appearance until its exit animation finishes.
            if (!this.state.hasToken(id)) continue;
            const flip = this.state.flipped[id] ? '-1' : '1';
            portrait.querySelector('.vn-character-img')?.style.setProperty('--flip-x', flip);
            portrait.style.setProperty('--flip-x', flip);
            const scale = this.state.portraitScales[id];
            if (scale === undefined) portrait.style.removeProperty('--char-scale');
            else portrait.style.setProperty('--char-scale', scale);
        }
    }

    applyScale(tokenId, scale) {
        this.#portrait(tokenId)?.style.setProperty('--char-scale', scale);
    }

    applyEffects() {
        for (const portrait of this.#portraits()) {
            const id = portrait.dataset.tokenId;
            if (this.state.hasToken(id)) VNCharFx.apply(portrait, this.state.charFx[id]);
        }
    }

    applyVisibility(tokenId) {
        const portrait = this.#portrait(tokenId);
        if (portrait) applyVisibility(portrait, this.state.visibility[tokenId] ?? 'visible');
    }

    applyAllVisibility() {
        for (const portrait of this.#portraits()) {
            applyVisibility(portrait, this.state.visibility[portrait.dataset.tokenId] ?? 'visible');
        }
    }

    #portraits() {
        return this.getOverlay()?.querySelectorAll('.vn-character') ?? [];
    }

    #portrait(tokenId) {
        return this.getOverlay()?.querySelector(`.vn-character[data-token-id="${CSS.escape(tokenId)}"]`);
    }
}
