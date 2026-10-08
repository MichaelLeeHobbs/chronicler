/**
 * A module whose catalog is rejected by defineEvents() while the module is evaluated
 * (reserved name "fork"). The parser must report INVALID_CATALOG as a validation error.
 */

import { defineEvents, event } from '../../../src/index';

export const events = defineEvents({
  fork: event({ level: 'info', message: 'Uses a reserved name', doc: 'Invalid' }),
} as never);
