/**
 * Smart Skip Intro - content script
 *
 * Flow:
 *  1. Detect which streaming platform the current page belongs to (once, at startup).
 *  2. Every POLL_INTERVAL_MS, look for each skip button the platform supports
 *     (intro, recap, outro, preview).
 *  3. The first time a button type is seen for a series, register that type in
 *     the library and let it play (so the user can decide later).
 *  4. On later visits, apply the stored rule of that type: auto-skip or never skip.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBUG = true;
const POLL_INTERVAL_MS = 800; // How often we look for skip buttons
const CLICK_DELAY_MS = 500; // Small delay before clicking, so the button is fully interactive

// After a skip type is registered for the first time, ignore auto-skip for that
// same series + type while we are still in the SAME episode and within this time.
// The page may re-render or briefly hide/show the button during the same segment,
// and that must never be mistaken for a new appearance. As soon as the episode
// changes (different page path) the protection no longer applies.
const FIRST_VIEW_PROTECTION_MS = 3 * 60 * 1000;

// Storage names. They are shared with popup.js and options.js:
// if you rename one here, rename it in those files too.
const STORAGE_KEY_ENABLED = 'isExtensionEnabled'; // master on/off switch
const STORAGE_KEY_ENABLED_SKIP_TYPES = 'enabledSkipTypes'; // per-type switches, e.g. { intro: true, recap: false }
const STORAGE_KEY_PREFIX = 'series_'; // full key: series_<platformId>_<seriesTitle>
const RULE_AUTO_SKIP = 'auto_skip';
const RULE_NEVER_SKIP = 'never_skip';

// Kinds of skippable segments. The values are saved in storage (inside "rules")
// and are also used by options.js.
const SKIP_TYPES = Object.freeze({
    INTRO: 'intro',
    RECAP: 'recap', // "previously on..."
    OUTRO: 'outro', // end credits
    PREVIEW: 'preview' // preview of the next episode
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let isExtensionEnabled = true;

// Per-type switches set in the popup. A type is enabled unless explicitly set to false.
let enabledSkipTypes = {};

// For each skip type, the last button element we already processed.
// Prevents handling the same button on every tick; the entry is removed when
// the button disappears or is hidden.
const lastHandledButtons = new Map();

// Registrations made during this page session, used to protect the first view.
// key: "<storageKey>::<skipType>", value: { time: timestamp, episodeId: string }
const firstViewRegistrations = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(message) {
    if (DEBUG) console.log(`[Smart Skip] ${message}`);
}

/** Returns the trimmed text of the first element matching the selector, or null. */
function readTextFromSelector(selector) {
    const element = document.querySelector(selector);
    const text = element?.textContent?.trim();
    return text || null;
}

/** True unless the user turned this skip type off in the popup. */
function isSkipTypeEnabled(skipType) {
    return enabledSkipTypes[skipType] !== false;
}

/** An element is considered usable only if it is displayed and clickable. */
function isElementVisible(element) {
    const style = window.getComputedStyle(element);
    return !(
        style.opacity === '0' ||
        style.display === 'none' ||
        style.pointerEvents === 'none'
    );
}

// ---------------------------------------------------------------------------
// Platform definitions
//
// To support a new platform, add an entry here and add its URL pattern to
// "content_scripts.matches" in manifest.json.
//
//  id         -> used inside the storage key (do not change once released)
//  label      -> human-readable name saved with each series
//  hostnames  -> substrings matched against window.location.hostname
//  skipButtons-> one entry per supported skip type. Each value is either a CSS
//                selector or a function returning the button element (or null)
//  getTitle() -> returns the series title, or null if not available yet
// ---------------------------------------------------------------------------

const PLATFORMS = [
    {
        id: 'crunchyroll',
        label: 'CRUNCHYROLL',
        hostnames: ['crunchyroll.com'],
        // Crunchyroll keeps all these buttons in the page and only hides them
        // (opacity 0 + pointer-events none) until they are needed.
        // The English labels are a best guess and still need to be verified.
        skipButtons: {
            [SKIP_TYPES.INTRO]:
                'button[aria-label="Salta intro"], button[aria-label="Skip intro"], [data-testid="vilos-skip-intro_button"]',
            [SKIP_TYPES.RECAP]:
                'button[aria-label="Salta riepilogo"], button[aria-label="Skip recap"]',
            [SKIP_TYPES.OUTRO]:
                'button[aria-label="Salta titoli di coda"], button[aria-label="Skip credits"]',
            [SKIP_TYPES.PREVIEW]:
                'button[aria-label="Salta anteprima"], button[aria-label="Skip preview"]'
        },
        getTitle: () => {
            const element = document.querySelector('[data-t="show-title-link"] h4');
            return element?.innerText?.trim() || null;
        }
    },
    {
        id: 'netflix',
        label: 'NETFLIX',
        hostnames: ['netflix.com'],
        // TODO: split recap into its own type (button[data-uia="player-skip-recap"])
        skipButtons: {
            [SKIP_TYPES.INTRO]:
                'button[data-uia="player-skip-intro"], button[data-uia="player-skip-recap"]'
        },
        getTitle: () => {
            const container = document.querySelector('[data-uia="video-title"]');
            if (!container) return null;
            // The real series title is usually in the first child (h4); the
            // rest of the container may hold the episode number/name.
            const titleElement = container.querySelector('h4') || container.firstElementChild;
            return (titleElement || container).textContent.trim() || null;
        }
    },
    {
        id: 'primevideo',
        label: 'PRIME VIDEO',
        hostnames: ['primevideo.com'],
        skipButtons: {
            [SKIP_TYPES.INTRO]:
                'button[aria-label="Salta intro"], button[aria-label="Skip intro"], .atvwebplayersdk-skipelement-button, [class*="skipElement"]'
        },
        getTitle: () => {
            // Preferred source: the page title, e.g. "Prime Video: Series Name"
            const pageTitle = document.title;
            if (pageTitle?.includes('Prime Video:')) {
                const cleaned = pageTitle.replace('Prime Video:', '').trim();
                if (cleaned && !cleaned.toLowerCase().includes('guarda')) return cleaned;
            }
            // Fallback: the title shown inside the player
            return readTextFromSelector('.atvwebplayersdk-title-text');
        }
    },
    {
        id: 'disneyplus',
        label: 'DISNEY+',
        hostnames: ['disneyplus.com'],
        skipButtons: {
            [SKIP_TYPES.INTRO]: () => {
                // The button lives inside two nested shadow roots:
                // skip-overlay > #shadow > skip-button > #shadow > button
                const overlay = document.querySelector('skip-overlay');
                const skipButton = overlay?.shadowRoot?.querySelector('skip-button');
                return skipButton?.shadowRoot?.querySelector('button') || null;
            }
        },
        getTitle: () => {
            // Preferred source: the page title, e.g. "Series Name | Disney+"
            const pageTitle = document.title;
            if (pageTitle?.includes('| Disney+')) {
                const cleaned = pageTitle.split('|')[0].trim();
                if (cleaned) return cleaned;
            }
            // Fallback: title elements inside the player
            return readTextFromSelector('.title-field, .content-title, [data-testid="video-title"]');
        }
    }
];

/** Finds the platform matching the current hostname (or undefined). */
function detectCurrentPlatform() {
    const hostname = window.location.hostname;
    return PLATFORMS.find((platform) =>
        platform.hostnames.some((name) => hostname.includes(name))
    );
}

/** Returns the button of the given type, or null. Works with selectors and functions. */
function findSkipButton(platform, skipType) {
    const finder = platform.skipButtons[skipType];
    return typeof finder === 'function' ? finder() : document.querySelector(finder);
}

// ---------------------------------------------------------------------------
// Skip logic
// ---------------------------------------------------------------------------

/**
 * Identifies the episode being watched. Streaming sites are single-page apps:
 * moving to the next episode does not reload the page, but the path changes
 * (e.g. /watch/<episodeId>). Query strings are ignored because some sites add
 * tracking parameters that change without the episode changing.
 */
function getCurrentEpisodeId() {
    return window.location.pathname;
}

/**
 * True if this series + skip type was registered a moment ago AND we are still
 * in the same episode (i.e. we are looking at the very segment we registered).
 */
function isStillFirstView(storageKey, skipType) {
    const registration = firstViewRegistrations.get(`${storageKey}::${skipType}`);
    if (!registration) return false;

    const isSameEpisode = registration.episodeId === getCurrentEpisodeId();
    const isRecent = Date.now() - registration.time < FIRST_VIEW_PROTECTION_MS;
    return isSameEpisode && isRecent;
}

/** Clicks the button after a short delay, looking it up again to avoid stale references. */
function clickSkipButtonLater(platform, skipType, title) {
    setTimeout(() => {
        const freshButton = findSkipButton(platform, skipType);
        // A programmatic click ignores "pointer-events: none", so check visibility first
        if (freshButton && isElementVisible(freshButton)) {
            freshButton.click();
            log(`Skipped ${skipType} for: ${title}.`);
        }
    }, CLICK_DELAY_MS);
}

/** First time this skip type is seen for a series: save the default rule and let it play. */
function registerSkipType(platform, skipType, title, storageKey, storedRecord) {
    const record = storedRecord && typeof storedRecord === 'object'
        ? storedRecord
        : { title: title, platform: platform.label, rules: {} };

    // Mark the first view synchronously, before the (async) save, so that any
    // later check already sees the protection.
    firstViewRegistrations.set(`${storageKey}::${skipType}`, {
        time: Date.now(),
        episodeId: getCurrentEpisodeId()
    });

    record.rules = { ...record.rules, [skipType]: RULE_AUTO_SKIP };
    chrome.storage.local.set({ [storageKey]: record });
    log(`First ${skipType} for: ${title}. Registered in the library (left playing).`);
}

/** Applies the stored rule of this skip type (or registers it if it is new). */
function applyStoredRule(platform, skipType, title, storageKey, storedRecord) {
    const rule = storedRecord?.rules?.[skipType];

    if (!rule) {
        registerSkipType(platform, skipType, title, storageKey, storedRecord);
        return;
    }

    // Same segment we just registered (e.g. the button was re-rendered): leave it playing
    if (isStillFirstView(storageKey, skipType)) {
        log(`The ${skipType} of ${title} was just registered in this episode: leaving it playing.`);
        return;
    }

    if (rule === RULE_AUTO_SKIP) {
        clickSkipButtonLater(platform, skipType, title);
    } else if (rule === RULE_NEVER_SKIP) {
        log(`Rule active: not skipping the ${skipType} of ${title}.`);
    }
}

/**
 * Checks one skip type. Returns true if a new button was found and is being
 * processed, false otherwise.
 */
function checkSkipButton(platform, skipType) {
    const button = findSkipButton(platform, skipType);

    // Some platforms (e.g. Crunchyroll) keep every button in the page and only
    // hide it, so "not visible" must count as "gone": the next time the button
    // shows up it has to be treated as new.
    if (!button || !isElementVisible(button)) {
        lastHandledButtons.delete(skipType);
        return false;
    }

    // Already handled this appearance of the button
    if (lastHandledButtons.get(skipType) === button) return false;

    // Without a title we cannot identify the series: retry on the next tick
    // (the button is intentionally NOT marked as handled yet).
    const title = platform.getTitle();
    if (!title) return false;

    lastHandledButtons.set(skipType, button);

    const storageKey = `${STORAGE_KEY_PREFIX}${platform.id}_${title}`;
    chrome.storage.local.get([storageKey], (result) => {
        applyStoredRule(platform, skipType, title, storageKey, result[storageKey]);
    });
    return true;
}

/** One polling tick: check every supported skip type of the platform. */
function checkAllSkipButtons(platform) {
    if (!isExtensionEnabled) return;

    for (const skipType of Object.keys(platform.skipButtons)) {
        if (!isSkipTypeEnabled(skipType)) continue; // turned off in the popup: ignore it completely

        // Handle at most one new button per tick. Registering a type does a
        // read-modify-write on the series record, so two types processed at the
        // same time could overwrite each other. The next one waits for the next tick.
        if (checkSkipButton(platform, skipType)) break;
    }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function initialize() {
    const platform = detectCurrentPlatform();
    if (!platform) return; // Not a supported site: do nothing

    log(`Content script started on host: ${window.location.hostname} (${platform.id})`);

    // Load the on/off switch state and keep it in sync with the popup toggle.
    chrome.storage.local.get([STORAGE_KEY_ENABLED, STORAGE_KEY_ENABLED_SKIP_TYPES], (result) => {
        isExtensionEnabled = result[STORAGE_KEY_ENABLED] !== false;
        enabledSkipTypes = result[STORAGE_KEY_ENABLED_SKIP_TYPES] || {};
    });

    chrome.storage.onChanged.addListener((changes) => {
        // A removed key (e.g. after "reset memory") has no new value: fall back to the defaults
        if (changes[STORAGE_KEY_ENABLED]) {
            isExtensionEnabled = changes[STORAGE_KEY_ENABLED].newValue !== false;
        }
        if (changes[STORAGE_KEY_ENABLED_SKIP_TYPES]) {
            enabledSkipTypes = changes[STORAGE_KEY_ENABLED_SKIP_TYPES].newValue || {};
        }
    });

    setInterval(() => checkAllSkipButtons(platform), POLL_INTERVAL_MS);
}

initialize();