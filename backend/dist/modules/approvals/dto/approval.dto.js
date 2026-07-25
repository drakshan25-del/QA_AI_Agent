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
exports.BulkApprovalDto = exports.ApprovalDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
const DECISIONS = ['approved', 'rejected', 'regenerate'];
class ApprovalDto {
}
exports.ApprovalDto = ApprovalDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: DECISIONS }),
    (0, class_validator_1.IsIn)(DECISIONS),
    __metadata("design:type", String)
], ApprovalDto.prototype, "decision", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ApprovalDto.prototype, "comment", void 0);
class BulkApprovalDto {
}
exports.BulkApprovalDto = BulkApprovalDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayNotEmpty)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], BulkApprovalDto.prototype, "ids", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: DECISIONS }),
    (0, class_validator_1.IsIn)(DECISIONS),
    __metadata("design:type", String)
], BulkApprovalDto.prototype, "decision", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BulkApprovalDto.prototype, "comment", void 0);
//# sourceMappingURL=approval.dto.js.map