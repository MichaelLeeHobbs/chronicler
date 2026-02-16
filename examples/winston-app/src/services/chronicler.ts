/**
 * Single Chronicler instance with event-based routing to multiple backends.
 *
 * Instead of creating separate chronicle instances per stream, we use
 * `createRouterBackend` to direct events to the appropriate Winston logger
 * based on event key prefix:
 *
 *   admin.*          → audit stream  (security / compliance)
 *   http.request.*   → http stream   (request lifecycle)
 *   everything else  → main stream   (application / business)
 */

import { createChronicle, createRouterBackend } from '@ubercode/chronicler';

import { config } from '../config/index.js';
import { loggerAudit, loggerHttp, loggerMain, toBackend } from './logger.js';

const mainBackend = toBackend(loggerMain);
const auditBackend = toBackend(loggerAudit);
const httpBackend = toBackend(loggerHttp);

export const chronicle = createChronicle({
  backend: createRouterBackend([
    { backend: auditBackend, filter: (_lvl, p) => p.eventKey.startsWith('admin.') },
    { backend: httpBackend, filter: (_lvl, p) => p.eventKey.startsWith('http.request.') },
    {
      backend: mainBackend,
      filter: (_lvl, p) =>
        !p.eventKey.startsWith('admin.') && !p.eventKey.startsWith('http.request.'),
    },
  ]),
  metadata: {
    serviceName: config.app.name,
    appVersion: config.app.version,
    env: config.environment,
  },
});
