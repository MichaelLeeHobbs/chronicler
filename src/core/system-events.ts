/**
 * Internal Chronicler system events
 *
 * These events are emitted by Chronicler itself to report internal issues,
 * warnings, and diagnostic information. The `chronicler.*` event key prefix
 * is reserved for system events only.
 */

import { SYSTEM_EVENT_PREFIX } from './constants';
import { defineEvent, defineEventGroup } from './events';
import { t } from './fields';

/**
 * System event group for internal Chronicler events
 *
 * Event key prefix `chronicler.*` is reserved and cannot be used by user-defined events.
 */
export const chroniclerSystemEvents = defineEventGroup({
  key: SYSTEM_EVENT_PREFIX.slice(0, -1), // Remove trailing dot for group key
  type: 'system',
  doc: 'Internal Chronicler system events for diagnostics and warnings',
  events: {
    /**
     * Emitted when addContext() attempts to set keys that already exist.
     * The original values are preserved, and the attempted values are rejected.
     * Multiple collisions from a single addContext() call are combined into one event.
     */
    contextCollision: defineEvent({
      key: `${SYSTEM_EVENT_PREFIX}contextCollision`,
      level: 'warn',
      message: 'Context key collisions detected',
      doc: 'Emitted when addContext() attempts to override existing context keys',
      fields: {
        keys: t.string().doc('Comma-separated list of keys that collided'),
        count: t.number().doc('Number of collisions'),
      },
    } as const),

    /**
     * Emitted when context key limit is reached and keys are dropped.
     */
    contextLimitReached: defineEvent({
      key: `${SYSTEM_EVENT_PREFIX}contextLimitReached`,
      level: 'warn',
      message: 'Context key limit reached, keys dropped',
      doc: 'Emitted when addContext() exceeds the configured maxContextKeys limit',
      fields: {
        keys: t.string().doc('Comma-separated list of dropped keys'),
        count: t.number().doc('Number of dropped keys'),
      },
    } as const),

    /**
     * Emitted when reserved field names are used in context.
     * Reserved fields are silently dropped.
     * Multiple reserved field attempts from a single addContext() call are combined into one event.
     */
    reservedFieldAttempt: defineEvent({
      key: `${SYSTEM_EVENT_PREFIX}reservedFieldAttempt`,
      level: 'warn',
      message: 'Attempted to use reserved field names',
      doc: 'Emitted when addContext() attempts to use reserved field names',
      fields: {
        keys: t.string().doc('Comma-separated list of reserved field names that were attempted'),
        count: t.number().doc('Number of reserved field attempts'),
      },
    } as const),
  },
} as const);
