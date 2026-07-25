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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Analysis = void 0;
const typeorm_1 = require("typeorm");
let Analysis = class Analysis {
};
exports.Analysis = Analysis;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Analysis.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], Analysis.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'requirement_id', nullable: true }),
    __metadata("design:type", Object)
], Analysis.prototype, "requirementId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'generation_run_id', nullable: true }),
    __metadata("design:type", Object)
], Analysis.prototype, "generationRunId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'schema_version', default: 'v1' }),
    __metadata("design:type", String)
], Analysis.prototype, "schemaVersion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'content_hash', default: '' }),
    __metadata("design:type", String)
], Analysis.prototype, "contentHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', name: 'risk_score', default: 5 }),
    __metadata("design:type", Number)
], Analysis.prototype, "riskScore", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json' }),
    __metadata("design:type", Object)
], Analysis.prototype, "output", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: '' }),
    __metadata("design:type", String)
], Analysis.prototype, "model", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'float', default: 0.1 }),
    __metadata("design:type", Number)
], Analysis.prototype, "temperature", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'created_by', nullable: true }),
    __metadata("design:type", Object)
], Analysis.prototype, "createdBy", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], Analysis.prototype, "createdAt", void 0);
exports.Analysis = Analysis = __decorate([
    (0, typeorm_1.Entity)('analyses')
], Analysis);
//# sourceMappingURL=analysis.entity.js.map