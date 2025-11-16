import { defineCorrelationGroup, defineEvent, defineEventGroup } from 'chronicler';

// System events
export const system = defineEventGroup({
  key: 'system',
  type: 'system',
  doc: 'System lifecycle events',
  events: {
    startup: defineEvent({
      key: 'system.startup',
      level: 'info',
      message: 'Application started',
      doc: 'Emitted when the app boots',
      fields: { port: { type: 'number', required: true, doc: 'Port number' } },
    }),
  },
});

// API request correlation
export const request = defineCorrelationGroup({
  key: 'api.request',
  type: 'correlation',
  doc: 'HTTP request handling',
  timeout: 10_000,
  events: {
    validated: defineEvent({
      key: 'api.request.validated',
      level: 'info',
      message: 'Request validated',
      doc: 'Validation passed',
      fields: {
        method: { type: 'string', required: true, doc: 'HTTP method' },
        path: { type: 'string', required: true, doc: 'Request path' },
      },
    }),
  },
});
