// Classic (non-module) script — must run and set `window.SillyTavern` before the extension's
// `lib/context.js` executes `SillyTavern.getContext()` at module-import time. Loaded as a plain
// <script> tag ahead of the <script type="module"> that imports the extension, since classic
// scripts run synchronously during parsing while module scripts are deferred.
//
// Minimal surface: only what index.js/pipeline.js/settingsUI.js/statusPanel.js/lib/*.js touch at
// load time and during the modal-open/expand-row/type-a-keystroke smoke test below. No LLM/chat
// state is exercised here, so generateRaw etc. are inert stubs, not working implementations.
(function () {
    function noop() {}

    const listeners = new Map();
    const eventSource = {
        on(type, cb) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(cb);
        },
        emit(type, ...args) {
            (listeners.get(type) || []).forEach((cb) => cb(...args));
        },
    };

    class SlashCommandEnumValue {
        constructor(name, description) {
            this.name = name;
            this.description = description;
        }
    }

    const context = {
        chat: [],
        chatMetadata: {},
        characters: [],
        groups: [],
        characterId: undefined,
        groupId: null,
        extensionSettings: {},
        eventSource,
        eventTypes: {
            MESSAGE_SENT: 'message_sent',
            CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
            CHAT_CHANGED: 'chat_id_changed',
            CONNECTION_PROFILE_LOADED: 'connection_profile_loaded',
        },
        saveSettingsDebounced: noop,
        saveMetadataDebounced: noop,
        saveChat: noop,
        setExtensionPrompt: noop,
        updateMessageBlock: noop,
        substituteParams: (s) => s,
        generateRaw: async () => '',
        ConnectionManagerRequestService: { sendRequest: async () => ({}) },
        SlashCommandParser: { addCommandObject: noop },
        SlashCommand: { fromProps: (o) => o },
        SlashCommandNamedArgument: { fromProps: (o) => o },
        SlashCommandArgument: { fromProps: (o) => o },
        SlashCommandEnumValue,
        ARGUMENT_TYPE: { STRING: 'string', NUMBER: 'number', BOOLEAN: 'boolean' },
    };

    window.SillyTavern = { getContext: () => context };
})();
