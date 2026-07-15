// Pure, dependency-free logic extracted out of index.js so it can be unit-tested with plain
// Node (no SillyTavern/jQuery globals needed). index.js imports these rather than redefining
// them — this file is the single source of truth for their behavior.

export function clamp01(n) {
    return Math.max(0, Math.min(1, n));
}

export function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reused for both the normal escalation keyword list and the dispel keyword list — same
// "any word in this comma list appears" test, just against different fields.
export function matchesKeywordList(text, keywordList) {
    const words = keywordList.split(',').map(w => w.trim()).filter(Boolean);
    if (words.length === 0) return false;
    const re = new RegExp(`\\b(${words.map(escapeRegExp).join('|')})\\b`, 'i');
    return re.test(text);
}

export function applyRegexEffect(text, regex, warnFn = console.warn) {
    if (!regex.pattern) return text;
    try {
        const re = new RegExp(regex.pattern, regex.flags ?? 'gi');
        return text.replace(re, regex.replacement ?? '');
    } catch (err) {
        warnFn(`Skipping regex effect — invalid pattern:`, err.message);
        return text;
    }
}

// Word-level mangler: occasional letter-doubling and trailing elongation. Deliberately
// simple/deterministic-ish (weighted by intensity) rather than a "real" phonetic model.
export function applyDrunk(text, intensity) {
    const words = text.split(/(\s+)/);
    return words.map(word => {
        if (/^\s+$/.test(word) || word.length < 2) return word;
        let chars = word.split('');
        chars = chars.flatMap(c => (/[a-zA-Z]/.test(c) && Math.random() < intensity * 0.4) ? [c, c] : [c]);
        if (/[a-zA-Z]$/.test(word) && Math.random() < intensity) {
            const lastChar = chars[chars.length - 1];
            chars = chars.concat(Array(Math.ceil(intensity * 3)).fill(lastChar));
        }
        return chars.join('');
    }).join('');
}

// Catches the classic LLM failure mode of a short chunk repeating itself into a runaway loop
// (e.g. "...ceralceralceralceral...") — a 3-20 char unit immediately repeated 10+ times in a
// row. Not a proof the whole output is bad, just a cheap tripwire for the specific pathology.
export function looksDegenerate(text) {
    return /(.{3,20})\1{10,}/s.test(text);
}

export function escapeHtmlForDisplay(text) {
    return text.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

// Word-level longest-common-subsequence diff: wraps words in `mangled` that AREN'T part of the
// LCS with `original` in a highlight span, so only what actually changed is colored. Display-only
// (called while building message.extra.display_text) — never touches message.mes/what the model
// receives. Guarded against pathological input length since it's a standard O(n*m) DP.
export function wordDiffHighlight(original, mangled) {
    const origWords = original.split(/(\s+)/);
    const newWords = mangled.split(/(\s+)/);
    if (origWords.length > 1000 || newWords.length > 1000) return escapeHtmlForDisplay(mangled);

    const n = origWords.length, m = newWords.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = origWords[i] === newWords[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const keep = new Array(m).fill(false);
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (origWords[i] === newWords[j]) { keep[j] = true; i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
    }

    return newWords.map((w, idx) => {
        const esc = escapeHtmlForDisplay(w);
        return /^\s+$/.test(w) || keep[idx] ? esc : `<span class="st_mangler_changed">${esc}</span>`;
    }).join('');
}

// Also resets a numeric field to its default if the existing value isn't a valid finite number —
// guards against corruption from hand-edited or malformed imported JSON. Without this, a bad
// value silently becomes NaN, and e.g. `NaN < minLevelToApply` is always false, so a corrupted
// effect could end up permanently "always active" with no error ever surfaced.
export function backfillDefaults(target, defaults, warnFn = console.warn) {
    for (const key of Object.keys(defaults)) {
        const defaultValue = defaults[key];
        if (target[key] === undefined) {
            target[key] = structuredClone(defaultValue);
        } else if (typeof defaultValue === 'number' && !Number.isFinite(Number(target[key]))) {
            warnFn(`Invalid value for "${key}" (${JSON.stringify(target[key])}) — resetting to default ${defaultValue}.`);
            target[key] = defaultValue;
        } else if (defaultValue !== null && typeof defaultValue === 'object' && !Array.isArray(defaultValue)
            && target[key] !== null && typeof target[key] === 'object') {
            backfillDefaults(target[key], defaultValue, warnFn);
        }
    }
}
