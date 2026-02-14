import { DEFAULT_REQUIRED_LEVELS, LOG_LEVELS } from './constants';
import { BackendMethodError } from './errors';

// Re-export for public API
export { DEFAULT_REQUIRED_LEVELS, LOG_LEVELS };

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
  missingFields?: string[];
  typeErrors?: string[];
}

export interface LogPayload {
  eventKey: string;
  fields: Record<string, unknown>;
  correlationId: string;
  forkId: string;
  metadata: Record<string, unknown>;
  timestamp: string;
  _validation?: ValidationMetadata;
  [key: string]: unknown;
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
 * Call a backend logger method
 * @param backend - Logger object
 * @param level - Log level
 * @param message - Log message
 * @param payload - Log payload
 * @throws Error if the backend does not support the log level
 */
export const callBackendMethod = (
  backend: LogBackend,
  level: LogLevel,
  message: string,
  payload: LogPayload,
): void => {
  if (typeof backend[level] === 'function') {
    backend[level](message, payload);
  } else {
    // This should never happen if validateBackendMethods is used correctly
    // However, they somehow broke the contract by providing a valid backend that later became invalid
    throw new BackendMethodError(level);
  }
};

/**
 * Create a zero-config backend that logs to the console.
 *
 * Maps each of the 9 Chronicler levels to the appropriate `console` method:
 * fatal/critical/alert/error → `console.error`, warn → `console.warn`,
 * audit/info → `console.info`, debug/trace → `console.debug`.
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
