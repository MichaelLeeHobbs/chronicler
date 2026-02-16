/**
 * Comprehensive event definitions for testing the docs CLI pipeline end-to-end.
 * Exercises all field builder variations, group types, and edge cases.
 */

import { defineCorrelationGroup, defineEvent, defineEventGroup } from '../../../src/core/events';
import { field } from '../../../src/core/fields';

/**
 * Standalone event — not inside any group.
 */
export const healthCheck = defineEvent({
  key: 'app.healthCheck',
  level: 'debug',
  message: 'Health check performed',
  doc: 'Periodic health check ping',
} as const);

/**
 * System group — inline events with all field type variations.
 */
export const system = defineEventGroup({
  key: 'system',
  type: 'system',
  doc: 'System lifecycle events',
  events: {
    startup: defineEvent({
      key: 'system.startup',
      level: 'info',
      message: 'Application started',
      doc: 'Emitted when the application starts',
      fields: {
        port: field.number().doc('Server port'),
        env: field.string().optional().doc('Runtime environment'),
      },
    } as const),
    shutdown: defineEvent({
      key: 'system.shutdown',
      level: 'info',
      message: 'Application shutdown',
      doc: 'Emitted on graceful shutdown',
    } as const),
    error: defineEvent({
      key: 'system.error',
      level: 'error',
      message: 'System error',
      doc: 'Emitted on unhandled errors',
      fields: {
        error: field.error().doc('Error details'),
        fatal: field.boolean().optional().doc('Whether error is fatal'),
      },
    } as const),
  },
} as const);

/**
 * Correlation group — with timeout and inline events.
 */
export const httpRequest = defineCorrelationGroup({
  key: 'http.request',
  type: 'correlation',
  doc: 'HTTP request lifecycle',
  timeout: 30000,
  events: {
    received: defineEvent({
      key: 'http.request.received',
      level: 'info',
      message: 'Request received',
      doc: 'Emitted when request arrives',
      fields: {
        method: field.string().doc('HTTP method'),
        path: field.string().doc('Request path'),
        ip: field.string().optional().doc('Client IP'),
      },
    } as const),
    completed: defineEvent({
      key: 'http.request.completed',
      level: 'info',
      message: 'Request completed',
      doc: 'Emitted when response is sent',
      fields: {
        statusCode: field.number().doc('Response status code'),
        duration: field.number().doc('Duration in ms'),
      },
    } as const),
  },
});
