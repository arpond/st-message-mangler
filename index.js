// Message Mangler: rewrites the user's chat input via a configurable pipeline of "effects"
// (regex find/replace, algorithmic drunk-mangling, or full LLM rewrites) before it's rendered
// and sent to the LLM. Hooks MESSAGE_SENT, which fires right after the message is pushed into
// chat[] but BEFORE addOneMessage() renders it and before generation is kicked off by the
// caller — so mutating message.mes here affects both the displayed bubble and what the model
// actually receives (see public/script.js sendMessageAsUser()).
//
// This file is just bootstrap wiring — the actual logic lives in lib/ (settings, chat state, LLM
// calls, pure rendering/logic), pipeline.js (the detect/trigger/transform pipeline + hooks),
// render.js (effect-list rendering), statusPanel.js (floating status overlay), and
// settingsUI.js (the settings panel itself). See DEVELOPMENT.md for the full module map.

import { context } from './lib/context.js';
import { log } from './lib/log.js';
import { getSettings } from './lib/settings.js';
import { resetLevelsOnFreshFork } from './lib/chatState.js';
import { onMessageSent, onCharacterMessageRendered, clearAllAwarenessCues, clearAllTrackerAutoCues, clearGlobalAwarenessCue } from './pipeline.js';
import { addWandStatusButton, addWandPauseButton } from './statusPanel.js';
import { addSettingsUI, registerSlashCommands, refreshEffectList, refreshTrackerList, refreshDetectionProfileDropdown } from './settingsUI.js';

getSettings();
addSettingsUI();
addWandStatusButton();
addWandPauseButton();
registerSlashCommands();
context.eventSource.on(context.eventTypes.MESSAGE_SENT, onMessageSent);
context.eventSource.on(context.eventTypes.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);
context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => {
    const settings = getSettings();
    clearAllAwarenessCues(settings);
    clearAllTrackerAutoCues(settings);
    clearGlobalAwarenessCue();
    resetLevelsOnFreshFork(settings);
    // Levels/turns/locked are per-chat — the settings panel's collapsed-row badges (and the
    // floating status panel, refreshed as part of the same call) were otherwise left showing
    // whatever chat they were last rendered for until some unrelated action (e.g. expanding a
    // row) happened to force a re-render.
    refreshTrackerList(settings);
    refreshEffectList(settings);
});
context.eventSource.on(context.eventTypes.CONNECTION_PROFILE_LOADED, () => refreshDetectionProfileDropdown(getSettings()));
log('Extension loaded.');
