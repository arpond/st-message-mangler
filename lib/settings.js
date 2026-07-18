import { context, MODULE_NAME } from './context.js';
import { log, warn } from './log.js';
import {
    defaultTrackerShape, defaultEffectShape, DEFAULT_SETTINGS, migrateLegacySettings, migrateEffectsToTrackers,
    backfillDefaults, sanitizeScaleSteps, migrateEffectDependency,
} from './pure.js';

export function getSettings() {
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    const settings = context.extensionSettings[MODULE_NAME];
    migrateLegacySettings(settings, log);
    // Must run before the DEFAULT_SETTINGS backfill below — that backfill would otherwise
    // silently fill in an empty `trackers: []` on its own and make migrateEffectsToTrackers'
    // own guard think migration already happened.
    migrateEffectsToTrackers(settings, log);
    backfillDefaults(settings, DEFAULT_SETTINGS, warn);
    for (const tracker of settings.trackers) {
        backfillDefaults(tracker, defaultTrackerShape(), warn);
        migrateEffectDependency(tracker);
    }
    for (const effect of settings.effects) {
        backfillDefaults(effect, defaultEffectShape(effect.type), warn);
        sanitizeScaleSteps(effect.llmRewrite.scaleSteps, warn);
    }
    return settings;
}

// Hidden debug flag — no UI control (see DEFAULT_SETTINGS.debug). Verbose enough to trace a
// single message's path through detection/trigger/transform without needing to re-read the code.
export function debugLog(...args) {
    if (getSettings().debug) log('[debug]', ...args);
}
