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
     * Emitted when addContext() attempts to set a key that already exists.
     * The original value is preserved, and the attempted value is rejected.
     */
    contextCollision: defineEvent({
      key: `${SYSTEM_EVENT_PREFIX}contextCollision`,
      level: 'warn',
      message: 'Context key collision detected',
      doc: 'Emitted when addContext() attempts to override an existing context key',
      fields: {
        key: t.string().doc('Context key that collided'),
        existingValue: t.string().doc('Current value that was preserved'),
        attemptedValue: t.string().doc('Attempted value that was rejected'),
        relatedEventKey: t
          .string()
          .optional()
          .doc('Event key that triggered the collision (if from an event)'),
      },
    } as const),

    /**
     * Emitted when a reserved field name is used in context.
     * Reserved fields are silently dropped.
     */
    reservedFieldAttempt: defineEvent({
      key: `${SYSTEM_EVENT_PREFIX}reservedFieldAttempt`,
      level: 'warn',
      message: 'Attempted to use reserved field name',
      doc: 'Emitted when addContext() attempts to use a reserved field name',
      fields: {
        key: t.string().doc('Reserved field name that was attempted'),
      },
    } as const),
  },
} as const);
