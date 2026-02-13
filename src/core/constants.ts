import * as os from 'node:os';

/**
 * Global constants used throughout Chronicler
 */

/**
 * Log level priority mapping
 * Lower numbers = higher priority/severity
 */
export const LOG_LEVELS = {
  fatal: 0, // System is unusable
  critical: 1, // Critical conditions requiring immediate attention
  alert: 2, // Action must be taken immediately
  error: 3, // Error conditions
  warn: 4, // Warning conditions
  audit: 5, // Audit trail events (compliance, security)
  info: 6, // Informational messages
  debug: 7, // Debug-level messages
  trace: 8, // Trace-level messages (very verbose)
} as const;

/**
 * All required log levels that backends must implement
 * This is a readonly array to prevent accidental modification
 */
export const DEFAULT_REQUIRED_LEVELS = [
  'fatal',
  'critical',
  'alert',
  'error',
  'warn',
  'audit',
  'info',
  'debug',
  'trace',
] as const;

/**
 * Default correlation timeout in milliseconds (5 minutes)
 */
export const DEFAULT_CORRELATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Root fork ID for the base chronicle instance
 */
export const ROOT_FORK_ID = '0';

/**
 * Separator used in hierarchical fork IDs
 * @example '1.1', '1.2.3'
 */
export const FORK_ID_SEPARATOR = '.';

/**
 * Default hostname for correlation ID generation
 */
export const DEFAULT_HOSTNAME = process.env.HOSTNAME ?? os.hostname() ?? 'unknown-host';

/**
 * Reserved prefix for Chronicler system events
 * User events cannot start with this prefix
 */
export const SYSTEM_EVENT_PREFIX = 'chronicler.';

/**
 * Default maximum number of context keys per ContextStore
 */
export const DEFAULT_MAX_CONTEXT_KEYS = 100;

/**
 * Default maximum fork nesting depth
 */
export const DEFAULT_MAX_FORK_DEPTH = 10;

/**
 * Default maximum number of active (uncompleted) correlations
 */
export const DEFAULT_MAX_ACTIVE_CORRELATIONS = 1000;
