// Shared "closest row -> data-*-id -> find in settings array" lookup, replacing the same
// three-line closest/find/guard pattern repeated across settingsUI.js's and statusPanel.js's
// delegated handlers. `rowSelector` defaults to the settings-panel row class; statusPanel.js
// passes its own (differently-classed) row selector instead.
export function findTrackerFromEl(el, settings, rowSelector = '.st_mangler_tracker') {
    return settings.trackers.find(t => t.id === $(el).closest(rowSelector).data('tracker-id'));
}

export function findEffectFromEl(el, settings, rowSelector = '.st_mangler_effect') {
    return settings.effects.find(e => e.id === $(el).closest(rowSelector).data('effect-id'));
}
