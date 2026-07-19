// Stand-in for SillyTavern's public/reasoning.js — only the export lib/llmClient.js uses. Not
// exercised by this smoke test (no LLM calls made), just needs to satisfy the import.
export function removeReasoningFromString(text) {
    return text;
}
