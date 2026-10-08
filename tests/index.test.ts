import { describe, expect, it } from 'vitest';

import * as api from '../src';
import { correlation, createChronicle, defineEvents, event, field } from '../src';
import { MockLoggerBackend } from './helpers/mock-logger';

describe('chronicler public API', () => {
  it('creates a chronicle and logs events', () => {
    const mock = new MockLoggerBackend();
    const events = defineEvents({
      system: {
        startup: event({
          level: 'info',
          message: 'started',
          doc: 'startup event',
          fields: { port: field.number().doc('port') },
        }),
      },
      http: { request: correlation({ events: {} }) },
    });
    const chronicle = createChronicle({
      events,
      backend: mock.backend,
      metadata: { deploymentId: 'dep-1' },
    });

    chronicle.system.startup({ port: 3000 });

    const payload = mock.getLastPayload();
    expect(payload?.eventKey).toBe('system.startup');
    expect(payload?.fields).toEqual({ port: 3000 });
    expect(payload?.metadata).toEqual({ deploymentId: 'dep-1' });
    expect(payload?.timestamp).toEqual(expect.any(String));
  });

  it('exports the 2.0 runtime surface', () => {
    expect(Object.keys(api)).toEqual(
      expect.arrayContaining([
        'ChroniclerError',
        'RESERVED_CATALOG_NAMES',
        'correlation',
        'createBackend',
        'createChronicle',
        'createConsoleBackend',
        'createRouterBackend',
        'defineEvents',
        'event',
        'field',
        'group',
        'isCatalog',
        'isCorrelationDefinition',
        'isEventDefinition',
        'walkCatalog',
      ]),
    );
  });

  it('no longer exports the 1.x API', () => {
    for (const removed of ['defineEvent', 'defineEventGroup', 'defineCorrelationGroup']) {
      expect(api).not.toHaveProperty(removed);
    }
  });

  it('lists the reserved catalog names', () => {
    expect(api.RESERVED_CATALOG_NAMES).toEqual([
      'fork',
      'run',
      'log',
      'addContext',
      'begin',
      'start',
      'complete',
      'fail',
      'timeout',
      'correlationId',
      'then',
    ]);
  });
});
