import { describe, expect, it, vi } from 'vitest';

import { createChronicle, defineEvent } from '../src';

describe('chronicler public API', () => {
  it('creates a chronicle and logs events', () => {
    const log = vi.fn();
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

    expect(log).toHaveBeenCalledWith(
      'info',
      'started',
      expect.objectContaining({
        eventKey: 'system.startup',
        fields: { port: 3000 },
      }),
    );
  });
});
