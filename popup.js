/**
 * Smart Skip Intro - popup
 *
 * Controls shown when the user clicks the extension icon:
 *  - a master on/off switch,
 *  - one switch for each skip type (intro, recap, outro, preview),
 *  - a button that opens the series library (options page),
 *  - a button that erases all saved data, protected by a confirmation modal.
 */
document.addEventListener('DOMContentLoaded', () => {
    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    // Storage names shared with content.js (keep them in sync)
    const STORAGE_KEY_ENABLED = 'isExtensionEnabled'; // master switch
    const STORAGE_KEY_ENABLED_SKIP_TYPES = 'enabledSkipTypes'; // { intro: true, recap: false, ... }

    // Skip types in display order, with their Italian labels.
    // The "type" values must match SKIP_TYPES in content.js.
    const SKIP_TYPE_LABELS = [
        { type: 'intro', label: 'Intro' },
        { type: 'recap', label: 'Riepilogo' },
        { type: 'outro', label: 'Titoli di coda' },
        { type: 'preview', label: 'Anteprima' }
    ];

    // -----------------------------------------------------------------------
    // DOM references and state
    // -----------------------------------------------------------------------

    const enableToggle = document.getElementById('enable-toggle');
    const skipTypesCard = document.getElementById('skip-types-card');
    const openLibraryButton = document.getElementById('open-library-button');
    const resetMemoryButton = document.getElementById('reset-memory-button');
    const confirmModal = document.getElementById('confirm-modal');
    const cancelButton = document.getElementById('cancel-button');
    const confirmButton = document.getElementById('confirm-button');

    // Current state of the per-type switches. A type missing here counts as enabled.
    let enabledSkipTypes = {};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function showConfirmModal() {
        confirmModal.classList.add('active');
    }

    function hideConfirmModal() {
        confirmModal.classList.remove('active');
    }

    /** Dims the per-type card while the master switch is off. */
    function updateSkipTypesCardAppearance() {
        skipTypesCard.classList.toggle('dimmed', !enableToggle.checked);
    }

    /** Builds one row (label + switch) for a skip type. */
    function createSkipTypeRow({ type, label }) {
        const row = document.createElement('div');
        row.className = 'toggle-row';

        const labelElement = document.createElement('span');
        labelElement.className = 'toggle-label';
        labelElement.textContent = label;

        // Same markup as the master switch: hidden checkbox + CSS-drawn slider
        const switchElement = document.createElement('label');
        switchElement.className = 'switch';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = enabledSkipTypes[type] !== false;

        const slider = document.createElement('span');
        slider.className = 'slider';

        // Save the whole object; content.js applies the change immediately
        checkbox.addEventListener('change', () => {
            enabledSkipTypes[type] = checkbox.checked;
            chrome.storage.local.set({ [STORAGE_KEY_ENABLED_SKIP_TYPES]: enabledSkipTypes });
        });

        switchElement.appendChild(checkbox);
        switchElement.appendChild(slider);
        row.appendChild(labelElement);
        row.appendChild(switchElement);
        return row;
    }

    // -----------------------------------------------------------------------
    // Load saved state, then build the switches
    // -----------------------------------------------------------------------

    chrome.storage.local.get([STORAGE_KEY_ENABLED, STORAGE_KEY_ENABLED_SKIP_TYPES], (result) => {
        // Defaults: everything enabled when nothing was saved yet
        enableToggle.checked = result[STORAGE_KEY_ENABLED] !== false;
        enabledSkipTypes = result[STORAGE_KEY_ENABLED_SKIP_TYPES] || {};

        SKIP_TYPE_LABELS.forEach((skipType) => {
            skipTypesCard.appendChild(createSkipTypeRow(skipType));
        });

        updateSkipTypesCardAppearance();
    });

    // -----------------------------------------------------------------------
    // Master switch
    // -----------------------------------------------------------------------

    enableToggle.addEventListener('change', () => {
        chrome.storage.local.set({ [STORAGE_KEY_ENABLED]: enableToggle.checked });
        updateSkipTypesCardAppearance();
    });

    // -----------------------------------------------------------------------
    // Open the library
    // -----------------------------------------------------------------------

    openLibraryButton.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    });

    // -----------------------------------------------------------------------
    // Reset all data (with confirmation)
    // -----------------------------------------------------------------------

    resetMemoryButton.addEventListener('click', showConfirmModal);
    cancelButton.addEventListener('click', hideConfirmModal);

    confirmButton.addEventListener('click', () => {
        // Wipe everything. Missing keys mean "all enabled", so only the master
        // switch is restored explicitly and the per-type switches go back to on.
        chrome.storage.local.clear(() => {
            chrome.storage.local.set({ [STORAGE_KEY_ENABLED]: true }, () => {
                enableToggle.checked = true;
                enabledSkipTypes = {};
                skipTypesCard.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
                    checkbox.checked = true;
                });
                updateSkipTypesCardAppearance();
                hideConfirmModal();
            });
        });
    });
});