/** One result per DialogV2: submit wins over its subsequent close; window close means cancellation.
 * onRender receives (dialog, resolve) for custom row pickers; resolving does not close the window.
 */
export function promptDialog(config, { cancelValue = null, onSubmit = value => value, onRender,
    onClose = () => cancelValue } = {}) {
    return new Promise((resolve, reject) => {
        let finished = false, dialog;
        const settle = value => {
            if (finished) return;
            finished = true;
            resolve(value);
        };
        const fail = error => {
            if (finished) return;
            finished = true;
            reject(error);
            try { Promise.resolve(dialog?.close()).catch(() => {}); } catch { /* preserve the original error */ }
        };
        try {
            dialog = new foundry.applications.api.DialogV2({ ...config, rejectClose: false,
                submit: (...args) => {
                    if (finished) return;
                    try { settle(onSubmit(...args)); } catch (error) { fail(error); }
                },
            });
            dialog.addEventListener('close', () => {
                if (finished) return;
                try { settle(onClose(dialog)); } catch (error) { fail(error); }
            }, { once: true });
            if (onRender) dialog.addEventListener('render', () => {
                if (finished) return;
                try { Promise.resolve(onRender(dialog, settle)).catch(fail); } catch (error) { fail(error); }
            });
            Promise.resolve(dialog.render({ force: true })).catch(fail);
        } catch (error) { fail(error); }
    });
}
