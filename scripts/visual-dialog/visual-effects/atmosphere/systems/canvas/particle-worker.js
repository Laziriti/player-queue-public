// Воркер канвас-частиц: рисует на OffscreenCanvas, переданном с главного потока, поэтому не нагружает поток Foundry.
// Вся работа — в ParticleRenderer; здесь только проводка сообщений.
import { ParticleRenderer } from './renderer.js';

const renderer = new ParticleRenderer(msg => self.postMessage(msg));
self.onmessage = event => renderer.handle(event.data);
