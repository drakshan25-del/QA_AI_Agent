import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Standard error contract (V2_CONTRACT §2, FR-BE-001):
 *   { error: { code, message, details?, correlationId } }
 *
 * AppException carries a stable machine `code` and optional `details`; the
 * global filter renders it (and adds the request correlationId).
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export class ValidationFailedException extends AppException {
  constructor(message: string, details?: unknown) {
    super('validation_failed', message, HttpStatus.BAD_REQUEST, details);
  }
}

export class NotFoundAppException extends AppException {
  constructor(message = 'Resource not found', details?: unknown) {
    super('not_found', message, HttpStatus.NOT_FOUND, details);
  }
}

export class ForbiddenAppException extends AppException {
  constructor(message = 'Forbidden', details?: unknown) {
    super('forbidden', message, HttpStatus.FORBIDDEN, details);
  }
}

export class UnauthorizedAppException extends AppException {
  constructor(message = 'Unauthorized', details?: unknown) {
    super('unauthorized', message, HttpStatus.UNAUTHORIZED, details);
  }
}

/** Invalid state transition → 409 + audited (V2_CONTRACT §2, FR-BE-005). */
export class ConflictAppException extends AppException {
  constructor(
    message: string,
    public readonly code2 = 'invalid_state_transition',
    details?: unknown,
  ) {
    super(code2, message, HttpStatus.CONFLICT, details);
  }
}

export class EngineException extends AppException {
  constructor(message: string, details?: unknown) {
    super('engine_error', message, HttpStatus.BAD_GATEWAY, details);
  }
}
