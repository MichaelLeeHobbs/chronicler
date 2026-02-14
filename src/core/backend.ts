import { DEFAULT_REQUIRED_LEVELS, LOG_LEVELS } from './constants';
import { ChroniclerError } from './errors';

type ConsoleMethod = 'error' | 'warn' | 'info' | 'debug';

const CONSOLE_LEVEL_MAP: Record<LogLevel, ConsoleMethod> = {
  fatal: 'error',
  critical: 'error',
  alert: 'error',
  error: 'error',
  warn: 'warn',
  audit: 'info',
  info: 'info',
  debug: 'debug',
  trace: 'debug',
};

const LEVEL_FALLBACK_CHAINS: Record<LogLevel, readonly LogLevel[]> = {
  fatal: ['critical', 'error', 'warn', 'info'],
  critical: ['error', 'warn', 'info'],
  alert: ['error', 'warn', 'info'],
  error: ['warn', 'info'],
  warn: ['info'],
  audit: ['info'],
  info: [],
  debug: ['info'],
  trace: ['debug', 'info'],
};

export interface ValidationMetadata {
  readonly missingFields?: string[];
  readonly typeErrors?: string[];
  readonly unknownFields?: string[];
}

export interface LogPayload {
  readonly eventKey: string;
  readonly fields: Record<string, unknown>;
  readonly correlationId: string;
  readonly forkId: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: string;
  readonly _validation?: ValidationMetadata;
}

export type LogLevel = keyof typeof LOG_LEVELS;

export type LogBackend = Record<LogLevel, (message: string, payload: LogPayload) => void>;

/**
 * Validate that backend has all required log level methods
 * @param backend - Logger object to validate
 * @param levels - Required log levels
 * @returns Array of missing log levels
 */
export const validateBackendMethods = (
  backend: LogBackend,
  levels: readonly LogLevel[],
): string[] => {
  const missing: LogLevel[] = [];
  for (const level of levels) {
    if (typeof backend[level] !== 'function') {
      missing.push(level);
    }
  }
  return missing;
};

/**
 * Call a backend logger method.
 *
 * Backend exceptions are caught and reported to `console.error` so that
 * logging never crashes the caller.  Only missing backend methods (a
 * configuration error) still throw.
 *
 * @param backend - Logger object
 * @param level - Log level
 * @param message - Log message
 * @param payload - Log payload
 * @throws {ChroniclerError} `BACKEND_METHOD` if the backend does not support the log level
 */
export const callBackendMethod = (
  backend: LogBackend,
  level: LogLevel,
  message: string,
  payload: LogPayload,
): void => {
  if (typeof backend[level] !== 'function') {
    throw new ChroniclerError('BACKEND_METHOD', `Backend does not support log level: ${level}`);
  }
  try {
    backend[level](message, payload);
  } catch (err: unknown) {
    console.error('[chronicler] Backend error during log emission:', err);
  }
};

/**
 * Create a zero-config backend that logs to the console.
 *
 * Maps each of the 9 Chronicler levels to the appropriate `console` method:
 * fatal/critical/alert/error → `console.error`, warn → `console.warn`,
 * audit/info → `console.info`, debug/trace → `console.debug`.
 *
 * @returns A fully populated LogBackend using console methods for all levels
 */
export const createConsoleBackend = (): LogBackend => {
  const backend = {} as LogBackend;
  for (const level of DEFAULT_REQUIRED_LEVELS) {
    const method = CONSOLE_LEVEL_MAP[level];
    backend[level] = (message: string, payload: LogPayload) => console[method](message, payload);
  }
  return backend;
};

/**
 * Create a backend from a partial set of handlers.
 *
 * For each missing level, the fallback chain is tried in order (e.g. `fatal` →
 * `critical` → `error` → `warn` → `info`). If no fallback is provided either,
 * the corresponding `console` method is used.
 *
 * @param partial - Partial backend with handlers for a subset of log levels
 * @returns A fully populated LogBackend with fallbacks applied for missing levels
 */
export const createBackend = (partial: Partial<LogBackend>): LogBackend => {
  const backend = {} as LogBackend;
  for (const level of DEFAULT_REQUIRED_LEVELS) {
    if (typeof partial[level] === 'function') {
      backend[level] = partial[level];
      continue;
    }
    const fallback = LEVEL_FALLBACK_CHAINS[level].find((fb) => typeof partial[fb] === 'function');
    if (fallback) {
      backend[level] = partial[fallback]!;
    } else {
      const method = CONSOLE_LEVEL_MAP[level];
      backend[level] = (message: string, payload: LogPayload) => console[method](message, payload);
    }
  }
  return backend;
};
