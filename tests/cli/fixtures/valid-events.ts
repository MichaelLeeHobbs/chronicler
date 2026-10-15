/**
 * Valid event catalog for testing the CLI parser.
 */

import { correlation, defineEvents, event, field, group } from '../../../src/index';

const startup = event({
  level: 'info',
  message: 'Application started',
  doc: 'Logged when the application starts',
  fields: {
    port: field.number().doc('Server port'),
    mode: field.string().optional().doc('Runtime mode'),
  },
});

export const events = defineEvents({
  system: group(
    { doc: 'System-level events' },
    {
      startup,
      shutdown: event({
        level: 'info',
        message: 'Application shutdown',
        doc: 'Logged when the application shuts down',
      }),
    },
  ),
  api: {
    query: correlation({
      doc: 'API query operations',
      timeout: 30000,
      events: {
        executed: event({
          level: 'info',
          message: 'Query executed',
          doc: 'Logged when query completes',
          fields: {
            duration: field.number().doc('Query duration in ms'),
            resultCount: field.number().doc('Number of results'),
          },
        }),
      },
    }),
  },
});

// The same catalog exported twice must only be documented once.
export default events;
