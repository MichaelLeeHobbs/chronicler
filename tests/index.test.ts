import { describe, expect, it, vi } from 'vitest';

import { createChronicle, defineEvent } from '../src';
import type { LogBackend, LogPayload } from '../src/core/backend';

describe('chronicler public API', () => {
  it('creates a chronicle and logs events', () => {
    const log = vi.fn<LogBackend['log']>();
    const chronicle = createChronicle({
      backend: {
        log,
        supportsLevel: () => true,
      },
      metadata: { deploymentId: 'dep-1' },
    });

    const event = defineEvent({
      key: 'system.startup',
      level: 'info',
      message: 'started',
      doc: 'startup event',
      fields: {
        port: { type: 'number', required: true, doc: 'port' },
      },
    });

    chronicle.event(event, { port: 3000 });

    const [, , payload] = log.mock.calls[0] as [string, string, LogPayload];
    expect(payload.eventKey).toBe('system.startup');
    expect(payload.fields).toEqual({ port: 3000 });
    expect(payload.timestamp).toEqual(expect.any(String));
  });
});
