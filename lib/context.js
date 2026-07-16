// Single shared SillyTavern context handle + this extension's settings-storage key. Every other
// module imports `context` from here rather than calling SillyTavern.getContext() itself, so
// there's exactly one cached reference in play (mirrors how index.js already cached it before
// this file existed) — except chatMetadata, which is re-fetched fresh on every read elsewhere
// (see lib/chatState.js) since SillyTavern reassigns it on every chat switch.
export const context = SillyTavern.getContext();
export const MODULE_NAME = 'st_message_mangler';
