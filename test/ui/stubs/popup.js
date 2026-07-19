// Stand-in for SillyTavern's public/scripts/popup.js — only the shape settingsUI.js actually
// uses: `new Popup(html, POPUP_TYPE.TEXT, '', opts)` with `.content`/`.show()`, a cancel button
// wired to `opts.onClose`. Real Popup does far more (multiple types, promises, animations); this
// only needs to be attach-order-faithful, since that's exactly what the modal-move bug hinged on —
// `.content` must exist synchronously in the constructor but not be attached to `document` until
// `show()` runs.
export const POPUP_TYPE = { TEXT: 1, CONFIRM: 2, INPUT: 3 };

export class Popup {
    constructor(content, type, _inputValue, options = {}) {
        this.type = type;
        this.options = options;

        this.dlg = document.createElement('dialog');
        this.dlg.className = 'st_ui_test_popup';
        if (options.large) this.dlg.classList.add('large');
        if (options.leftAlign) this.dlg.classList.add('left-align');

        this.content = document.createElement('div');
        this.content.className = 'popup-content';
        if (typeof content === 'string') {
            this.content.innerHTML = content;
        } else if (content instanceof Node) {
            this.content.appendChild(content);
        }
        this.dlg.appendChild(this.content);

        if (options.cancelButton) {
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'popup-button-cancel';
            cancelBtn.textContent = typeof options.cancelButton === 'string' ? options.cancelButton : 'Cancel';
            cancelBtn.addEventListener('click', () => this.completeCancelled());
            this.dlg.appendChild(cancelBtn);
        }
        if (options.okButton) {
            const okBtn = document.createElement('button');
            okBtn.className = 'popup-button-ok';
            okBtn.textContent = typeof options.okButton === 'string' ? options.okButton : 'OK';
            this.dlg.appendChild(okBtn);
        }
    }

    show() {
        document.body.appendChild(this.dlg);
        if (typeof this.dlg.showModal === 'function') this.dlg.showModal();
        return Promise.resolve();
    }

    completeCancelled() {
        // onClose runs *before* the dialog is detached — settingsUI.js's onClose moves the
        // relocated panes back out via `$('#…').insertAfter(...)` while they're still attached to
        // `document` (as a descendant of this dialog); removing the dialog first would detach
        // that whole subtree, making the by-id jQuery lookup fail the same way the real
        // attach-order bug this test exists for does.
        if (typeof this.options.onClose === 'function') this.options.onClose(this);
        this.dlg.remove();
    }
}
