/** A cancellable trailing call; the owner cancels it when its UI is disposed. */
export function debounce(fn, ms = 50) {
    let timer;
    const run = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    run.cancel = () => clearTimeout(timer);
    return run;
}
