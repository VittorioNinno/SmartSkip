/**
 * Smart Skip Intro - options page (series library)
 *
 * Reads every series registered by content.js from chrome.storage.local and
 * shows them grouped by platform. Entries that share the same base title
 * (e.g. "Show", "Show - Stagione 2", "Show - To The Top") are shown together
 * in one group: the group row holds the general settings, the entries below
 * hold the specific ones. The user can search, filter by platform, sort,
 * change the skip rule of each segment type, or delete entries.
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

    // Entries are grouped by the text before this separator: "Show - Stagione 2" -> "Show"
    const TITLE_SEPARATOR = ' - ';

    // Label of the entry whose title is exactly the base title (no suffix)
    const MAIN_ENTRY_LABEL = 'Principale';

    // State of a chip. A group chip is MIXED when its entries disagree.
    const CHIP_STATE = Object.freeze({ ALL: 'all', NONE: 'none', MIXED: 'mixed' });

    // -----------------------------------------------------------------------
    // DOM references and state
    // -----------------------------------------------------------------------

    const seriesListElement = document.getElementById('series-list');
    const searchInput = document.getElementById('search-input');
    const platformFilter = document.getElementById('platform-filter');
    const sortOrder = document.getElementById('sort-order');

    // Every valid entry found in storage, as { storageKey, record }
    let allSeries = [];

    // Remembered so that re-rendering the list (e.g. after deleting or changing
    // a rule) does not reset what the user opened or closed.
    const collapsedPlatforms = new Set();
    const expandedGroups = new Set(); // groups are collapsed by default

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
    // Filtering, grouping and sorting
    // -----------------------------------------------------------------------

    /** Applies the search text and the platform filter. */
    function getVisibleSeries() {
        const searchText = searchInput.value.toLowerCase();
        const selectedPlatform = platformFilter.value; // 'all' or a lowercase platform name

        return allSeries.filter(({ record }) => {
            const matchesSearch = record.title.toLowerCase().includes(searchText);
            const platformName = (record.platform || '').toLowerCase();
            const matchesPlatform = selectedPlatform === 'all' || platformName.includes(selectedPlatform);
            return matchesSearch && matchesPlatform;
        });
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

    /** "Show - Stagione 2" -> "Show". A title without separator is its own base. */
    function getBaseTitle(title) {
        const separatorIndex = title.indexOf(TITLE_SEPARATOR);
        return (separatorIndex > 0 ? title.slice(0, separatorIndex) : title).trim();
    }

    /** "Show - Stagione 2" -> "Stagione 2". The bare base title -> MAIN_ENTRY_LABEL. */
    function getVariantLabel(title) {
        const separatorIndex = title.indexOf(TITLE_SEPARATOR);
        if (separatorIndex <= 0) return MAIN_ENTRY_LABEL;
        return title.slice(separatorIndex + TITLE_SEPARATOR.length).trim() || MAIN_ENTRY_LABEL;
    }

    /**
     * Splits the entries of one platform into groups sharing the same base title,
     * sorted by base title (direction from the sort selector). Entries inside a
     * group are always sorted A-Z with numbers in natural order (Stagione 2 < Stagione 10).
     */
    function groupByBaseTitle(seriesItems) {
        const groupsByKey = new Map();
        for (const item of seriesItems) {
            const baseTitle = getBaseTitle(item.record.title);
            const groupKey = baseTitle.toLowerCase();
            if (!groupsByKey.has(groupKey)) {
                groupsByKey.set(groupKey, { groupKey: groupKey, baseTitle: baseTitle, items: [] });
            }
            groupsByKey.get(groupKey).items.push(item);
        }

        const direction = sortOrder.value === 'title-desc' ? -1 : 1;
        const groups = [...groupsByKey.values()];
        groups.sort((a, b) => direction * a.groupKey.localeCompare(b.groupKey));
        groups.forEach((group) => {
            group.items.sort((a, b) =>
                a.record.title.localeCompare(b.record.title, undefined, { numeric: true, sensitivity: 'base' })
            );
        });
        return groups;
    }

    /** Skip types that appear in at least one of the entries, in display order. */
    function getRegisteredTypes(items) {
        return SKIP_TYPE_LABELS.filter(({ type }) => items.some((item) => item.record.rules[type]));
    }

    /** State of a group chip: do all the entries that have this type agree? */
    function getGroupChipState(items, skipType) {
        const rules = items.map((item) => item.record.rules[skipType]).filter(Boolean);
        if (rules.every((rule) => rule === RULE_AUTO_SKIP)) return CHIP_STATE.ALL;
        if (rules.every((rule) => rule === RULE_NEVER_SKIP)) return CHIP_STATE.NONE;
        return CHIP_STATE.MIXED;
    }

    // -----------------------------------------------------------------------
    // Rendering: list and platform sections
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

        const platforms = groupByPlatform(visibleSeries);
        Object.keys(platforms).sort().forEach((platformName) => {
            seriesListElement.appendChild(createPlatformSection(platformName, platforms[platformName]));
        });
    }

    /** Builds a collapsible section containing the cards and groups of one platform. */
    function createPlatformSection(platformName, items) {
        const section = document.createElement('div');
        section.className = 'platform-section';

        // Header: platform name + number of entries
        const header = document.createElement('div');
        header.className = 'platform-header';

        const nameElement = document.createElement('span');
        nameElement.textContent = platformName + ' ';

        const countElement = document.createElement('span');
        countElement.style.cssText = 'color:#7e8299; font-size:14px; margin-left:6px;';
        countElement.textContent = `(${items.length})`;

        nameElement.appendChild(countElement);
        header.appendChild(nameElement);

        // Content: a plain card for single entries, a group for several
        const content = document.createElement('div');
        content.className = 'platform-content';
        groupByBaseTitle(items).forEach((group) => {
            if (group.items.length === 1) {
                content.appendChild(createSeriesCard(group.items[0], false));
            } else {
                content.appendChild(createSeriesGroup(platformName, group));
            }
        });

        // Restore the collapsed state from previous renders
        if (collapsedPlatforms.has(platformName)) {
            header.classList.add('collapsed');
            content.classList.add('hidden');
        }

        // Clicking the header collapses/expands the platform
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

    // -----------------------------------------------------------------------
    // Rendering: chips
    // -----------------------------------------------------------------------

    /**
     * Builds a chip. ALL = checked, NONE = unchecked, MIXED = indeterminate
     * (only used by groups). onToggle receives the new checked value.
     */
    function createRuleChip(label, state, tooltip, onToggle) {
        const chip = document.createElement('label');
        chip.className = 'rule-chip';
        chip.title = tooltip;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state === CHIP_STATE.ALL;
        checkbox.indeterminate = state === CHIP_STATE.MIXED;

        const text = document.createElement('span');
        text.textContent = label;

        checkbox.addEventListener('change', () => onToggle(checkbox.checked));

        chip.appendChild(checkbox);
        chip.appendChild(text);
        return chip;
    }

    /** Chips of a single entry: checked = skip automatically, unchecked = never skip. */
    function createEntryRulesList(item) {
        const { storageKey, record } = item;
        const rulesList = document.createElement('div');
        rulesList.className = 'rules-list';

        getRegisteredTypes([item]).forEach(({ type, label }) => {
            const state = record.rules[type] === RULE_AUTO_SKIP ? CHIP_STATE.ALL : CHIP_STATE.NONE;
            rulesList.appendChild(createRuleChip(
                label,
                state,
                'Acceso: salta in automatico. Spento: non saltare mai.',
                (isChecked) => {
                    record.rules[type] = isChecked ? RULE_AUTO_SKIP : RULE_NEVER_SKIP;
                    chrome.storage.local.set({ [storageKey]: record });
                }
            ));
        });

        return rulesList;
    }

    /** Sets the same rule on every entry of the group that already has this type. */
    function applyRuleToGroup(items, skipType, isAutoSkip) {
        const updates = {};
        items.forEach(({ storageKey, record }) => {
            if (!record.rules[skipType]) return; // type never seen for this entry: left alone
            record.rules[skipType] = isAutoSkip ? RULE_AUTO_SKIP : RULE_NEVER_SKIP;
            updates[storageKey] = record;
        });
        // Redraw afterwards so the chips of the entries below show the new state
        chrome.storage.local.set(updates, () => renderSeriesList());
    }

    /** General chips of a group: one per type found in any of its entries. */
    function createGroupRulesList(items) {
        const rulesList = document.createElement('div');
        rulesList.className = 'rules-list';

        getRegisteredTypes(items).forEach(({ type, label }) => {
            rulesList.appendChild(createRuleChip(
                label,
                getGroupChipState(items, type),
                'Applica a tutte le voci del gruppo. Il trattino indica impostazioni diverse tra le voci.',
                (isChecked) => applyRuleToGroup(items, type, isChecked)
            ));
        });

        return rulesList;
    }

    // -----------------------------------------------------------------------
    // Rendering: cards and groups
    // -----------------------------------------------------------------------

    /**
     * Card of a single entry. As a group child it shows only the variant label
     * ("Stagione 2") and no platform badge, because the group already gives the context.
     */
    function createSeriesCard(item, isGroupChild) {
        const { storageKey, record } = item;

        const card = document.createElement('div');
        card.className = isGroupChild ? 'series-card child-card' : 'series-card';

        // Left side: title (and platform badge). textContent avoids HTML injection.
        const info = document.createElement('div');
        info.className = 'info-container';

        const titleElement = document.createElement('div');
        titleElement.className = isGroupChild ? 'series-title child-title' : 'series-title';
        titleElement.textContent = isGroupChild ? getVariantLabel(record.title) : record.title;
        titleElement.title = record.title; // full title as tooltip
        info.appendChild(titleElement);

        if (!isGroupChild) {
            const badgeElement = document.createElement('div');
            badgeElement.className = 'platform-badge';
            badgeElement.textContent = record.platform || UNKNOWN_PLATFORM_LABEL;
            info.appendChild(badgeElement);
        }

        // Right side: chips and delete button
        const deleteButton = document.createElement('button');
        deleteButton.className = 'btn-delete';
        deleteButton.textContent = 'Elimina';
        deleteButton.addEventListener('click', () => {
            chrome.storage.local.remove(storageKey, () => loadSeries());
        });

        const actions = document.createElement('div');
        actions.className = 'card-actions';
        actions.appendChild(createEntryRulesList(item));
        actions.appendChild(deleteButton);

        card.appendChild(info);
        card.appendChild(actions);
        return card;
    }

    /**
     * Group of entries with the same base title: a header row with the general
     * settings, and a collapsible list with one card per entry.
     */
    function createSeriesGroup(platformName, group) {
        const groupId = `${platformName}::${group.groupKey}`;
        const isExpanded = expandedGroups.has(groupId);

        const wrapper = document.createElement('div');
        wrapper.className = 'series-group';

        // Header row
        const headerCard = document.createElement('div');
        headerCard.className = 'series-card group-card' + (isExpanded ? '' : ' collapsed');

        const heading = document.createElement('div');
        heading.className = 'info-container group-heading'; // the arrow is drawn in CSS

        const titleElement = document.createElement('div');
        titleElement.className = 'series-title';
        titleElement.textContent = group.baseTitle;

        const countElement = document.createElement('div');
        countElement.className = 'group-count';
        countElement.textContent = `${group.items.length} stagioni`;

        heading.appendChild(titleElement);
        heading.appendChild(countElement);

        const deleteButton = document.createElement('button');
        deleteButton.className = 'btn-delete';
        deleteButton.textContent = 'Elimina';
        deleteButton.addEventListener('click', () => {
            const message = `Eliminare "${group.baseTitle}" e le sue ${group.items.length} voci?`;
            if (!confirm(message)) return;
            chrome.storage.local.remove(group.items.map((item) => item.storageKey), () => loadSeries());
        });

        const actions = document.createElement('div');
        actions.className = 'card-actions';
        actions.appendChild(createGroupRulesList(group.items));
        actions.appendChild(deleteButton);

        headerCard.appendChild(heading);
        headerCard.appendChild(actions);

        // Children: one card per entry
        const children = document.createElement('div');
        children.className = 'group-children' + (isExpanded ? '' : ' hidden');
        group.items.forEach((item) => {
            children.appendChild(createSeriesCard(item, true));
        });

        // Only the heading toggles the group, so clicking chips/buttons does not
        heading.addEventListener('click', () => {
            const isNowCollapsed = headerCard.classList.toggle('collapsed');
            children.classList.toggle('hidden', isNowCollapsed);
            if (isNowCollapsed) expandedGroups.delete(groupId);
            else expandedGroups.add(groupId);
        });

        wrapper.appendChild(headerCard);
        wrapper.appendChild(children);
        return wrapper;
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