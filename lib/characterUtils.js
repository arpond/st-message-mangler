import { context, getCurrentCharacterId, getCurrentGroupId, getCurrentGroups } from './context.js';
import { resolveBindableCharacters } from './pure.js';

// Thin context-reading wrapper — the actual scoping logic is resolveBindableCharacters (lib/pure.js,
// unit-tested). Shared by statusPanel.js (per-chat binding picker). characterId/groupId/groups are
// read live (getCurrentCharacterId/getCurrentGroupId/getCurrentGroups), not from the cached
// `context` — see lib/context.js's caching-hazard note; using the cached values here previously
// made every binding picker fall back to the full character roster after the first chat switch.
export function bindableCharacters() {
    return resolveBindableCharacters(context.characters, getCurrentGroupId(), getCurrentGroups(), getCurrentCharacterId());
}
