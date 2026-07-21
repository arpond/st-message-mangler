import { context, MODULE_NAME } from './context.js';
import { log, warn } from './log.js';
import {
    defaultTrackerShape, defaultEffectShape, DEFAULT_SETTINGS, migrateLegacySettings, migrateEffectsToTrackers,
    backfillDefaults, sanitizeScaleSteps, sanitizeRules, migrateEffectDependency, migrateAmountToSteps, sanitizeAmountSteps,
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
    sanitizeScaleSteps(settings.globalAwareness.steps, warn);
    for (const tracker of settings.trackers) {
        backfillDefaults(tracker, defaultTrackerShape(), warn);
        migrateEffectDependency(tracker);
    }
    for (const effect of settings.effects) {
        migrateAmountToSteps(effect.llmRewrite); // must run before backfillDefaults below — that
        // would otherwise fill in amountSteps: [] first and make this migration's "already an
        // array" no-op guard think migration already happened, discarding an old flat `amount` choice
        backfillDefaults(effect, defaultEffectShape(effect.type), warn);
        sanitizeScaleSteps(effect.llmRewrite.scaleSteps, warn);
        sanitizeAmountSteps(effect.llmRewrite.amountSteps, warn);
        sanitizeRules(effect.rules, warn);
    }
    return settings;
}

// Hidden debug flag — no UI control (see DEFAULT_SETTINGS.debug). Verbose enough to trace a
// single message's path through detection/trigger/transform without needing to re-read the code.
// Reads the raw stored flag directly instead of going through getSettings() — that function reruns
// full migration/backfill/sanitize over every tracker and effect on every call, and debugLog fires
// dozens of times per message, so routing through it made debug-flag checks a hot-path cost even
// with logging disabled.
export function debugLog(...args) {
    if (context.extensionSettings[MODULE_NAME]?.debug) log('[debug]', ...args);
}

// Cheap check for call sites that need to skip building an expensive debug-only string/args (e.g.
// scans, JSON.stringify) rather than just passing args to debugLog — template-literal arguments
// are evaluated eagerly at the call site regardless of whether debugLog ends up logging them.
export function isDebugEnabled() {
    return !!context.extensionSettings[MODULE_NAME]?.debug;
}
