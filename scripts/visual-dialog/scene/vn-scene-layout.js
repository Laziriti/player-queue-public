// Applies scene layout data and renders its transitions; sockets/audio remain with the scene coordinator.
import { VNSceneState } from './vn-scene-state.js';
import { CAST_FIELDS, LAYOUT_FIELDS, VISUAL_SETTINGS_DEFAULTS, readScenePatch } from './vn-scene-contract.js';
import { VNTransitions } from '../visual-effects/vn-transitions.js';
import { VNPreloader } from '../media/vn-preload.js';
import { fitNameplates } from '../overlay/vn-nameplate.js';
import { particleMotion } from '../visual-effects/atmosphere/config/particle-effect-settings.js';

export function particleSettingsChanges(previous, state) {
    const changed = key => previous[key] !== state[key];
    return {
        intensityChanged: changed('particleIntensity'), depthChanged: changed('particleDepth'),
        windChanged: changed('particleWind'), gustsChanged: changed('particleGusts'),
        wrapChanged: changed('particleWrap'), tempoChanged: changed('particleTempo'),
        motionChanged: particleMotion(state.particleEffect, previous.particleEffectSettings)
            !== particleMotion(state.particleEffect, state.particleEffectSettings),
        appearanceChanged: changed('particleScale') || changed('particleOpacity')
            || changed('particleTintColor') || changed('particleTintStrength') || changed('particleSolidTexture'),
        layerChanged: changed('particlesLayer'),
        mixChanged: (previous.particlesLayer === 'mix') !== (state.particlesLayer === 'mix'),
    };
}

/** Apply layout fields only. Omitted fields retain the existing update semantics (cast defaults to empty). */
export function applySceneLayoutPayload(state, payload, normalizePortraitMap = values => ({ ...values })) {
    const patch = readScenePatch(payload);
    const previous = { ...state };
    const prevCast = CAST_FIELDS.map(key => JSON.stringify(state[key]));
    for (const key of LAYOUT_FIELDS) {
        if (Object.hasOwn(patch, key)) state[key] = patch[key];
    }
    for (const key of ['flipped', 'portraitScales']) {
        if (Object.hasOwn(patch, key)) state[key] = normalizePortraitMap(patch[key]);
    }
    const changed = key => previous[key] !== state[key];
    return {
        speakersAfter: { ...state.speakers },
        castChanged: CAST_FIELDS.some((key, i) => JSON.stringify(state[key]) !== prevCast[i]),
        bgChanged: !!(previous.background && changed('background')),
        particleChanged: changed('particleEffect'), visualChanged: changed('visualEffect'),
        ...particleSettingsChanges(previous, state),
        angleChanged: changed('visualAngle'),
        visualAppearanceChanged: Object.keys(VISUAL_SETTINGS_DEFAULTS).some(key => key !== 'visualAngle' && changed(key)),
        newLayer: state.particlesLayer,
    };
}


export class VNSceneLayout {
    constructor({ state, getOverlay, html, resolveTokens, atmosphere, background, effectsUI,
        particleLook, applyLayerUI, applyCharFx, settlePortraits, applyCaption }) {
        Object.assign(this, { state, getOverlay, html, resolveTokens, atmosphere, background, effectsUI,
            particleLook, applyLayerUI, applyCharFx, settlePortraits, applyCaption });
        this._revision = 0;
        this._entrances = new Map();
    }

    invalidate(reset = false) {
        if (reset) this._pendingChanges = null;
        this._revision++;
        VNTransitions.cancel(this.getOverlay()?.[0]);
        clearTimeout(this._quickTransitionTimer);
        this.getOverlay()?.[0]?.classList.remove('vn-tr-live');
        for (const [id, el] of this._entrances) {
            clearTimeout(id);
            el.style.visibility = '';
        }
        this._entrances.clear();
        return this._revision;
    }

    // Carry unfinished changes into the next update: state may have advanced before its DOM did.
    prepare(changes) {
        const next = { ...changes };
        for (const [key, value] of Object.entries(this._pendingChanges ?? {})) {
            if (typeof value === 'boolean') next[key] ||= value;
        }
        this._pendingChanges = next;
        return next;
    }

    isCurrent(revision) { return revision === this._revision && this.state.isActive; }

    /** Shortens the speaker-highlight / glow / nameplate / effect-layer CSS transitions while a scene change plays out. */
    _beginQuickTransition(timing) {
        const overlay = this.getOverlay()?.[0];
        if (!overlay) return;
        overlay.style.setProperty('--vn-tr-live', `${timing.exit}ms`);
        overlay.style.setProperty('--vn-tr-fx', `${Math.min(220, Math.max(100, Math.round(timing.bg * 0.25)))}ms`);
        overlay.classList.add('vn-tr-live');
        clearTimeout(this._quickTransitionTimer);
        this._quickTransitionTimer = setTimeout(
            () => overlay.classList.remove('vn-tr-live'),
            timing.bg + timing.exit + timing.enter + 600
        );
    }

    async _updateSide(ids, sideSelector, position, queueData, timing, revision = this._revision) {
        const entrance = this.state.characterEntrance;
        const animateEntrance = entrance !== 'none' && timing.enter > 0;
        const tokens = this.resolveTokens(ids, this.state.portraitImages, this.state.portraitNames);
        const container = this.getOverlay()?.[0]?.querySelector(`.vn-side${sideSelector}`);
        if (!container) return;

        const { useMultiRow } = this.html.computeRowLayout(ids.length, position);
        container.classList.toggle('vn-multi-row', useMultiRow);

        const oldChars = container.querySelectorAll('.vn-character');
        const oldIds = Array.from(oldChars).map(el => el.dataset.tokenId);
        const newIds = tokens.map(t => t.id || `actor-${t.actor.id}`);

        // A newer update may retain a portrait whose exit animation was already started.
        for (const el of oldChars) {
            if (newIds.includes(el.dataset.tokenId) && el.classList.contains('vn-exiting')) {
                VNTransitions.enterCharacter(el, 'none');
            }
        }
        if (oldIds.length === newIds.length && oldIds.every((id, i) => id === newIds[i])) return;

        const oldIdSet = new Set(oldIds);
        const newIdSet = new Set(newIds);
        const removingEls = Array.from(oldChars).filter(el => !newIdSet.has(el.dataset.tokenId));
        const addingIds = new Set(newIds.filter(id => !oldIdSet.has(id)));

        if (removingEls.length) await Promise.all(removingEls.map(el => VNTransitions.exitCharacter(el, timing.exit)));
        if (!this.isCurrent(revision)) return;

        if (tokens.length) {
            // Characters that stay are moved into the new markup instead of being re-created: a rebuilt portrait
            // flickers while its image decodes and restarts its highlight transition (a speaker who stayed would
            // dim and then brighten again). Read after the exit await: another update may have run meanwhile.
            const staying = new Map(Array.from(container.querySelectorAll('.vn-character'))
                .filter(el => newIdSet.has(el.dataset.tokenId))
                .map(el => [el.dataset.tokenId, el]));
            const fresh = document.createElement('div');
            fresh.innerHTML = this.html.sideCharacters(tokens, position, queueData);
            for (const newEl of fresh.querySelectorAll('.vn-character')) {
                const kept = staying.get(newEl.dataset.tokenId);
                if (!kept) continue;
                for (const rowClass of ['vn-row-front', 'vn-row-back']) kept.classList.toggle(rowClass, newEl.classList.contains(rowClass));
                newEl.replaceWith(kept);
            }
            container.replaceChildren(...fresh.childNodes);
            container.classList.remove('empty');
            fitNameplates(container);

            const activeSpeaker = this.state.speakers[position];
            container.querySelectorAll('.vn-character').forEach(charEl => {
                const tid = charEl.dataset.tokenId;
                const img = charEl.querySelector('.vn-character-img');
                if (img) img.style.setProperty('--flip-x', this.state.flipped[tid] ? '-1' : '1');
                if (addingIds.has(tid) && animateEntrance) charEl.style.visibility = 'hidden';
            });
            // Force reflow so the browser registers initial CSS state before .active
            // is applied — without this, transitions don't play on freshly inserted elements
            container.offsetHeight;
            if (activeSpeaker) {
                container.querySelector(`.vn-character[data-token-id="${activeSpeaker}"]`)
                    ?.classList.add('active');
            }

            let idx = 0;
            container.querySelectorAll('.vn-character').forEach(charEl => {
                if (addingIds.has(charEl.dataset.tokenId)) {
                    if (animateEntrance) {
                        const id = setTimeout(() => {
                            this._entrances.delete(id);
                            if (this.isCurrent(revision) && charEl.isConnected) VNTransitions.enterCharacter(charEl, entrance, timing.enter);
                        }, idx++ * timing.stagger);
                        this._entrances.set(id, charEl);
                    } else {
                        VNTransitions.enterCharacter(charEl, 'none');
                    }
                }
            });
        } else {
            container.innerHTML = '';
            container.classList.add('empty');
        }
    }

    applyParticles({ particleChanged, intensityChanged, depthChanged, windChanged, gustsChanged,
        layerChanged, mixChanged, wrapChanged, appearanceChanged, tempoChanged, motionChanged }) {
        const { particleEffect, particleIntensity, particlesLayer, particleWind, particleGusts,
            particleScale, particleOpacity, particleTempo, particleTintColor, particleTintStrength, particleSolidTexture } = this.state;
        if (particleChanged || intensityChanged || depthChanged || mixChanged || wrapChanged || motionChanged) {
            this.atmosphere.setParticles(particleEffect, particleIntensity, particlesLayer, this.particleLook());
        } else {
            if (windChanged || gustsChanged) this.atmosphere.setWind(particleWind, particleGusts);
            if (appearanceChanged) this.atmosphere.setParticleAppearance(
                particleScale, particleOpacity, particleTintColor, particleTintStrength, particleSolidTexture);
            if (tempoChanged) this.atmosphere.setParticleTempo(particleTempo);
        }
        if (layerChanged) this.applyLayerUI();
    }

    _applyAtmosphere(changes) {
        const { particleChanged, visualChanged, angleChanged, visualAppearanceChanged } = changes;
        this.applyParticles(changes);
        if (visualChanged) this.atmosphere.setVisual(this.state.visualEffect, this.state);
        else if (visualAppearanceChanged) this.atmosphere.setVisualAppearance(this.state);
        if (angleChanged) this.atmosphere.setVisualAngle(this.state.visualAngle);
        this.effectsUI.syncSettings();
        if (particleChanged || visualChanged) this.effectsUI.syncButtons();
    }

    /** The revision guards cancel work belonging to a superseded update or a closed scene. */
    async render(changes, timing, revision, queueData) {
        const { bgChanged, castChanged, speakersAfter } = changes;
        if (!this.isCurrent(revision)) return;
        const settle = () => {
            if (!this.isCurrent(revision)) return;
            this.settlePortraits(speakersAfter);
        };
        const updateSides = (t = timing) => Promise.all(VNSceneState.POSITIONS.map(side =>
            this._updateSide(this.state[`${side}Ids`], `.vn-${side}-side`, side, queueData, t, revision)));

        // Background, outgoing and incoming characters all run at once instead of one after another
        this._beginQuickTransition(timing);
        // Nothing starts before the new picture is decoded, so effect, background and characters stay in step
        if (bgChanged) await VNPreloader.ready(this.state.background);
        const stage = VNTransitions.STAGE_TYPES.includes(timing.type);
        const cover = timing.cover && bgChanged && castChanged;
        if (stage) {
            // Decode before the browser freezes rendering for its old/new snapshots.
            await Promise.all(VNPreloader.stepUrls([this.state.toPayload()]).map(url => VNPreloader.ready(url)));
        }
        if (!this.isCurrent(revision)) return;

        // Whole-stage transitions swap the cast and background while the outgoing scene is captured or covered.
        if (stage || cover) {
            const video = VNPreloader.isVideo(this.state.background) ? await VNTransitions.prepareVideo(this.state.background) : null;
            try {
                if (!this.isCurrent(revision)) return;
                const swap = async () => {
                    if (!this.isCurrent(revision)) return;
                    this._applyAtmosphere(changes);
                    this.background.applyBackgroundInstant(this.getOverlay(), this.state.background, this.state.backgroundOverlay, video);
                    this.applyCaption();
                    await updateSides({ ...timing, exit: 0, enter: 0, stagger: 0 });
                    settle();
                };
                const overlay = this.getOverlay()[0];
                if (stage) await VNTransitions.stage(overlay, timing, swap, {
                    url: this.state.background, video, dim: this.state.backgroundOverlay
                });
                else await VNTransitions.cover(overlay, timing, swap);
            } finally {
                if (video && !video.isConnected) VNTransitions.releaseVideos(video);
            }
            if (this.isCurrent(revision)) this._pendingChanges = null;
            return;
        }

        // The whole "look" — visual effect, effect layers, background dimming — switches in the very frame the new
        // picture starts to fade in, and within ~0.2 s (--vn-tr-fx), far ahead of the dissolve.
        // So the new picture is never shown bare and then darkened afterwards.
        this._applyAtmosphere(changes);
        // Characters who stay on stage change their portrait effect together with the step, not after the dissolve
        this.applyCharFx();
        this.background.fadeOverlay(this.getOverlay(), this.state.backgroundOverlay, this.state.background);

        const bgDone = bgChanged
            ? this.background.switchWithTransition(this.getOverlay(), this.state.background, this.state.backgroundOverlay, this.atmosphere, timing, () => this.isCurrent(revision))
            : Promise.resolve(this.background.applyBackground(this.getOverlay(), this.state.background, this.state.backgroundOverlay));
        this.applyCaption();
        await updateSides();
        settle();
        await bgDone;
        if (this.isCurrent(revision)) this._pendingChanges = null;
    }
}
