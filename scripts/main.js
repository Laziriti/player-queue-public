// ============================================================
// main.js — module entry point
// ============================================================

import { PlayerQueue } from './queue/player-queue.js';
import { SoundTestApp } from './sound-test.js';
import { registerSettings, applyNameplateImage } from './settings.js';
import { VisualNovelScene } from './visual-dialog/visual-novel-scene.js';
import { VNPresets } from './visual-dialog/vn-state.js';

// ============================================================
// Scene Control Buttons
// ============================================================

function _makeControlBtn(layers, control, icon, label, onClick) {
    const li = document.createElement('li');
    li.innerHTML = `
        <button type="button"
                class="control ui-control layer icon fa-solid ${icon}"
                role="tab" data-action="control" data-control="${control}"
                aria-pressed="false" aria-label="${label}"
                aria-controls="scene-controls-tools">
        </button>`;
    const btn = li.querySelector('button');
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        onClick();
        layers.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
    });
    layers.appendChild(li);
}

function addQueueControl() {
    const layers = document.querySelector('#scene-controls-layers');
    if (!layers) return;

    // Always remove stale injected buttons before re-adding
    layers.querySelector('[data-control="queue"]')?.closest('li')?.remove();
    layers.querySelector('[data-control="vn-scene"]')?.closest('li')?.remove();

    _makeControlBtn(layers, 'queue', 'fa-users', game.i18n.localize('playerQueue.control.queueLabel'),
        () => PlayerQueue.instance?.toggleQueue());

    if (game.user?.isGM) {
        _makeControlBtn(layers, 'vn-scene', 'fa-theater-masks', game.i18n.localize('playerQueue.control.vnSceneLabel'),
            () => window.visualNovelScene?.openSceneDialog());
    }
}

let _controlObserver = null;
function _ensureControlObserver() {
    if (_controlObserver) return;
    const controls = document.querySelector('#scene-controls');
    if (!controls) return;
    _controlObserver = new MutationObserver(() => addQueueControl());
    _controlObserver.observe(controls, { childList: true, subtree: false });
}

// ============================================================
// Hooks
// ============================================================

Hooks.once('init', () => {
    registerSettings();
    PlayerQueue.initialize();

    game.keybindings.register(PlayerQueue.ID, 'raiseHand', {
        name: 'playerQueue.keybindings.raiseHand.name',
        hint: 'playerQueue.keybindings.raiseHand.hint',
        editable: [{ key: 'KeyH' }],
        onDown: () => {
            // Only while a dialog scene is open on a player's screen; otherwise leave the key to Foundry
            const scene = window.visualNovelScene;
            if (game.user.isGM || !scene?.state.isActive || scene.state.minimized) return false;
            PlayerQueue.instance?.toggleHand();
            return true;
        }
    });
});

Hooks.once('socketlib.ready', () => {
    const socket = socketlib.registerModule('player-queue');

    PlayerQueue.socket = socket;

    socket.register('playerQueueRequest', function (req) {
        return PlayerQueue.instance?.network.handleRequest(req, this?.socketdata?.userId)
            ?? { ok: false, reason: 'not-ready' };
    });

    socket.register('vnScene', (data) => {
        window.visualNovelScene?.handleSocketEvent(data);
    });

    // Store socket reference for VN scene (will be consumed in 'ready')
    VisualNovelScene._pendingSocket = socket;
});

Hooks.once('ready', async () => {
    if (PlayerQueue.instance && !PlayerQueue.instance.isLoaded) {
        await PlayerQueue.instance.loadQueue();
    }

    PlayerQueue.instance?.updateTheme(PlayerQueue.setting('darkTheme'));

    let nameplateValue = PlayerQueue.setting('nameplateImage');
    if (game.user.isGM && (nameplateValue?.includes('dialog name lables') || nameplateValue?.includes('name_lable_'))) {
        nameplateValue = nameplateValue
            .replace('dialog name lables', 'dialog name labels')
            .replace('name_lable_', 'name_label_');
        game.settings.set(PlayerQueue.ID, 'nameplateImage', nameplateValue).catch(() => {});
    }
    applyNameplateImage(nameplateValue);

    // Visual Novel Scene
    const vns = new VisualNovelScene();
    await vns.initialize();

    if (VisualNovelScene._pendingSocket) {
        vns.initSocket(VisualNovelScene._pendingSocket);
        delete VisualNovelScene._pendingSocket;
    }

    window.visualNovelScene = vns;

    // Restore scene if was active before reload
    await vns.restoreStateIfNeeded();
});

Hooks.on('renderSceneControls', () => {
    addQueueControl();
    _ensureControlObserver();
});

Hooks.on('canvasReady', () => {
    setTimeout(() => { addQueueControl(); _ensureControlObserver(); }, 50);
});

Hooks.on('playerQueueUpdated', () => {
    window.visualNovelScene?.updateQueueDisplay();
});

// Only the GM who announced reacts: their client drives the scene and broadcasts the speaker change
Hooks.on('playerQueueAnnounced', ({ entry, by }) => {
    if (by === game.user.id) window.visualNovelScene?.focusQueuedSpeaker(entry.id);
});

// ============================================================
// Global API
// ============================================================

window.openQueue = () => PlayerQueue.instance?.toggleQueue();
window.joinQueueLow = () => PlayerQueue.instance?.joinQueueWithPriority(0);
window.joinQueueMedium = () => PlayerQueue.instance?.joinQueueWithPriority(1);
window.joinQueueHigh = () => PlayerQueue.instance?.joinQueueWithPriority(2);

window.syncQueue = async () => {
    if (PlayerQueue.instance && game.user.isGM) await PlayerQueue.instance.requestSync();
};

window.clearQueueData = async () => {
    if (!game.user.isGM) return;
    localStorage.removeItem(`${PlayerQueue.ID}-position`);
    await PlayerQueue.instance?.clearQueue();
};

window.debugQueue = () => {
    console.log('=== QUEUE DEBUG ===');
    console.log('Instance:', PlayerQueue.instance);
    console.log('Queue:', PlayerQueue.instance?.queue);
    console.log('Rev:', PlayerQueue.instance?.rev, 'Loaded:', PlayerQueue.instance?.isLoaded);
    console.log('GM:', game.user.isGM, 'Host:', !!game.users.activeGM?.isSelf);
    try { console.log('Saved state:', game.settings.get('player-queue', 'queueState')); } catch {}
};

window.openVisualNovelScene = () => window.visualNovelScene?.openSceneDialog();

window.openScenePresets = async () => {
    if (!game.user.isGM) return;

    const vnScene = window.visualNovelScene;
    if (!vnScene) { ui.notifications.warn('Visual Novel Scene не инициализирован'); return; }

    const currentScene = canvas?.scene;
    if (!currentScene) {
        ui.notifications.warn(game.i18n.localize('vn.scenePresets.noScene'));
        return;
    }

    const allPresets = await VNPresets.getSorted();
    const scenePresets = allPresets.filter(p => p.sceneId === currentScene.id);

    const gmOnlyLabel = game.i18n.localize('vn.dialog.gmOnlyLabel');
    const gmOnlyTitle = game.i18n.localize('vn.dialog.gmOnlyToggleTitle');
    const unnamedLabel = game.i18n.localize('vn.scenePresets.unnamed');

    let listHtml;
    if (scenePresets.length === 0) {
        listHtml = `<p style="text-align:center;padding:32px 0;color:var(--vn-text-dim)">${game.i18n.localize('vn.scenePresets.empty')}</p>`;
    } else {
        const cards = scenePresets.map(p => {
            const img = p.thumbnailData
                ? `<img class="vn-preset-card-img" src="${p.thumbnailData}" loading="lazy" alt="">`
                : `<div class="vn-preset-card-placeholder"><i class="fas fa-film"></i></div>`;
            const name = p.name ?? unnamedLabel;
            return `
                <div class="vn-preset-card vn-sp-card" data-preset-id="${p.id}">
                    <div class="vn-preset-card-poster">
                        ${img}
                        <div class="vn-preset-card-footer">
                            <div class="vn-preset-card-name" title="${name.replace(/"/g, '&quot;')}">${name}</div>
                        </div>
                        <div class="vn-preset-card-overlay">
                            <button type="button" class="vn-preset-card-launch" tabindex="-1">
                                <i class="fas fa-play"></i>
                            </button>
                        </div>
                    </div>
                </div>`;
        }).join('');
        listHtml = `<div class="vn-preset-cards">${cards}</div>`;
    }

    const content = `
        <div class="vn-scene-dialog">
            <div style="display:flex;align-items:center;padding:10px 12px 8px;border-bottom:1px solid var(--vn-border);gap:8px;flex-shrink:0">
                <i class="fas fa-map" style="color:var(--vn-text-dim);flex-shrink:0"></i>
                <span style="font-weight:600;color:var(--vn-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${currentScene.name}</span>
                <label class="vn-gm-only-toggle" title="${gmOnlyTitle}">
                    <input type="checkbox" id="vn-sp-gm-only">
                    <span class="vn-toggle-track"></span>
                    <i class="fas fa-eye-slash"></i> ${gmOnlyLabel}
                </label>
            </div>
            <div style="padding:10px">${listHtml}</div>
        </div>`;

    const dialog = new foundry.applications.api.DialogV2({
        window: {
            title: game.i18n.format('vn.scenePresets.title', { scene: currentScene.name }),
            icon: 'fas fa-theater-masks',
            resizable: true,
        },
        position: { width: 560, height: 500 },
        content,
        buttons: [{ label: game.i18n.localize('Cancel'), action: 'cancel', icon: 'fas fa-times' }],
    });

    dialog.addEventListener('render', () => {
        dialog.element.querySelectorAll('.vn-sp-card').forEach(card => {
            card.addEventListener('click', async () => {
                const presetId = card.dataset.presetId;
                const gmOnly = dialog.element.querySelector('#vn-sp-gm-only')?.checked ?? false;
                const preset = await VNPresets.load(presetId);
                if (!preset) { ui.notifications.error(game.i18n.localize('vn.scenePresets.notFound')); return; }
                try { dialog.close(); } catch {}
                vnScene.createScene({ ...preset, gmOnly });
            });
        });
    });

    dialog.render({ force: true });
};

window.launchVNPreset = async (presetId) => {
    const scene = window.visualNovelScene;
    if (!scene) { ui.notifications.warn('Visual Novel Scene is not initialized'); return; }
    const preset = await VNPresets.load(presetId);
    if (!preset) { ui.notifications.error(`VN Preset "${presetId}" not found`); return; }
    scene.createScene(preset);
};
