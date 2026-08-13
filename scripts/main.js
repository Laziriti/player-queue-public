// ============================================================
// main.js — module entry point
// ============================================================

import { PlayerQueue } from './queue/player-queue.js';
import { SoundTestApp } from './sound-test.js';
import { registerSettings, applyNameplateImage } from './settings.js';
import { VisualNovelScene } from './visual-dialog/visual-novel-scene.js';

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

    _makeControlBtn(layers, 'queue', 'fa-users', 'Очередь игроков',
        () => PlayerQueue.instance?.toggleQueue());

    if (game.user?.isGM) {
        _makeControlBtn(layers, 'vn-scene', 'fa-theater-masks', 'Диалоговая сцена',
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
});

Hooks.once('socketlib.ready', () => {
    const socket = socketlib.registerModule('player-queue');

    PlayerQueue.socket = socket;

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

    if (game.socket) {
        game.socket.on(PlayerQueue.SOCKET, (data) => {
            PlayerQueue.instance?.handleSocketEvent(data);
        });
    }

    PlayerQueue.instance?.updateTheme(PlayerQueue.setting('darkTheme'));
    applyNameplateImage(PlayerQueue.setting('nameplateImage'));

    if (game.user.isGM && PlayerQueue.instance?.isLoaded) {
        setTimeout(() => PlayerQueue.instance.requestSync(), 2000);
    }

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

Hooks.on('userConnected', async (user, connected) => {
    if (!PlayerQueue.instance?.isLoaded) return;

    if (!connected && PlayerQueue.instance.isInQueue(user.id)) {
        await PlayerQueue.instance.removeFromQueue(user.id);
    } else if (connected && game.user.isGM) {
        setTimeout(() => PlayerQueue.instance.requestSync(), 3000);
    }
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
    await game.settings.set('player-queue', 'queueData', []);
    localStorage.removeItem(`${PlayerQueue.ID}-position`);
    if (PlayerQueue.instance) {
        PlayerQueue.instance.queue = [];
        PlayerQueue.instance.updateDisplay();
    }
};

window.debugQueue = () => {
    console.log('=== QUEUE DEBUG ===');
    console.log('Instance:', PlayerQueue.instance);
    console.log('Queue:', PlayerQueue.instance?.queue);
    console.log('Loaded:', PlayerQueue.instance?.isLoaded);
    console.log('GM:', game.user.isGM);
    try { console.log('Saved data:', game.settings.get('player-queue', 'queueData')); } catch {}
};

window.openVisualNovelScene = () => window.visualNovelScene?.openSceneDialog();
