/**
 * Valid event definitions for testing CLI parser
 */

import { defineCorrelationGroup, defineEvent, defineEventGroup } from '../../../src/core/events';

export const startupEvent = defineEvent({
  key: 'system.startup',
  level: 'info',
  message: 'Application started',
  doc: 'Logged when the application starts',
  fields: {
    port: { type: 'number', required: true, doc: 'Server port' },
    mode: { type: 'string', required: false, doc: 'Runtime mode' },
  },
});

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
        duration: { type: 'number', required: true, doc: 'Query duration in ms' },
        resultCount: { type: 'number', required: true, doc: 'Number of results' },
      },
    }),
  },
});
