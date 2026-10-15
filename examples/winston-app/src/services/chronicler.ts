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
 *
 * The rest of the app imports the destructured namespaces and calls them directly:
 *
 *   import { admin } from '../services/chronicler.js';
 *   admin.login({ userId, success });
 */

import { type Chronicle, createChronicle, createRouterBackend } from '@ubercode/chronicler';

import { config } from '../config/index.js';
import { events } from '../events.js';
import { loggerAudit, loggerHttp, loggerMain, toBackend } from './logger.js';

const isAudit = (eventKey: string) => eventKey.startsWith('admin.');
const isHttp = (eventKey: string) => eventKey.startsWith('http.request.');

export const chronicle: Chronicle<typeof events> = createChronicle({
  events,
  // A function backend is created lazily, on the first event.
  backend: () =>
    createRouterBackend([
      { backend: toBackend(loggerAudit), filter: (_lvl, p) => isAudit(p.eventKey) },
      { backend: toBackend(loggerHttp), filter: (_lvl, p) => isHttp(p.eventKey) },
      {
        backend: toBackend(loggerMain),
        filter: (_lvl, p) => !isAudit(p.eventKey) && !isHttp(p.eventKey),
      },
    ]),
  metadata: {
    serviceName: config.app.name,
    appVersion: config.app.version,
    env: config.environment,
  },
});

export const { system, http, admin, business } = chronicle;
