/**
 * A module with no event catalog: a plain object and a Chronicler 1.x-style group.
 */

export const notACatalog = { hello: 'world' };

export const legacyGroup = { key: 'system', type: 'system', doc: 'Old style', events: {} };
