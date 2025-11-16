/**
 * Chronicler instances for different log streams
 */

import { createChronicle } from 'chronicler';

import { config } from '../config/index.js';
import { loggerAudit, loggerHttp, loggerMain } from './logger.js';

/**
 * Create a backend adapter for any Winston logger
 */
function createBackend(logger: any) {
  return {
    fatal: (msg: string, data: unknown) => logger.fatal(msg, data),
    critical: (msg: string, data: unknown) => logger.critical(msg, data),
    alert: (msg: string, data: unknown) => logger.alert(msg, data),
    error: (msg: string, data: unknown) => logger.error(msg, data),
    warn: (msg: string, data: unknown) => logger.warn(msg, data),
    audit: (msg: string, data: unknown) => logger.audit(msg, data),
    http: (msg: string, data: unknown) => logger.http(msg, data),
    info: (msg: string, data: unknown) => logger.info(msg, data),
    debug: (msg: string, data: unknown) => logger.debug(msg, data),
    trace: (msg: string, data: unknown) => logger.trace(msg, data),
  };
}

/**
 * Main chronicle for application logs
 * Uses the 'main' CloudWatch stream
 */
export const chronicleMain = createChronicle({
  backend: createBackend(loggerMain),
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
  backend: createBackend(loggerAudit),
  metadata: {
    service: config.app.name,
    version: config.app.version,
    env: config.environment,
    stream: 'audit',
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
  backend: createBackend(loggerHttp),
  metadata: {
    service: config.app.name,
    version: config.app.version,
    env: config.environment,
    stream: 'http',
  },
  monitoring: {
    memory: false,
    cpu: false,
  },
});
