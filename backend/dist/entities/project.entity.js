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
exports.Project = void 0;
const typeorm_1 = require("typeorm");
let Project = class Project {
};
exports.Project = Project;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Project.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], Project.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: '' }),
    __metadata("design:type", String)
], Project.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'base_url', default: '' }),
    __metadata("design:type", String)
], Project.prototype, "baseUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'allowed_domains', default: 'localhost,127.0.0.1' }),
    __metadata("design:type", String)
], Project.prototype, "allowedDomains", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: '' }),
    __metadata("design:type", String)
], Project.prototype, "repository", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'test' }),
    __metadata("design:type", String)
], Project.prototype, "environment", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'active' }),
    __metadata("design:type", String)
], Project.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'llm_model', default: '' }),
    __metadata("design:type", String)
], Project.prototype, "llmModel", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'float', name: 'llm_temperature', default: 0.1 }),
    __metadata("design:type", Number)
], Project.prototype, "llmTemperature", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'pytest' }),
    __metadata("design:type", String)
], Project.prototype, "runner", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', name: 'tc_zero_pad', default: 0 }),
    __metadata("design:type", Number)
], Project.prototype, "tcZeroPad", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'created_by', nullable: true }),
    __metadata("design:type", Object)
], Project.prototype, "createdBy", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], Project.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], Project.prototype, "updatedAt", void 0);
exports.Project = Project = __decorate([
    (0, typeorm_1.Entity)('projects')
], Project);
//# sourceMappingURL=project.entity.js.map