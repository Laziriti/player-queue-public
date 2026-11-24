export function filePickerImplementation() {
    return globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}
