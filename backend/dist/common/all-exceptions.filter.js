"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AllExceptionsFilter = void 0;
const common_1 = require("@nestjs/common");
const correlation_1 = require("./correlation");
const redact_1 = require("./redact");
let AllExceptionsFilter = class AllExceptionsFilter {
    constructor() {
        this.logger = new common_1.Logger('Http');
    }
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const res = ctx.getResponse();
        const req = ctx.getRequest();
        const correlationId = (0, correlation_1.getCorrelationId)(req);
        let status = common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        let code = 'internal_error';
        let message = 'Internal server error';
        let details;
        if (exception instanceof common_1.HttpException) {
            status = exception.getStatus();
            const body = exception.getResponse();
            if (typeof body === 'string') {
                message = body;
                code = mapCodeFromStatus(status);
            }
            else if (body && typeof body === 'object') {
                const b = body;
                code = b.code || mapCodeFromStatus(status);
                message = normaliseMessage(b.message) || message;
                details = b.details;
            }
        }
        else if (exception instanceof Error) {
            message = exception.message || message;
        }
        if (status >= 500) {
            this.logger.error(`${req.method} ${req.url} → ${status} ${code}: ${message} [${correlationId}]`, exception instanceof Error ? exception.stack : undefined);
        }
        else {
            this.logger.warn(`${req.method} ${req.url} → ${status} ${code}: ${message} [${correlationId}]`);
        }
        res.status(status).json({
            error: {
                code,
                message,
                ...(details !== undefined ? { details: (0, redact_1.redact)(details) } : {}),
                correlationId,
            },
        });
    }
};
exports.AllExceptionsFilter = AllExceptionsFilter;
exports.AllExceptionsFilter = AllExceptionsFilter = __decorate([
    (0, common_1.Catch)()
], AllExceptionsFilter);
function normaliseMessage(message) {
    if (Array.isArray(message))
        return message.join('; ');
    if (typeof message === 'string')
        return message;
    return '';
}
function mapCodeFromStatus(status) {
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
//# sourceMappingURL=all-exceptions.filter.js.map