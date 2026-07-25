"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CorrelationMiddleware = exports.CORRELATION_HEADER = void 0;
exports.getCorrelationId = getCorrelationId;
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
exports.CORRELATION_HEADER = 'x-correlation-id';
let CorrelationMiddleware = class CorrelationMiddleware {
    use(req, res, next) {
        const existing = req.header(exports.CORRELATION_HEADER);
        const correlationId = existing && existing.trim() ? existing : (0, crypto_1.randomUUID)();
        req.correlationId = correlationId;
        res.setHeader(exports.CORRELATION_HEADER, correlationId);
        next();
    }
};
exports.CorrelationMiddleware = CorrelationMiddleware;
exports.CorrelationMiddleware = CorrelationMiddleware = __decorate([
    (0, common_1.Injectable)()
], CorrelationMiddleware);
function getCorrelationId(req) {
    const cid = req
        ?.correlationId;
    return cid || (req?.header(exports.CORRELATION_HEADER) ?? (0, crypto_1.randomUUID)());
}
//# sourceMappingURL=correlation.js.map