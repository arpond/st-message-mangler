import { context, MODULE_NAME } from './context.js';
import { log, warn } from './log.js';
import { defaultEffectShape, DEFAULT_SETTINGS, migrateLegacySettings, backfillDefaults, sanitizeScaleSteps } from './pure.js';

export function getSettings() {
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    const settings = context.extensionSettings[MODULE_NAME];
    migrateLegacySettings(settings, log);
    backfillDefaults(settings, DEFAULT_SETTINGS, warn);
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
