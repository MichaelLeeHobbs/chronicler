/**
 * A valid catalog that trips the CLI's lint-style checks: missing docs, a field colliding with
 * a reserved payload field, and the reserved `chronicler.` prefix.
 */

import { correlation, defineEvents, event, field } from '../../../src/index';

export const events = defineEvents({
  user: {
    created: event({ level: 'info', message: 'User created' }),
    tagged: event({
      level: 'info',
      message: 'User tagged',
      doc: 'Tag added',
      fields: { eventKey: field.string() },
    }),
  },
  chronicler: {
    internal: event({ level: 'debug', message: 'Internal', doc: 'Reserved prefix' }),
    job: correlation({ doc: 'Reserved correlation', events: {} }),
  },
});
