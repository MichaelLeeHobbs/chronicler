import { DEFAULT_REQUIRED_LEVELS, type LogLevel } from './constants';
import { ChroniclerError } from './errors';
import type { ValidationMetadata } from './validation';

type ConsoleMethod = 'error' | 'warn' | 'info' | 'debug';

/** Maps each Chronicler log level to its corresponding console method. */
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

/** Ordered fallback chains for backend levels — tried sequentially when a level handler is missing. */
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

export interface LogPayload {
  readonly eventKey: string;
  readonly fields: Record<string, unknown>;
  readonly correlationId: string;
  readonly forkId: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: string;
  readonly _validation?: ValidationMetadata;
}

export type LogBackend = Record<LogLevel, (message: string, payload: LogPayload) => void>;

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
    console.error(
      '[chronicler] Backend error during log emission:',
      err instanceof Error ? err.message : 'Unknown error',
    );
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
    // eslint-disable-next-line no-console -- createConsoleBackend: console IS the backend
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
      // eslint-disable-next-line no-console -- createBackend fallback: console IS the fallback backend
      backend[level] = (message: string, payload: LogPayload) => console[method](message, payload);
    }
  }
  return backend;
};

/**
 * A routing rule that pairs a backend with an optional filter.
 *
 * When `filter` is omitted the backend receives all events.
 * When provided, the backend only receives events for which `filter` returns `true`.
 */
export interface BackendRoute {
  readonly backend: LogBackend;
  readonly filter?: (level: LogLevel, payload: LogPayload) => boolean;
}

/**
 * Create a backend that routes events to multiple backends based on filter rules.
 *
 * Each route pairs a backend with an optional filter function. Events are
 * dispatched to every route whose filter matches (or to all routes without a
 * filter). This enables splitting logs into separate streams — for example,
 * maintenance/debug logs to stdout and audit events to a dedicated store.
 *
 * @param routes - One or more backend routes with optional filters
 * @returns A single LogBackend that fans out to the matching routes
 * @throws {Error} If no routes are provided
 *
 * @example
 * ```typescript
 * const router = createRouterBackend([
 *   { backend: consoleBackend, filter: (level, payload) => !payload.eventKey.startsWith('audit.') },
 *   { backend: auditBackend,   filter: (level, payload) => payload.eventKey.startsWith('audit.') },
 * ]);
 *
 * const chronicle = createChronicle({ backend: router, metadata: { appName: 'my-app' } });
 * ```
 */
export const createRouterBackend = (routes: BackendRoute[]): LogBackend => {
  if (routes.length === 0) {
    throw new Error('createRouterBackend requires at least one route.');
  }
  const backend = {} as LogBackend;
  for (const level of DEFAULT_REQUIRED_LEVELS) {
    backend[level] = (message: string, payload: LogPayload) => {
      for (const route of routes) {
        if (!route.filter || route.filter(level, payload)) {
          callBackendMethod(route.backend, level, message, payload);
        }
      }
    };
  }
  return backend;
};
