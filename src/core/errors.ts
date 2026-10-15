export type ChroniclerErrorCode =
  | 'UNSUPPORTED_LOG_LEVEL'
  | 'RESERVED_FIELD'
  | 'BACKEND_METHOD'
  | 'FORK_DEPTH_EXCEEDED'
  | 'FIELD_VALIDATION'
  | 'INVALID_CATALOG'
  | 'INVALID_CONFIG';

/**
 * Typed error class for Chronicler configuration and runtime failures.
 * Uses a discriminator `code` to identify the specific error category.
 */
export class ChroniclerError extends Error {
  readonly code: ChroniclerErrorCode;

  /**
   * @param code - Machine-readable error category discriminator
   * @param message - Human-readable description of the error
   */
  constructor(code: ChroniclerErrorCode, message: string) {
    super(message);
    this.name = 'ChroniclerError';
    this.code = code;
  }
}
