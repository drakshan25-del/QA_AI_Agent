"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineException = exports.ConflictAppException = exports.UnauthorizedAppException = exports.ForbiddenAppException = exports.NotFoundAppException = exports.ValidationFailedException = exports.AppException = void 0;
const common_1 = require("@nestjs/common");
class AppException extends common_1.HttpException {
    constructor(code, message, status, details) {
        super({ code, message, details }, status);
        this.code = code;
        this.details = details;
    }
}
exports.AppException = AppException;
class ValidationFailedException extends AppException {
    constructor(message, details) {
        super('validation_failed', message, common_1.HttpStatus.BAD_REQUEST, details);
    }
}
exports.ValidationFailedException = ValidationFailedException;
class NotFoundAppException extends AppException {
    constructor(message = 'Resource not found', details) {
        super('not_found', message, common_1.HttpStatus.NOT_FOUND, details);
    }
}
exports.NotFoundAppException = NotFoundAppException;
class ForbiddenAppException extends AppException {
    constructor(message = 'Forbidden', details) {
        super('forbidden', message, common_1.HttpStatus.FORBIDDEN, details);
    }
}
exports.ForbiddenAppException = ForbiddenAppException;
class UnauthorizedAppException extends AppException {
    constructor(message = 'Unauthorized', details) {
        super('unauthorized', message, common_1.HttpStatus.UNAUTHORIZED, details);
    }
}
exports.UnauthorizedAppException = UnauthorizedAppException;
class ConflictAppException extends AppException {
    constructor(message, code2 = 'invalid_state_transition', details) {
        super(code2, message, common_1.HttpStatus.CONFLICT, details);
        this.code2 = code2;
    }
}
exports.ConflictAppException = ConflictAppException;
class EngineException extends AppException {
    constructor(message, details) {
        super('engine_error', message, common_1.HttpStatus.BAD_GATEWAY, details);
    }
}
exports.EngineException = EngineException;
//# sourceMappingURL=errors.js.map