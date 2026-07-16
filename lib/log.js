const LOG_PREFIX = '[message-mangler]';
export const log = (...args) => console.log(LOG_PREFIX, ...args);
export const warn = (...args) => console.warn(LOG_PREFIX, ...args);
