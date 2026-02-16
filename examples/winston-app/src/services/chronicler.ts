/**
 * Chronicler instances for different log streams
 */

import { createChronicle } from '@ubercode/chronicler';

import { config } from '../config/index.js';
import { loggerAudit, loggerHttp, loggerMain } from './logger.js';

/**
 * Main chronicle for application logs
 * Uses the 'main' CloudWatch stream
 */
export const chronicleMain = createChronicle({
  backend: loggerMain,
  metadata: {
    service: config.app.name,
    version: config.app.version,
    env: config.environment,
  },
  monitoring: {
    memory: true,
    cpu: true,
  },
});

/**
 * Audit chronicle for compliance/security logs
 * Uses the 'audit' CloudWatch stream
 */
export const chronicleAudit = createChronicle({
  backend: loggerAudit,
  metadata: {
    service: config.app.name,
    version: config.app.version,
    env: config.environment,
  },
  monitoring: {
    memory: false,
    cpu: false,
  },
});

/**
 * HTTP chronicle for request/response logs
 * Uses the 'http' CloudWatch stream
 */
export const chronicleHttp = createChronicle({
  backend: loggerHttp,
  metadata: {
    service: config.app.name,
    version: config.app.version,
    env: config.environment,
  },
  monitoring: {
    memory: false,
    cpu: false,
  },
});
