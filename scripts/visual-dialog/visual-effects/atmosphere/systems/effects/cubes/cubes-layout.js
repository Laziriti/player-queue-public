export const CUBES_WAVE_SEC = 10;
export const CUBES_LOOK_PCT = 30;
export const CUBES_LOOK_LERP = 0.08;

export function cubesGrid(overlay, layer, full) {
    const vw = overlay.clientWidth, vh = overlay.clientHeight;
    const ox = -layer.offsetLeft, oy = -layer.offsetTop;
    const cols = Math.min(20, Math.max(5, Math.round(vw / (full ? 190 : 150))));
    const size = vw / cols;
    const rows = full ? Math.ceil(vh / size) : Math.max(3, Math.floor(vh / size));
    const top = full ? oy : oy + (vh - rows * size) / 2;
    return { cols, rows, size, ox, top, width: layer.clientWidth, height: layer.clientHeight };
}

export function cubesPush() {
    return 60 + Math.random() * 100;
}

export function cubesDelay(col, row) {
    return col * 0.45 + row * 0.7 - CUBES_WAVE_SEC;
}

export function cubeCells({ cols, rows }, full) {
    const positions = [];
    if (full) {
        for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) positions.push([col, row]);
    } else {
        // Side-adjacent cells would occlude each other in the sparse variant.
        const want = Math.max(4, Math.round(cols * rows * 0.16));
        const taken = new Set();
        const neighbours = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let attempt = 0; taken.size < want && attempt < want * 40; attempt++) {
            const col = Math.floor(Math.random() * cols), row = Math.floor(Math.random() * rows);
            if (neighbours.some(([dc, dr]) => taken.has(`${col + dc},${row + dr}`))) continue;
            taken.add(`${col},${row}`);
            positions.push([col, row]);
        }
    }
    return positions.map(([col, row]) => {
        const push = cubesPush();
        const duration = full ? CUBES_WAVE_SEC : 9 + Math.random() * 8;
        const delay = full ? cubesDelay(col, row) : -Math.random() * duration;
        return { col, row, push, duration, delay };
    });
}
