import { NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
export declare const CORRELATION_HEADER = "x-correlation-id";
export declare class CorrelationMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: NextFunction): void;
}
export declare function getCorrelationId(req: Request | undefined): string;
