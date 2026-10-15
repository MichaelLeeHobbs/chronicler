/**
 * Comprehensive event catalog for testing the docs CLI pipeline end-to-end.
 * Exercises all field builder variations, namespaces with group() docs, correlations,
 * key overrides, mounted catalogs and edge cases.
 *
 * Imports the public entry point, which the CLI bundles as a separate copy of the package —
 * the same situation as a user's module importing the published package.
 */

import { correlation, defineEvents, event, field, group } from '../../../src/index';

/**
 * A catalog mounted inside `events` below. The parser must skip this export because it is
 * already documented as part of `events`.
 */
export const billingEvents = defineEvents({
  charge: event({
    level: 'audit',
    message: 'Card charged',
    doc: 'Emitted when a payment succeeds',
    fields: { amount: field.number().doc('Amount in cents') },
  }),
});

export const events = defineEvents({
  /** Root-level event with an explicit wire key. */
  healthCheck: event({
    key: 'app.healthCheck',
    level: 'debug',
    message: 'Health check performed',
    doc: 'Periodic health check ping',
  }),

  /** Namespace with all field type variations. */
  system: group(
    { doc: 'System lifecycle events' },
    {
      startup: event({
        level: 'info',
        message: 'Application started',
        doc: 'Emitted when the application starts',
        fields: {
          port: field.number().doc('Server port'),
          env: field.string().optional().doc('Runtime environment'),
        },
      }),
      shutdown: event({
        level: 'info',
        message: 'Application shutdown',
        doc: 'Emitted on graceful shutdown',
      }),
      error: event({
        level: 'error',
        message: 'System error',
        doc: 'Emitted on unhandled errors',
        fields: {
          error: field.error().doc('Error details'),
          fatal: field.boolean().optional().doc('Whether error is fatal'),
        },
      }),
    },
  ),

  /** Namespace holding a correlation with a timeout and a nested namespace. */
  http: group(
    { doc: 'HTTP server events' },
    {
      request: correlation({
        doc: 'HTTP request lifecycle',
        timeout: 30000,
        events: {
          received: event({
            level: 'info',
            message: 'Request received',
            doc: 'Emitted when request arrives',
            fields: {
              method: field.string().doc('HTTP method'),
              path: field.string().doc('Request path'),
              ip: field.string().optional().doc('Client IP'),
            },
          }),
          completed: event({
            level: 'info',
            message: 'Request completed',
            doc: 'Emitted when response is sent',
            fields: {
              statusCode: field.number().doc('Response status code'),
              duration: field.number().doc('Duration in ms'),
            },
          }),
          cache: {
            hit: event({ level: 'debug', message: 'Cache hit', doc: 'Response served from cache' }),
          },
        },
      }),
    },
  ),

  billing: billingEvents,
});
