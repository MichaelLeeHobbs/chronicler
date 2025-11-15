import { describe, expect, it } from 'vitest';

import { defineCorrelationGroup, defineEvent, defineEventGroup } from '../../src/core/events';

describe('event helpers', () => {
  it('preserves event typing', () => {
    const event = defineEvent({
      key: 'system.startup',
      level: 'info',
      message: 'started',
      doc: 'doc',
      fields: {
        port: { type: 'number', required: true, doc: 'port' },
        mode: { type: 'string', required: false, doc: 'mode' },
      },
    });

    expect(event.fields?.port.required).toBe(true);
  });

  it('decorates correlation groups with auto events', () => {
    const group = defineCorrelationGroup({
      key: 'api.request',
      type: 'correlation',
      doc: 'API request',
      timeout: 1000,
      events: {
        received: defineEvent({
          key: 'api.request.received',
          level: 'info',
          message: 'received',
          doc: 'request received',
        }),
      },
    });

    expect(group.events.start.key).toBe('api.request.start');
    expect(group.events.metadataWarning.fields?.attemptedKey.required).toBe(true);
  });

  it('supports nested groups', () => {
    const system = defineEventGroup({
      key: 'system',
      type: 'system',
      doc: 'system events',
      groups: {
        child: defineCorrelationGroup({
          key: 'system.child',
          type: 'correlation',
          doc: 'child',
          timeout: 200,
        }),
      },
    });

    expect(system.groups?.child.key).toBe('system.child');
  });
});
