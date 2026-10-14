/**
 * Smart Skip Intro - options page (series library)
 *
 * Reads every series registered by content.js from chrome.storage.local and
 * shows them grouped by platform. The user can search, filter by platform,
 * sort, change the skip rule of each segment type (intro, recap, ...) of a
 * series, or delete the series.
 */
document.addEventListener('DOMContentLoaded', () => {
    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    // Storage names shared with content.js and popup.js (keep them in sync)
    const STORAGE_KEY_PREFIX = 'series_';
    const RULE_AUTO_SKIP = 'auto_skip';
    const RULE_NEVER_SKIP = 'never_skip';

    // Text displayed when a platform name is missing (the UI is in Italian)
    const UNKNOWN_PLATFORM_LABEL = 'SCONOSCIUTA';

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

    const seriesListElement = document.getElementById('series-list');
    const searchInput = document.getElementById('search-input');
    const platformFilter = document.getElementById('platform-filter');
    const sortOrder = document.getElementById('sort-order');

    // Every valid entry found in storage, as { storageKey, record }
    let allSeries = [];

    // Platforms the user collapsed. Remembered so that re-rendering the list
    // (e.g. after deleting a series) does not expand them again.
    const collapsedPlatforms = new Set();

    // -----------------------------------------------------------------------
    // Data loading
    // -----------------------------------------------------------------------

    /** Reads all series from storage, then renders the list. */
    function loadSeries() {
        chrome.storage.local.get(null, (storedItems) => {
            allSeries = [];

            for (const storageKey in storedItems) {
                if (!storageKey.startsWith(STORAGE_KEY_PREFIX)) continue;

                const record = storedItems[storageKey];
                // Entries without a title or without a rules object are invalid and ignored
                if (!record || typeof record !== 'object' || !record.title) continue;
                if (!record.rules || typeof record.rules !== 'object') continue;

                allSeries.push({ storageKey: storageKey, record: record });
            }

            renderSeriesList();
        });
    }

    // -----------------------------------------------------------------------
    // Filtering, sorting and grouping
    // -----------------------------------------------------------------------

    /** Applies the search text, the platform filter and the sort order. */
    function getVisibleSeries() {
        const searchText = searchInput.value.toLowerCase();
        const selectedPlatform = platformFilter.value; // 'all' or a lowercase platform name

        const visibleSeries = allSeries.filter(({ record }) => {
            const matchesSearch = record.title.toLowerCase().includes(searchText);
            const platformName = (record.platform || '').toLowerCase();
            const matchesPlatform = selectedPlatform === 'all' || platformName.includes(selectedPlatform);
            return matchesSearch && matchesPlatform;
        });

        const direction = sortOrder.value === 'title-desc' ? -1 : 1;
        visibleSeries.sort((a, b) =>
            direction * a.record.title.toLowerCase().localeCompare(b.record.title.toLowerCase())
        );

        return visibleSeries;
    }

    /** Groups series by platform name: { 'NETFLIX': [item, ...], ... } */
    function groupByPlatform(seriesItems) {
        const groups = {};
        for (const item of seriesItems) {
            const platformName = item.record.platform || UNKNOWN_PLATFORM_LABEL;
            if (!groups[platformName]) groups[platformName] = [];
            groups[platformName].push(item);
        }
        return groups;
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    /** Redraws the whole list according to the current search/filter/sort. */
    function renderSeriesList() {
        seriesListElement.replaceChildren();

        const visibleSeries = getVisibleSeries();

        if (visibleSeries.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.textContent = 'Nessuna serie trovata in memoria. Guarda una sigla per registrarla!';
            seriesListElement.appendChild(emptyState);
            return;
        }

        const groups = groupByPlatform(visibleSeries);
        Object.keys(groups).sort().forEach((platformName) => {
            seriesListElement.appendChild(createPlatformSection(platformName, groups[platformName]));
        });
    }

    /** Builds a collapsible section containing the cards of one platform. */
    function createPlatformSection(platformName, items) {
        const section = document.createElement('div');
        section.className = 'platform-section';

        // Header: platform name + number of series
        const header = document.createElement('div');
        header.className = 'platform-header';

        const nameElement = document.createElement('span');
        nameElement.textContent = platformName + ' ';

        const countElement = document.createElement('span');
        countElement.style.cssText = 'color:#7e8299; font-size:14px; margin-left:6px;';
        countElement.textContent = `(${items.length})`;

        nameElement.appendChild(countElement);
        header.appendChild(nameElement);

        // Content: one card per series
        const content = document.createElement('div');
        content.className = 'platform-content';
        items.forEach((item) => {
            content.appendChild(createSeriesCard(item.storageKey, item.record));
        });

        // Restore the collapsed state from previous renders
        if (collapsedPlatforms.has(platformName)) {
            header.classList.add('collapsed');
            content.classList.add('hidden');
        }

        // Clicking the header collapses/expands the group
        header.addEventListener('click', () => {
            const isNowCollapsed = header.classList.toggle('collapsed');
            content.classList.toggle('hidden', isNowCollapsed);
            if (isNowCollapsed) collapsedPlatforms.add(platformName);
            else collapsedPlatforms.delete(platformName);
        });

        section.appendChild(header);
        section.appendChild(content);
        return section;
    }

    /**
     * Builds a chip for one skip type. The rule is binary, so a checkbox is enough:
     * checked = skip automatically, unchecked = never skip.
     */
    function createRuleChip(storageKey, record, skipType, label) {
        const chip = document.createElement('label');
        chip.className = 'rule-chip';
        chip.title = 'Acceso: salta in automatico. Spento: non saltare mai.';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = record.rules[skipType] === RULE_AUTO_SKIP;

        const text = document.createElement('span');
        text.textContent = label;

        // Save the new rule as soon as the user toggles the chip
        checkbox.addEventListener('change', () => {
            record.rules[skipType] = checkbox.checked ? RULE_AUTO_SKIP : RULE_NEVER_SKIP;
            chrome.storage.local.set({ [storageKey]: record });
        });

        chip.appendChild(checkbox);
        chip.appendChild(text);
        return chip;
    }

    /** Builds the row of chips for the skip types registered for a series. */
    function createRulesList(storageKey, record) {
        const rulesList = document.createElement('div');
        rulesList.className = 'rules-list';

        SKIP_TYPE_LABELS.forEach(({ type, label }) => {
            if (!record.rules[type]) return; // type never seen for this series
            rulesList.appendChild(createRuleChip(storageKey, record, type, label));
        });

        return rulesList;
    }

    /** Builds the card of a single series: title, platform badge, rules and delete button. */
    function createSeriesCard(storageKey, record) {
        const card = document.createElement('div');
        card.className = 'series-card';

        // Left side: title and platform badge (textContent avoids HTML injection)
        const info = document.createElement('div');
        info.className = 'info-container';

        const titleElement = document.createElement('div');
        titleElement.className = 'series-title';
        titleElement.textContent = record.title;

        const badgeElement = document.createElement('div');
        badgeElement.className = 'platform-badge';
        badgeElement.textContent = record.platform || UNKNOWN_PLATFORM_LABEL;

        info.appendChild(titleElement);
        info.appendChild(badgeElement);

        // Right side: rules and delete button
        const deleteButton = document.createElement('button');
        deleteButton.className = 'btn-delete';
        deleteButton.textContent = 'Elimina';
        deleteButton.addEventListener('click', () => {
            chrome.storage.local.remove(storageKey, () => loadSeries());
        });

        const actions = document.createElement('div');
        actions.className = 'card-actions';
        actions.appendChild(createRulesList(storageKey, record));
        actions.appendChild(deleteButton);

        card.appendChild(info);
        card.appendChild(actions);
        return card;
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    // Re-render (no storage read needed) whenever search, filter or sort change
    searchInput.addEventListener('input', renderSeriesList);
    platformFilter.addEventListener('change', renderSeriesList);
    sortOrder.addEventListener('change', renderSeriesList);

    loadSeries();
});