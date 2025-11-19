import { describe, expect, it } from 'vitest';

import { createChronicle, defineEvent, t } from '../src';
import { MockLoggerBackend } from './helpers/mock-logger';

describe('chronicler public API', () => {
  it('creates a chronicle and logs events', () => {
    const mock = new MockLoggerBackend();
    const chronicle = createChronicle({
      backend: mock.backend,
      metadata: { deploymentId: 'dep-1' },
    });

    const event = defineEvent({
      key: 'system.startup',
      level: 'info',
      message: 'started',
      doc: 'startup event',
      fields: {
        port: t.number().doc('port'),
      },
    } as const);

    chronicle.event(event, { port: 3000 });

    const payload = mock.getLastPayload();
    expect(payload?.eventKey).toBe('system.startup');
    expect(payload?.fields).toEqual({ port: 3000 });
    expect(payload?.timestamp).toEqual(expect.any(String));
  });
});
