export class UnsupportedLogLevelError extends Error {
  constructor(level: string) {
    super(`Log backend does not support level: ${level}`);
    this.name = 'UnsupportedLogLevelError';
  }
}

export class ReservedFieldError extends Error {
  constructor(fields: string[]) {
    super(`Reserved fields cannot be used in metadata: ${fields.join(', ')}`);
    this.name = 'ReservedFieldError';
  }
}

export class InvalidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConfigError';
  }
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
