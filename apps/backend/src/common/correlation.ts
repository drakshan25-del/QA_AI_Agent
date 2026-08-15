import { randomUUID } from 'crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Ensures every request carries an `x-correlation-id` (FR-BE-003): reuses the
 * inbound header if present, otherwise mints one. The id is echoed on the
 * response and flows browser→backend→engine and back on every event.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const existing = req.header(CORRELATION_HEADER);
    const correlationId = existing && existing.trim() ? existing : randomUUID();
    (req as Request & { correlationId: string }).correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    next();
  }
}

export function getCorrelationId(req: Request | undefined): string {
  const cid = (req as (Request & { correlationId?: string }) | undefined)
    ?.correlationId;
  return cid || (req?.header(CORRELATION_HEADER) ?? randomUUID());
}
