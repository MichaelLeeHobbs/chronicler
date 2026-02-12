/**
 * Valid event definitions for testing CLI parser.
 * Uses raw FieldBuilder-shaped objects (not t.* builders) because the AST parser
 * extracts object literals from source — it cannot evaluate call expressions.
 */

import { defineCorrelationGroup, defineEvent, defineEventGroup } from '../../../src/core/events';

export const startupEvent = defineEvent({
  key: 'system.startup',
  level: 'info',
  message: 'Application started',
  doc: 'Logged when the application starts',
  fields: {
    port: { _type: 'number', _required: true, _doc: 'Server port' },
    mode: { _type: 'string', _required: false, _doc: 'Runtime mode' },
  },
} as const);

export const shutdownEvent = defineEvent({
  key: 'system.shutdown',
  level: 'info',
  message: 'Application shutdown',
  doc: 'Logged when the application shuts down',
});

export const systemEvents = defineEventGroup({
  key: 'system',
  type: 'system',
  doc: 'System-level events',
  events: {
    startup: startupEvent,
    shutdown: shutdownEvent,
  },
});

export const queryEvents = defineCorrelationGroup({
  key: 'api.query',
  type: 'correlation',
  doc: 'API query operations',
  timeout: 30000,
  events: {
    executed: defineEvent({
      key: 'api.query.executed',
      level: 'info',
      message: 'Query executed',
      doc: 'Logged when query completes',
      fields: {
        duration: { _type: 'number', _required: true, _doc: 'Query duration in ms' },
        resultCount: { _type: 'number', _required: true, _doc: 'Number of results' },
      },
    } as const),
  },
});
