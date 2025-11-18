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

export class BackendMethodError extends Error {
  constructor(level: string) {
    super(`Backend does not support log level: ${level}`);
    this.name = 'BackendMethodError';
  }
}
