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
exports.UpdateAutomationDto = exports.GenerateAutomationDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class GenerateAutomationDto {
}
exports.GenerateAutomationDto = GenerateAutomationDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayNotEmpty)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], GenerateAutomationDto.prototype, "testCaseIds", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Draft preview bypasses the approved-only gate (FR-TC-009)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], GenerateAutomationDto.prototype, "draftPreview", void 0);
class UpdateAutomationDto {
}
exports.UpdateAutomationDto = UpdateAutomationDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'The full edited script content.' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1_048_576, { message: 'content exceeds the 1 MiB limit' }),
    __metadata("design:type", String)
], UpdateAutomationDto.prototype, "content", void 0);
//# sourceMappingURL=automation.dto.js.map