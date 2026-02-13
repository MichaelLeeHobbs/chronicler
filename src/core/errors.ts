/**
 * Thrown when the backend is missing one or more required log-level methods.
 *
 * @param level - Comma-separated list of missing log levels
 */
export class UnsupportedLogLevelError extends Error {
  constructor(level: string) {
    super(`Log backend does not support level: ${level}`);
    this.name = 'UnsupportedLogLevelError';
  }
}

/**
 * Thrown when `config.metadata` contains reserved field names
 * (e.g. `eventKey`, `correlationId`, `timestamp`).
 *
 * @param fields - Array of reserved field names that were used
 */
export class ReservedFieldError extends Error {
  constructor(fields: string[]) {
    super(`Reserved fields cannot be used in metadata: ${fields.join(', ')}`);
    this.name = 'ReservedFieldError';
  }
}

/**
 * Thrown for general configuration errors such as a missing backend.
 *
 * @param message - Human-readable description of the configuration problem
 */
export class InvalidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConfigError';
  }
}

/**
 * Thrown at runtime when a backend method is called for a log level
 * that no longer exists on the backend object.
 *
 * @param level - The log level whose method was missing
 */
export class BackendMethodError extends Error {
  constructor(level: string) {
    super(`Backend does not support log level: ${level}`);
    this.name = 'BackendMethodError';
  }
}
