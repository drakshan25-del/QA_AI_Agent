"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const decorators_1 = require("../../common/decorators");
const engine_client_1 = require("../../engine/engine.client");
let HealthController = class HealthController {
    constructor(dataSource, engine) {
        this.dataSource = dataSource;
        this.engine = engine;
    }
    async health() {
        let database = 'ok';
        try {
            await this.dataSource.query('SELECT 1');
        }
        catch {
            database = 'error';
        }
        let engine = 'error';
        let ollama = 'unknown';
        try {
            const h = await this.engine.health();
            engine = h.status === 'ok' ? 'ok' : 'degraded';
            const ol = h.ollama;
            ollama = ol?.available ? 'ok' : 'unavailable';
        }
        catch {
            engine = 'error';
            ollama = 'unknown';
        }
        const status = database === 'ok' && engine === 'ok' ? 'ok' : 'degraded';
        return { status, api: 'ok', database, engine, ollama };
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, decorators_1.Public)(),
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "health", null);
exports.HealthController = HealthController = __decorate([
    (0, swagger_1.ApiTags)('health'),
    (0, common_1.Controller)('health'),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.DataSource,
        engine_client_1.EngineClient])
], HealthController);
//# sourceMappingURL=health.controller.js.map