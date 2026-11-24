// Formatting used by scene controls.
export const windLabel = w => w === 0 ? game.i18n.localize('vn.bg.windCalm') : `${w < 0 ? '← ' : ''}${Math.abs(w)}${w > 0 ? ' →' : ''}`;
