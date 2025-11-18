import { BackendMethodError } from './errors';

export interface ValidationMetadata {
  missingFields?: string[];
  typeErrors?: string[];
  multipleCompletes?: boolean;
}

export interface PerformanceSample {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  cpuUser?: number;
  cpuSystem?: number;
}

export interface LogPayload {
  eventKey: string;
  fields: Record<string, unknown>;
  correlationId: string;
  forkId: string;
  metadata: Record<string, unknown>;
  timestamp: string;
  _validation?: ValidationMetadata;
  _perf?: PerformanceSample;
  [key: string]: unknown;
}

export const LOG_LEVELS = {
  fatal: 0,
  critical: 1,
  alert: 2,
  error: 3,
  warn: 4,
  audit: 5,
  info: 6,
  debug: 7,
  trace: 8,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

export const DEFAULT_REQUIRED_LEVELS: LogLevel[] = [
  'fatal',
  'critical',
  'alert',
  'error',
  'warn',
  'audit',
  'info',
  'debug',
  'trace',
];

export type LogBackend = Record<LogLevel, (message: string, payload: LogPayload) => void>;

/**
 * Validate that backend has all required log level methods
 * @param backend - Logger object to validate
 * @param levels - Required log levels
 * @returns Array of missing log levels
 */
export const validateBackendMethods = (backend: LogBackend, levels: LogLevel[]): string[] => {
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
