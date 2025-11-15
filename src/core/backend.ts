import type { LogLevel } from './events';

export interface LogBackend {
  log(level: LogLevel, message: string, data: Record<string, unknown>): void;
  supportsLevel(level: LogLevel): boolean;
}

export const ensureBackendSupportsLevels = (
  backend: LogBackend,
  levels: LogLevel[],
): LogLevel[] => {
  const unsupported = levels.filter((level) => !backend.supportsLevel(level));
  return unsupported;
};
