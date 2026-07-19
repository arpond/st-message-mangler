// Stand-in for SillyTavern's top-level public/script.js — only the two named exports this
// extension actually imports from it (pipeline.js, settingsUI.js).
export const extension_prompt_types = {
    NONE: 0,
    BEFORE_PROMPT: 1,
    IN_PROMPT: 2,
    IN_CHAT: 3,
};

export const extension_prompt_roles = {
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
};
