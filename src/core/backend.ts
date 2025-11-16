import type { LogLevel } from './events';

export interface ValidationMetadata {
  missingFields?: string[];
  typeErrors?: string[];
  contextCollisions?: string[];
}

export interface PerformanceSample {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

export interface LogPayload {
  eventKey: string;
  fields: Record<string, unknown>;
  correlationId: string;
  metadata: Record<string, unknown>;
  timestamp: string;
  _validation?: ValidationMetadata;
  _perf?: PerformanceSample;

  [key: string]: unknown;
}

export interface LogBackend {
  log(level: LogLevel, message: string, data: LogPayload): void;

  supportsLevel(level: LogLevel): boolean;
}

export const ensureBackendSupportsLevels = (
  backend: LogBackend,
  levels: LogLevel[],
): LogLevel[] => {
  return levels.filter((level) => !backend.supportsLevel(level));
};
