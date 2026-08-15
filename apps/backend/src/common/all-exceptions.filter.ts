import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { getCorrelationId } from './correlation';
import { redact } from './redact';

/**
 * Renders every error as the standard contract (FR-BE-001):
 *   { error: { code, message, details?, correlationId } }
 * Secrets are redacted from logged payloads (SEC-007).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlationId = getCorrelationId(req);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        code = mapCodeFromStatus(status);
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        code = (b.code as string) || mapCodeFromStatus(status);
        message = normaliseMessage(b.message) || message;
        details = b.details;
      }
    } else if (exception instanceof Error) {
      message = exception.message || message;
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status} ${code}: ${message} [${correlationId}]`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `${req.method} ${req.url} → ${status} ${code}: ${message} [${correlationId}]`,
      );
    }

    res.status(status).json({
      error: {
        code,
        message,
        ...(details !== undefined ? { details: redact(details) } : {}),
        correlationId,
      },
    });
  }
}

function normaliseMessage(message: unknown): string {
  if (Array.isArray(message)) return message.join('; ');
  if (typeof message === 'string') return message;
  return '';
}

function mapCodeFromStatus(status: number): string {
  switch (status) {
    case 400:
      return 'validation_failed';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'invalid_state_transition';
    case 502:
      return 'engine_error';
    default:
      return 'error';
  }
}
