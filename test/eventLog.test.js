import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logEvent, logCueEvent, getEventLog, clearEventLog } from '../lib/eventLog.js';

test('logEvent/getEventLog round-trips an event, filtered by trackerId', () => {
    clearEventLog();
    logEvent('tracker-a', 'level-change', { from: 0, to: 0.3, reason: 'keyword hit' });
    logEvent('tracker-b', 'level-change', { from: 0, to: 0.5, reason: 'keyword hit' });
    assert.equal(getEventLog('tracker-a').length, 1);
    assert.equal(getEventLog('tracker-a')[0].detail.to, 0.3);
    assert.equal(getEventLog('tracker-b').length, 1);
    clearEventLog();
});

test('logEvent caps the buffer at 150, dropping the oldest first', () => {
    clearEventLog();
    for (let i = 0; i < 155; i++) logEvent('tracker-a', 'level-change', { from: 0, to: i, reason: 'keyword hit' });
    const events = getEventLog('tracker-a');
    assert.equal(events.length, 150);
    assert.equal(events[0].detail.to, 5); // oldest 5 (0-4) dropped
    assert.equal(events[149].detail.to, 154);
    clearEventLog();
});

test('logCueEvent only logs once per distinct cue text for the same key, not on every call', () => {
    clearEventLog();
    logCueEvent('effect-1', 'tracker-a', 'Fear is rising');
    logCueEvent('effect-1', 'tracker-a', 'Fear is rising'); // unchanged — should not log again
    assert.equal(getEventLog('tracker-a').length, 1);

    logCueEvent('effect-1', 'tracker-a', 'Fear is peaking'); // changed — logs again
    assert.equal(getEventLog('tracker-a').length, 2);
    clearEventLog();
});

test('logCueEvent clearing (empty text) does not log, but lets the same text log again afterward', () => {
    clearEventLog();
    logCueEvent('effect-1', 'tracker-a', 'Fear is rising');
    logCueEvent('effect-1', 'tracker-a', ''); // cue cleared/inactive — no log entry
    assert.equal(getEventLog('tracker-a').length, 1);

    logCueEvent('effect-1', 'tracker-a', 'Fear is rising'); // re-activated with the same text — logs again
    assert.equal(getEventLog('tracker-a').length, 2);
    clearEventLog();
});

test('clearEventLog empties every tracker\'s log', () => {
    logEvent('tracker-a', 'level-change', { from: 0, to: 0.3, reason: 'keyword hit' });
    clearEventLog();
    assert.equal(getEventLog('tracker-a').length, 0);
});
