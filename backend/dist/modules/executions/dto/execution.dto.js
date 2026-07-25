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
exports.CreateExecutionDto = exports.ExecutionSettingsDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const swagger_1 = require("@nestjs/swagger");
class ExecutionSettingsDto {
}
exports.ExecutionSettingsDto = ExecutionSettingsDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 900 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], ExecutionSettingsDto.prototype, "timeoutSeconds", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 0, description: 'Reruns per failed test' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(10),
    __metadata("design:type", Number)
], ExecutionSettingsDto.prototype, "retries", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 1 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(16),
    __metadata("design:type", Number)
], ExecutionSettingsDto.prototype, "workers", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 0, description: 'Playwright slow-motion in ms' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ExecutionSettingsDto.prototype, "slowMoMs", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        default: 'on-failure',
        enum: ['on-failure', 'every-test', 'off'],
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['on-failure', 'every-test', 'off']),
    __metadata("design:type", String)
], ExecutionSettingsDto.prototype, "screenshotMode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: false, description: 'Record video evidence' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ExecutionSettingsDto.prototype, "video", void 0);
class CreateExecutionDto {
}
exports.CreateExecutionDto = CreateExecutionDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateExecutionDto.prototype, "projectId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: [String] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], CreateExecutionDto.prototype, "automationIds", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: [String] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], CreateExecutionDto.prototype, "testPaths", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 'chromium', enum: ['chromium', 'firefox', 'webkit'] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['chromium', 'firefox', 'webkit']),
    __metadata("design:type", String)
], CreateExecutionDto.prototype, "browser", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: false }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateExecutionDto.prototype, "headed", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 'local' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateExecutionDto.prototype, "environment", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 'selected', enum: ['selected', 'failed', 'all'] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['selected', 'failed', 'all']),
    __metadata("design:type", String)
], CreateExecutionDto.prototype, "runScope", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: ExecutionSettingsDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => ExecutionSettingsDto),
    __metadata("design:type", ExecutionSettingsDto)
], CreateExecutionDto.prototype, "settings", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateExecutionDto.prototype, "markers", void 0);
//# sourceMappingURL=execution.dto.js.map