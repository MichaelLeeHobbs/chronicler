// import type { LogLevel } from './events';

export interface ValidationMetadata {
  missingFields?: string[];
  typeErrors?: string[];
  contextCollisions?: string[];
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

export type LogBackend = Record<string, (message: string, payload: LogPayload) => void>;

/**
 * Validate that backend has all required log level methods
 * @param backend - Logger object to validate
 * @param levels - Required log levels
 * @returns Array of missing log levels
 */
export const validateBackendMethods = (backend: LogBackend, levels: string[]): string[] => {
  const missing: string[] = [];
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
  level: string,
  message: string,
  payload: LogPayload,
): void => {
  if (typeof backend[level] === 'function') {
    backend[level](message, payload);
  } else {
    throw new Error(`Backend does not support log level: ${level}`);
  }
};
