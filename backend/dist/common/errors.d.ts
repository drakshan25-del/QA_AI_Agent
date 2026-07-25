import { HttpException, HttpStatus } from '@nestjs/common';
export declare class AppException extends HttpException {
    readonly code: string;
    readonly details?: unknown | undefined;
    constructor(code: string, message: string, status: HttpStatus, details?: unknown | undefined);
}
export declare class ValidationFailedException extends AppException {
    constructor(message: string, details?: unknown);
}
export declare class NotFoundAppException extends AppException {
    constructor(message?: string, details?: unknown);
}
export declare class ForbiddenAppException extends AppException {
    constructor(message?: string, details?: unknown);
}
export declare class UnauthorizedAppException extends AppException {
    constructor(message?: string, details?: unknown);
}
export declare class ConflictAppException extends AppException {
    readonly code2: string;
    constructor(message: string, code2?: string, details?: unknown);
}
export declare class EngineException extends AppException {
    constructor(message: string, details?: unknown);
}
