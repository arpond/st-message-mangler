// Single shared SillyTavern context handle + this extension's settings-storage key. Every other
// module imports `context` from here rather than calling SillyTavern.getContext() itself, so
// there's exactly one cached reference in play (mirrors how index.js already cached it before
// this file existed) — except chatMetadata (see lib/chatState.js's getChatMetadata) and
// characterId/groupId (see getCurrentCharacterId/getCurrentGroupId below), which are re-fetched
// fresh on every read since SillyTavern reassigns the underlying this_chid/selected_group/
// chat_metadata variables on every chat switch, and getContext() just snapshots their value at
// call time into a plain field — a cached `context.characterId`/`context.groupId` silently goes
// stale the moment you switch chats after the extension loaded (same bug class as chatMetadata).
export const context = SillyTavern.getContext();
export const MODULE_NAME = 'st_message_mangler';

// Live re-fetch — see the caching-hazard note above. Cheap (getContext() is a plain object
// literal build, not an expensive call), so there's no reason to risk the stale-snapshot bug to
// save it.
export function getCurrentCharacterId() {
    return SillyTavern.getContext().characterId;
}

export function getCurrentGroupId() {
    return SillyTavern.getContext().groupId;
}

// `groups` is a live-mutated array in most cases, EXCEPT group-chats.js's getGroups() (fired on
// every groups list refetch) reassigns it wholesale (`groups = data.slice()`) rather than
// mutating in place — same staleness hazard as characterId/groupId above, just less obvious since
// most of the module list (chat, characters) really is mutate-in-place-safe to cache.
export function getCurrentGroups() {
    return SillyTavern.getContext().groups;
}
