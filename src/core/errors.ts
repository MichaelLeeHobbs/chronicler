export type ChroniclerErrorCode =
  | 'UNSUPPORTED_LOG_LEVEL'
  | 'RESERVED_FIELD'
  | 'INVALID_CONFIG'
  | 'BACKEND_METHOD'
  | 'FORK_DEPTH_EXCEEDED'
  | 'CORRELATION_LIMIT_EXCEEDED';

export class ChroniclerError extends Error {
  readonly code: ChroniclerErrorCode;

  constructor(code: ChroniclerErrorCode, message: string) {
    super(message);
    this.name = 'ChroniclerError';
    this.code = code;
  }
}
