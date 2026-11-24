import { VISUAL_EFFECT_SETTINGS } from '../../config/visual-effect-settings.js';
import { seededRandom } from '../../../../../utils/seeded-random.js';

const mouthWidth = 960;
const mouthHeight = 360;
const left = 58;
const right = 902;
const center = (left + right) / 2;
const middle = 178;

function jawEdge(x, lower) {
    const arch = 1 - ((x - center) / (right - center)) ** 2;
    const ripple = Math.sin(x * 0.031 + (lower ? 2.1 : 0)) * 6 * arch;
    return middle + (lower ? 118 : -116) * arch + ripple;
}

function outline() {
    const shape = new Path2D();
    shape.moveTo(left, jawEdge(left, false));
    shape.bezierCurveTo(210, 26, 730, 26, right, jawEdge(right, false));
    shape.bezierCurveTo(745, 340, 215, 340, left, jawEdge(left, true));
    shape.closePath();
    return shape;
}

function drawTeeth(ctx, lower, random) {
    const direction = lower ? -1 : 1;
    const toothColors = lower
        ? ['#311c3b', '#b8a3c0', '#f0e6ef']
        : ['#24192c', '#d1bfd8', '#fff4e7'];
    let index = 0;

    for (let x = left + 22 + random() * 5; x < right - 17; x += 36 + random() * 15, index++) {
        const edge = jawEdge(x, lower);
        const centerWeight = Math.max(0.18, 1 - Math.abs(x - center) / 520);
        const fang = index % 5 === 1 || index % 7 === 4;
        const length = (fang ? 66 + random() * 30 : 34 + random() * 28) * centerWeight;
        const width = fang ? 13 + random() * 6 : 17 + random() * 11;
        const root = edge + 5 * direction;
        const tipX = x + (random() - 0.5) * width * 0.7;
        const tipY = root + direction * length;
        const gradient = ctx.createLinearGradient(x - width, root, x + width, tipY);
        gradient.addColorStop(0, toothColors[0]);
        gradient.addColorStop(0.43, toothColors[1]);
        gradient.addColorStop(0.78, toothColors[2]);
        gradient.addColorStop(1, toothColors[0]);
        ctx.fillStyle = gradient;
        ctx.strokeStyle = 'rgba(8, 3, 13, 0.92)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(x - width, root);
        ctx.quadraticCurveTo(x - width * 0.6, root + length * direction * 0.22, tipX, tipY);
        ctx.quadraticCurveTo(x + width * 0.42, root + length * direction * 0.42, x + width, root);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
}

function makeMouth() {
    const canvas = document.createElement('canvas');
    canvas.width = mouthWidth;
    canvas.height = mouthHeight;
    canvas.className = 'vn-cosmic-mouth';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    const random = seededRandom('cosmic-entity-mouth');
    const shape = outline();
    const cavity = ctx.createLinearGradient(0, 35, 0, 325);
    cavity.addColorStop(0, '#24112f');
    cavity.addColorStop(0.24, '#08040d');
    cavity.addColorStop(0.51, '#010104');
    cavity.addColorStop(0.78, '#09040e');
    cavity.addColorStop(1, '#21102a');

    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(119, 28, 177, 0.34)';
    ctx.shadowBlur = 20;
    ctx.strokeStyle = 'rgba(105, 37, 143, 0.36)';
    ctx.lineWidth = 7;
    ctx.stroke(shape);
    ctx.shadowBlur = 0;
    ctx.fillStyle = cavity;
    ctx.fill(shape);
    ctx.save();
    ctx.clip(shape);
    const abyss = ctx.createRadialGradient(center, middle, 28, center, middle, 390);
    abyss.addColorStop(0, '#000');
    abyss.addColorStop(0.7, '#030107');
    abyss.addColorStop(1, 'rgba(42, 13, 56, 0.88)');
    ctx.fillStyle = abyss;
    ctx.fillRect(0, 0, mouthWidth, mouthHeight);
    drawTeeth(ctx, true, random);
    drawTeeth(ctx, false, random);
    ctx.restore();
    return canvas;
}

export class CosmicEntity {
    start(overlay, _variant, _type, settings) {
        this.overlay = overlay;
        this.setSettings(settings);
    }

    setSettings({ cosmicEntity = VISUAL_EFFECT_SETTINGS.cosmicEntity.initial }) {
        if (cosmicEntity === this.entity) return;
        if (this.entity) this.overlay.classList.remove(`vn-vfx-cosmic-entity-${this.entity}`);
        this.entity = cosmicEntity;
        this.overlay.classList.add(`vn-vfx-cosmic-entity-${cosmicEntity}`);
        if (cosmicEntity === 'eye') {
            this.mouth?.remove();
        } else {
            this.mouth ??= makeMouth();
            this.overlay.querySelector('.vn-fx-tint').appendChild(this.mouth);
        }
    }

    stop() {
        this.overlay.classList.remove(`vn-vfx-cosmic-entity-${this.entity}`);
        this.mouth?.remove();
    }
}
